# -*- coding: utf-8 -*-
"""services 层测试：模型参数兼容、处理管线语言分离、字幕优化、会话缓冲。"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from services import (
    build_llm_kwargs, AudioSubtitleService, SubtitleEnhancer,
    EnhancerConfig, TranslationConfig, LocalSTTConfig, STTConfig,
)


class TestBuildLLMKwargs:
    def test_standard_model(self):
        kwargs = build_llm_kwargs("gpt-4o-mini", temperature=0.2, max_tokens=512)
        assert kwargs["temperature"] == 0.2
        assert kwargs["max_tokens"] == 512

    def test_reasoning_model(self):
        for model in ("o1", "o3-mini", "gpt-5", "GPT-5-Mini"):
            kwargs = build_llm_kwargs(model, temperature=0.2, max_tokens=512)
            assert "temperature" not in kwargs, model
            assert kwargs["max_completion_tokens"] == 512, model


class FakeSTT:
    def __init__(self):
        self.received_language = "unset"

    def transcribe(self, audio_data, language=None):
        self.received_language = language
        return "hello world"


class FakeAPISTT:
    def __init__(self):
        self.received_language = "unset"

    async def transcribe(self, audio_data, language=None):
        self.received_language = language
        return "hello world"


class FakeTranslator:
    def __init__(self):
        self.received_target = "unset"

    async def translate(self, text, target_lang=None):
        self.received_target = target_lang
        return "你好世界"


class TestProcessPipeline:
    def _make_service(self, mode="local"):
        svc = AudioSubtitleService()
        svc.mode = mode
        svc.local_stt = FakeSTT() if mode == "local" else None
        svc.api_stt = FakeAPISTT() if mode == "api" else None
        svc.translator = FakeTranslator()
        return svc

    def test_language_separation(self):
        """识别源语言与翻译目标语言必须分离传递。"""
        svc = self._make_service(mode="api")
        result = asyncio.run(svc.process(b"audio", translate=True,
                                         language="en", target_lang="zh"))
        assert result["original"] == "hello world"
        assert result["translation"] == "你好世界"
        assert svc.api_stt.received_language == "en"      # STT 收到源语言
        assert svc.translator.received_target == "zh"     # 翻译收到目标语言

    def test_translation_target_defaults_to_config(self):
        svc = self._make_service()
        asyncio.run(svc.process(b"audio", translate=True, language="ja"))
        assert svc.translator.received_target is None  # 未指定时由翻译服务用配置默认值

    def test_no_translate(self):
        svc = self._make_service()
        result = asyncio.run(svc.process(b"audio", translate=False))
        assert result["translation"] == ""

    def test_session_text_accumulated(self):
        svc = self._make_service()
        asyncio.run(svc.process(b"audio", translate=True))
        texts = svc.get_session_texts()
        assert len(texts) == 1
        assert "hello world" in texts[0]
        assert "你好世界" in texts[0]

    def test_session_capped(self):
        svc = self._make_service()
        svc.SESSION_MAX_ENTRIES = 3
        for _ in range(5):
            svc.add_session_text("t")
        assert len(svc.get_session_texts()) == 3

    def test_clear_session(self):
        svc = self._make_service()
        svc.add_session_text("x")
        svc.clear_session()
        assert svc.get_session_texts() == []


class TestSubtitleEnhancer:
    def test_disabled_without_key(self):
        enhancer = SubtitleEnhancer(EnhancerConfig(api_key=""))
        assert enhancer.ready is False

    @pytest.mark.asyncio
    async def test_passthrough_without_key(self):
        enhancer = SubtitleEnhancer(EnhancerConfig(api_key=""))
        text = "嗯 这个是一个 测试"
        assert await enhancer.enhance(text) == text

    def test_service_skips_enhancer_when_disabled(self):
        svc = AudioSubtitleService()
        svc.mode = "local"
        svc.local_stt = FakeSTT()
        svc.set_enhance(False)
        svc.update_enhancer(EnhancerConfig(api_key="sk-test"))
        result = asyncio.run(svc.process(b"audio", translate=False))
        assert result["enhanced"] is False
        assert result["original"] == "hello world"


class TestSummaryFallback:
    def test_summarize_without_key(self):
        from services import SummaryService
        svc = SummaryService(__import__("services").SummaryConfig(api_key=""))
        result = asyncio.run(svc.summarize(["a", "b"]))
        assert result == {"summary": "", "key_points": []}

    def test_summarize_empty(self):
        from services import SummaryService
        svc = SummaryService(__import__("services").SummaryConfig(api_key="sk-x"))
        result = asyncio.run(svc.summarize([]))
        assert result == {"summary": "", "key_points": []}
