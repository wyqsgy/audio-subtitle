#!/usr/bin/env python3
import subprocess
import sys
import os
import time
import webbrowser
from pathlib import Path

def main():
    print("=" * 50)
    print("   Audio Subtitle - 实时音频字幕翻译")
    print("=" * 50)
    print()
    
    base_dir = Path(__file__).parent
    backend_dir = base_dir / "backend"
    
    print("[1/4] 检查 Python 环境...")
    if sys.version_info < (3, 9):
        print("[错误] 需要 Python 3.9 或更高版本")
        sys.exit(1)
    print(f"Python {sys.version_info.major}.{sys.version_info.minor} ✓")
    
    print("[2/4] 安装 Python 依赖...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "-q"],
        cwd=backend_dir,
        check=True
    )
    
    print("[3/4] 检查 Node.js 环境...")
    try:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True)
        print(f"Node.js {result.stdout.strip()} ✓")
    except FileNotFoundError:
        print("[错误] 未找到 Node.js，请先安装 Node.js 18+")
        sys.exit(1)
    
    print("[4/4] 安装前端依赖...")
    if os.name == 'nt':
        subprocess.run(["npm", "install"], cwd=base_dir, shell=True, check=True)
    else:
        subprocess.run(["npm", "install"], cwd=base_dir, check=True)
    
    print()
    print("=" * 50)
    print("   启动服务...")
    print("=" * 50)
    print()
    
    print("启动后端服务...")
    backend_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8765"],
        cwd=backend_dir
    )
    
    time.sleep(2)
    print("后端服务已启动: http://127.0.0.1:8765")
    print()
    
    print("启动前端应用...")
    if os.name == 'nt':
        subprocess.run(["npm", "run", "electron:dev"], cwd=base_dir, shell=True)
    else:
        subprocess.run(["npm", "run", "electron:dev"], cwd=base_dir)
    
    backend_process.terminate()

if __name__ == "__main__":
    main()
