@echo off
chcp 65001 >nul
title Building Audio Subtitle Installer
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║     Audio Subtitle - 构建安装包          ║
echo  ╚══════════════════════════════════════════╝
echo.

echo  [ 第 1 步 / 3 ]  构建 Python 后端...
echo  ─────────────────────────────────────
call build-backend.bat
if errorlevel 1 (
    echo  [错误] 后端构建失败！
    pause
    exit /b 1
)

echo.
echo  [ 第 2 步 / 3 ]  安装前端依赖...
echo  ─────────────────────────────────────
call npm install --silent
if errorlevel 1 (
    echo  [错误] 前端依赖安装失败！
    pause
    exit /b 1
)

echo.
echo  [ 第 3 步 / 3 ]  构建安装程序...
echo  ─────────────────────────────────────
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
call npm run build
if errorlevel 1 (
    echo  [错误] 安装程序构建失败！
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║     构建完成！                            ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  安装包位置: release\Audio Subtitle Setup 1.0.0.exe
echo.
echo  运行该文件即可安装。
echo.
pause