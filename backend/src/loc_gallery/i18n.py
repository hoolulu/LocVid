# -*- coding: utf-8 -*-
"""LocVid 后端 i18n —— HTTPException detail 双语翻译。

方案：固定文案以「中文原文」作为 key（server.py 无需改动），
通过 FastAPI exception handler 按请求 Accept-Language 翻译；
带参数的模板消息用前缀匹配（保留参数部分原文）。
"""

from fastapi import Request

_MSG: dict[str, dict[str, str]] = {
    # 404 / 400 常见错误
    "视频库不存在": {"zh": "视频库不存在", "en": "Library not found"},
    "视频不存在": {"zh": "视频不存在", "en": "Video not found"},
    "专辑不存在": {"zh": "专辑不存在", "en": "Album not found"},
    "缩略图不存在": {"zh": "缩略图不存在", "en": "Thumbnail not found"},
    "候选缩略图不存在": {"zh": "候选缩略图不存在", "en": "Candidate thumbnail not found"},
    "文件不存在": {"zh": "文件不存在", "en": "File not found"},
    "分类目录不存在": {"zh": "分类目录不存在", "en": "Category directory not found"},
    "前端未构建": {"zh": "前端未构建", "en": "Frontend not built"},
    "分类名不能为空": {"zh": "分类名不能为空", "en": "Category name is required"},
    "顺序不能为空": {"zh": "顺序不能为空", "en": "Order must not be empty"},
    "需要指定分类": {"zh": "需要指定分类", "en": "A category is required"},
    "需要 category, old_path, new_name": {
        "zh": "需要 category, old_path, new_name",
        "en": "category, old_path and new_name are required",
    },
    "需要 category, src_path": {
        "zh": "需要 category, src_path",
        "en": "category and src_path are required",
    },
    "action 须为 add 或 remove": {
        "zh": "action 须为 add 或 remove",
        "en": "action must be 'add' or 'remove'",
    },
    "请求体不是有效 JSON": {"zh": "请求体不是有效 JSON", "en": "Request body is not valid JSON"},
    "数据格式无效": {"zh": "数据格式无效", "en": "Invalid data format"},
    "position_sec 无效": {"zh": "position_sec 无效", "en": "Invalid position_sec"},
    "无法开始修复": {"zh": "无法开始修复", "en": "Unable to start repair"},
    "未选择视频": {"zh": "未选择视频", "en": "No video selected"},
    "未指定目标分类": {"zh": "未指定目标分类", "en": "No target category specified"},
    "缺少或无效的 candidate index (0-4)": {
        "zh": "缺少或无效的 candidate index (0-4)",
        "en": "Missing or invalid candidate index (0-4)",
    },
    "不能同时筛选收藏、最近播放与专辑": {
        "zh": "不能同时筛选收藏、最近播放与专辑",
        "en": "Cannot filter favorites, history and albums at the same time",
    },
    "同名文件已存在": {"zh": "同名文件已存在", "en": "A file with the same name already exists"},
    "已在目标分类": {"zh": "已在目标分类", "en": "Already in the target category"},
}

# 前缀匹配（参数化消息：翻译前缀，参数部分保留）
_PREFIX_MSG: list[tuple[str, dict[str, str]]] = [
    (
        "外部播放器未找到: ",
        {"zh": "外部播放器未找到: ", "en": "External player not found: "},
    ),
    (
        "无法启动外部播放器: ",
        {"zh": "无法启动外部播放器: ", "en": "Failed to launch external player: "},
    ),
    ("目录不存在: ", {"zh": "目录不存在: ", "en": "Directory not found: "}),
    ("目标目录已存在: ", {"zh": "目标目录已存在: ", "en": "Target directory already exists: "}),
    ("目标路径已存在: ", {"zh": "目标路径已存在: ", "en": "Target path already exists: "}),
    ("目标已存在: ", {"zh": "目标已存在: ", "en": "Target already exists: "}),
]


def get_lang(request: Request) -> str:
    """从 Accept-Language 解析语言：en 开头 → en，其余默认 zh。"""
    al = (request.headers.get("accept-language") or "").lower()
    return "en" if al.startswith("en") else "zh"


def translate_detail(detail: str, lang: str) -> str:
    """翻译 HTTPException detail（原文即 key；支持前缀模板）。"""
    entry = _MSG.get(detail)
    if entry:
        return entry.get(lang, detail)
    for prefix, entry2 in _PREFIX_MSG:
        if detail.startswith(prefix):
            return entry2.get(lang, prefix) + detail[len(prefix):]
    return detail
