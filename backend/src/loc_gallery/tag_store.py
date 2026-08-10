# -*- coding: utf-8 -*-
"""视频标签（按库隔离）。

数据模型：{"version": 1, "tags": {"<video_id>": ["HEYZO", "流出无码"]}}
- 一个视频可打多个标签，标签为字符串列表（顺序无意义）
- 与 favorite_store 同构：读盘 + _lock，无内存缓存（大库 JSON <10ms）
- 原子写（tmp + replace），migrate_id 支持改名/移动迁移
"""
from __future__ import annotations

import json
import threading

from loc_gallery.config import tags_file

_lock = threading.Lock()


def _load_raw(library_id: str) -> dict:
    path = tags_file(library_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("tags"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": 1, "tags": {}}


def _save_raw(library_id: str, data: dict) -> dict:
    path = tags_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return data


def export_tags(library_id: str) -> dict:
    """导出标签全量数据（备份/迁移用）。"""
    with _lock:
        return _load_raw(library_id)


def import_tags(library_id: str, data: dict) -> dict:
    """导入标签全量数据（覆盖当前）。"""
    raw = (data or {}).get("tags") or {}
    # 导入校验：过滤非 list 值，且列表内只保留字符串，防坏数据 500
    cleaned = {}
    for k, v in raw.items():
        if isinstance(v, list):
            cleaned[k] = [t for t in v if isinstance(t, str)]
    with _lock:
        return _save_raw(library_id, {"version": 1, "tags": cleaned})


def migrate_id(library_id: str, old_id: str, new_id: str) -> None:
    """改名/移动后标签从旧 id 迁移到新 id（随 _migrate_video_id 调用）。"""
    if old_id == new_id:
        return
    with _lock:
        data = _load_raw(library_id)
        tags = data.get("tags") or {}
        if old_id in tags:
            tags[new_id] = tags.pop(old_id)
            _save_raw(library_id, data)


def get_tags_map(library_id: str) -> dict[str, list[str]]:
    """一次读取标签索引，供列表 API 批量使用（无 N+1）。"""
    with _lock:
        return dict(_load_raw(library_id).get("tags") or {})


def get_video_tags(library_id: str, video_id: str) -> list[str]:
    with _lock:
        return list((_load_raw(library_id).get("tags") or {}).get(video_id) or [])


def set_video_tags(library_id: str, video_id: str, tags: list[str]) -> list[str]:
    """整组覆盖（手动打标用）。过滤空串/去重/裁剪空白。"""
    cleaned = list(dict.fromkeys(t.strip() for t in (tags or []) if t and t.strip()))
    with _lock:
        data = _load_raw(library_id)
        tags_map = data.setdefault("tags", {})
        if cleaned:
            tags_map[video_id] = cleaned
        else:
            tags_map.pop(video_id, None)
        _save_raw(library_id, data)
        return cleaned


def add_tags(library_id: str, video_id: str, tags: list[str]) -> list[str]:
    """追加标签（自动打标用），去重、不删除已有标签、不覆盖手动标签。"""
    cleaned = list(dict.fromkeys(t.strip() for t in (tags or []) if t and t.strip()))
    if not cleaned:
        return get_video_tags(library_id, video_id)
    with _lock:
        data = _load_raw(library_id)
        tags_map = data.setdefault("tags", {})
        existing = list(tags_map.get(video_id) or [])
        merged = list(dict.fromkeys([*existing, *cleaned]))
        if len(merged) != len(existing):
            tags_map[video_id] = merged
            _save_raw(library_id, data)
        return merged


def remove_tag(library_id: str, video_id: str, tag: str) -> list[str]:
    """移除单个标签；移除后为空则删除该视频条目。"""
    with _lock:
        data = _load_raw(library_id)
        tags_map = data.get("tags") or {}
        existing = list(tags_map.get(video_id) or [])
        if tag not in existing:
            return existing
        rest = [t for t in existing if t != tag]
        if rest:
            tags_map[video_id] = rest
        else:
            tags_map.pop(video_id, None)
        _save_raw(library_id, data)
        return rest


def prune_missing(library_id: str, valid_ids: set[str]) -> int:
    """清理已删视频的孤儿标签，返回移除条目数。"""
    with _lock:
        data = _load_raw(library_id)
        tags = data.get("tags") or {}
        before = len(tags)
        data["tags"] = {k: v for k, v in tags.items() if k in valid_ids}
        removed = before - len(data["tags"])
        if removed:
            _save_raw(library_id, data)
        return removed


def list_all_tags(library_id: str) -> list[dict]:
    """标签列表 + 每个标签的视频数（按数量降序）。"""
    with _lock:
        tags_map = _load_raw(library_id).get("tags") or {}
    counts: dict[str, int] = {}
    for vids in tags_map.values():
        for t in set(vids):
            counts[t] = counts.get(t, 0) + 1
    return sorted(
        ({"tag": t, "count": c} for t, c in counts.items()),
        key=lambda x: -x["count"],
    )


def get_videos_by_tag(library_id: str, tag: str) -> list[str]:
    """返回打了指定标签的视频 id 列表。"""
    with _lock:
        tags_map = _load_raw(library_id).get("tags") or {}
    return [vid for vid, vids in tags_map.items() if tag in vids]
