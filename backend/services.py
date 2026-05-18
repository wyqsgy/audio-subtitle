import asyncio
import logging
import io
import wave
import tempfile
import os
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False


@dataclass
class STTConfig:
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "whisper-1"
    language: Optional[str] = None


@dataclass
class LocalSTTConfig:
    model_size: str = "base"
    language: Optional[str] = None
    device: str = "auto"
    compute_type: str = "auto"


@dataclass
class TranslationConfig:
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-3.5-turbo"
    source_language: str = "auto"
    target_language: str = "zh"


class LocalSpeechToTextService:
    def __init__(self, config: LocalSTTConfig):
        self.config = config
        self._model = None
        self._model_loaded = False

    def _ensure_model(self):
        if self._model is not None:
            return
        if not FASTER_WHISPER_AVAILABLE:
            raise RuntimeError("faster-whisper not installed. Run: pip install faster-whisper")

        device = self.config.device
        compute_type = self.config.compute_type

        if device == "auto":
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                device = "cpu"

        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

        logger.info(f"Loading Whisper '{self.config.model_size}' on {device} ({compute_type})...")
        self._model = WhisperModel(
            self.config.model_size,
            device=device,
            compute_type=compute_type
        )
        self._model_loaded = True
        logger.info("Whisper model loaded.")

    def transcribe(self, audio_data: bytes, language: Optional[str] = None) -> str:
        self._ensure_model()

        temp_path = None
        try:
            fd, temp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

            with wave.open(temp_path, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(audio_data)

            segments, _ = self._model.transcribe(
                temp_path,
                language=language or self.config.language,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )

            text = " ".join(seg.text.strip() for seg in segments)
            return text.strip()

        except Exception as e:
            logger.error(f"Local transcription error: {e}")
            return ""
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    @property
    def is_ready(self) -> bool:
        return self._model_loaded


class APISpeechToTextService:
    def __init__(self, config: STTConfig):
        self.config = config
        self._client = None

    @property
    def client(self):
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self.config.api_key, base_url=self.config.base_url)
        return self._client

    async def transcribe(self, audio_data: bytes, language: Optional[str] = None) -> str:
        if not self.config.api_key:
            return ""

        try:
            buf = io.BytesIO(audio_data)
            buf.name = "audio.wav"
            resp = await self.client.audio.transcriptions.create(
                model=self.config.model,
                file=buf,
                language=language or self.config.language
            )
            return resp.text.strip()
        except Exception as e:
            logger.error(f"API transcription error: {e}")
            return ""


class TranslationService:
    def __init__(self, config: TranslationConfig):
        self.config = config
        self._client = None

    @property
    def client(self):
        if self._client is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self.config.api_key, base_url=self.config.base_url)
        return self._client

    async def translate(self, text: str, target_lang: Optional[str] = None) -> str:
        if not self.config.api_key or not text.strip():
            return ""

        lang_map = {"zh": "中文", "en": "英语", "ja": "日语", "ko": "韩语",
                     "fr": "法语", "de": "德语", "es": "西班牙语", "ru": "俄语"}
        tgt = lang_map.get(target_lang or self.config.target_language,
                           target_lang or self.config.target_language)

        try:
            resp = await self.client.chat.completions.create(
                model=self.config.model,
                messages=[
                    {"role": "system", "content": "你是专业翻译。只输出翻译结果，不要加解释。"},
                    {"role": "user", "content": f"翻译成{tgt}：\n{text}"}
                ],
                temperature=0.2,
                max_tokens=512
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return ""


class AudioSubtitleService:
    def __init__(
        self,
        stt_config: Optional[STTConfig] = None,
        local_stt_config: Optional[LocalSTTConfig] = None,
        translation_config: Optional[TranslationConfig] = None
    ):
        self.api_stt: Optional[APISpeechToTextService] = None
        self.local_stt: Optional[LocalSpeechToTextService] = None
        self.translator: Optional[TranslationService] = None
        self.mode: str = "local"

        if local_stt_config:
            self.local_stt = LocalSpeechToTextService(local_stt_config)
        if stt_config and stt_config.api_key:
            self.api_stt = APISpeechToTextService(stt_config)
        if translation_config and translation_config.api_key:
            self.translator = TranslationService(translation_config)

    def update_api_stt(self, c: STTConfig):
        self.api_stt = APISpeechToTextService(c) if c.api_key else None

    def update_local_stt(self, c: LocalSTTConfig):
        self.local_stt = LocalSpeechToTextService(c)

    def update_translator(self, c: TranslationConfig):
        self.translator = TranslationService(c) if c.api_key else None

    def set_mode(self, mode: str):
        self.mode = mode

    async def process(self, audio_data: bytes, translate: bool = True,
                      language: Optional[str] = None) -> dict:
        result = {"original": "", "translation": ""}

        if self.mode == "local" and self.local_stt:
            loop = asyncio.get_event_loop()
            original = await loop.run_in_executor(
                None, self.local_stt.transcribe, audio_data, language
            )
            result["original"] = original
        elif self.mode == "api" and self.api_stt:
            result["original"] = await self.api_stt.transcribe(audio_data, language)

        if translate and result["original"] and self.translator:
            result["translation"] = await self.translator.translate(
                result["original"], target_lang=language
            )

        return result