import asyncio
import json
import logging
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from audio_capture import AudioCapture, AudioBuffer
from services import AudioSubtitleService, STTConfig, LocalSTTConfig, TranslationConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

audio_capture: Optional[AudioCapture] = None
subtitle_service: Optional[AudioSubtitleService] = None
audio_buffer: Optional[AudioBuffer] = None
capture_task: Optional[asyncio.Task] = None
connected_clients: list = []


class SettingsModel(BaseModel):
    api_key: str = ""
    api_base_url: str = "https://api.openai.com/v1"
    source_language: str = "auto"
    target_language: str = "zh"
    stt_model: str = "whisper-1"
    translation_model: str = "gpt-3.5-turbo"
    recognition_mode: str = "local"
    local_model: str = "base"


class CaptureRequest(BaseModel):
    device_id: str = "default"
    translate: bool = True
    chunk_duration: float = 4.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global audio_capture, subtitle_service, audio_buffer

    audio_capture = AudioCapture()
    audio_buffer = AudioBuffer(max_duration=30.0)
    subtitle_service = AudioSubtitleService(
        local_stt_config=LocalSTTConfig(model_size="base")
    )
    logger.info("Audio Subtitle Service started")
    yield
    if audio_capture:
        audio_capture.cleanup()
    logger.info("Audio Subtitle Service stopped")


app = FastAPI(title="Audio Subtitle Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                    allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/devices")
async def get_devices():
    if not audio_capture:
        raise HTTPException(503, "Service not ready")
    return audio_capture.get_audio_devices()


@app.post("/settings")
async def update_settings(s: SettingsModel):
    global subtitle_service
    if not subtitle_service:
        return {"status": "error", "message": "Service not ready"}

    subtitle_service.set_mode(s.recognition_mode)

    if s.recognition_mode == "api" and s.api_key:
        subtitle_service.update_api_stt(STTConfig(
            api_key=s.api_key, base_url=s.api_base_url, model=s.stt_model,
            language=s.source_language if s.source_language != "auto" else None
        ))
        subtitle_service.update_translator(TranslationConfig(
            api_key=s.api_key, base_url=s.api_base_url, model=s.translation_model,
            source_language=s.source_language, target_language=s.target_language
        ))
    elif s.recognition_mode == "local":
        subtitle_service.update_local_stt(LocalSTTConfig(
            model_size=s.local_model,
            language=s.source_language if s.source_language != "auto" else None
        ))

    return {"status": "ok"}


@app.post("/capture/start")
async def start_capture(req: CaptureRequest):
    global capture_task, audio_buffer
    if capture_task and not capture_task.done():
        raise HTTPException(400, "Already capturing")
    if not audio_capture:
        raise HTTPException(503, "Service not ready")

    audio_buffer.clear()
    audio_capture.is_capturing = True
    capture_task = asyncio.create_task(
        process_audio_stream(req.device_id, req.translate, req.chunk_duration)
    )
    return {"status": "started", "device_id": req.device_id}


@app.post("/capture/stop")
async def stop_capture():
    global capture_task
    if audio_capture:
        audio_capture.stop_capture()
    if capture_task and not capture_task.done():
        capture_task.cancel()
        try:
            await capture_task
        except asyncio.CancelledError:
            pass
    capture_task = None
    return {"status": "stopped"}


@app.get("/capture/status")
async def get_status():
    return {
        "is_capturing": audio_capture.is_capturing if audio_capture else False,
        "buffer_duration": audio_buffer.duration if audio_buffer else 0
    }


async def process_audio_stream(device_id: str, translate: bool, chunk_duration: float):
    global audio_buffer
    if not audio_capture or not audio_buffer:
        return

    try:
        async for chunk in audio_capture.start_capture(device_id):
            audio_buffer.add(chunk)
            if audio_buffer.duration >= chunk_duration:
                data = audio_buffer.get(chunk_duration)
                audio_buffer.clear()
                if subtitle_service:
                    result = await subtitle_service.process(data, translate)
                    if result["original"]:
                        await broadcast({"original": result["original"],
                                          "translation": result["translation"]})
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"Stream error: {e}")


async def broadcast(result: dict):
    msg = json.dumps({"type": "subtitle", "data": result}, ensure_ascii=False)
    dead = []
    for client in connected_clients:
        try:
            await client.send_text(msg)
        except Exception:
            dead.append(client)
    for d in dead:
        connected_clients.remove(d)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                t = msg.get("type")
                if t == "settings":
                    await update_settings(SettingsModel(**msg.get("data", {})))
                    await ws.send_text(json.dumps({"type": "settings_updated"}))
                elif t == "start_capture":
                    await start_capture(CaptureRequest(**msg.get("data", {})))
                    await ws.send_text(json.dumps({"type": "capture_started"}))
                elif t == "stop_capture":
                    await stop_capture()
                    await ws.send_text(json.dumps({"type": "capture_stopped"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if ws in connected_clients:
            connected_clients.remove(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)