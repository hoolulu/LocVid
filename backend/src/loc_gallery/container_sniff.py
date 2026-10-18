# -*- coding: utf-8 -*-
"""按文件头判断容器类型（只读前 16 字节）。

单独成模块的原因：`media_probe` 依赖 `file_stability`，而扫描层（`file_stability`）
也需要嗅探能力——放 `media_probe` 里会形成循环导入。

用途：下载工具会把超长文件名硬截断，末尾的 `.mp4` 一起被砍掉，文件本身仍是完整
MP4。扫描层只认扩展名的话这类文件永远不入库（实测：150 字符截断，两个 1~2GB 的
完整 MP4 被漏掉）。
"""
from __future__ import annotations

from pathlib import Path

# 嗅探前先看大小：几百字节的碎片不值得读，也避免误收缩略图缓存之类的小文件
SNIFF_MIN_BYTES = 64 * 1024

# 嗅探认得出的容器 → 对应扩展名（用于播放/流媒体判断时补回扩展名语义）
_CONTAINER_EXTENSIONS = {
    "mp4": ".mp4",
    "mkv": ".mkv",
    "avi": ".avi",
}


def sniff_container_kind(path: Path) -> str:
    """根据文件头判断真实容器类型：mp4 / mkv / avi / image / unknown。"""
    try:
        with path.open("rb") as f:
            head = f.read(16)
    except OSError:
        return "unknown"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image"
    if head.startswith(b"\xff\xd8\xff"):
        return "image"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image"
    if len(head) >= 8 and head[4:8] == b"ftyp":
        return "mp4"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "mkv"
    if head.startswith(b"RIFF") and head[8:12] == b"AVI ":
        return "avi"
    return "unknown"


def container_extension(kind: str) -> str | None:
    """嗅探结果 → 等价扩展名（unknown/image 返回 None）。"""
    return _CONTAINER_EXTENSIONS.get(kind)


def sniff_video_extension(path: Path) -> str | None:
    """扩展名缺失/不可信时，按文件头判断该文件其实是哪种视频容器。

    只对大文件嗅探（< SNIFF_MIN_BYTES 直接放弃），且只认 mp4/mkv/avi，
    图片（png/jpg/gif）不会被误判成视频。返回 `.mp4` 这类扩展名或 None。
    """
    try:
        if path.stat().st_size < SNIFF_MIN_BYTES:
            return None
    except OSError:
        return None
    return container_extension(sniff_container_kind(path))
