import asyncio
import numpy as np
from typing import Optional, AsyncGenerator
from dataclasses import dataclass, field
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import pyaudio
    PYAUDIO_AVAILABLE = True
except ImportError:
    PYAUDIO_AVAILABLE = False
    logger.warning("PyAudio not available. Run: pip install pyaudio")

try:
    from pycaw.pycaw import AudioUtilities, IAudioMeterInformation
    from comtypes import CLSCTX_ALL
    PYCAW_AVAILABLE = True
except ImportError:
    PYCAW_AVAILABLE = False


@dataclass
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    chunk_size: int = 4096
    format: int = field(default_factory=lambda: 8)


class AudioCapture:
    def __init__(self, config: Optional[AudioConfig] = None):
        self.config = config or AudioConfig()
        self.is_capturing = False
        self.audio = None
        self.stream = None
        self.meter = None

        if PYAUDIO_AVAILABLE:
            try:
                self.audio = pyaudio.PyAudio()
            except Exception as e:
                logger.error(f"Failed to init PyAudio: {e}")

        if PYCAW_AVAILABLE:
            try:
                devices = AudioUtilities.GetSpeakers()
                interface = devices.Activate(IAudioMeterInformation._iid_, CLSCTX_ALL, None)
                self.meter = interface.QueryInterface(IAudioMeterInformation)
            except Exception:
                pass

    def get_audio_devices(self) -> list:
        devices = []
        if not self.audio:
            return [{"id": "default", "name": "默认麦克风（PyAudio 不可用）", "type": "microphone"}]

        try:
            default_input = self.audio.get_default_input_device_info()
            devices.append({
                "id": "default",
                "name": default_input.get("name", "默认麦克风"),
                "type": "microphone",
                "sample_rate": int(default_input.get("defaultSampleRate", 16000))
            })
        except Exception:
            devices.append({"id": "default", "name": "默认麦克风", "type": "microphone"})

        for i in range(self.audio.get_device_count()):
            try:
                info = self.audio.get_device_info_by_index(i)
                if info.get("maxInputChannels", 0) > 0:
                    devices.append({
                        "id": str(i),
                        "name": info.get("name", f"设备 {i}"),
                        "type": "microphone",
                        "sample_rate": int(info.get("defaultSampleRate", 16000))
                    })
            except Exception:
                continue

        devices.append({"id": "system", "name": "系统音频输出 (Stereo Mix / Loopback)", "type": "system"})
        return devices

    async def start_capture(self, device_id: str = "default") -> AsyncGenerator[bytes, None]:
        if not self.audio:
            logger.error("PyAudio not available")
            return

        self.is_capturing = True
        target = self._capture_system if device_id == "system" else self._capture_mic
        async for data in target(device_id):
            yield data

    async def _capture_mic(self, device_id: str) -> AsyncGenerator[bytes, None]:
        device_index = None if device_id == "default" else int(device_id)
        try:
            self.stream = self.audio.open(
                format=self.config.format,
                channels=self.config.channels,
                rate=self.config.sample_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=self.config.chunk_size
            )
            logger.info(f"Microphone capture started: {device_id}")

            loop = asyncio.get_event_loop()
            while self.is_capturing:
                try:
                    data = await loop.run_in_executor(
                        None,
                        lambda: self.stream.read(self.config.chunk_size, exception_on_overflow=False)
                    )
                    yield data
                except Exception as e:
                    logger.error(f"Mic read error: {e}")
                    break

        except Exception as e:
            logger.error(f"Mic capture error: {e}")
        finally:
            self._close_stream()

    async def _capture_system(self, _device_id: str) -> AsyncGenerator[bytes, None]:
        logger.info("System audio capture starting...")

        loopback_idx = self._find_loopback()
        if loopback_idx is not None:
            try:
                self.stream = self.audio.open(
                    format=self.config.format,
                    channels=2,
                    rate=self.config.sample_rate,
                    input=True,
                    input_device_index=loopback_idx,
                    frames_per_buffer=self.config.chunk_size
                )
                logger.info(f"System audio capture started via loopback device #{loopback_idx}")

                loop = asyncio.get_event_loop()
                while self.is_capturing:
                    try:
                        data = await loop.run_in_executor(
                            None,
                            lambda: self.stream.read(self.config.chunk_size, exception_on_overflow=False)
                        )
                        mono = self._stereo_to_mono(data)
                        yield mono
                    except Exception as e:
                        logger.error(f"Loopback read error: {e}")
                        break
            except Exception as e:
                logger.error(f"Loopback capture error: {e}")
            finally:
                self._close_stream()

        if self.is_capturing:
            logger.warning("No loopback device found — falling back to microphone")
            async for data in self._capture_mic("default"):
                yield data

    def _find_loopback(self) -> Optional[int]:
        if not self.audio:
            return None
        keywords = ["loopback", "stereo mix", "wave out", "wasapi"]
        for i in range(self.audio.get_device_count()):
            try:
                name = self.audio.get_device_info_by_index(i).get("name", "").lower()
                if any(k in name for k in keywords):
                    return i
            except Exception:
                continue
        return None

    def _stereo_to_mono(self, data: bytes) -> bytes:
        arr = np.frombuffer(data, dtype=np.int16).reshape(-1, 2)
        mono = arr.mean(axis=1).astype(np.int16)
        return mono.tobytes()

    def _close_stream(self):
        if self.stream:
            try:
                self.stream.stop_stream()
            except Exception:
                pass
            try:
                self.stream.close()
            except Exception:
                pass
            self.stream = None

    def stop_capture(self):
        self.is_capturing = False
        self._close_stream()

    def cleanup(self):
        self.stop_capture()
        if self.audio:
            try:
                self.audio.terminate()
            except Exception:
                pass
            self.audio = None


class AudioBuffer:
    def __init__(self, max_duration: float = 30.0, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.max_samples = int(max_duration * sample_rate)
        self._chunks: list = []
        self._total = 0

    def add(self, chunk: bytes):
        samples = np.frombuffer(chunk, dtype=np.int16)
        self._chunks.append(samples)
        self._total += len(samples)
        while self._total > self.max_samples and self._chunks:
            removed = self._chunks.pop(0)
            self._total -= len(removed)

    def get(self, duration: Optional[float] = None) -> bytes:
        if not self._chunks:
            return b''
        flat = np.concatenate(self._chunks)
        if duration:
            n = min(int(duration * self.sample_rate), len(flat))
            flat = flat[-n:]
        return flat.tobytes()

    def clear(self):
        self._chunks.clear()
        self._total = 0

    @property
    def duration(self) -> float:
        return self._total / self.sample_rate if self.sample_rate else 0