# -*- coding: utf-8 -*-
"""随机列表「本轮已展示」记录（按库隔离 + 按筛选范围分组）。

配合硬排除策略：随机列表换一批时只从「本轮还没展示过」的池子里抽，
池子不足一页时自动开新一轮（本模块只负责记录/查询/清空，判定时机在 server）。

- 状态落盘（JSON + tmp+replace 原子写），服务重启后本轮进度不丢
- 每翻一页都会增长 → 写入做 1.5s 防抖合并，避免每个请求都落盘
"""
from __future__ import annotations

import json
import threading
import time

from loc_gallery.config import random_round_file

_FLUSH_DELAY = 1.5

_lock = threading.Lock()
# library_id -> scope -> 本轮已展示的 video id
_state: dict[str, dict[str, set[str]]] = {}
_timers: dict[str, threading.Timer] = {}


def _load_raw(library_id: str) -> dict:
    path = random_round_file(library_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("scopes"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"scopes": {}}


def _save_raw(library_id: str, scopes: dict[str, set[str]]) -> None:
    path = random_round_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "scopes": {scope: sorted(ids) for scope, ids in scopes.items() if ids},
        "updated_at": time.time(),
    }
    # 原子写：先写临时文件再 replace，避免进程中断时截断 JSON
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _scopes_locked(library_id: str) -> dict[str, set[str]]:
    """调用方需持有 _lock。首次访问时从磁盘加载。"""
    if library_id not in _state:
        raw = _load_raw(library_id).get("scopes") or {}
        _state[library_id] = {
            str(scope): {str(v) for v in (ids or [])} for scope, ids in raw.items()
        }
    return _state[library_id]


def _flush_locked(library_id: str) -> None:
    timer = _timers.pop(library_id, None)
    if timer:
        timer.cancel()
    if library_id in _state:
        _save_raw(library_id, _state[library_id])


def _schedule_flush_locked(library_id: str) -> None:
    timer = _timers.pop(library_id, None)
    if timer:
        timer.cancel()
    t = threading.Timer(_FLUSH_DELAY, _flush_now, args=(library_id,))
    t.daemon = True
    _timers[library_id] = t
    t.start()


def _flush_now(library_id: str) -> None:
    with _lock:
        if library_id in _state:
            _timers.pop(library_id, None)
            _save_raw(library_id, _state[library_id])


def get_shown(library_id: str, scope: str) -> set[str]:
    """某个筛选范围本轮已展示的 id 集合。"""
    with _lock:
        return set(_scopes_locked(library_id).get(scope) or set())


def mark_shown(library_id: str, scope: str, ids: list[str]) -> int:
    """记录已展示的 id，返回本轮已展示总数（落盘防抖合并）。"""
    with _lock:
        shown = _scopes_locked(library_id).setdefault(scope, set())
        if ids:
            shown.update(ids)
            _schedule_flush_locked(library_id)
        return len(shown)


def reset_scope(library_id: str, scope: str) -> int:
    """清空某个筛选范围的本轮记录（开新一轮），返回清掉的条数，立即落盘。"""
    with _lock:
        cleared = len(_scopes_locked(library_id).pop(scope, set()) or set())
        if cleared:
            _flush_locked(library_id)
        return cleared


def flush(library_id: str | None = None) -> None:
    """立即落盘（不传 library_id 则全部）。"""
    with _lock:
        for lib in ([library_id] if library_id else list(_state)):
            if lib in _state:
                _flush_locked(lib)


def reset_cache() -> None:
    """清空内存缓存（测试用），不触碰磁盘。"""
    with _lock:
        for timer in _timers.values():
            timer.cancel()
        _timers.clear()
        _state.clear()