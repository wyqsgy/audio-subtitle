@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

echo ==========================================
echo   Building Python Backend (PyInstaller)
echo ==========================================
echo.

echo [1/3] Ensuring dependencies...
pip install -r requirements.txt -q 2>nul

echo [2/3] Building standalone executable...
pyinstaller --noconfirm --clean --onefile ^
    --name "audiosubtitle-backend" ^
    --distpath "../build-resources" ^
    --add-data "audio_capture.py;." ^
    --add-data "services.py;." ^
    --add-data "main.py;." ^
    --hidden-import "uvicorn.logging" ^
    --hidden-import "uvicorn.loops" ^
    --hidden-import "uvicorn.loops.auto" ^
    --hidden-import "uvicorn.protocols" ^
    --hidden-import "uvicorn.protocols.http" ^
    --hidden-import "uvicorn.protocols.http.auto" ^
    --hidden-import "uvicorn.protocols.websockets" ^
    --hidden-import "uvicorn.protocols.websockets.auto" ^
    --hidden-import "uvicorn.lifespan" ^
    --hidden-import "uvicorn.lifespan.on" ^
    --hidden-import "fastapi" ^
    --hidden-import "websockets" ^
    --hidden-import "pydantic" ^
    --hidden-import "numpy" ^
    --hidden-import "faster_whisper" ^
    --hidden-import "ctranslate2" ^
    --collect-all "faster_whisper" ^
    --collect-all "ctranslate2" ^
    run.py

echo [3/3] Cleaning up build artifacts...
rmdir /s /q build 2>nul
del audiosubtitle-backend.spec 2>nul

echo.
echo Done! Backend executable created at: build-resources\audiosubtitle-backend.exe
echo.
cd /d "%~dp0"