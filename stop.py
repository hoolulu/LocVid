# -*- coding: utf-8 -*-
"""一键停止 LocVid：停止后端 API、前端 Vite，并清理所有相关 ffmpeg/ffprobe 子进程。

用法：
    python stop.py                # 停止服务 + 清理 ffmpeg/ffprobe（改名/迁移目录前推荐）
    python stop.py --no-ffmpeg    # 只停服务，不动 ffmpeg/ffprobe

说明：
    - 后端 uvicorn / 前端 Vite 通过 PID 文件 + 端口双重兜底停止（scripts/service.py）
    - ffmpeg/ffprobe 是缩略图生成 / HLS 切片 / 重封装子进程；正常由服务进程树连带结束，
      但为避免孤儿进程占用视频文件导致改名/移动失败，这里显式兜底清理。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
SRC_DIR = PROJECT_ROOT / "backend" / "src"
for d in (SCRIPTS_DIR, SRC_DIR):
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))

from service import stop_all  # noqa: E402


def kill_ffmpeg_processes() -> int:
    """结束所有 ffmpeg/ffprobe 进程，返回被杀进程组的数量。"""
    if sys.platform != "win32":
        return 0
    killed = 0
    for name in ("ffmpeg.exe", "ffprobe.exe"):
        result = subprocess.run(
            ["taskkill", "/IM", name, "/F", "/T"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if result.returncode == 0:
            killed += 1
    return killed


def main() -> None:
    print("=== 正在停止 LocVid 服务 ===\n")
    stop_all()
    print("\n=== 服务已停止 ===")

    if "--no-ffmpeg" in sys.argv:
        print("（--no-ffmpeg：已跳过 ffmpeg 清理）")
        return

    print("正在清理 ffmpeg/ffprobe 进程（缩略图 / HLS / 重封装子进程）...")
    killed = kill_ffmpeg_processes()
    print(f"已结束 {killed} 组 ffmpeg/ffprobe 进程")
    print("\n现在可以安全地重命名 / 移动项目目录。")


if __name__ == "__main__":
    main()
