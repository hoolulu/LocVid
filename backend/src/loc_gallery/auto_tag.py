# -*- coding: utf-8 -*-
"""文件名 → (建议规范名, 标签集) 规则引擎。

面向 FetchV 等新下载视频：
- 有番号（HMN-531 / SONE-543-UC / carib...）：保留番号 + 技术标记，厂商/有码无码打标
- 无番号（英文标题/中文标题）：保留标题（去站点广告后缀），题材关键词打标
- 裸 id / 时间戳 / 无法识别：不改名、不打标（返回 None 建议，等手动）
"""
from __future__ import annotations

import os
import re

# ── 命名规则（复用生产验证过的 avv_rename_exec.py 正则）──
PREFIX_PAT = re.compile(
    r'^(?:'
    r'(?:hhd800|bbs2048|aavv38|zzpp08|gg5|18bt|2048|thz|mteam|jnty\d+|jjav)\w*\.?(?:com|net|cc|la|xyz|co|org|info|app)?@'
    r'|@[^@\s]+@'
    r'|\[(?:Thz\.la|ThZu\.Cc|Spankbang|Eporner|xvideos|pornhub|123AV|FC2|MissAV|nJAV|Njavtv|JavGG)\][ _-]*'
    r'|(?:jnty\d+|hhd800|bbs2048|avtb)\d*\.app[-_ ]*'
    r'|@\w{2,20}[ _-]*'
    r')',
    re.I,
)
TAIL_PAT = re.compile(
    r'\s*[-–—]\s*(?:nJAV|MissAV|123AV|SpankBang|Spankbang|xhamster|Xvideos|Pornhub\.com|Eporner|BongaCams|'
    r'BestJavPorn|hhd800|javguru|JavGG|t66y|第一会所|nyap2p\.com|javdb|javbus|Telegram|t\.me)[^/]*$',
    re.I,
)
SER_PATTERNS = [
    re.compile(r'(?<![a-z0-9])carib[-_]?\d{6}[-_]\d{2,4}', re.I),
    re.compile(r'(?<![a-z0-9])paco[-_]\d{6}[-_]\d{2,4}', re.I),
    re.compile(r'(?<![a-z0-9])1pon[dt]?o?[-_]?\d{6}_\d{3}', re.I),
    re.compile(r'(?<![a-z0-9])10mu[-_]\d{6}[-_]\d{2,4}', re.I),
    re.compile(r'(?<![a-z0-9])heyzo[-_]\d{3,5}', re.I),
    re.compile(r'(?<![a-z0-9])fc2[-_ ]?ppv[-_]\d+', re.I),
]
DATE_CODE = re.compile(r'(?<![0-9])\d{6}[-_]\d{3,4}')
CODE = re.compile(r'(?<![a-zA-Z0-9])([A-Za-z]{2,6})[-_]\d{2,5}(?![a-zA-Z0-9])')
TECH = re.compile(
    r'(?:[-_ ]?(?:C|UC|MR|NC|C_GG5|FHD|HD|2160p|1080p|720p|480p|2K|4K|CARIB|PACO|1PON|10MU|HEYZO))+\s*$',
    re.I,
)

# ── 标签规则 ──
_IGNORE_VENDOR = {"VIDEO", "IMG", "COM", "CN", "AV"}
_UNCENSORED = re.compile(r'-UC\b|uncensored|leaked|carib|1pon|paco|heyzo|10mu|流出|无码', re.I)
_AMATEUR = re.compile(r'HUNTC|HUNTB|HJBB|HJMO|amateur|素人|街拍|搭讪', re.I)
_CN_LIVE = re.compile(r'\bCN[-_]\d|主播|直播|国漫|cosplay', re.I)
_THEME_PATTERNS = [
    ("巨乳", re.compile(r'big tit|huge tit|large breast|爆乳|美乳|巨乳', re.I)),
    ("中出", re.compile(r'creampie|nakadashi|中出', re.I)),
    ("熟女人妻", re.compile(r'mature|milf|married|housewife|人妻|熟女', re.I)),
    ("美少女", re.compile(r'young|teen|18yo|美少女|少女|萝莉', re.I)),
    ("自慰", re.compile(r'masturbat|solo|自慰', re.I)),
    ("足交", re.compile(r'footjob|feet|足交', re.I)),
    ("口交", re.compile(r'blowjob|oral|口交', re.I)),
    ("按摩", re.compile(r'massage|按摩', re.I)),
    ("百合", re.compile(r'lesbian|scissor|百合', re.I)),
    ("Cosplay", re.compile(r'cosplay', re.I)),
]
_SITE_PATTERNS = [
    ("来源:SpankBang", re.compile(r'spankbang', re.I)),
    ("来源:Xvideos", re.compile(r'xvideos', re.I)),
    ("来源:xHamster", re.compile(r'xhamster', re.I)),
    ("来源:Pornhub", re.compile(r'pornhub', re.I)),
    ("来源:MissAV", re.compile(r'missav', re.I)),
    ("来源:pym", re.compile(r'\bpym\b', re.I)),
]

# 无法识别的裸 id / 时间戳（不改名不打标，等手动）
_UNIDENTIFIABLE = re.compile(
    (
        r'^\d{6,11}(-\d{3,4}p)?\.\w+$'
        r'|^\d{8,}_?\d{6,}?\.\w+$'
        r'|^\d{1,5}( \(\d+\))?\.\w+$'
        r'|^\(\d+\)\.\w+$'
        r'|^[0-9a-f]{32,36}\.\w+$'
        r'|^IMG_\d+\.\w+$'
        r'|^video_\d{4}-\d{2}-\d{2}'
        r'|^\w{1,3}( \(\d+\))?\.\w+$'
        r'|^tumblr_[0-9a-z]+(\(\d+\))?\.\w+$'
    ),
    re.I,
)


def _vendor_tag(name: str) -> str | None:
    m = CODE.search(name)
    if not m:
        return None
    v = m.group(1).upper()
    if v in _IGNORE_VENDOR:
        return None
    return v


def _extract_code(name: str) -> str | None:
    for pat in SER_PATTERNS:
        m = pat.search(name)
        if m:
            c = m.group(0)
            for a, b in [
                ("1pondo", "1PONDO"), ("carib", "CARIB"), ("paco", "PACO"),
                ("1pon", "1PON"), ("10mu", "10MU"), ("heyzo", "HEYZO"),
                ("fc2", "FC2"), ("ppv", "PPV"),
            ]:
                c = re.sub(a, b, c, flags=re.I)
            return c
    m = DATE_CODE.search(name)
    if m:
        return m.group(0)
    m = CODE.search(name)
    if m:
        return re.sub(r'^[A-Za-z]{2,6}', lambda x: x.group(0).upper(), m.group(0))
    return None


def _strip_title(name_stem: str) -> str:
    """去掉站点/广告前缀后缀，保留标题本体。"""
    s = name_stem
    for _ in range(3):
        n2 = PREFIX_PAT.sub('', s, count=1)
        if n2 == s:
            break
        s = n2
    s = TAIL_PAT.sub('', s)
    s = re.sub(r'\s{2,}', ' ', s).strip(' \t')
    # ⚠️ 只清理分隔符/空白，不清理 [ ]：正常文件名可能含 [1080p]/[BluRay]
    #（旧版 [\[\]_\-\.]+$ 会把 [BluRay] 的 ] 删掉 → 括号不闭合 → 破坏正常视频名）
    s = re.sub(r'^[-_\.\s]+', '', s)
    s = re.sub(r'[-_\.\s]+$', '', s)
    return s.strip(' \t')


def _suggest_name(name: str) -> str | None:
    """返回建议规范名；None = 无需改名（已规范或不可识别）。"""
    stem, ext = os.path.splitext(name)
    if _UNIDENTIFIABLE.match(name):
        return None
    # 保留分段/重名后缀 (1)/(2)，避免 112112-189 (1) → 112112-189 撞名
    seg = ''
    m = re.search(r'\((\d+)\)\s*$', stem)
    if m:
        seg = f" ({m.group(1)})"
        stem = stem[: m.start()].rstrip()
    s = _strip_title(stem)
    tm = TECH.search(s)
    tech = tm.group(0).strip() if tm else ''
    body = TECH.sub('', s).strip(' -_')
    code = _extract_code(body)
    if code:
        sep = '' if (not tech or tech[0] in '-_') else ' '
        new = f"{code}{sep}{tech}{seg}{ext}"
    else:
        # 无番号：保留标题本体（去广告后），加回技术标记与分段后缀
        new = f"{s}{seg}{ext}"
    # 幂等：改名后再跑此函数应返回原名（防 watchdog 递归）
    if new == name:
        return None
    return new


def _collect_tags(name: str) -> list[str]:
    tags: list[str] = []
    v = _vendor_tag(name)
    if v:
        tags.append(v)
    # 系列厂商（carib/1pondo/paco/heyzo/10mu/fc2 等）
    for pat, label in [
        (re.compile(r'carib', re.I), "CARIB"),
        (re.compile(r'1pondo|1pon', re.I), "1PONDO"),
        (re.compile(r'paco', re.I), "PACO"),
        (re.compile(r'heyzo', re.I), "HEYZO"),
        (re.compile(r'10mu', re.I), "10MU"),
        (re.compile(r'fc2[-_ ]?ppv', re.I), "FC2"),
    ]:
        if pat.search(name):
            tags.append(label)
    if _UNCENSORED.search(name):
        tags.append("流出无码")
    if _AMATEUR.search(name):
        tags.append("素人")
    if _CN_LIVE.search(name):
        tags.append("国产直播")
    for theme, pat in _THEME_PATTERNS:
        if pat.search(name):
            tags.append(theme)
    for site, pat in _SITE_PATTERNS:
        if pat.search(name):
            tags.append(site)
    # 去重保序
    return list(dict.fromkeys(tags))


def analyze_filename(name: str) -> dict:
    """主入口：返回 {"suggested_name": str|None, "tags": [str]}。

    - suggested_name 为 None 表示无需改名
    - tags 为空列表表示无标签（UI 不显示标签行）
    """
    if _UNIDENTIFIABLE.match(name):
        return {"suggested_name": None, "tags": []}
    suggested = _suggest_name(name)
    tags = _collect_tags(name)
    return {"suggested_name": suggested, "tags": tags}
