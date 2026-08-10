# -*- coding: utf-8 -*-
"""用户专辑（按库隔离，视频可多专辑归属）。"""
from __future__ import annotations

import json
import threading
import time
import uuid
from copy import deepcopy

from loc_gallery.config import albums_file

_lock = threading.Lock()


def _empty_raw() -> dict:
    return {"version": 1, "albums": {}, "album_order": []}


def _load_raw(library_id: str) -> dict:
    path = albums_file(library_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("albums"), dict):
                if not isinstance(data.get("album_order"), list):
                    data["album_order"] = list(data["albums"].keys())
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return _empty_raw()


def _save_raw(library_id: str, data: dict) -> dict:
    path = albums_file(library_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    # 原子写：先写临时文件再 replace，避免进程中断时截断 JSON（与缩略图索引一致）
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return data


def export_albums(library_id: str) -> dict:
    """导出专辑全量数据（备份/迁移用）。"""
    with _lock:
        return _load_raw(library_id)


def import_albums(library_id: str, data: dict) -> dict:
    """导入专辑全量数据（覆盖当前）。"""
    raw_albums = (data or {}).get("albums") or {}
    # 导入数据校验：过滤非 dict 专辑（P2）
    albums = {k: v for k, v in raw_albums.items() if isinstance(v, dict)}
    order = list((data or {}).get("album_order") or [])
    if not order:
        order = list(albums.keys())
    with _lock:
        return _save_raw(library_id, {"version": 1, "albums": albums, "album_order": order})


def migrate_video_id(library_id: str, old_id: str, new_id: str) -> None:
    """改名/移动后所有专辑里的 video_id 从旧 id 迁移到新 id（保留专辑归属）。"""
    if old_id == new_id:
        return
    with _lock:
        data = _load_raw(library_id)
        changed = False
        # ⚠️ 专辑存储用 items 键（{video_id: {added_at, position}}），video_ids 只是运行时
        # summary 字段（读不存在的键会导致迁移永远匹配不到 → 改名丢专辑的根因）
        for album in (data.get("albums") or {}).values():
            items = album.get("items") or {}
            if old_id in items:
                items[new_id] = items.pop(old_id)
                changed = True
            if album.get("cover_video_id") == old_id:
                album["cover_video_id"] = new_id
                changed = True
        if changed:
            _save_raw(library_id, data)


def _normalize_positions(items: dict) -> None:
    ordered = sorted(
        items.items(),
        key=lambda kv: (float(kv[1].get("position", 0)), float(kv[1].get("added_at", 0))),
    )
    for idx, (vid, entry) in enumerate(ordered):
        entry["position"] = idx


def _resolve_cover_video_id(album: dict, video_ids: list[str] | None = None) -> str | None:
    items = album.get("items") or {}
    cover = (album.get("cover_video_id") or "").strip()
    if cover and (cover in items or (video_ids and cover in video_ids)):
        return cover
    if video_ids:
        return video_ids[0] if video_ids else None
    if not items:
        return None
    ordered = sorted(
        items.items(),
        key=lambda kv: (float(kv[1].get("position", 0)), float(kv[1].get("added_at", 0))),
    )
    return ordered[0][0]


def _is_filter_album(album: dict) -> bool:
    return bool(album.get("filter") and album["filter"].get("tag"))


def _filter_video_ids(library_id: str, album: dict) -> list[str]:
    """标签专辑：动态聚合该标签下视频 id（按 mtime 倒序，新在前）。"""
    tag = (album.get("filter") or {}).get("tag") or ""
    if not tag:
        return []
    from loc_gallery.tag_store import get_videos_by_tag
    from loc_gallery.scanner import get_by_id

    ids = get_videos_by_tag(library_id, tag)
    # 按 mtime 倒序（最近更新的在前，封面取最新）
    with_mtime = []
    for vid in ids:
        item = get_by_id(library_id, vid)
        with_mtime.append((vid, item.mtime if item else 0))
    with_mtime.sort(key=lambda x: -x[1])
    return [vid for vid, _ in with_mtime]


def _album_summary(library_id: str, album_id: str, album: dict) -> dict:
    items = album.get("items") or {}
    if _is_filter_album(album):
        # 标签专辑：动态聚合，不写 items
        filter_ids = _filter_video_ids(library_id, album)
        cover_id = _resolve_cover_video_id(album, filter_ids)
        return {
            "id": album_id,
            "name": album.get("name") or "未命名专辑",
            "description": album.get("description") or "",
            "filter": {"tag": album["filter"]["tag"]},
            "cover_video_id": cover_id,
            "video_count": len(filter_ids),
            "created_at": album.get("created_at"),
            "updated_at": album.get("updated_at"),
        }
    cover_id = _resolve_cover_video_id(album)
    return {
        "id": album_id,
        "name": album.get("name") or "未命名专辑",
        "description": album.get("description") or "",
        "cover_video_id": cover_id,
        "video_count": len(items),
        "created_at": album.get("created_at"),
        "updated_at": album.get("updated_at"),
    }


def list_albums(library_id: str) -> list[dict]:
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        order = [aid for aid in (data.get("album_order") or []) if aid in albums]
        for aid in albums:
            if aid not in order:
                order.append(aid)
    # 标签专辑：按 tag_album_min_videos 阈值过滤（低于阈值的标签专辑不显示）
    try:
        from loc_gallery.settings_store import get_setting
        min_videos = int(get_setting("tag_album_min_videos") or 3)
    except Exception:
        min_videos = 3
    out = []
    for aid in order:
        album = albums[aid]
        summary = _album_summary(library_id, aid, album)
        if _is_filter_album(album) and summary["video_count"] < min_videos:
            continue
        out.append(summary)
    return out


def get_album(library_id: str, album_id: str) -> dict | None:
    with _lock:
        album = (_load_raw(library_id).get("albums") or {}).get(album_id)
    if not album:
        return None
    summary = _album_summary(library_id, album_id, album)
    if _is_filter_album(album):
        # 标签专辑：video_ids 动态聚合
        summary["video_ids"] = _filter_video_ids(library_id, album)
        return summary
    items = album.get("items") or {}
    video_ids = sorted(
        items.keys(),
        key=lambda vid: (
            float(items[vid].get("position", 0)),
            float(items[vid].get("added_at", 0)),
        ),
    )
    summary["video_ids"] = video_ids
    return summary


def create_album(
    library_id: str,
    name: str,
    *,
    description: str = "",
    tag: str | None = None,
) -> dict:
    """创建专辑；tag 非空则创建「标签专辑」（动态聚合该标签下视频，不写 items）。"""
    name = (name or "").strip()
    if not name:
        raise ValueError("专辑名称不能为空")
    album_id = f"alb-{uuid.uuid4().hex[:12]}"
    now = time.time()
    with _lock:
        data = _load_raw(library_id)
        albums = data.setdefault("albums", {})
        album = {
            "id": album_id,
            "name": name,
            "description": (description or "").strip(),
            "cover_video_id": None,
            "created_at": now,
            "updated_at": now,
        }
        if tag and tag.strip():
            album["filter"] = {"tag": tag.strip()}
            album["items"] = {}
        else:
            album["items"] = {}
        albums[album_id] = album
        order = data.setdefault("album_order", [])
        order.append(album_id)
        _save_raw(library_id, data)
    return get_album(library_id, album_id) or _album_summary(library_id, album_id, album)


def update_album(
    library_id: str,
    album_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    cover_video_id: str | None = None,
) -> dict | None:
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        album = albums.get(album_id)
        if not album:
            return None
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("专辑名称不能为空")
            album["name"] = name
        if description is not None:
            album["description"] = description.strip()
        if cover_video_id is not None:
            if _is_filter_album(album):
                # 标签专辑封面自动取最新，不允许手动设置
                raise ValueError("标签专辑封面自动生成，不可手动设置")
            cover_video_id = cover_video_id.strip()
            items = album.get("items") or {}
            if cover_video_id and cover_video_id not in items:
                raise ValueError("封面视频须属于该专辑")
            album["cover_video_id"] = cover_video_id or None
        album["updated_at"] = time.time()
        _save_raw(library_id, data)
    return get_album(library_id, album_id)


def delete_album(library_id: str, album_id: str) -> bool:
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        if album_id not in albums:
            return False
        del albums[album_id]
        data["album_order"] = [aid for aid in (data.get("album_order") or []) if aid != album_id]
        _save_raw(library_id, data)
    return True


def reorder_albums(library_id: str, order: list[str]) -> list[dict]:
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        seen: set[str] = set()
        new_order: list[str] = []
        for aid in order:
            if aid in albums and aid not in seen:
                new_order.append(aid)
                seen.add(aid)
        for aid in albums:
            if aid not in seen:
                new_order.append(aid)
        data["album_order"] = new_order
        _save_raw(library_id, data)
    return list_albums(library_id)


def list_album_video_ids_sorted(library_id: str, album_id: str) -> list[str]:
    album = get_album(library_id, album_id)
    if not album:
        return []
    return list(album.get("video_ids") or [])


def add_videos(library_id: str, album_id: str, video_ids: list[str]) -> dict | None:
    if not video_ids:
        album = get_album(library_id, album_id)
        return album
    now = time.time()
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        album = albums.get(album_id)
        if not album:
            return None
        if _is_filter_album(album):
            # 标签专辑只读：由标签自动聚合，不允许手动加入
            return None
        items = album.setdefault("items", {})
        max_pos = max((float(v.get("position", 0)) for v in items.values()), default=-1)
        added = 0
        for vid in video_ids:
            if not vid:
                continue
            if vid in items:
                continue
            max_pos += 1
            items[vid] = {"added_at": now, "position": max_pos}
            added += 1
        if not album.get("cover_video_id") and items:
            album["cover_video_id"] = _resolve_cover_video_id(album)
        album["updated_at"] = now
        _save_raw(library_id, data)
    out = get_album(library_id, album_id)
    if out:
        out["added"] = added
    return out


def remove_videos(library_id: str, album_id: str, video_ids: list[str]) -> dict | None:
    if not video_ids:
        return get_album(library_id, album_id)
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        album = albums.get(album_id)
        if not album:
            return None
        if _is_filter_album(album):
            return None
        items = album.get("items") or {}
        removed = 0
        for vid in video_ids:
            if vid in items:
                del items[vid]
                removed += 1
        _normalize_positions(items)
        cover = album.get("cover_video_id")
        if cover and cover not in items:
            album["cover_video_id"] = _resolve_cover_video_id(album)
        album["updated_at"] = time.time()
        _save_raw(library_id, data)
    out = get_album(library_id, album_id)
    if out:
        out["removed"] = removed
    return out


def reorder_videos(library_id: str, album_id: str, order: list[str]) -> dict | None:
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        album = albums.get(album_id)
        if not album:
            return None
        if _is_filter_album(album):
            return None
        items = album.get("items") or {}
        seen: set[str] = set()
        new_ids: list[str] = []
        for vid in order:
            if vid in items and vid not in seen:
                new_ids.append(vid)
                seen.add(vid)
        for vid in sorted(
            items.keys(),
            key=lambda v: (float(items[v].get("position", 0)), float(items[v].get("added_at", 0))),
        ):
            if vid not in seen:
                new_ids.append(vid)
        for idx, vid in enumerate(new_ids):
            items[vid]["position"] = idx
        album["updated_at"] = time.time()
        _save_raw(library_id, data)
    return get_album(library_id, album_id)


def set_cover(library_id: str, album_id: str, video_id: str) -> dict | None:
    return update_album(library_id, album_id, cover_video_id=video_id)


def get_album_ids_for_video(library_id: str, video_id: str) -> list[str]:
    with _lock:
        albums = _load_raw(library_id).get("albums") or {}
    out: list[str] = []
    tag_albums: list[tuple[str, str]] = []
    for aid, album in albums.items():
        if video_id in (album.get("items") or {}):
            out.append(aid)
        tag = (album.get("filter") or {}).get("tag")
        if tag:
            tag_albums.append((aid, tag))
    # 标签专辑：打了对应标签的视频同样计入 albumIds（前端按钮/角标据此展示）
    if tag_albums:
        from loc_gallery.tag_store import get_video_tags
        tags = set(get_video_tags(library_id, video_id))
        for aid, tag in tag_albums:
            if tag in tags:
                out.append(aid)
    return out


def get_album_map_for_videos(library_id: str, video_ids: list[str]) -> dict[str, list[str]]:
    wanted = set(video_ids)
    if not wanted:
        return {}
    with _lock:
        albums = _load_raw(library_id).get("albums") or {}
    out: dict[str, list[str]] = {vid: [] for vid in wanted}
    tag_to_aids: dict[str, list[str]] = {}
    for aid, album in albums.items():
        for vid in (album.get("items") or {}):
            if vid in wanted:
                out[vid].append(aid)
        tag = (album.get("filter") or {}).get("tag")
        if tag:
            tag_to_aids.setdefault(tag, []).append(aid)
    # 标签专辑聚合：一次读全量标签 map 反查，避免 N+1
    if tag_to_aids:
        from loc_gallery.tag_store import get_tags_map
        tags_map = get_tags_map(library_id)
        for vid in wanted:
            vtags = tags_map.get(vid) or []
            for tag in vtags:
                for aid in tag_to_aids.get(tag, ()):
                    out[vid].append(aid)
    return out


def remove_video_from_all_albums(library_id: str, video_ids: list[str]) -> int:
    if not video_ids:
        return 0
    ids = set(video_ids)
    changed = 0
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        for album in albums.values():
            items = album.get("items") or {}
            before = len(items)
            for vid in list(ids):
                items.pop(vid, None)
            if len(items) != before:
                changed += 1
                _normalize_positions(items)
                cover = album.get("cover_video_id")
                if cover and cover not in items:
                    album["cover_video_id"] = _resolve_cover_video_id(album)
                album["updated_at"] = time.time()
        if changed:
            _save_raw(library_id, data)
    return changed


def prune_missing(library_id: str, valid_ids: set[str]) -> int:
    removed = 0
    with _lock:
        data = _load_raw(library_id)
        albums = data.get("albums") or {}
        for album in albums.values():
            items = album.get("items") or {}
            before = len(items)
            album["items"] = {k: v for k, v in items.items() if k in valid_ids}
            if len(album["items"]) != before:
                removed += before - len(album["items"])
                _normalize_positions(album["items"])
                cover = album.get("cover_video_id")
                if cover and cover not in album["items"]:
                    album["cover_video_id"] = _resolve_cover_video_id(album)
                album["updated_at"] = time.time()
        if removed:
            _save_raw(library_id, data)
    return removed
