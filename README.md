# Audio Subtitle - 实时音频字幕翻译工具

<p align="center">
  <strong>实时将电脑音频转为字幕</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/electron-28-blue?logo=electron" />
  <img src="https://img.shields.io/badge/react-18-blue?logo=react" />
  <img src="https://img.shields.io/badge/typescript-5-blue?logo=typescript" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

## 简介

Audio Subtitle 是一个基于 Electron 的桌面应用，能够实时捕获电脑音频并将其转换为字幕。支持本地 Whisper 模型和云端 API，自动生成 SRT/VTT 格式字幕文件。

## 功能特性

- **实时转写** - 实时捕获系统音频并转写为文字
- **多模型支持** - 支持本地 Whisper 模型和云端 API
- **多格式导出** - 支持 SRT/VTT 字幕格式
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

## 技术栈

- **前端**: React 18, TypeScript, Vite, Lucide React
- **桌面**: Electron 28, electron-builder
- **后端**: Python (音频处理)
- **构建**: NSIS 安装程序 (Windows)

## 许可证

MIT
