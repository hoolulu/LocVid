# LocVid 项目记忆 / Workspace Instructions

> 本文件是 ZCode 的工作区级指令/记忆文件（每次会话自动加载进模型上下文）。
> 面向后续任何 agent：先读本文件快速恢复项目状态，再动手。
> 详细规格见 `doc/PRD.md`，演进史见 `CHANGELOG.md`，发版 SOP 见 `doc/发版流程.md`。

## 项目一句话

**LocVid** —— 纯本机、单用户、Windows 优先的本地视频画廊 Web 服务：浏览器当 UI、ffmpeg 当引擎，扫描本地视频目录，提供缩略图网格浏览、搜索、收藏、播放记录、专辑、标签、内嵌播放（movi-player WASM demux + Range 直连）。默认 `http://127.0.0.1:3460`，无认证，只绑本机。

## 当前版本

以 `VERSION` 文件为准（当前 16.0.1）。**改版号必须 4 处同步**：
`VERSION` / `frontend/package.json` / `backend/pyproject.toml` / `backend/src/loc_gallery/__init__.py`。

## 技术栈

- 前端：Vue 3 `<script setup>` + TS + Vite + Pinia + Vue Router + Tailwind CSS 4（Vite 插件）+ movi-player 0.3.5 + vue-draggable-plus
- 后端：FastAPI + uvicorn；文件监听 watchdog；媒体处理 ffmpeg / ffprobe；缩略图评分用 Pillow
- 存储：全部 JSON 文件（`data/`，gitignored），无数据库

## 目录速览

```
restart.py / dev_backend.py / stop.py   一键启停（入口）
scripts/service.py + ports.py           进程管理：后端 3461 + Vite 3460（开发）；生产单后端 3460
backend/src/loc_gallery/                后端包（26 模块）
frontend/src/                           前端（71 文件）
doc/PRD.md · CHANGELOG.md · 发版流程.md  文档
data/                                   运行时数据（gitignored，勿提交勿删）
.workbuddy/                             旧 WorkBuddy 工具遗留记忆（gitignored）
```

## 常用命令

```bash
python restart.py            # 开发模式：停旧进程→装依赖→后端3461+Vite3460→开浏览器
python restart.py --build    # 生产模式：前端 build 后单后端 3460 托管 dist
python stop.py               # 停服务并清理 ffmpeg/ffprobe 子进程
cd frontend && npm run dev   # 单独前端
cd frontend && npm run build # 构建（vue-tsc -b && vite build）
# 后端测试（unittest + mock.patch 路径；部分需运行中服务）
python backend/tests/test_auto_new_video.py
```

## 运行架构

- **开发**：uvicorn 后端在 **3461**（Vite 代理 `/api` → 3461）+ Vite dev 在 **3460**（HMR）。
- **生产**：单后端在 **3460** 托管 `frontend/dist`（带 hash 资源走 immutable 缓存）。
- 后端依赖 Python 3.11+；ffmpeg/ffprobe 必须在 PATH。

## 后端核心模块与关键链路

- `scanner.py`：每库内存索引 `VideoItem`，**id = 相对路径 md5**；分类 = 库根一级子目录；版本号 `version` 驱动前端刷新。
- `server.py`：全部 REST + SSE。watchdog 事件合并 1.5s debounce 防 O(n²)；删除事件→合并全库刷新。
- `file_stability.py`：下载中检测——**不完整文件名按后缀匹配**（`.part`/`.crdownload`/`.tmp`…），绝不能子串匹配（`The.Party.mp4` 会被误杀）；size/mtime 双采样判稳；`notify_file_activity` 用 5s Timer 递归重试，稳定后**增量入库**（不重扫全库）。
- `thumb_manager.py`：缩略图+时长双子系统。索引 `index.json`（status: missing/queued/generating/ready/failed），优先级队列 + 线程池 worker，脏写延迟落盘（原子写）。抽帧强制 BT.709；候选帧 Laplacian 方差评分；时长 ffprobe 探测缓存进索引。
- `media_probe.py` + `format_index.py`：播放策略双层缓存（内存+磁盘 `playback_plans.json`），按 mtime/size 失效 + `_PLAN_VERSION`/policy 标签。识别伪装 MPEG-TS、碎片化/多段 mdat、moov_end、现代编码直连、硬解不支持。
- `remux_manager.py` + `remux_core.py`：碎片化/多段 mdat MP4 **流复制**重封装（`-c copy -movflags +faststart`），单并行 + 卡死检测 + `.bak` 备份/回滚 + 磁盘预检 + 失败黑名单。修复后**恢复原 mtime** + `seed_direct_playback_plan` 跳过重探测。
- 存储层（favorite/history/album/tag/category/settings store）：统一模式 = JSON + 线程锁 + **tmp+replace 原子写** + 按库隔离。专辑支持**标签专辑**（`filter:{tag}`，动态聚合，不可手动增删）。
- 库类型：`title-based`（默认，标题影片库）/ `id-based`（编号影片库，新视频**自动命名 + 追加打标**）。

## 关键工程决策（防踩坑记忆，改动前必读）

1. **改名/移动数据迁移时序（P0）**：`file_ops._migrate_video_id` 必须在 `refresh_cache` **之前**执行，依次迁移收藏/历史/专辑/缩略图/格式索引/标签。watchdog 的 prune 在删除事件后 1.5s 触发，若迁移晚于刷新会清空旧 id 的全部用户数据。
2. **prune 守卫**：`_prune_user_data` 在索引为空时**跳过清理**——瞬时空索引（文件在 20s 写入窗口）误按空集合 prune 会不可逆地删掉全部收藏/历史/专辑。
3. **多线程 ContextVar**：后台线程（watchdog/rescan/缩略图/remux/format-probe）必须显式 `set_thread_library(lib)`；否则索引重建/孤儿清理作用到错误库（15.0.1 的 bug）。
4. **rescan 移线程池**：全库扫描/ffprobe/缩略图是秒级阻塞，直接同步执行会冻结事件循环（所有 API/SSE/流卡死），必须 `asyncio.to_thread`。
5. **任务条严格串行**：需重封装（修复）的视频先进 remux 队列，修复后文件替换触发 watchdog 重入库才生成缩略图、再探测时长——避免"先做缩略图/时长、修复后又重做一遍"。
6. **movi-player 两个致命坑**：
   - `document.createElement('movi-player')` 在部分 Chromium **抛 NotSupportedError 或静默返回不可用元素**（构造器违规 setAttribute 违反 Custom Elements 规范）。必须校验 `instanceof MoviElement && el.shadowRoot`，失败用 `new MoviElement()`。
   - **`src` 必须在 `appendChild`（触发 connectedCallback）之前设置**，否则 player 永不初始化。
   - 就绪信号用 `statechange`（idle/loading/ready/…），**不是** 原生 `<video>` 的 `loadeddata/canplay`。
7. **播放 vs 悬停预览能力不对称**：悬停预览用浏览器原生 `<video>` 直连（只支持标准 H.264 MP4/WebM 等原生容器+编码），播放走 movi WASM demux（可解 MKV/TS/HEVC/伪装 TS）。"能播但不可预览"是常态，前端用 `previewable` 字段区分。
8. **SSE**：`version` 事件（`{lib}:{ver}`）驱动前端重载分类+列表（500ms 去抖；切库握手窗口用 `suppressVersionLoad` 抑制二次加载）；`progress` 事件驱动任务条轮询。跨线程广播必须 `loop.call_soon_threadsafe`。
9. **前端竞态防护**：播放链路用 player store 的 session 计数（`bumpSession`/`isStale`）；列表/播放列表用模块级 seq 丢弃过期响应。改动异步流程时必须保留这套防护。
10. **列表 API 防 N+1**：`_videos_to_dicts` 一次快照收藏/历史/标签/缩略图索引，再逐条解析；不要逐条读盘。

## 任务条（HeaderProgressBar）与进度广播（16.0.x 重构要点）

- **任务条状态机**（`useThumbProgress.ts` + `HeaderProgressBar.vue`）：单行 stepper「修复→缩略图→时长」+ 实时百分比 + 行内「📥新影片 / ✓完成」徽标（不再占第二行）。
- **前端防卡**：任务条状态**不只靠 SSE progress 事件驱动**——加了条件轮询兜底（任一任务忙碌时每 1.5s `refresh()`，空闲自动停），任何广播被节流吞掉/SSE 丢失都能自愈。
- **`isThumbProgressIdle` 语义**：`failed>0` / `paused` 不再视为「忙碌」（否则单个失败缩略图把任务条钉死、完成闪示永不触发）；失败用失败徽标、暂停用「已暂停」单独呈现。
- **完成闪示必须保显**：`completionActive`（busy→idle 后 5s 内）让 `showBar` 保持 true，否则 stage 变 idle 立即收起，`v-if="stage!=='idle'"` 里的完成徽标永远看不见（真实 bug，mock 测试抓出）。
- **remux 必须广播 progress SSE**：`remux_manager` 在 running/done/error 三个节点调 `_notify_library_progress` → `server._broadcast("progress")`，否则前端任务条看不到修复百分比、完成不通知（只发 version 不触发任务条刷新）。
- **时长完成广播**：`_duration_worker_loop` 的 `_all_done` 必须在 `_duration_probing.discard(key)` **之后**判定并 `_notify_progress(force=True)`；`_process_one` 的 remux-skip 分支必须清理 `_generating` 并广播——否则最后完成被 1s 节流吞掉、任务条卡住。
- **service.py 编码坑**：`subprocess.run(text=True)` 读 taskkill/netstat/tasklist 输出必须加 `encoding="utf-8", errors="replace"`，否则 Python 3.13 + 中文 Windows 下 UnicodeDecodeError 崩掉（`restart_service.py`/设置页「重启服务」按钮会挂）。
- **前端测试**：`vitest.config.ts` + `src/**/__tests__/*.spec.ts`（mock `@/api/thumbs` + pinia），跑 `cd frontend && npx vitest run`。组件测试跨用例需重置模块级单例状态（`lastCompleted`/`incomingFlash`/`prevAnyBusy`）。

## 约定（红线）

- **隐私铁律**：`data/`、真实库路径、Windows 用户名、本机软件路径（PotPlayer 等）**绝不写入代码、提交、AGENTS.md、release notes**。库路径在设置页配置；`config.py` 的 `VIDEO_ROOT` 只是本地开发种子。
- **push/发版铁律**：所有 `git push`（master / tag）必须先经用户确认；用户说"发版/发布"仅授权**当次**版本（commit→push→tag→release），不延续。release notes 一律用文件传递，**禁止 shell heredoc**（Windows bash CRLF 会导致 EOF 失败）。
- **CHANGELOG**：英前中后（Added/新增 → Fixed/修复），Keep a Changelog 风格，P0/P1/P2 标注。
- **i18n**：UI 文案必须走 `frontend/src/i18n` 的 `zh/en` 字典 + `t()`；后端 HTTPException 的固定文案原文即 key，经 `i18n.translate_detail` 按 `Accept-Language` 翻译。
- **构建验证**：改前端跑 `vue-tsc -b`（或 `npm run build`）；改后端 `ast.parse` / `py_compile` 全模块。
- **测试**：改动涉及稳定检测/专辑/多库隔离/prune/扫描索引时，跑对应 `backend/tests/` 单测。

## 数据存放（按库隔离）

- 库注册表：`data/libraries.json`；每库数据 `data/libraries/{lib_id}/`：`favorites.json`、`play_history.json`、`albums.json`、`tags.json`、`category_meta.json`、`settings.json`、`.thumbs/`（含 `index.json`）、`cache/playback_plans.json`、`cache/format_index.json`。
- 全局设置 `data/settings.json`；设置支持**全局 + 库级覆盖**（白名单键）。
