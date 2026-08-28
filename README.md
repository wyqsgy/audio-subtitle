# Audio Subtitle - 实时音频字幕翻译工具

<p align="center">
  <strong>实时将电脑音频转为字幕</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/electron-28-blue?logo=electron" />
  <img src="https://img.shields.io/badge/react-18-blue?logo=react" />
  <img src="https://img.shields.io/badge/typescript-5-blue?logo=typescript" />
  <img src="https://img.shields.io/badge/version-2.0.0-purple" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

## 🆕 v2.0.0 更新日志

- **AI 字幕优化**：新增 LLM 字幕后期处理引擎——自动修正 ASR 同音错别字、补全标点、去除语气词（嗯/啊/呃）与卡顿重复、合并被截断的半句；可在设置页一键开关，保留原始识别结果
- **会话纪要生成**：自动累积本次会话全部字幕（上限 500 条防内存膨胀），`POST /summary` 一键生成「一段话总结 + 要点列表 + 主题」结构化纪要
- **会话字幕导出**：`GET /session/export` 将整段会话字幕导出为 SRT 文件（含原文+译文双行）
- **修复翻译语言混淆 bug**：旧版 `process()` 把识别源语言误当作翻译目标语言传参；现在源语言（STT）与目标语言（翻译）分离传递
- **推理模型兼容**：翻译/优化模型为 o1/o3/o4/GPT-5 系时自动切换 `max_completion_tokens` 并忽略 `temperature`，不再 400
- **翻译默认模型升级**：`gpt-3.5-turbo` → `gpt-4o-mini`，支持 DeepSeek / 智谱 GLM 等 OpenAI 兼容端点
- **依赖升级**：`python-multipart ≥0.0.20`（修复 CVE-2024-24762 ReDoS）、`openai ≥1.50`、`faster-whisper ≥1.0`
- **新增测试套件**：13 个用例覆盖处理管线语言分离、字幕优化降级、会话缓冲、模型参数兼容

## 简介

Audio Subtitle 是一个基于 Electron 的桌面应用，能够实时捕获电脑音频并将其转换为字幕。支持本地 Whisper 模型和云端 API，自动生成 SRT/VTT 格式字幕文件。

## 功能特性

- **实时转写** - 实时捕获系统音频并转写为文字
- **多模型支持** - 支持本地 Whisper 模型（faster-whisper，完全离线）和云端 API
- **AI 字幕优化** - LLM 实时修正错别字、补全标点、去除语气词
- **智能翻译** - 支持多种 OpenAI 兼容模型，含推理系列自动兼容
- **会话纪要** - 一键把整段字幕归纳为结构化纪要
- **多格式导出** - 支持 SRT/VTT 字幕格式与会话 SRT 导出
- **桌面应用** - 基于 Electron 的跨平台桌面应用
- **简洁界面** - React + TypeScript 构建的现代化 UI

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建 Windows 安装包
npm run build
```

### 后端（本地开发）

```bash
cd backend
pip install -r requirements.txt
python run.py    # 默认监听 http://127.0.0.1:8765
```

### 主要 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/settings` | POST | 更新识别/翻译/字幕优化配置 |
| `/capture/start` `/capture/stop` `/capture/status` | POST/GET | 音频捕获控制 |
| `/summary` | POST | AI 会话纪要（需 API 模式） |
| `/session/export` | GET | 导出会话字幕（SRT） |
| `/session/clear` | POST | 清空会话缓冲 |
| `/ws` | WS | 实时字幕/音频电平推送 |

## 技术栈

- **前端**: React 18, TypeScript, Vite, Lucide React
- **桌面**: Electron 28, electron-builder
- **后端**: FastAPI, faster-whisper (本地 STT), OpenAI SDK (云端 STT/翻译/优化)
- **构建**: NSIS 安装程序 (Windows)

## 许可证

MIT
