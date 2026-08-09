# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [15.0.0] - 2026-08-10

### Added (English)

- **Ingestion pipeline task bar**: new videos are now processed strictly in sequence — repair (remux) → thumbnail generation → duration probe. A single-line task bar shows the current stage badge, stage text, progress bar and a real-time summary (video count + thumbnails ready). Incoming videos trigger a "New videos detected, processing…" flash; when all background tasks finish, a "✓ All tasks completed" flash is shown. A repaired video is no longer re-processed for thumbnails/durations.
- **Global remux status endpoint**: `GET /api/remux/status` exposes repair queue state (active / running / queued / done_total / failed_keys) for the task bar.

### Fixed (English)

- **Thumbnail cache usage not displayed** (P1): `/api/thumb/stats` was shadowed by the `/api/thumb/{video_id}` route (defined later matched first), so the settings page always showed "…" — the stats route is now registered before the wildcard.
- **Orphan thumbnail cleanup reported 0**: `cleanup_orphans` only scanned index entries (≈0); on-disk orphan `*.jpg` files (leftover candidate frames / deleted videos) were never removed. Now scans the disk directory. (G电影 library: 30 real orphans cleaned.)
- **Cache usage count off by one**: stats counted `index.json` as a file (137 vs 106 videos) — now counts only `*.jpg` thumbnails.
- **Thumbnail progress bar never disappeared after completion** (P1): the last "done" broadcast was swallowed by the 1s throttle in `_notify_progress`, so the frontend stayed busy forever — a forced broadcast fires when the queue drains.
- **Switching libraries showed blank thumbnails** (P1): `loading="lazy"` conflicted with the virtual grid (new rows misjudged as off-screen during scroll-reset) — removed lazy loading and added one auto-retry on image error.
- **All thumbnails flickered once after switching library**: stale videos from the old library stayed until the new data replaced them — the list is now cleared immediately (skeleton takes over).
- **Thumbnails refreshed a second time after switching library**: the SSE reconnect handshake pushed a version that triggered a duplicate `loadVideos` — a suppress window prevents the second load during library switch.
- **Empty / dangling states in the task bar**: clicking the top-right thumbnail chip while idle showed a blank bar — an idle detail branch now shows the full thumbnail summary; clicking the chip while any task is active collapses/restores the bar (repair included).

### 新增（中文）

- **入库处理管道任务条**：新影片入库后按「修复 → 缩略图 → 时长」严格串行处理。单行任务条显示当前阶段徽标、阶段文本、进度条与实时总况（影片数 + 缩略图就绪数）。新影片入库时顶部闪示「检测到新影片，开始处理…」；全部后台任务完成时闪示「✓ 全部处理完成」。修复过的视频不再重复生成缩略图/时长。
- **全局修复状态接口**：`GET /api/remux/status` 暴露修复队列状态（active / running / queued / done_total / failed_keys），供任务条展示。

### 修复（中文）

- **缩略图缓存占用不显示**（P1）：`/api/thumb/stats` 被 `/api/thumb/{video_id}` 通配路由抢先匹配，设置页一直显示"…"——stats 路由已移至通配路由之前。
- **清理孤立缩略图报 0 个**：`cleanup_orphans` 只扫索引条目（≈0），磁盘上残留的孤儿 `*.jpg`（候选帧/已删视频残留）从未被清理——现补磁盘目录扫描（G电影 实测清掉 30 个真实孤儿）。
- **缓存占用计数多 1**：stats 把 `index.json` 也算作文件（137 vs 106 视频）——现只统计 `*.jpg` 缩略图。
- **缩略图进度条完成后不消失**（P1）：`_notify_progress` 的 1s 节流吞掉最后一次"完成"广播，前端永远停留在忙碌——队列清空时强制广播。
- **切库后大量缩略图空白**（P1）：`loading="lazy"` 与虚拟网格冲突（滚动重置瞬间新行被误判视口外）——移除 lazy，图片加载失败自动重试一次。
- **切库后所有图片闪烁一次**：旧库视频残留到新数据到达才整体替换——切库瞬间清空列表（骨架屏接管）。
- **切库后图片二次刷新**：SSE 重连握手推送版本触发重复 `loadVideos`——切库窗口内抑制二次加载。
- **任务条空态/交互**：空闲时点右上角缩略图按钮显示空白条——补空闲详情分支显示缩略图总况；有任务时点按钮收起/恢复任务条（含修复阶段）。

## [14.5.0] - 2026-08-10

### Fixed (English)

This release is a systematic bug-hunting pass across the whole codebase (30 fixes, all verified by behavior tests and full audits).

- **Restart API completely broken** (P0): `service_ctl` resolved the project root to `backend/` instead of the repo root, so the "restart service" button always threw `FileNotFoundError`. Now resolved correctly.
- **Normal videos permanently filtered out of the library** (P1): the "downloading" detection matched `.part`/`.download`/`.temp` as substrings anywhere in the filename — `The.Party.mp4`, `Video.Downloads.mp4`, `Movie.Template.mkv` were all wrongly treated as incomplete. Now matches only the file extension suffix.
- **Event loop frozen on rescan** (P1): `/api/rescan` ran the full library scan synchronously inside the async handler, blocking every API/SSE/stream request. Moved to a thread pool; the background rescan thread now also sets the library context so thumbnail/scan bookkeeping hits the right library.
- **Player double audio/video track** (P1): quickly switching videos left an orphan `<movi-player>` element (with autoplay+src) that would start playing once ready. Destroy now clears all host children.
- **Remux deadlock forever** (P1): a hung ffmpeg blocked all remuxing with no timeout (global single-flight). Added stall timeout (no output growth for 180s) plus an absolute 3600s cap.
- **User data lost after move/rename** (P1): moving a freshly-downloaded file (mtime < 20s) was skipped by the stability check, leaving `new_id` unknown, then watchdog prune deleted the just-migrated favorites/history/albums. Move now upserts the new path like rename does.
- **Plus 23 more** (P2): cross-library thumbnail queue wipe on HIGH scheduling; malformed Range header (`bytes=abc`) crashing the stream endpoint; 0-byte files hanging clients on `Content-Length: 1`; SSE cross-thread broadcasting and unbounded queue; deleting a library leaving thumbnail/scan residue; search term leaking across library switch; favorites refresh jumping to top of the grid; hover tooltip/preview leaking across route changes; playlist sort race overwriting the list; ended-callback skipping two episodes; rename of the playing video breaking prev/next; non-atomic settings writes; path traversal in folder rename/move; thumbnail state counters always zero; capture error attribution across workers; import not validating entry types; auto-remux blacklisting transient busy state; and more.

### 修复（中文）

本版本是一次全代码库的系统性挖 bug（30 项修复，均经过行为用例与完整审计）。

- **服务重启 API 完全失效**（P0）：`service_ctl` 项目根路径解析错误导致"重启服务"永远 `FileNotFoundError`，已修正。
- **正常视频被永久过滤不入库**（P1）：下载中检测把 `.part`/`.download`/`.temp` 当文件名任意位置子串匹配——`The.Party.mp4`、`Video.Downloads.mp4`、`Movie.Template.mkv` 全被误判为下载中；已改为仅匹配扩展名后缀。
- **重新扫描冻结整个服务**（P1）：`/api/rescan` 在 async 处理器里同步跑全库扫描，期间所有 API/SSE/流请求卡死；已移入线程池，后台扫描线程也补了库上下文（多库下缩略图/扫描记账作用正确）。
- **播放器双音轨/双解码**（P1）：快速切换视频会残留带 autoplay+src 的孤儿 `<movi-player>` 元素，就绪后自动播放；销毁逻辑现会清空宿主全部子元素。
- **重封装永久卡死**（P1）：ffmpeg 挂死时无超时（全局单并行）阻塞全部修复；新增输出无增长 180s + 绝对 3600s 超时终止。
- **移动/改名后收藏历史丢失**（P1）：刚下载完（mtime<20s）就移动的文件被稳定检测跳过，`new_id` 未知后 watchdog prune 把刚迁移的收藏/历史/专辑删掉；移动现与改名一致补 upsert 兜底。
- **其余 23 项**（P2）：HIGH 调度跨库清空缩略图任务、畸形 Range 头（`bytes=abc`）致流接口 500、0 字节文件 `Content-Length:1` 挂起客户端、SSE 跨线程广播与队列无界、删除库后缩略图/扫描残留、切库残留搜索词、收藏刷新跳回网格顶部、悬停浮层/预览跨路由残留、播放列表排序竞态覆盖、播完连跳两集、重命名播放中视频致上一首/下一首失效、设置非原子写、文件夹重命名/移动路径穿越、缩略图状态统计恒为 0、多 worker 截帧错误串扰、导入不校验条目类型、自动重封装把瞬时占用写进永久黑名单 等。

## [14.0.1] - 2026-08-09

### Added (English)

- **Hover preview mode option**: Settings → Playback → Hover preview → new "Preview mode" dropdown — `Multi-segment video preview` (default, current behavior) or `Large thumbnail (no video loading)`, which skips video streaming on hover entirely (saves bandwidth/decoding on low-end machines).

### Fixed (English)

- **`html5_hover_preview_mode` was not persisted**: the backend `SettingsUpdate` (Pydantic) model was the save whitelist, and the new field was missing — the frontend POST was silently dropped by Pydantic, so the choice reverted to default after refresh. Added to the model.
- **Thumbnails missing after switching library / first open**: the virtual grid (`VirtualVideoGrid`) kept the stale scroll position when switching library/category/page — with a smaller library the virtual window start could exceed the total row count, producing an empty grid (blank page until refresh). Now the visible range is clamped to the last row, and switching lists resets scroll to top.

### 新增（中文）

- **悬停预览模式选项**：设置 → 播放 → 悬停预览 → 新增「悬停预览模式」下拉——`多段视频预览`（默认，现有行为）或 `大缩略图（不加载视频）`（悬停完全不加载视频流，省带宽/解码资源，低配机友好）。

### 修复（中文）

- **`html5_hover_preview_mode` 保存不持久化**：后端 `SettingsUpdate`（Pydantic 模型）是保存白名单，新字段未加入 → 前端 POST 被 Pydantic 静默丢弃 → 刷新后回退默认。已补入模型。
- **切库/首次打开缩略图不显示**：虚拟网格（VirtualVideoGrid）切库/切分类/翻页后残留旧滚动位置——切到小库时虚拟窗口起点可能超过总行数，导致整页空白（刷新才好）。现已 clamp 到末行，且切换列表自动回到顶部。

## [14.0.0] - 2026-08-09

### Added (English)

- **Project renamed to LocVid**: repo renamed from Loc-Gallery (old URL auto-redirects); About & Topics updated; docs are now English-first with Chinese after.
- **Full UI internationalization (i18n)**: light-weight built-in i18n (no new deps) with `zh`/`en` dictionaries (436 keys), language follows the browser by default, switchable in Settings → Other → Language (persisted).
- **Backend error i18n**: HTTPException details (video/album/library not found, validation errors, etc.) translate by `Accept-Language`; frontend API client sends the current UI language automatically.
- **Docs bilingual**: README (English first, Chinese after), CHANGELOG entries (English first, Chinese after), PRD head section.
- **Branding**: header logo & `<title>` show LocVid; [LocGallery] console tags → [LocVid].
- **One-click stop script** `stop.py`: stops backend, frontend dev server and cleans up any ffmpeg/ffprobe processes — safe to rename/move the project folder afterwards.
- **Remux robustness**: auto-remux failure blacklist (a failed file is not retried every 60s while unchanged); failed `.bak` deletions are queued and retried; disk-space pre-check before remux.

### Fixed (English)

- **Header logo showed "Loc Vid"**: `.app-header-logo` is a flex container with `gap`; the bare "Vid" text node became a separate flex item adding a visual gap — the wordmark is now wrapped in one span so "LocVid" stays a single word.
- **Nav bar / dropdowns did not refresh on language switch**: `navItems`, theme presets, settings tabs and sidebar sort options were plain arrays evaluated once at setup; converted to `computed` so labels re-evaluate when the language changes.
- **Playback status messages stuck after a language switch**: status-clear timers compared `statusText` against freshly translated prefixes; the prefix is now captured at set time (closure).
- **Sidebar drag & drop regression**: adding `:model-value` to `VueDraggable` switched the library into controlled mode with no `update:model-value` handler, so the order never persisted; reverted to the `:list` + `@end` pattern (the component's required `modelValue` typing is suppressed with `@vue-ignore`).
- **Top-level categories had no folder icon** while subfolders did; the row structure (chevron placeholder + always-present glyph) is now identical for categories and subfolders.

### 新增（中文）

- **项目更名 LocVid**：仓库从 Loc-Gallery 改名（旧 URL 自动 301），About 与 Topics 已更新；文档改为英文在前、中文在后。
- **界面全量国际化**：自研轻量 i18n（无新依赖），zh/en 双语字典 436 键；默认跟随浏览器语言，设置 → 其他 → 界面语言 可切换并持久化。
- **后端错误国际化**：HTTPException detail（视频/专辑/视频库不存在、校验错误等）按请求 `Accept-Language` 翻译；前端 API 自动携带当前界面语言。
- **文档双语**：README（英文在前中文在后）、CHANGELOG 条目（英文在前中文在后）、PRD 头部。
- **品牌**：Header logo 与 `<title>` 显示 LocVid；[LocGallery] 控制台标记 → [LocVid]。
- **一键停止脚本** `stop.py`：停止后端与前端开发服务，并清理 ffmpeg/ffprobe 进程——改名/移动目录前使用更安全。
- **修复机制加固**：后台自动修复失败黑名单（文件未变化不再每 60 秒重试）；`.bak` 删除失败自动入队重试；重封装前磁盘空间预检。

### 修复（中文）

- **Header logo 曾显示 "Loc Vid"**：`.app-header-logo` 为 flex + gap，裸文本 "Vid" 成为独立 flex item 产生空隙；现将文字包裹为整体，保证 LocVid 连写。
- **导航条/下拉框切语言不刷新**：navItems、主题选项、设置页标签、侧栏排序选项原为普通数组（setup 时求值一次）；已改为 computed，随语言实时重算。
- **切语言后播放状态提示不消失**：状态清除定时器原用实时翻译的前缀比对；现改为设置时闭包捕获前缀。
- **左栏拖拽失效回归**：为 VueDraggable 添加 `:model-value` 使库进入受控模式且无 `update:model-value` 处理，排序不再持久化；已恢复 `:list` + `@end` 写法（组件必需 modelValue 的类型检查用 `@vue-ignore` 抑制）。
- **顶层分类缺目录图标**：分类与子目录行结构现完全一致（箭头占位 + 常驻图标）。

## [13.0.0] - 2026-08-09

### 重大变更

- **改名/移动数据迁移（P0 数据保护）**：视频改名或移动到分类后 id（路径 hash）变化，原先会**清空收藏/历史/专辑归属并删除缩略图重新生成**；现改为在文件移动后立即把用户数据与缓存**从旧 id 迁移到新 id**（收藏/播放记录/专辑归属/缩略图文件与索引/格式缓存），迁移先于 watchdog 全库清理执行，彻底消除竞态；前端同步更新播放列表中的新 id，并移除无版本校验的列表缓存
- **左栏拖拽重构（vue-draggable-plus）**：分类与文件夹支持拖拽排序（带占位动画），排序模式（自定义/名称/数量）与后端真实状态同步——此前显示"自定义"实为"名称排序"导致拖拽无效；文件夹顺序新增后端持久化（按库/分类隔离，字母序兜底）
- **批量修复入口移除**：批量条"批量修复"与前端 `beginBatchRemux/endBatchRemux` 移除——与「后台自动修复」（`html5_auto_remux` 默认开，空闲静默批量重封装）功能完全重叠，且原实现为同步阻塞轮询（每视频最长等 10 分钟）；播放链路的单文件自动修复保留

### 新增

- **「最多播放」导航页** `/most-played`：按播放次数倒序展示全库（未播放排后），带播放次数角标、续播进度、分页、全局右键菜单；浏览页排序下拉同步新增「最多播放/最少播放」（含分类内），播放次数排序绕过过滤器缓存保证实时
- **卡片播放信息**：浏览页/收藏/最近播放/最多播放卡片显示播放次数与播放进度条（续播进度）
- **左栏全局化**：分类侧栏提升到全部导航页（经典布局）；其他页点击分类/文件夹自动跳回首页对应分类，避免"标题与内容不符"错乱；分页组件全站统一（页码条/共 N 个/跳页越界保护）
- **左栏搜索过滤**：侧栏顶部搜索框实时过滤分类与任意层级文件夹（子树匹配、命中祖先自动展开），过滤时禁用拖拽
- **搜索增强**：搜索建议下拉 + 搜索历史（localStorage）+ 标题关键词高亮；支持搜子文件夹名、去扩展名；搜索语义为全库搜索（自动清空分类/文件夹）；修复快速输入竞态
- **数据导出/导入**：设置 → 其他 →「数据备份」——导出收藏/播放记录/专辑/分类顺序/设置聚合 JSON，导入按字段覆盖 + 二次确认 + 自动刷新各页状态；换机迁移/定期备份
- **视频属性面板**：右键 →「属性」，展示标题/文件名/完整路径/分类/大小/时长/编码/容器/格式/播放方式/修改时间/播放次数/最近播放/收藏
- **键盘网格导航**：浏览页 ↑↓←→ 移动卡片焦点（自动滚入视野）、Enter 播放、F 收藏、Esc 取消；播放器打开时自动让位
- **倍速记忆**：播放页 C/X/Z 调倍速后持久化，下次播放（含刷新）自动应用
- **内置确认对话框**：替换全部原生 `confirm`（删除/清空/重启/移除专辑等），风格统一
- **设置页维护入口**：缩略图统计（占用/数量）/清理孤立/重新生成失败；「其他」新增默认排序、忽略目录（`watch_ignore_dirs`）配置
- **悬停预览不可播判定**：后端播放计划带 `previewable`，伪装 TS/MKV/HEVC 等"可播放但不支持悬停预览"的视频直接提示、不再白等超时；预览运行时失败回退缩略图 + "点击可直接播放"
- **专辑体验**：「加入专辑」弹窗可直接新建专辑（自动勾选新专辑）；右键菜单收藏/专辑文案按状态动态变化（收藏/取消收藏、加入专辑/管理专辑(N)）
- **Header logo**：新增影视图标（内联 SVG，夜晚模式白色）+ 融入导航栏「首页」左侧，主题切换提示显示中文名（影院/经典）
- **全局提示强化**：toast 改页面垂直居中、强调色实底 + 对勾图标，设置保存后自动关闭对话框
- **缩略图角标重排**：左上播放次数、右上批量复选框（悬停显示）、左下专辑徽章 + 收藏 ♥（无状态隐藏、悬停显示、已加入常驻、动态排列）、右下格式 + 时长，互不重叠；全局滚动条主题化（夜晚暗色低调）

### 修复

- **属性接口 500**：`item.path`（str）直传期望 Path 的播放计划函数 → `'str' object has no attribute 'is_file'` → 属性面板"获取失败"；补 `Path()` 包装
- **改名丢专辑真根因**：专辑落盘结构为 `items`（dict），`video_ids` 仅是运行时汇总字段；迁移函数误读 `video_ids` 导致静默失败——收藏恰好同为 `items` 键故迁移成功（现象吻合"收藏保留专辑丢"）；改用 `items` 键并顺带迁移封面 `cover_video_id`
- **专辑详情显示全库视频**：`get_durations_for_ids` 新旧同名函数覆盖（新函数参数签名不同）导致 `GET /api/albums/{id}` 500 → 前端 onMounted 中断显示残留全库列表；删除重复函数
- **批量选择状态残留**：取消最后一个勾选时 `manageMode` 未复位 → body 批量 class/卡片点击拦截/角标常显残留；现自动退出批量模式
- **悬停浮层不显示**：`previewable===false` 时预览跳过导致浮层定位触发全部失效（浮层停在屏幕外）；新增静态提示块定位触发 + 视频切换重定位
- **收藏页排序被持久化污染**：`setSort('page')` 会写 localStorage 覆盖浏览页排序；移除
- **watchdog 事件风暴**：大量文件变更时防 O(n²) 事件合并；扫描剪枝忽略目录（IGNORE_DIRS 逐目录判定 + TTL 缓存）

### 移除

- 批量修复入口（按钮 + `beginBatchRemux/endBatchRemux` API）；前端无版本校验的 `videoListCache` 读取

## [12.1.0] - 2026-08-08

### 新增

- **播放器自带快捷键（替代油猴脚本）**：C 加速 / X 正常速度 / Z 减速（0.1 步进，0.25x~2x，movi OSD 显示倍速）；空格播放/暂停；←/→ 快进/快退 5 秒（Ctrl+←/→ 30 秒，左下角提示）；Enter 全屏（原有）
- **播放器 UI 定制**：中间播放三角形放大至 150px 并圆角化；已播进度条改白色；去除载入转圈动画

### 变更

- 移除设置项「播放器内置快捷键」（`html5_disable_movi_hotkeys`）：movi 内置快捷键无条件关闭，播放页快捷键由页面级处理接管，避免冲突
- 悬停预览浮层默认改为「移开鼠标自动消失」（`html5_hover_tip_pin` 默认 false）

### 修复

- 点击视频卡片进入播放页时，预览浮层与预览视频自动关闭（含钉住模式），不再残留
- 倍速数值浮点精度：0.1 步进改用整数十分位计算，避免显示 1.2000000000000002 类误差

## [12.0.0] - 2026-08-08

### 重大变更

- **悬停预览全面重构**：预览区不再显示缩略图，改为深色 16:9「加载中」占位 + spinner；视频就绪后在占位之上 500ms 长淡入播放——消除「静态图 → 动态视频」的内容替换突兀感（YouTube 式 hover preview）
- **预览浮层可钉住**：新增 `html5_hover_tip_pin`（默认开）——悬停后浮层保留，鼠标移开不消失、预览视频继续播放；点右上角 ✕ 或**点击浮层外任意位置**才关闭；可切回「移开鼠标自动消失」
- **播放器内核升级（11.0.1 合并）**：全面切换 movi-player `<movi-player>` web 组件（WASM demux + 直连 Range 流），替代早期 HLS `<video>` 播放路径

### 新增

- 设置项「预览浮层消失方式」（`html5_hover_tip_pin`）：按关闭按钮才消失（默认）/ 移开鼠标自动消失
- 悬停预览加载占位：深色区域 + spinner，加载/seek 期间不黑屏

### 修复

- **时长探测每次重启重复执行**：探测结果改为按批落盘（原依赖延迟 flush，重启中断则丢失 → 磁盘索引永远缺时长 → 每次启动重新探测同一批文件并弹提示条）
- 悬停预览过渡优化：220ms 淡入 → 500ms 长淡入；移除「首段对齐缩略图截帧位置」方案（缩略图截帧位置不可靠）
- **悬停预览比例自适应**：预览区按原视频真实宽高比显示（竖屏/超宽屏不再被压成 16:9），浮层宽度跟随视频宽度收缩、无黑边；视频 `object-fit: contain` 完整显示不裁切
- **预览区等视频比例就绪后才渲染**：竖屏视频首现即竖屏，彻底消除「横屏占位 → 竖屏」的跳变；加载背景配色改为暖灰（深色模式 `#6e6a5e`，亮度贴近视频平均亮度与肤色色温），淡入视频过渡自然
- **浮层一次定位不跳变**：浮层在视频比例就绪前挂起（不可见），就绪后以最终尺寸一次性定位——靠边视频不再闪现不完整浮层、不再位置跳动
- **卡片间切换黑屏系列修复**：每次预览新建独立 `<video>` 元素（消除复用残留）、事件回调校验当前活动元素（杜绝旧元素延迟事件误触发）、video 挂载到浮层后才开始加载/播放（未挂载播放无画面输出）、显示时机等浏览器实际渲染首帧（`requestVideoFrameCallback`）、`stopNow` 不再误杀新预览的启动定时器、`previewFailed` 状态防异步污染——「卡片间直接移动必黑屏」彻底解决


### 移除

- HLS 切片/转码链路（`hls_manager` 模块、`/api/hls/*` 端点等，11.0.1 合并）
- 前端孤儿 API 封装与 HLS 死代码（11.0.1 合并）

### 升级说明（从 11.x）

1. 直接运行 `python restart.py`（自动装依赖、停旧进程）
2. 用户数据完全兼容：`data/libraries/{id}/` 下收藏、历史、专辑、缩略图、时长缓存均保留
3. 时长探测结果将随新代码自动补全并持久化，重启后不再重复提示

## [11.0.1] - 2026-08-07

### 重大变更

- **格式区分系统精简**：movi-player 可直连绝大多数文件，格式筛选从 8 项精简为「全部 / 无法播放」；卡片角标仅保留「无法播放」（浏览器硬解不支持的编码），其余可播放/可自动修复的格式不再标记
- **HLS 链路移除**：删除 `/api/hls/*`、播放 prepare/status/stop/pause/resume/catchup 端点与 `hls_manager` 模块（约 786 行）；`media_probe` 的 HLS 切片 / 转码分支简化——AV1/HEVC/VP9 恒尝试直连，非 MP4 容器统一直连，`mode: hls` 仅作「是否可重封装」判断
- **PotPlayer 改为通用外部播放器**：`potplayer_path` → `external_player_path`，可填 VLC / MPC-HC / PotPlayer 等任意 exe（未填自动探测）；播放失败弹窗按钮改为「用外部播放器打开」
- **重封装时机优化**：新增后台批量预修复（`html5_auto_remux`，默认开）——空闲时静默扫描各库可修复文件逐个重封装，点播即秒开，不再需要在播放器里等 1-2 分钟

### 新增

- 设置项「后台自动修复」（`html5_auto_remux`），控制空闲时批量重封装可修复文件
- 悬停预览增强：浮层整体放大 20%；视频加载/seek 阶段保持透明、画面就绪才显示（消除黑屏闪烁）；预览段数与每段秒数可配置（`html5_hover_preview_segments` / `_segment_sec`，默认 5×5）

### 修复

- `scripts/clean_cache.py` 引用已删除的 `hls_manager` 会报错 → 改为仅清理日志与旧版遗留 HLS 缓存
- 清理历史遗留设置键（`player_mode` / `hls_large_h264` / `hls_moov_end_h264` / `html5_fragmented_mp4` / `html5_modern_codecs_direct`），`settings.json` 旧键自动过滤
- 前端移除孤儿 API 封装（`regenerateThumb` / `priorityThumbs` / `getFormatStatus`）与 HLS 死代码（`useHlsThrottle` / `hlsInstance` / `hlsPlaylistUrl` 等）

### 移除

- 前端 HLS 相关死代码与依赖引用；后端 `hls_manager.py` 模块

## [11.0.0] - 2026-08-07

### 重大变更

- **播放器内核升级**：全面切换为 movi-player `<movi-player>` web 组件（canvas 渲染 + 完整控件 + Shadow DOM 字幕渲染），直连流 + WASM 解码，替代早期 HLS `<video>` 播放路径
- **播放器架构重构**：`useMoviPlayer` 命令式集成，以 `statechange` 状态机驱动就绪 / 播放 / 错误处理；续播、字幕自动选中文等由封装层统一管理
- **快捷键策略调整**：新增「播放器内置快捷键」开关并**默认关闭**——键位完全交由页面级脚本（如油猴 HTML5 增强）接管，消除按键冲突

### 新增

- 设置项「播放器内置快捷键」（`html5_disable_movi_hotkeys`），可随时切回播放器接管
- 右键菜单「复制文件路径」（列表页与播放页右侧播放列表均可用）
- `/api/stream` 支持 HEAD 请求（movi-player HttpSource 探测文件大小 / Range 支持）

### 修复

- **播放器永久卡"加载中"**：movi-player 构造函数违规设置 `tabindex` 属性，导致 `document.createElement('movi-player')` 抛 `NotSupportedError`（部分 Chromium 静默返回不可用元素）→ 创建时校验产物并回退 `new MoviElement()`；同步修复 `src` 须在挂载前设置、就绪信号改用 `statechange` 等
- **特定站点源无法播放**：多段 mdat / 碎片化 MP4（如 123AV「Uncensored Leaked」HLS 转存）的 moov 无法被 movi-player 解析 → `remuxable` 文件播放前自动重封装修复，12 秒兜底自动触发
- **滚轮快进 / 回退失效**：恢复画面区滚轮绑定（步长由 `html5_wheel_seek_sec` 控制，0 关闭）
- **重命名双重扩展名**：输入带 `.mp4` 的完整文件名会生成 `xxx.mp4.mp4` → 后端智能去重、前端按去扩展名的 stem 传参
- **续播提示**：左下角"从 X 继续播放"提示 3 秒后自动消失

### 移除

- 播放器工具栏音轨 / 字幕下拉框（由 movi-player 齿轮菜单接管）
- 旧 HLS `<video>` 播放路径（startHls / waitHlsReady / startWebHls / bindSaver 等）

---

## [10.0.2] - 2026-08-05

### 修复

- **缩略图接口 404**：`/api/thumb/{video_id}` 在缩略图文件不存在时返回 500 而非 404（文件被清理 / 外部删除 / 生成失败时会触发），现改为返回 404
- **播放修复卡死**：`remux_manager` worker 在清理旧临时文件时若抛出 `OSError`（文件被残留进程占用），会让该视频的修复任务永久停在排队状态、无法重试；现忽略该清理错误
- **重封装后排序错乱**：`refresh_video_item_stat` 更新 size/mtime 后未失效按大小 / 时间排序的全局索引，导致 remux 原地替换后列表顺序错误
- **误删收藏/历史/专辑风险**：库索引因瞬时状态（文件处于 20 秒写入窗口等）暂时为空时，清理逻辑会按空集合误删全部收藏、播放历史与专辑；现为空索引时跳过清理
- **格式扫描进度重复计数**：`get_format_status` 的 `scanning` 统计把排队项重复计入，导致进度高估一倍

### 测试

- 新增回归测试：`test_thumb_404.py`、`test_scanner_invalidate.py`、`test_prune_guard.py`
- 修复 `test_auto_new_video.py`（旧模块 `avv_gallery`、旧端口、多库适配）与 `test_multi_library.py`（调用已不存在的 `update_position`）

---

## [10.0.1] - 2026-08-04

### 改进

- 右键菜单自适应视口位置，播放列表等窄区域不再显示不全
- 播放器「上一个 / 下一个」移至左侧工具栏「返回浏览」右侧
- 视频聚焦时去除白框描边

---

## [10.0.0] - 2026-08-02

### 重大变更

- **架构重构**：前端由原生 HTML/JS 全面迁移至 **Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS 4**
- **开发体验**：单端口 `3460` 开发模式（Vite 热更新 + 内部 API），`python restart.py` 一键启动
- **默认端口**：由 `3456` 调整为 **`3460`**
- **项目结构**：`frontend/` + `backend/src/loc_gallery/` 前后端分离

### 新增

- 经典 / 影院两种布局预设，暗色 / 亮色主题
- 虚拟滚动网格、列表 API 批量加载与资源缓存
- `scripts/setup.py` 首次依赖安装；`scripts/clean_cache.py` 清理 HLS 与日志缓存
- 启动时 HLS 缓存 LRU 淘汰（单库上限 2GB）
- 产品文档 `doc/PRD.md`

### 改进

- 播放策略探测与格式角标逻辑优化（直连/HLS 不转码不再显示「转码」角标）
- 播放器导航、随机列表、批量操作栏与右键菜单体验打磨
- `.gitignore` 强化，避免误提交 `data/`、日志、PID 等运行时文件

### 升级说明（从 8.x）

1. 拉取本版本代码后执行 `python scripts/setup.py`（或首次 `python restart.py` 会自动安装依赖）
2. **用户数据兼容**：`data/libraries/{id}/` 下的 `.thumbs/`、`favorites.json`、`play_history.json`、`albums.json`、`category_meta.json` 可保留
3. 可安全清理：`data/**/cache/hls/`、`data/logs/`（会按需重建）
4. 在 **设置 → 视频库** 中确认库路径后点击顶栏 **刷新** 完成索引

### 环境要求

- Python 3.10+
- Node.js 18+（开发 / 构建前端）
- ffmpeg / ffprobe（PATH 可用）

---

## [8.1.0] 及更早版本

历史记录见 Git 提交与 [GitHub Releases](https://github.com/hoolulu/LocVid/releases)。
