# -*- coding: utf-8 -*-
"""检测未完成下载/正在写入的视频，避免过早触发自动处理。"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable

from loc_gallery.config import (
    FILE_RECENT_MODIFY_SEC,
    FILE_STABLE_CHECK_DELAY,
    FILE_STABLE_SAMPLE_INTERVAL,
    VIDEO_EXTENSIONS,
)

_INCOMPLETE_MARKERS = (
    ".part",
    ".tmp",
    ".crdownload",
    ".download",
    ".partial",
    ".aria2",
    ".ytdl",
    ".temp",
    ".downloading",
    ".!ut",
)

_lock = threading.Lock()
_pending: set[str] = set()
_path_libraries: dict[str, str] = {}
_timers: dict[str, threading.Timer] = {}
_on_stable_callback: Callable[[Path | None], None] | None = None


def set_stable_callback(callback: Callable[[], None] | None) -> None:
    global _on_stable_callback
    _on_stable_callback = callback


def is_incomplete_filename(name: str) -> bool:
    """判断文件名是否属于"下载中"标记。

    必须按【扩展名后缀】匹配，不能用 `marker in lower` 子串匹配——
    `.part`/`.download`/`.temp` 等会误伤 The.**.part**y.mp4、Video.**.download**s.mp4、
    Movie.**.temp**late.mkv 这类正常片名（此前 P1 bug：正常视频被永久过滤不入库）。
    """
    lower = name.lower()
    return any(lower.endswith(marker) for marker in _INCOMPLETE_MARKERS)


def _stat(path: Path) -> tuple[int, float] | None:
    try:
        st = path.stat()
        return st.st_size, st.st_mtime
    except OSError:
        return None


def is_file_stable(path: Path) -> bool:
    """两次采样 size/mtime 不变则视为写入完成（会短暂 sleep）。"""
    first = _stat(path)
    if not first or first[0] <= 0:
        return False
    time.sleep(FILE_STABLE_SAMPLE_INTERVAL)
    second = _stat(path)
    if not second:
        return False
    return first == second


def is_pending(path: Path) -> bool:
    return str(path.resolve()) in _pending


def is_ready_for_index(path: Path, *, notify: bool = True, library_id: str | None = None) -> bool:
    """是否可纳入视频库索引（扫描层快速判断，不阻塞）。

    notify=True 时，若文件仍在 20s 写入窗口，会登记稳定性检查（稍后回调稳定回调）。
    仅【扫描上下文】需要该副作用；处理上下文（缩略图/修复/播放策略）绝不能触发——
    否则每次检查都会重建 5s 稳定定时器 → 稳定回调再跑一遍 _on_video_stable →
    同一文件被重复处理/重复广播 version+progress（用户反馈「提示条走两遍」）。

    登记时必须绑定库：notify_file_activity 不传库且 _path_libraries 无记录时，
    _run_stability_check 会回退到「活跃库」→ _on_video_stable 作用到错误库
    （实测：新建库首次扫描后，回调打到 lib-default，文件入错库/重复入库）。
    """
    if not path.is_file():
        return False
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return False
    if is_incomplete_filename(path.name):
        return False
    if is_pending(path):
        return False
    snap = _stat(path)
    if snap and (time.time() - snap[1]) < FILE_RECENT_MODIFY_SEC:
        if notify:
            from loc_gallery.library_context import current_library_id

            notify_file_activity(path, library_id or current_library_id())
        return False
    return True


def is_ready_for_processing(path: Path) -> bool:
    """处理前二次校验（缩略图 / probe），仅路径、无索引快照。

    不触发 notify：处理流程自身有延迟重试（_process_one 5s Timer / _repair_one 重入队），
    若在此触发 notify_file_activity 会重建稳定定时器 → 稳定回调重跑完整管道（重复处理）。
    """
    return is_ready_for_index(path, notify=False)


def is_ready_for_video(path: Path, *, size: int, mtime: float) -> bool:
    """结合扫描时的 size/mtime，判断文件是否仍在写入。

    处理/统计上下文：不触发 notify（避免稳定性回调重入）。文件的新变化事件会由
    watchdog 重新驱动处理（_on_video_stable/_on_library_changed）。
    """
    if not is_ready_for_index(path, notify=False):
        return False
    snap = _stat(path)
    if not snap:
        return False
    if snap[0] != size or snap[1] != mtime:
        return False
    return True


def clear_path_pending(path: Path) -> None:
    """修复/写入完成后清除待稳定标记，避免播放被误判为正在写入。"""
    key = str(path.resolve())
    timer = None
    with _lock:
        _pending.discard(key)
        timer = _timers.pop(key, None)
        _path_libraries.pop(key, None)
    if timer:
        timer.cancel()


def notify_file_activity(path: Path, library_id: str | None = None) -> None:
    """文件系统事件：加入待稳定队列，延迟后再触发库刷新。"""
    if is_incomplete_filename(path.name):
        return
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return
    if not path.exists():
        return

    key = str(path.resolve())
    with _lock:
        _pending.add(key)
        if library_id:
            _path_libraries[key] = library_id
        elif key in _path_libraries:
            # is_ready 路径的 notify 不带库：继承已注册的库，
            # 否则稳定回调反查不到库 → 作用到线程残留的错误库（实测 lib-23178673）
            library_id = _path_libraries[key]
        old = _timers.pop(key, None)
        if old:
            old.cancel()
        timer = threading.Timer(FILE_STABLE_CHECK_DELAY, _run_stability_check, args=(path,))
        timer.daemon = True
        _timers[key] = timer
        timer.start()


def _invoke_stable_callback(path: Path | None, library_id: str | None) -> None:
    if not _on_stable_callback:
        return
    from loc_gallery.library_context import set_thread_library

    if library_id:
        set_thread_library(library_id)
    else:
        # 仍无库（_path_libraries 已被消耗）：显式绑定活跃库，
        # 避免线程 contextvar 残留读到错误库（实测 _on_video_stable 作用到 lib-23178673）
        from loc_gallery.library_store import get_active_library_id

        set_thread_library(get_active_library_id())
    _on_stable_callback(path)


def _run_stability_check(path: Path) -> None:
    key = str(path.resolve())
    library_id = None
    if not path.is_file():
        with _lock:
            _pending.discard(key)
            _timers.pop(key, None)
            library_id = _path_libraries.pop(key, None)
        _invoke_stable_callback(None, library_id)
        return

    if is_file_stable(path):
        with _lock:
            _pending.discard(key)
            _timers.pop(key, None)
            library_id = _path_libraries.pop(key, None)
        _invoke_stable_callback(path, library_id)
        return

    with _lock:
        library_id = _path_libraries.get(key)
    notify_file_activity(path, library_id)
