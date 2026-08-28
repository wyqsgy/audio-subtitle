import asyncio
import logging
import io
import wave
import tempfile
import os
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False

# 推理模型：不接受 temperature，且需要 max_completion_tokens
_REASONING_MODEL_PREFIXES = ("o1", "o3", "o4", "gpt-5")


def build_llm_kwargs(model: str, temperature: float, max_tokens: int) -> dict:
    """按模型能力构造 chat/completions 请求参数，保证推理系列模型兼容。"""
    model_l = (model or "").lower()
    if any(model_l.startswith(p) for p in _REASONING_MODEL_PREFIXES):
        return {"model": model, "max_completion_tokens": max_tokens}
    return {"model": model, "temperature": temperature, "max_tokens": max_tokens}


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
    model: str = "gpt-4o-mini"
    source_language: str = "auto"
    target_language: str = "zh"


@dataclass
class EnhancerConfig:
    """LLM 字幕优化配置：修正 ASR 错字、补全标点、去除语气词与重复。"""
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    language: Optional[str] = None


@dataclass
class SummaryConfig:
    """会话纪要生成配置。"""
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    language: str = "zh"


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


class _ChatClientMixin:
    """共享的 AsyncOpenAI 懒加载客户端。子类需提供 self.config（含 api_key/base_url）。"""

    @property
    def client(self):
        if getattr(self, "_client", None) is None:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(
                api_key=self.config.api_key, base_url=self.config.base_url
            )
        return self._client

    @property
    def ready(self) -> bool:
        return bool(getattr(self.config, "api_key", ""))


class TranslationService(_ChatClientMixin):
    def __init__(self, config: TranslationConfig):
        self.config = config
        self._client = None

    async def translate(self, text: str, target_lang: Optional[str] = None) -> str:
        if not text.strip():
            return ""
        if not self.ready:
            return ""

        lang_map = {"zh": "中文", "en": "英语", "ja": "日语", "ko": "韩语",
                    "fr": "法语", "de": "德语", "es": "西班牙语", "ru": "俄语"}
        tgt = lang_map.get(target_lang or self.config.target_language,
                           target_lang or self.config.target_language)

        try:
            resp = await self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "你是专业翻译。只输出翻译结果，不要加解释。"},
                    {"role": "user", "content": f"翻译成{tgt}：\n{text}"}
                ],
                **build_llm_kwargs(self.config.model, temperature=0.2, max_tokens=512)
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return ""


class SubtitleEnhancer(_ChatClientMixin):
    """用 LLM 优化 ASR 字幕：修正错别字、补全标点、去除语气词与重复片段。"""

    def __init__(self, config: EnhancerConfig):
        self.config = config
        self._client = None

    async def enhance(self, text: str) -> str:
        if not text.strip() or not self.ready:
            return text

        lang_hint = f"使用{self.config.language}输出" if self.config.language else "保持原文语言"
        try:
            resp = await self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content":
                        "你是实时字幕后期处理引擎。对语音识别结果做最小修正："
                        "1) 修正同音错别字 2) 补全标点符号 3) 去除语气词（嗯、啊、呃）与卡顿重复 4) 合并被截断的半句。"
                        "禁止改写意思、禁止增删信息、禁止回答或评论内容，只输出修正后的字幕文本。"},
                    {"role": "user", "content": f"{lang_hint}：\n{text}"}
                ],
                **build_llm_kwargs(self.config.model, temperature=0.0, max_tokens=512)
            )
            return (resp.choices[0].message.content or "").strip() or text
        except Exception as e:
            logger.error(f"Subtitle enhance error: {e}")
            return text


class SummaryService(_ChatClientMixin):
    """把整段会话字幕归纳为结构化纪要。"""

    def __init__(self, config: SummaryConfig):
        self.config = config
        self._client = None

    async def summarize(self, texts: list[str]) -> dict:
        if not texts or not self.ready:
            return {"summary": "", "key_points": []}

        content = "\n".join(t for t in texts if t.strip())[-12000:]
        lang = "中文" if self.config.language.startswith("zh") else self.config.language
        try:
            resp = await self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content":
                        "你是会议/语音内容纪要助手。根据字幕内容输出 JSON："
                        '{"summary": "一段话总结", "key_points": ["要点1", "要点2", ...], "topics": ["主题"]}。'
                        "只输出 JSON。"},
                    {"role": "user", "content": f"用{lang}归纳以下字幕内容：\n{content}"}
                ],
                **build_llm_kwargs(self.config.model, temperature=0.2, max_tokens=1024)
            )
            raw = (resp.choices[0].message.content or "").strip()
            return self._parse_json(raw)
        except Exception as e:
            logger.error(f"Summary error: {e}")
            return {"summary": "", "key_points": [], "error": str(e)}

    @staticmethod
    def _parse_json(text: str) -> dict:
        import json
        candidates = [text]
        if "```json" in text:
            candidates.insert(0, text.split("```json")[1].split("```")[0])
        elif "```" in text:
            candidates.insert(0, text.split("```")[1].split("```")[0])
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            candidates.insert(0, text[start:end + 1])
        for cand in candidates:
            try:
                return json.loads(cand.strip())
            except (json.JSONDecodeError, ValueError):
                continue
        return {"summary": text[:2000], "key_points": []}


class AudioSubtitleService:
    # 会话字幕缓冲上限（防止长会话内存无限增长）
    SESSION_MAX_ENTRIES = 500

    def __init__(
        self,
        stt_config: Optional[STTConfig] = None,
        local_stt_config: Optional[LocalSTTConfig] = None,
        translation_config: Optional[TranslationConfig] = None,
        enhancer_config: Optional[EnhancerConfig] = None,
        summary_config: Optional[SummaryConfig] = None
    ):
        self.api_stt: Optional[APISpeechToTextService] = None
        self.local_stt: Optional[LocalSpeechToTextService] = None
        self.translator: Optional[TranslationService] = None
        self.enhancer: Optional[SubtitleEnhancer] = None
        self.summary_service: Optional[SummaryService] = None
        self.mode: str = "local"
        self.enhance_subtitles: bool = True
        self._session_texts: list[str] = []

        if local_stt_config:
            self.local_stt = LocalSpeechToTextService(local_stt_config)
        if stt_config and stt_config.api_key:
            self.api_stt = APISpeechToTextService(stt_config)
        if translation_config and translation_config.api_key:
            self.translator = TranslationService(translation_config)
        if enhancer_config and enhancer_config.api_key:
            self.enhancer = SubtitleEnhancer(enhancer_config)
        if summary_config and summary_config.api_key:
            self.summary_service = SummaryService(summary_config)

    def update_api_stt(self, c: STTConfig):
        self.api_stt = APISpeechToTextService(c) if c.api_key else None

    def update_local_stt(self, c: LocalSTTConfig):
        self.local_stt = LocalSpeechToTextService(c)

    def update_translator(self, c: TranslationConfig):
        self.translator = TranslationService(c) if c.api_key else None

    def update_enhancer(self, c: EnhancerConfig):
        self.enhancer = SubtitleEnhancer(c) if c.api_key else None

    def update_summary_service(self, c: SummaryConfig):
        self.summary_service = SummaryService(c) if c.api_key else None

    def set_mode(self, mode: str):
        self.mode = mode

    def set_enhance(self, enabled: bool):
        self.enhance_subtitles = enabled

    # ------------------------------------------------------------------
    # 会话字幕缓冲
    # ------------------------------------------------------------------
    def add_session_text(self, original: str, translation: str = ""):
        text = original if not translation else f"{original}\n{translation}"
        if text.strip():
            self._session_texts.append(text.strip())
            if len(self._session_texts) > self.SESSION_MAX_ENTRIES:
                self._session_texts = self._session_texts[-self.SESSION_MAX_ENTRIES:]

    def get_session_texts(self) -> list[str]:
        return list(self._session_texts)

    def clear_session(self):
        self._session_texts = []

    # ------------------------------------------------------------------
    # 主处理管线：转写 -> (可选)字幕优化 -> (可选)翻译
    # ------------------------------------------------------------------
    async def process(self, audio_data: bytes, translate: bool = True,
                      language: Optional[str] = None,
                      target_lang: Optional[str] = None) -> dict:
        """language: 识别源语言；target_lang: 翻译目标语言（None 用配置默认值）。"""
        result = {"original": "", "translation": "", "enhanced": False}

        if self.mode == "local" and self.local_stt:
            loop = asyncio.get_event_loop()
            original = await loop.run_in_executor(
                None, self.local_stt.transcribe, audio_data, language
            )
            result["original"] = original
        elif self.mode == "api" and self.api_stt:
            result["original"] = await self.api_stt.transcribe(audio_data, language)

        # LLM 字幕优化（仅本地/云端转写结果，翻译前执行）
        if self.enhance_subtitles and result["original"] and self.enhancer:
            result["original"] = await self.enhancer.enhance(result["original"])
            result["enhanced"] = True

        if translate and result["original"] and self.translator:
            result["translation"] = await self.translator.translate(
                result["original"], target_lang=target_lang
            )

        if result["original"]:
            self.add_session_text(result["original"], result["translation"])

        return result
