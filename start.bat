@echo off
chcp 65001 >nul
title Audio Subtitle
cd /d "%~dp0"

echo ========================================
echo   Audio Subtitle — 实时音频字幕
echo ========================================
echo.

echo [1/2] 安装 Python 依赖...
cd backend
pip install -r requirements.txt -q 2>nul
cd ..

echo [2/2] 安装前端依赖...
call npm install --silent 2>nul

echo.
echo 启动中...

start "AudioSubtitle-Backend" cmd /c "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port 8765 --log-level warning"
timeout /t 2 >nul

call npm run dev