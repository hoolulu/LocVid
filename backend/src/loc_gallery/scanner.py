# -*- coding: utf-8 -*-
import hashlib
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from loc_gallery.config import IGNORE_DIRS, VIDEO_EXTENSIONS, WEB_ROOT
from loc_gallery.file_stability import is_ready_for_index
from loc_gallery import title as title_mod


@dataclass
class VideoItem:
    id: str
    path: str
    category: str
    subfolder: str
    title: str
    filename: str
    size: int
    mtime: float
    library_id: str = ""


_lock = threading.Lock()
_caches: dict[str, dict[str, VideoItem]] = {}
_versions: dict[str, int] = {}
_sort_id_indexes: dict[str, dict[str, list[str]]] = {}
_category_items: dict[str, dict[str, list[VideoItem]]] = {}


def _rebuild_indexes_locked(library_id: str) -> None:
    cache = _caches.get(library_id) or {}
    items = list(cache.values())
    by_cat: dict[str, list[VideoItem]] = {}
    for item in items:
        by_cat.setdefault(item.category, []).append(item)
    _category_items[library_id] = by_cat
    _sort_id_indexes[library_id] = {
        "mtime_desc": [v.id for v in sorted(items, key=lambda x: x.mtime, reverse=True)],
        "mtime_asc": [v.id for v in sorted(items, key=lambda x: x.mtime)],
        "title_asc": [v.id for v in sorted(items, key=lambda x: x.title.lower())],
        "title_desc": [v.id for v in sorted(items, key=lambda x: x.title.lower(), reverse=True)],
        "size_desc": [v.id for v in sorted(items, key=lambda x: x.size, reverse=True)],
        "size_asc": [v.id for v in sorted(items, key=lambda x: x.size)],
        "category_asc": [v.id for v in sorted(items, key=lambda x: x.category.lower())],
    }


def _ensure_indexes_locked(library_id: str) -> None:
    if library_id not in _sort_id_indexes:
        _rebuild_indexes_locked(library_id)


def get_sorted_ids(library_id: str, sort: str) -> list[str] | None:
    with _lock:
        _ensure_indexes_locked(library_id)
        ids = (_sort_id_indexes.get(library_id) or {}).get(sort)
        return list(ids) if ids is not None else None


def get_category_sorted_ids(library_id: str, category: str, sort: str) -> list[str]:
    with _lock:
        _ensure_indexes_locked(library_id)
        items = list((_category_items.get(library_id) or {}).get(category, []))
    if sort == "random":
        return [v.id for v in items]
    if sort in ("playcount_desc", "playcount_asc"):
        # 按播放次数排序（浏览/搜索通用；scanner 不建该索引，故此处现算）
        from loc_gallery.history_store import get_history_map
        hist_map = get_history_map(library_id)
        items.sort(
            key=lambda v: int((hist_map.get(v.id) or {}).get("play_count", 0)),
            reverse=(sort == "playcount_desc"),
        )
        return [v.id for v in items]
    sort_key = {
        "mtime_desc": lambda v: v.mtime,
        "mtime_asc": lambda v: v.mtime,
        "title_asc": lambda v: v.title.lower(),
        "title_desc": lambda v: v.title.lower(),
        "size_desc": lambda v: v.size,
        "size_asc": lambda v: v.size,
        "category_asc": lambda v: v.category.lower(),
    }.get(sort, lambda v: v.mtime)
    reverse = sort in ("mtime_desc", "title_desc", "size_desc")
    items.sort(key=sort_key, reverse=reverse)
    return [v.id for v in items]


def _make_id(rel_path: str) -> str:
    return hashlib.md5(rel_path.encode("utf-8")).hexdigest()


def _is_video(path: Path) -> bool:
    return is_ready_for_index(path)


def _should_skip_dir(path: Path) -> bool:
    return path.name in IGNORE_DIRS or path == WEB_ROOT


# watch_ignore_dirs 解析结果 TTL 缓存：scan_all 每目录 + watchdog 每事件都会调用，
# 而 get_setting 每次读盘，必须缓存避免拖慢扫描/监听
_ignore_tokens_cache: dict[str, tuple[float, list[str]]] = {}
_IGNORE_TOKENS_TTL = 5.0


def _should_skip_watch_dir(path: Path, library_id: str) -> bool:
    """设置项 watch_ignore_dirs（逗号分隔的目录名）匹配时跳过扫描/监听。"""
    from loc_gallery.settings_store import get_setting
    now = time.time()
    cached = _ignore_tokens_cache.get(library_id)
    if cached is None or now - cached[0] > _IGNORE_TOKENS_TTL:
        raw = (get_setting("watch_ignore_dirs", library_id) or "").strip()
        tokens = [t.strip().lower() for t in raw.split(",") if t.strip()]
        _ignore_tokens_cache[library_id] = (now, tokens)
    else:
        tokens = cached[1]
    if not tokens:
        return False
    name = path.name.lower()
    return any(t in name for t in tokens)


def _video_item_from_path(
    video_path: Path,
    video_root: Path,
    library_id: str,
    *,
    trusted_stable: bool = False,
) -> VideoItem | None:
    video_path = video_path.resolve()
    video_root = video_root.resolve()
    if trusted_stable:
        if not video_path.is_file():
            return None
        if video_path.suffix.lower() not in VIDEO_EXTENSIONS:
            return None
        from loc_gallery.file_stability import is_incomplete_filename

        if is_incomplete_filename(video_path.name):
            return None
    elif not _is_video(video_path):
        return None
    try:
        rel = video_path.relative_to(video_root).as_posix()
    except ValueError:
        return None
    parts = Path(rel).parts
    if len(parts) == 1:
        category = "根目录"
        category_dir = video_root
        subfolder = ""
    else:
        category = parts[0]
        category_dir = video_root / parts[0]
        rel_in_cat = video_path.relative_to(category_dir)
        subfolder = "" if rel_in_cat.parent == Path(".") else rel_in_cat.parent.as_posix()
    stat = video_path.stat()
    return VideoItem(
        id=_make_id(rel),
        path=str(video_path),
        category=category,
        subfolder=subfolder,
        title=title_mod.extract_title(video_path),
        filename=video_path.name,
        size=stat.st_size,
        mtime=stat.st_mtime,
        library_id=library_id,
    )


def upsert_video_from_path(library_id: str, video_path: Path) -> VideoItem | None:
    """单个稳定文件入库（新下载完成时增量更新，避免全库扫描）。"""
    from loc_gallery.library_store import get_library

    lib = get_library(library_id)
    if not lib:
        return None
    item = _video_item_from_path(video_path, lib.path_obj, library_id, trusted_stable=True)
    if not item:
        return None
    with _lock:
        cache = _caches.setdefault(library_id, {})
        cache[item.id] = item
        _versions[library_id] = _versions.get(library_id, 0) + 1
        _sort_id_indexes.pop(library_id, None)
        _category_items.pop(library_id, None)
    return item


def scan_all(video_root: Path, library_id: str) -> list[VideoItem]:
    items: list[VideoItem] = []
    video_root = video_root.resolve()

    if not video_root.exists():
        return items

    def _add_video(video_path: Path, category: str, category_dir: Path) -> None:
        rel = video_path.relative_to(video_root).as_posix()
        rel_in_cat = video_path.relative_to(category_dir)
        subfolder = "" if rel_in_cat.parent == Path(".") else rel_in_cat.parent.as_posix()
        stat = video_path.stat()
        items.append(VideoItem(
            id=_make_id(rel),
            path=str(video_path),
            category=category,
            subfolder=subfolder,
            title=title_mod.extract_title(video_path),
            filename=video_path.name,
            size=stat.st_size,
            mtime=stat.st_mtime,
            library_id=library_id,
        ))

    try:
        for entry in video_root.iterdir():
            if _is_video(entry):
                _add_video(entry, "根目录", video_root)
    except OSError:
        return items

    try:
        for category_dir in sorted(video_root.iterdir()):
            if not category_dir.is_dir() or _should_skip_dir(category_dir):
                continue
            if _should_skip_watch_dir(category_dir, library_id):
                continue
            category = category_dir.name
            # os.walk + 剪枝：跳过 IGNORE_DIRS / 用户配置忽略的子目录（cache/node_modules/.git 等），
            # 避免 rglob 全量遍历垃圾目录（万级文件库的集中耗时点）
            for dirpath, dirnames, filenames in os.walk(category_dir):
                dirnames[:] = [
                    d for d in dirnames
                    if not _should_skip_dir(Path(dirpath) / d)
                    and not _should_skip_watch_dir(Path(dirpath) / d, library_id)
                ]
                for name in filenames:
                    video_path = Path(dirpath) / name
                    if _is_video(video_path):
                        _add_video(video_path, category, category_dir)
    except OSError:
        pass

    return items


def refresh_cache(library_id: str, video_root: Path | None = None) -> int:
    import importlib

    importlib.reload(title_mod)
    if video_root is None:
        from loc_gallery.library_store import get_library
        lib = get_library(library_id)
        if not lib:
            raise ValueError("视频库不存在")
        video_root = lib.path_obj
    items = scan_all(video_root, library_id)
    new_cache = {item.id: item for item in items}
    with _lock:
        _caches[library_id] = new_cache
        _versions[library_id] = _versions.get(library_id, 0) + 1
        _rebuild_indexes_locked(library_id)
        return _versions[library_id]


def refresh_all_libraries() -> None:
    from loc_gallery.library_store import list_libraries
    for lib in list_libraries():
        refresh_cache(lib.id, lib.path_obj)


def bump_library_version(library_id: str) -> int:
    """仅递增版本号（供 SSE / 前端刷新），不触发全库扫描。"""
    with _lock:
        _versions[library_id] = _versions.get(library_id, 0) + 1
        return _versions[library_id]


def refresh_video_item_stat(library_id: str, video_id: str) -> bool:
    """重封装等原地替换后，更新缓存中的 size/mtime。"""
    with _lock:
        item = (_caches.get(library_id) or {}).get(video_id)
        if not item:
            return False
        path = Path(item.path)
    try:
        st = path.stat()
    except OSError:
        return False
    with _lock:
        item = (_caches.get(library_id) or {}).get(video_id)
        if not item:
            return False
        item.size = st.st_size
        item.mtime = st.st_mtime
        _versions[library_id] = _versions.get(library_id, 0) + 1
        # size/mtime 变了，需失效按 size/mtime 排序的全局索引与分类索引
        _sort_id_indexes.pop(library_id, None)
        _category_items.pop(library_id, None)
        return True


def get_version(library_id: str) -> int:
    with _lock:
        return _versions.get(library_id, 0)


def get_all(library_id: str) -> list[VideoItem]:
    with _lock:
        return list((_caches.get(library_id) or {}).values())


def get_by_id(library_id: str, video_id: str) -> VideoItem | None:
    with _lock:
        return (_caches.get(library_id) or {}).get(video_id)


def get_categories(library_id: str) -> list[dict]:
    with _lock:
        cache = _caches.get(library_id) or {}
        counts: dict[str, int] = {}
        has_subfolders: dict[str, bool] = {}
        for item in cache.values():
            counts[item.category] = counts.get(item.category, 0) + 1
            if item.subfolder:
                has_subfolders[item.category] = True
    from loc_gallery.category_store import sort_categories
    cats = sort_categories(library_id, counts)
    for c in cats:
        c["has_subfolders"] = has_subfolders.get(c["name"], False)
    return cats


def get_folder_tree(library_id: str, category: str) -> dict:
    with _lock:
        items = [v for v in (_caches.get(library_id) or {}).values() if v.category == category]

    direct_count = sum(1 for v in items if not v.subfolder)
    nested: dict = {}

    def _ensure(path: str) -> dict:
        if path in nested:
            return nested[path]
        name = path.rsplit("/", 1)[-1]
        nested[path] = {"name": name, "path": path, "direct": 0, "children": []}
        return nested[path]

    for item in items:
        if not item.subfolder:
            continue
        parts = item.subfolder.split("/")
        for i in range(len(parts)):
            path = "/".join(parts[: i + 1])
            node = _ensure(path)
            if i == len(parts) - 1:
                node["direct"] += 1

    roots: list[dict] = []
    for path, node in nested.items():
        if "/" not in path:
            roots.append(node)
        else:
            parent = path.rsplit("/", 1)[0]
            if parent in nested:
                nested[parent]["children"].append(node)

    # 分类内文件夹自定义顺序（folder_order）：每层按用户拖拽顺序重排，未记录的按名称字母序
    from loc_gallery.category_store import get_folder_order
    folder_order = get_folder_order(library_id, category)

    def _sort_tree(nodes: list[dict], parent: str = "") -> list[dict]:
        nodes.sort(key=lambda n: n["name"].lower())
        ordered = folder_order.get(parent) or []
        if ordered:
            idx = {p: i for i, p in enumerate(ordered)}
            nodes.sort(key=lambda n: (idx.get(n["path"], 10_000), n["name"].lower()))
        for n in nodes:
            n["children"] = _sort_tree(n["children"], n["path"])
            n["total"] = n["direct"] + sum(c["total"] for c in n["children"])
        return nodes

    roots = _sort_tree(roots)
    return {"category": category, "direct_count": direct_count, "folders": roots}
