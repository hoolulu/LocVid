# -*- coding: utf-8 -*-
import re
from pathlib import Path

from loc_gallery.auto_tag import strip_site_noise

# 匹配 ABC-123、XYZ-540 等编号（有 - 的番号分支，勿改）
_CODE_PATTERN = re.compile(r"[A-Za-z0-9]+-\d+")

# 含中日文的标题：按字数截
_CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
# 中日文标题字数上限：卡片两行渲染，24 字比 14 字更完整（14 字会把日文标题切在半截）
_TITLE_CJK_MAX = 24
# 纯拉丁标题：留更多内容（卡片两行渲染），按词边界截
_TITLE_LATIN_MAX = 48

# 常见电影名里的 (1992) / （2021） 等
_YEAR_PAREN = re.compile(r"[\(（](?:19|20)\d{2}[\)）]")


def _truncate_latin(text: str, limit: int) -> str:
    """拉丁文按词边界截，不把单词切成两半。"""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,.;:-")


def _title_without_code(name: str) -> str:
    """无 XXX-NNN 时：有括号则截到年份右括号；否则按字数截取。"""
    name = name.strip()
    if not name:
        return name

    m = _YEAR_PAREN.search(name)
    if m:
        return name[: m.end()].strip()

    for open_ch, close_ch in (("(", ")"), ("（", "）")):
        close_idx = name.find(close_ch)
        if close_idx >= 0:
            return name[: close_idx + 1].strip()

    if _CJK_RE.search(name):
        if len(name) <= _TITLE_CJK_MAX:
            return name
        return name[:_TITLE_CJK_MAX]

    return _truncate_latin(name, _TITLE_LATIN_MAX)


def extract_title(filepath: str | Path) -> str:
    """从文件名提取标题：优先匹配 XXX-NNN 格式，否则清洗站点噪音后截取。"""
    name = Path(filepath).stem
    match = _CODE_PATTERN.search(name)
    if match:
        return match.group(0).upper()
    # 站点名（YouPorn / JAVHUB / Eporner / Free Porn Videos 等）不是标题的一部分；
    # 以前不清洗，长英文名直接按字符数硬截，会切出半个单词。
    # 清洗与自动命名共用 auto_tag._strip_title，避免两处规则各写一套。
    cleaned = strip_site_noise(name)
    return _title_without_code(cleaned or name)
