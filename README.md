# KitterHub

**A community platform for young creators — share works, discuss in forums, form studios, and keep
moderation in the hands of the community.**

KitterHub is a full-stack community site for teenage programmers and creators. Members publish
Scratch / Kitten projects, post in forums, join studios, chat privately, earn experience levels and
badges, and help govern the site through an elected Discipline Committee system.

KitterHub 是一个面向**青少年创作者**的社区网站：作品投稿与展示、论坛、工作室、私信、经验等级，
以及一套「敏感词 → 举报 → 风纪委员会 → 管理员复审」的内容治理流水线。

- **后端**：Python 3 + FastAPI + SQLAlchemy + SQLite + Socket.IO
- **主站前端**：React 18 + Vite + Material Web（中英双语 / 深浅色主题 / 响应式）
- **SE 精简版**：无框架、纯 ES5、面向 IE11 等老浏览器的只读版本
- **部署**：nginx 反向代理 + systemd（`deploy/` 下附示例配置）

> **开源协议：MIT**（见 [`LICENSE`](LICENSE)）—— 允许自由使用、修改、商用与再发布（含闭源商用）。
> 名称与站标不在授权范围内，详见 [`TRADEMARK.md`](TRADEMARK.md)。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 功能清单](#2-功能清单)
- [3. 截图](#3-截图)
- [4. 技术栈](#4-技术栈)
- [5. 目录结构](#5-目录结构)
- [6. 本地跑起来](#6-本地跑起来)
- [7. 配置项说明](#7-配置项说明)
- [8. API 概览](#8-api-概览)
- [9. 内容治理机制](#9-内容治理机制)
- [10. 部署说明](#10-部署说明)
- [11. 开源协议](#11-开源协议)
- [12. 贡献指南](#12-贡献指南)
- [13. 常见问题](#13-常见问题)

---

## 1. 项目简介

KitterHub 是一个把「作品社区 + 论坛 + 工作室 + 私信」放在一起的青少年创作者平台，
用一套统一的经验值与权限体系把它们串起来，并且把内容治理做成了**可参与、可追溯**的流程，
而不是只靠管理员手动删帖。

一句话定位：**给学编程的孩子一个能投稿、能交流、能被同龄人认可，且相对安全的地方。**

设计取向（都能在代码里看到对应实现）：

| 取向 | 体现 |
| --- | --- |
| 未成年人优先 | 注册需签订《友好条约》；护照/实名认证未完成前**所有写操作**被拦下（`deps.get_active_user`）；`frontend/public/docs/minors.md` 有专门条款 |
| 治理可参与 | 风纪委员会（LV3 可申请、管理员审批）：委员能隐藏内容并送审，也能投票判「无违规」把内容恢复 |
| 先隐藏、后复核 | 敏感词命中或被多次举报的内容先转为待审、不对外展示，再由人裁决；委员的每一次隐藏都会被记录与统计误判 |
| 不写死配置 | 域名、邮件通道、限流、上传上限、存储配额等全部走环境变量 |
| 少依赖 | i18n 是自研的 30 行实现，SE 版零运行时依赖，前端不引 UI 框架（直接用 Material Web 组件） |

## 1.1 功能状态（哪些真的在跑）

开源项目最怕文档把**没跑的东西写成有**。下面这张表按代码事实区分两栏；
细节与代码位置见 [`docs/MODERATION.md`](docs/MODERATION.md)。

| 功能 | 状态 | 依据 |
| --- | --- | --- |
| 敏感词命中 → 入库 + 内容隐藏待审 | ✅ 已上线 | `app/sensitive.py`、`app/serializers.py` 的 `queue_sensitive_review()`、`app/routers/works.py` |
| 举报入库；作品/帖子累计 ≥3 次举报 → 自动下架待审 | ✅ 已上线 | `app/routers/reports.py` 的 `create_report()` |
| 风纪委员 LV3 申请 + 管理员审批 | ✅ 已上线 | `app/committee.py` 的 `MIN_LEVEL = 3`、`/committee/apply` |
| 委员「隐藏 + 送审」（每日 20 条上限） | ✅ 已上线 | `app/committee.py` 的 `/committee/hide`、`DAILY_HIDE_LIMIT = 20` |
| 委员「无违规」投票：满 3 票判无违规并恢复 | ✅ 已上线 | `app/committee.py` 的 `VOTE_THRESHOLD = 3`、`/committee/vote` |
| 管理员复审队列（通过＝恢复 / 驳回＝维持隐藏并可处罚） | ✅ 已上线 | `app/routers/admin.py` 的 `/sensitive-reviews/*` |
| 操作审计（后台写操作、登录、改密） | ✅ 已上线 | `app/audit.py`、`admin_logs` / `audit_logs` 表 |
| 通用在线考试系统（题库/试卷/成绩，`/admin/exam`） | ✅ 已上线 | `app/routers/exam_api.py` |
| **答题入会**（100 题库 / 随机抽 20 题 / 答对 ≥15 通过后才可申请） | 🚧 设计中，**未合并** | 仅存在于 `tmp_stage2/`，**不在本次导出内** |
| **委员任期 60 天 / 标记 >50 免审免答连任** | 🚧 设计中，**未合并** | 同上 |
| **委员标记 ≥1 票违规 → 隐藏并送管理员复审** | 🚧 设计中，**未合并** | 当前实际为「委员手动隐藏 + 满 3 票无违规恢复」 |

> 说明：`frontend/src/pages/Committee.jsx`、`CommitteeExam.jsx` 与
> `frontend/src/i18n/dict/committee.js` 已按上述**设计中**的规则预先写好界面文案，
> 但后端并未提供对应接口（`app/main.py` 只挂载了 `app/committee.py` 的 6 个端点），
> 因此这些界面功能在当前版本**不可用**。

## 2. 功能清单

### 2.1 作品（Works）

- 投稿 Scratch / Kitten4 / KittenN 等类型作品，支持封面、标签、分类、简介。
- 作品类型包含 `scratch`（含 `.sb3` 作品包上传，默认上限 50MB）与外部链接/嵌入类型。
- 在线试玩：优先使用后端算好的 `play_url`，Scratch 作品回退到 TurboWarp 嵌入播放器。
- 详情页包含播放器、说明（Markdown）、评论、点赞、收藏、投喂、举报、源码下载、播放量统计。
- 作品存在版本记录（`work_versions`），编辑后可回溯。
- 系列（`series`）与合集（`collections`）两种组织方式。
- 每日投稿上限（`NIMAO_DAILY_WORK_LIMIT`，默认 20）。

### 2.2 论坛（Forum / Posts）

- 发帖支持置顶、精华、话题（topics）、Markdown 正文、图片附件。
- 帖子存在版本记录（`post_versions`）。
- 评论：帖子评论与作品评论两套（`post_comments` / `work_comments`），支持回复、点赞、举报。
- 草稿箱：帖子与作品都支持多份草稿（`drafts`），可恢复。
- 回收站（`recycle_bin`）：删除的内容先进入回收站，可还原。
- 每日发帖上限（`NIMAO_DAILY_POST_LIMIT`，默认 20）。

### 2.3 工作室（Studios）

- 创建工作室、设置简介与公告、上传图标。
- 成员管理：申请加入、邀请、审核、角色（室长 / 管理员 / 成员）、退出、踢出、封禁。
- 工作室作品（`studio_works`）与工作室关注（`studio_follows`）。
- 违规工作室可被全站隐藏（后台动作，会记审计与通知室长）。

### 2.4 私信与群聊（Chat）

- 单聊与群聊（`chat_threads` / `chat_members` / `chat_messages`）。
- 基于 Socket.IO 的实时消息推送与在线状态。
- 群成员管理、群公告、退群。
- 消息已读回执（`read_at`）、免打扰偏好（`notifyPrefs`）、消息搜索。
- 会话级与用户级黑名单（`chat_blocks`）。
- 聊天内容也走敏感词检测（socket 路径复用 60 秒词库缓存）。
- **总开关** `NIMAO_CHAT_ENABLED`：置 0 后聊天 REST 返回 503、Socket 聊天事件被拦截，通知不受影响。

### 2.5 通知（Notifications）

- 统一通知表（`notifications`），覆盖点赞、评论、关注、收藏、投喂、@提及、
  审核结果、举报处理、工作室事件、活动奖励、管理端操作等。
- 未读数、通知气泡、按类型已读、单条与全部已读。
- 聊天通知偏好可单独设置（含免打扰）。

### 2.6 经验等级与徽章（XP / Levels / Badges）

- 等级 LV0–LV7，六级徽章为六边形设计，带级数与颜色区分（见截图之外的 `level_*` 系列设计稿来源）。
  经验门槛（来自 `frontend/public/guide/faq.md`）：
  LV0 注册即得；签订《友好条约》升 LV1；LV2 = 200、LV3 = 700、LV4 = 1500、
  LV5 = 5000、LV6 = 10000、LV7 = 50000 经验。
- 经验来源：每日签到、投喂他人、被投喂、邀请好友、编程猫等级奖励、绑定奖励，
  以及限时活动奖励（`events.grant_due_events`，在每次请求里顺带发放，没有活动时零开销）。
- 经验中心页面展示来源明细与升级进度。
- 徽章：等级徽章、认证徽章（护照认证/编程猫绑定）、活动徽章。
- 编程猫等级同步：绑定编程猫账号后可拉取等级并换算经验/徽章。

### 2.7 认证与账号安全

- 两种激活方式（二选一）：
  1. 上传**护照个人信息页**等证件，管理员审核；
  2. 绑定**编程猫（Codemao）**账号。
- 未激活的账号可以正常浏览，但一切写操作被拦下，只放行激活自己所需的那几个接口
  （白名单见 `deps._LOCKED_ALLOW`）。
- 邮箱注册与找回密码：验证码走 SMTP 或 Resend（二选一）。
- 免密码验证登录（编程猫签名比对）、GitHub OAuth 登录与绑定。
- 密码用 bcrypt 哈希；修改密码会使旧 JWT 失效（`token_version` 机制）。
- 登录失败次数锁定（`NIMAO_LIMIT_LOGIN`）、注册配额（`NIMAO_LIMIT_REG`）。
- 注销账号：级联处理内容与关联数据（`cascade.py` / `purge.py`）。

### 2.8 敏感词与举报

- 敏感词**存在数据库**（`sensitive_words` 表），管理员可在后台增删，改完立即生效（60 秒缓存）。
  代码内置词库为空列表 `SENSITIVE_WORDS = []`，只作为表为空时的种子位。
- 命中敏感词的内容**自动转为待审、不对外展示**，并进入风纪委员会审议库
  （`ContentReview.source = "sensitive"`）。
- 覆盖范围：作品标题与简介、帖子标题与正文、作品评论、帖子评论；
  另外用户名、昵称、工作室名命中会**直接拒绝**（不入审议库）。
- 豁免用户（`users.sensitive_exempt`，后台可开）发布的内容不做敏感词检测。
- 举报：登录用户可举报作品/帖子/评论等类型；同一人对同一目标只能举报一次。
- 同一作品或帖子被举报累计达到 **3 次** → 作品自动下架为待审；帖子给作者发通知由管理员复核
  （见 [§9](#9-内容治理机制) 的准确口径）。

### 2.9 风纪委员会（Discipline Committee）

- **申请门槛 LV3**（`committee.MIN_LEVEL = 3`），提交理由，管理员审批后上任。
- 状态：审核中 / 在职 / 未通过 / 已停职（`committee_status`）。
- **审议库**同时收录两类内容：委员巡逻时隐藏送审的（`source="committee"`）
  与系统命中敏感词自动送审的（`source="sensitive"`）；被举报的内容**必进**，正常内容随机抽样
  （每次抽 `RANDOM_QUEUE_SIZE = 12` 条）。
- 委员核心动作：**隐藏 + 送审**——内容立刻隐藏，同时进入管理员复审队列，必须写明理由，
  会通知所有管理员。每人每天最多隐藏 20 条（`DAILY_HIDE_LIMIT`）。
- 委员权限被**有意收紧**：只能隐藏 + 送审，不能删除、不能处罚、看不到举报人是谁。
- 委员可以对待审内容投「无违规」：**满 3 票**（`VOTE_THRESHOLD = 3`）即判定无违规，
  恢复展示、结掉复审记录（标记为投票判定，**不计入送审人的误判**）、
  驳回该内容上尚未处理的举报并通知作者。同一个人对同一目标只能投一票。
- 管理员「通过」（判定内容其实没问题）会记在送审委员名下，后台可见误判数，可据此停职。
- **资格答题**：仓库内含一套通用在线考试系统（`routers/exam_api.py`，题型含单选/多选/判断/填空/简答，
  每场考试可配及格分与时长），管理端在 `/admin/exam`。
- ⚠️ **「先答题才能申请入会」尚未合并**：把考试与入会串起来的「题库 100 题 / 随机抽 20 题 /
  答对 ≥15 题通过 → 获得申请机会」，以及 60 天任期、标记 >50 免审连任、标记 ≥1 票违规即隐藏
  这几条规则，目前**只存在于重构中间目录 `tmp_stage2/`**，并未接入 `app/main.py`，
  且**不属于本次开源导出的内容**（`tmp_stage2/` 未导出，题库文件在本仓库中不存在）。
  当前版本实际生效的是本节的「LV3 申请 + 管理员审批」与「满 3 票无违规恢复」。
  详见 [`docs/MODERATION.md`](docs/MODERATION.md) 的「设计完成但未合并到当前版本」一节。

> 📖 治理流程的完整说明（含每条的代码位置、状态机与两版的差异）见
> [`docs/MODERATION.md`](docs/MODERATION.md)。

### 2.10 后台管理（Admin）

- 仪表盘：用户/作品/帖子/评论/工作室总量，待处理举报数、待审内容数、待审批委员数，
  以及按天的趋势曲线。
- 用户管理：搜索、详情、改资料、封禁/解封（含限时）、改角色、
  设置存储配额、开关内容豁免、重置密码、重置考试、删除/注销用户。
- 内容管理：作品、帖子、评论、工作室的列表与审核；待审队列；回收站。
- 举报处理：通过 / 驳回 / 维持隐藏，可追加处罚并通知举报人与作者。
- 敏感词管理：增删词条。
- 风纪委员会管理：审批申请、停职/恢复、查看每个委员的送审与误判统计。
- 考试管理：题库、试卷、成绩与统计。
- 系统开关（`switches.py`）：聊天开关、限流开关等可在后台直接切换并持久化到 `site_settings`。
- 站点设置、横幅管理、活动管理、地图活动数据、Pages 静态托管管理。
- 所有管理端写操作自动记审计（`admin_logs` / `audit_logs`）。

### 2.11 IO / 国际化与主题

- **中英双语**，自研轻量 i18n（`frontend/src/i18n/`）：词条按模块分文件，中英同文件成对，
  用 `import.meta.glob` 自动收集，新增文件不用改注册表；缺词条时回退「当前语言 → 中文 → key」。
- 后端返回的中文错误提示由 `i18n/server.js` 通过正则翻译成英文。
- **深浅色主题**与**自定义主题色**：基于 Material Web 的 `--md-sys-color-*` CSS 变量，
  主题色在 JS 里现算（读页面生效的 primary，用 HSL 推第二色），换主题色立即生效。
- 响应式：桌面 / 平板 / 手机三档布局，含移动端底部导航。
- 自定义背景图（带裁剪器）、头像、气泡与圆角等外观选项。

### 2.12 SE 精简版（frontend-se）

- 面向 **IE11** 等老浏览器的**只读**浏览版本：首页、论坛、作品、搜索、帖子详情、用户页、通知、设置。
- 无框架、纯 ES5；用 `XMLHttpRequest` 而非 `fetch`，不用 Promise；
  构建产物必须是 **IIFE 普通脚本**（不能是 `type="module"`，IE11 不执行 module 脚本）。
- 与主站共用同一个 localStorage 令牌键，所以主站登录后 SE 版即已登录。
- 目标是「能看」而不是「能用」：写操作能力有限。

### 2.13 其他

- **公开 API**（`/api/public/*`，无需登录）：对外只读的作品/帖子接口，供第三方与爬虫使用，
  支持绝对地址拼接（`NIMAO_PUBLIC_BASE_URL`）。
- **Pages 静态托管**：用户上传 zip 形式的纯静态项目，托管在独立域名
  （`NIMAO_PAGES_DOMAIN`，示例 `pages.example.com`），占用计入账号存储配额。
  解压实现针对 Zip Slip、Zip Bomb、symlink 与可执行后缀做了防护。
- **pickCat 头像工具集成**：绑定第三方头像工具账号，走本站 nginx 同源反代调用其 API。
- **存储配额**：每用户默认 100MB，可申请提升到上限（默认 20GB），低于阈值自动生效。
- **IP 属地**：基于离线 ip2region 库，只存到「省 / 国家」这一档，按小时节流，
  支持给管理员官号固定属地与豁免名单。
- **地图活动**：「锦绣山河·点亮中国」类活动，按访问者属地记录点亮的省份。
- **站点维护模式**与维护页。

## 3. 截图

> 以下截图均来自本项目界面，**已逐张确认不含真实用户名、头像、帖子内容或个人信息**。
> 由于主站的首页 / 发现 / 个人主页等页面天然会显示用户昵称与作品标题，
> 出于隐私考虑**没有**收录这些页面的截图。

### 使用说明（文档中心，深色主题）

![使用说明](docs/screenshots/01-help-center-dark.png)

### 社区规则中心（《KitterHub 社区管理规定》第一篇·总纲）

![规则中心](docs/screenshots/02-rules-center.png)

### SE 精简版（IE11 可用的只读界面）

![SE 版](docs/screenshots/04-se-edition.png)

### pickCat 头像工具页（浅色主题）

![pickCat 浅色](docs/screenshots/05-pickcat-tool-light.png)

### pickCat 头像工具页（深色主题，同一页面的主题切换效果）

![pickCat 深色](docs/screenshots/06-pickcat-tool-dark.png)

### 维护模式页

![维护中](docs/screenshots/03-maintenance.png)

## 4. 技术栈

### 后端

| 组件 | 选型 | 说明 |
| --- | --- | --- |
| 语言 | Python 3.10+ | 用到 `X \| None` 联合类型语法 |
| Web 框架 | FastAPI ≥ 0.115 | 路由按业务拆分到 `app/routers/` |
| ASGI 服务器 | uvicorn[standard] ≥ 0.34 | `run.py` 里 `reload=False`，信任本机 nginx 写入的 `X-Forwarded-*` |
| ORM | SQLAlchemy 2.x | 声明式 `Base`，`check_same_thread=False` |
| 数据库 | SQLite | 单文件，默认 `backend/nimao.db`；**不使用 Alembic** |
| 校验 | Pydantic 2.x + email-validator | 请求/响应模型与邮箱格式 |
| 鉴权 | PyJWT（HS256）+ bcrypt | Bearer Token；`token_version` 支持改密后强制下线 |
| 实时通信 | python-socketio ≥ 5.11 | 私信、群聊、通知推送 |
| 上传 | python-multipart | `UploadFile` / `Form` |
| 邮件 | SMTP（标准库）或 Resend HTTP API | 二选一，都没配时接口返回明确的配置提示 |
| 配置 | 环境变量 + 可选 `.env`（python-dotenv） | 见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) |

> **刻意不引入的东西**：Celery / Redis / 消息队列（用 `threading` 与内存缓存）、
> Alembic（用独立 `migrate_*.py` 脚本）、Pillow（图片处理交由前端与 nginx）、
> 前端 UI 框架与 i18n 库。

### 前端（主站）

| 组件 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 构建 | Vite 5 |
| 路由 | react-router-dom 6 |
| UI 组件 | `@material/web`（Material 3 Web Components）+ `@lit/react` |
| 图标 | lucide-react |
| HTTP | axios |
| 实时 | socket.io-client |
| 二维码 | qrcode-generator |
| 压缩 | fflate |
| 样式 | 原生 CSS + CSS 变量（无预处理器、无 Tailwind） |
| 国际化 | 自研（`src/i18n/`，无第三方库） |

### 前端（SE 版）

无框架、无运行时依赖。构建用 Vite 的 **lib 模式**输出 IIFE，`target: es5`，
用 Terser（`ecma: 5`）压缩，并关闭 Rollup 注入的 `Symbol.toStringTag` 等 ES2015 语法
（原因见 `frontend-se/vite.config.js` 里的注释——IE11 没有 `Symbol`，会在加载时直接抛错）。

### 部署

nginx 反向代理静态文件与 `/api`、`/socket.io`、`/uploads`、`/cloud`；
后端由 systemd 托管。示例见 `deploy/`。

## 5. 目录结构

```
KitterHubOpenProject/
├── README.md                     项目主页（本文件）
├── CONTRIBUTING.md               贡献指南：环境、规范、提交流程
├── CODE_OF_CONDUCT.md            贡献者公约（含未成年人隐私特别条款）
├── CHANGELOG.md                  更新日志
├── LICENSE                       MIT 许可证全文
├── TRADEMARK.md                  品牌与商标说明（MIT 不授权名称与站标）
├── .gitignore                    忽略密钥 / 数据库 / 上传 / 构建产物
│
├── backend/                      后端（FastAPI）
│   ├── app/                      全部业务代码
│   │   ├── main.py               应用入口：建表、挂载 Socket.IO、注册全部路由、审计中间件
│   │   ├── config.py             全部配置项，集中读环境变量（改配置先看这里）
│   │   ├── database.py           引擎 / 会话 / Base / init_db()
│   │   ├── models.py             50 个 SQLAlchemy 模型（数据表定义）
│   │   ├── schemas.py            Pydantic 请求与响应模型
│   │   ├── serializers.py        模型 → JSON，以及通知 / 审计等公共写入
│   │   ├── deps.py               依赖注入：数据库会话、当前用户、封禁与激活拦截、管理员校验
│   │   ├── security.py           bcrypt 密码哈希 + JWT 签发 / 校验
│   │   ├── committee.py          风纪委员会：审议库、隐藏送审、无违规投票、误判统计
│   │   ├── sensitive.py          敏感词过滤（数据库词库 + 60 秒缓存 + 豁免用户）
│   │   ├── chat_core.py          聊天领域逻辑（会话、成员、消息、已读）
│   │   ├── socket.py             Socket.IO 事件处理
│   │   ├── mailer.py             邮件发送（SMTP / Resend），含 HTML 模板与每日限额
│   │   ├── emailcode.py          邮箱验证码的签发、校验与防刷
│   │   ├── emailcheck.py         注册邮箱预检（格式 / 一次性邮箱 / MX）
│   │   ├── iplocate.py           ip2region 离线库解析 IP 属地
│   │   ├── github.py             GitHub OAuth 与头像回填
│   │   ├── codemao.py            编程猫账号对接（等级、徽章、免密验证）
│   │   ├── pickcat.py            头像工具绑定与头像派生
│   │   ├── pages_sites.py        用户静态项目（zip）托管，含 Zip Slip / Zip Bomb 防护
│   │   ├── storage_quota.py      存储配额计算与申请
│   │   ├── cascade.py            账号注销时的级联清理
│   │   ├── purge.py              内容清理与管理端删除动作
│   │   ├── audit.py              安全审计记录
│   │   ├── ratelimit.py          全局限流中间件与真实客户端 IP 解析
│   │   ├── limits.py             每日 / 频率等业务限流
│   │   ├── switches.py           运行期开关（后台可切，持久化到 site_settings）
│   │   ├── events.py             限时活动奖励发放
│   │   ├── map_event.py          地图活动（点亮省份）
│   │   ├── contests.py           比赛 / 接力赛
│   │   ├── studio_core.py        工作室领域逻辑与异常
│   │   ├── imageurl.py           图片 URL 规范化与第三方图床识别
│   │   ├── gamefile.py           Scratch 作品包（.sb3）处理
│   │   ├── work_sort.py          作品排序
│   │   ├── comments_order.py     评论排序与置顶
│   │   ├── antispam.py           反垃圾辅助
│   │   ├── assets/               邮件用图片等静态资源（如站点 LOGO）
│   │   └── routers/              24 个路由模块 + 3 个应用级路由（见 docs/API.md）
│   ├── run.py                    启动脚本（uvicorn，127.0.0.1:8000）
│   ├── requirements.txt          Python 依赖
│   ├── .env.example              环境变量示例（★ 复制为 .env 后修改）
│   └── README.md                 后端职责、依赖、启动与迁移说明
│
├── frontend/                     主站前端（React）
│   ├── src/
│   │   ├── main.jsx              入口
│   │   ├── App.jsx               路由表与全局布局
│   │   ├── api/                  axios 客户端、Socket.IO 客户端、后端地址唯一来源
│   │   ├── pages/                60 个页面组件（含 admin/ 后台）
│   │   ├── components/           可复用组件（顶栏、页脚、卡片、评论、聊天、Markdown、裁剪器等）
│   │   ├── context/              Auth / 主题模式等 React Context
│   │   ├── chat/                 聊天状态与通知偏好
│   │   ├── i18n/                 自研国际化：index.jsx + dict/（28 个词条文件）+ server.js
│   │   ├── pickcat/              头像工具面板与同步
│   │   ├── styles/               全局 CSS 与主题变量
│   │   └── ui/                   Material Web 组件封装
│   ├── public/                   静态资源（图标、帮助页、社区规则 md、引导文档、地理数据）
│   ├── index.html                页面模板
│   ├── vite.config.js            构建配置（开发服务器 5173）
│   ├── package.json              依赖与脚本
│   ├── package-lock.json         锁定的依赖树
│   └── README.md                 主站前端结构、依赖、开发与构建
│
├── frontend-se/                  SE 精简版（无框架 / 纯 ES5 / 面向 IE11）
│   ├── src/
│   │   ├── app.js                入口：路由与挂载
│   │   ├── router.js             基于 hash 的极简路由
│   │   ├── api.js                XMLHttpRequest 取数层 + 主站地址常量
│   │   ├── dom.js                h() 建节点与工具函数
│   │   ├── img.js                图片处理
│   │   ├── md.js                 极简 Markdown 渲染
│   │   ├── prefs.js              本地偏好
│   │   ├── se.css                SE 版样式（只用 CSS2.1）
│   │   └── views/                11 个视图：首页 / 论坛 / 作品 / 搜索 / 帖子 / 用户 / 通知 / 设置 / 互动 / 作品详情 等
│   ├── public/                   index.html（手写，不用 module 脚本）、样式、图标
│   ├── vite.config.js            lib 模式 → IIFE 的构建配置（IE11 关键）
│   ├── package.json              依赖与脚本
│   ├── package-lock.json         锁定的依赖树
│   └── README.md                 SE 版定位、IE11 构建约束与开发方式
│
├── docs/                         项目文档
│   ├── ARCHITECTURE.md           整体架构、请求链路、鉴权流程、目录职责
│   ├── DEVELOPMENT.md            本地开发细节、代码规范、i18n 与新增页面/接口
│   ├── CONFIGURATION.md          环境变量速查表（含默认值）
│   ├── API.md                    接口清单（从路由代码整理）
│   ├── DATABASE.md               数据表、字段、外键与关系图
│   ├── MODERATION.md             内容治理与风纪委员会规则详解
│   ├── SECURITY.md               安全实践与漏洞上报
│   ├── FAQ.md                    常见问题
│   ├── public-api.md             对外公开 API 的说明（已有文档）
│   └── screenshots/              界面截图（6 张，已确认无真实用户信息）
│
└── deploy/                       部署示例（域名一律为 example.com 占位符）
    ├── nginx.conf.example        nginx 站点配置示例
    ├── kitterhub-backend.service.example   systemd 服务单元示例
    └── README.md                 这些文件怎么用、要改哪里
```

## 6. 本地跑起来

### 6.1 环境要求

- **Python 3.10+**（推荐 3.11 / 3.12）
- **Node.js 18+**（推荐 20 LTS），随附 npm
- Git
- 不需要单独安装数据库（用 SQLite）

### 6.2 第一步：后端

```bash
cd backend

# 1) 建虚拟环境
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# 2) 装依赖
pip install -r requirements.txt

# 3) 准备配置
cp .env.example .env        # Windows: copy .env.example .env
```

现在**必须**填一项：

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

把输出写进 `backend/.env`：

```ini
NIMAO_SECRET_KEY=<粘贴上面生成的那串>
```

> **没有 `.env` 会怎样？**
> 后端会**直接拒绝启动**，并抛出：
> ```
> RuntimeError: NIMAO_SECRET_KEY 未正确注入（缺失/仍为默认值/长度不足）。拒绝以不安全的签名密钥启动。
> ```
> 这是刻意设计：密钥缺失时宁可起不来，也不要静默用一个弱密钥启动。
> 另外，`NIMAO_SECRET_KEY` 长度必须 ≥ 32 字符，且不能等于示例里的占位符。
> **除它之外，其余所有配置项都有默认值**，所以只填这一项就能跑起来。

```bash
# 4) 启动（首次启动会自动建表）
python run.py
```

看到 `Uvicorn running on http://127.0.0.1:8000` 即成功。

- 后端默认只监听 `127.0.0.1:8000`（**不对外**，设计上由 nginx 在前面反代）。
- 首次启动时 `app/main.py` 会调用 `init_db()` → `Base.metadata.create_all`，
  **自动在 `backend/` 下创建 `nimao.db` 并建好全部表**，不需要手工执行任何 SQL。
- 数据库文件路径可用 `NIMAO_DATABASE_URL` 修改（默认 `sqlite:///<backend 目录>/nimao.db`）。
- 建议顺手建好这几个目录（代码会在需要时自动创建，但先建好更省事）：
  `backend/uploads/`（公开上传）、`backend/private/`（护照等敏感件，**不要**被 nginx 挂载）、
  `backend/data/`（放 ip2region 库）。
- 想确认起来了：

  ```bash
  curl http://127.0.0.1:8000/api/public/works?limit=1
  ```

  接口文档默认**关闭**（`NIMAO_DOCS=0`）。本地调试想看 `/docs`，在 `.env` 里设 `NIMAO_DOCS=1`。

### 6.3 第二步：前端主站

```bash
cd frontend
npm install
npm run dev
```

打开 http://127.0.0.1:5173 。

- 开发服务器端口固定 **5173**（见 `vite.config.js`）。
- 前端在开发模式下会把 API 指向 `http://localhost:8000/api`
  （判断依据是页面端口是否为 `5173` / `5273`，见 `src/api/base.js`），所以**后端必须先起来**。
- 生产构建：`npm run build` → 产物在 `frontend/dist/`。
- 其他可用变量（在 `frontend/.env` 里设，参考 `frontend/.env.example`）：
  - `VITE_API_URL` —— 覆盖 API 基址（默认同源 `/api`）
  - `VITE_SUPPORT_EMAIL` —— 页脚展示的支持邮箱（默认 `support@example.com`）
  - `VITE_PAGES_DOMAIN` —— Pages 托管域名（默认 `pages.example.com`）

### 6.4 第三步：SE 精简版（可选）

```bash
cd frontend-se
npm install
npm run build      # 产物在 frontend-se/dist/：app.js + style.css + index.html
npm run dev        # 开发预览
```

SE 版是**构建期**产出 IIFE 脚本 + 手写的 `public/index.html`，
把 `frontend-se/dist/` 整个目录作为静态站点托管即可，API 走同源 `/api`。

- `frontend-se/.env` 里可设 `VITE_SITE_ORIGIN`（默认 `https://example.com`），
  用于「回主站」「在 KitterHub 打开」这类外链。

### 6.5 常见的「起不来」

| 现象 | 原因与处理 |
| --- | --- |
| `RuntimeError: NIMAO_SECRET_KEY ...` | 没建 `.env` 或密钥太短。见 §6.2 |
| 页面能开但所有请求失败 | 后端没启动，或端口不是 5173（开发模式判定依赖端口） |
| `ModuleNotFoundError: No module named 'app'` | 必须在 `backend/` 目录下执行 `python run.py` |
| 上传图片 413 | nginx 的 `client_max_body_size` 小于应用上限，见 `deploy/nginx.conf.example` |
| 邮件相关接口报「邮件服务还没配置好」 | 正常：SMTP 与 Resend 都没配。见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) 第 4 节 |
| IP 属地一直是空的 | 没有 `backend/data/ip2region_v4.xdb`（需自行下载，约 11MB），功能会自动降级 |

## 7. 配置项说明

所有配置项都以 `NIMAO_` 开头，通过环境变量注入；本地开发放在 `backend/.env`。
**完整清单（含默认值与是否必填）见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)**，
这里只列最常用的几组，示例值一律用占位符。

### 7.1 核心

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NIMAO_SECRET_KEY` | **是** | 无 | JWT 签名密钥。≥ 32 字符，不填则拒绝启动 |
| `NIMAO_TOKEN_EXPIRE` | 否 | `1440` | 令牌有效期（分钟） |
| `NIMAO_DATABASE_URL` | 否 | `sqlite:///<backend>/nimao.db` | 数据库连接串 |
| `NIMAO_DOCS` | 否 | `0` | 置 1 开放 `/docs`、`/redoc`、`/openapi.json` |

### 7.2 站点标识

| 变量 | 默认值（占位符） | 说明 |
| --- | --- | --- |
| `NIMAO_SITE_URL` | `https://example.com` | 站点主地址：SEO canonical、分享链接、GitHub OAuth 回调、SE 版回跳 |
| `NIMAO_PAGES_DOMAIN` | `pages.example.com` | Pages 静态托管的独立域名（只写主机名） |
| `NIMAO_SUPPORT_EMAIL` | `support@example.com` | 页脚与社区规则文档里的联系邮箱 |
| `NIMAO_PUBLIC_BASE_URL` | 空 | 公开接口拼绝对地址用；留空按请求 Host 推断 |
| `NIMAO_PICKCAT_API_BASE` | `https://example.com/pickcat-avatar/api/v1` | 头像工具后端地址 |

### 7.3 邮件（两组二选一，都不配则邮件功能不可用）

| 变量 | 说明 |
| --- | --- |
| `NIMAO_MAIL_PROVIDER` | 强制通道 `smtp` / `resend`；留空自动 |
| `NIMAO_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_SSL` | SMTP 通道（授权码，不是登录密码） |
| `NIMAO_RESEND_API_KEY` / `NIMAO_MAIL_FROM` | Resend 通道 |
| `NIMAO_EMAIL_REGISTER` / `_PRECHECK` | 邮箱注册总开关 / 注册邮箱预检 |
| `NIMAO_MAIL_DAILY_LIMIT` | 全站每日发信上限（默认 80） |
| `NIMAO_EMAIL_CODE_ECHO` | ★ 仅联调：置 1 时验证码随接口返回。**正式环境必须 0** |
| `NIMAO_EMAIL_FIXED_CODE` | ★ 仅联调：非空时注册接受固定码。**正式环境必须留空**（默认已留空） |

### 7.4 开关与限流

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_CHAT_ENABLED` | `1` | 聊天总开关 |
| `NIMAO_LIMIT_RATE` / `NIMAO_RATE_LIMIT` | `0` / `300` | 全局限流开关 / 每 IP 每分钟请求数 |
| `NIMAO_LIMIT_FREQ` | `0` | 发帖评论投稿的短时频率限制 |
| `NIMAO_LIMIT_DAILY` | `0` | 每日内容数量上限开关 |
| `NIMAO_DAILY_POST_LIMIT` / `_COMMENT_LIMIT` / `_WORK_LIMIT` | `20` / `50` / `20` | 对应每日上限 |
| `NIMAO_LIMIT_LOGIN` | `0` | 登录失败次数锁定 |
| `NIMAO_LIMIT_REG` | `0` | 自动注册配额 |

### 7.5 上传与存储

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_MAX_UPLOAD_SIZE` | `3145728`（3MB） | 单张图片上限 |
| `NIMAO_MAX_VIDEO_SIZE` | `31457280`（30MB） | 视频上限 |
| `NIMAO_PASSPORT_MAX_SIZE` | `8388608`（8MB） | 证件图上限 |
| `NIMAO_SCRATCH_MAX_SIZE` | `52428800`（50MB） | `.sb3` 作品包上限 |
| `NIMAO_STORAGE_PER_USER_MB` | `100` | 每用户默认存储配额 |
| `NIMAO_STORAGE_QUOTA_MAX_MB` | `20480` | 可申请到的配额上限 |

### 7.6 云变量与 IP 属地

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_CLOUD_ENABLED` / `_HOST` / `_SECRET` | `1` / `wss://example.com/cloud` / 空 | Scratch 云变量服务；**本仓库不含该服务**，见 §13 |
| `NIMAO_IP2REGION_XDB` | 空（默认 `backend/data/ip2region_v4.xdb`） | 离线 IP 库路径；缺失则功能降级 |
| `NIMAO_IP_REGION_REFRESH` | `60` | 属地缓存刷新间隔（分钟） |
| `NIMAO_IP_REGION_ADMIN_FIXED` | 空 | 给管理员官号固定显示的属地 |
| `NIMAO_IP_REGION_FIXED_UIDS` / `_PIN_EXEMPT_UIDS` | 空 | 固定属地 / 豁免固定属地的账号 uid 列表 |

## 8. API 概览

- 所有接口都挂在 **`/api`** 前缀下。
- 鉴权用 `Authorization: Bearer <JWT>`；令牌由 `/api/auth/login` 等接口签发。
- 错误统一为 `{"detail": "中文提示"}`；`422` 是 Pydantic 校验失败，`detail` 是对象数组。
- **完整清单（373 个端点，含方法 / 路径 / 鉴权 / 说明）见 [`docs/API.md`](docs/API.md)。**

按模块分布（端点数量来自路由代码统计）：

| 模块 | 前缀 | 端点数 | 说明 |
| --- | --- | --- | --- |
| 后台管理 | `/api/admin` | 96 | 用户、内容、举报、风纪委员会、考试、开关 |
| 用户 | `/api/users` | 58 | 资料、关注、收藏、历史、设置、经验、认证 |
| 工作室 | `/api/studios` | 33 | 创建、成员、公告、审核 |
| 作品 | `/api/works` | 31 | 投稿、详情、试玩、评论、源码 |
| 私信与群聊 | `/api/chat` | 25 | 会话、消息、群成员、免打扰 |
| 帖子 | `/api/posts` | 18 | 发帖、编辑、置顶、评论 |
| 认证 | `/api/auth` | 14 | 登录、注册、验证码、OAuth |
| 发现 | `/api/discover` | 8 | 推荐流与筛选 |
| 通知 | `/api/notifications` | 7 | 列表、未读数、已读 |
| 认证审核 | `/api/verify` | 7 | 证件提交与状态 |
| 搜索 | `/api/search` | 5 | 全站搜索、话题 |
| 草稿 | `/api/drafts` | 5 | 草稿箱 |
| 好友关系 | `/api/friends` | 5 | 关注 / 粉丝 / 互关 |
| 风纪委员会 | `/api/committee` | 6 | 审议库、隐藏送审、投票 |
| 举报 | `/api/reports` | 4 | 举报与我的举报 |
| 收藏夹 | `/api/collections` | 4 | 收藏夹管理 |
| 地图活动 | `/api/map-event` | 4 | 省份数据与领奖 |
| 反馈 | `/api/feedback` | 3 | 意见反馈（可带图） |
| 公开接口 | `/api/public` | 3 | **无需登录**，对外只读 |
| 上传 | `/api/upload` | 3 | 图片 / 视频 / 头像 |
| 其他 | `/api/{reactions,contests,events,...}` | 各 1–4 | 互动、活动、首页聚合等 |
| 公开对外 API | `/api/public/*` | 3 | 见 [`docs/public-api.md`](docs/public-api.md) |

常用示例（把 `example.com` 换成本地 `127.0.0.1:8000`）：

```bash
# 登录，拿令牌
curl -X POST https://example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"demo_user","password":"<你的密码>"}'

# 带令牌取当前用户
curl https://example.com/api/auth/me -H "Authorization: Bearer $TOKEN"

# 公开接口（无需令牌）
curl "https://example.com/api/public/works?limit=20"
```

主要接口分组：

- **认证**：`POST /api/auth/login`、`POST /api/auth/register`、`POST /api/auth/email/send-code`、
  `POST /api/auth/forgot`、`GET /api/auth/me`、`POST /api/auth/github/authorize-url`、
  `GET /api/auth/github/callback`
- **用户**：`GET /api/users/{id}`、`PATCH /api/users/me`、`POST /api/users/me/treaty`、
  `GET /api/users/me/xp`、`POST/DELETE /api/users/{id}/follow`
- **作品**：`GET/POST /api/works`、`GET/PATCH/DELETE /api/works/{id}`、
  `POST /api/works/{id}/comments`、`GET /api/works/{id}/source`
- **帖子**：`GET/POST /api/posts`、`GET/PATCH/DELETE /api/posts/{id}`、
  `POST /api/posts/{id}/comments`
- **评论**：`GET/POST /api/posts/{id}/comments`、`GET/POST /api/works/{id}/comments`
- **搜索**：`GET /api/search`、`GET /api/search/suggest`、`GET /api/search/hot`
- **通知**：`GET /api/notifications`、`GET /api/notifications/unread-count`、
  `POST /api/notifications/read-all`
- **私信**：`GET /api/chat/threads`、`GET/POST /api/chat/threads/{id}/messages`、
  `POST /api/chat/threads/{id}/read`
- **工作室**：`GET/POST /api/studios`、`GET/PATCH /api/studios/{id}`、
  `POST /api/studios/{id}/join`、`POST /api/studios/{id}/members/{uid}/approve`
- **治理**：`POST /api/reports`、`GET /api/reports/me`、`GET /api/committee/queue`、
  `POST /api/committee/hide`、`POST /api/committee/vote`
- **后台**：`GET /api/admin/dashboard`、`GET/PATCH /api/admin/users`、
  `GET /api/admin/sensitive-reviews`、`POST /api/admin/sensitive-reviews/{id}/approve`
- **公开**：`GET /api/public/works`、`GET /api/public/works/{id}`、`GET /api/public/posts`

## 9. 内容治理机制

> 本节内容**全部来自代码**（`app/sensitive.py`、`app/routers/reports.py`、
> `app/committee.py`、`app/serializers.py`），阈值均标注了定义位置。
> 更详细的说明与状态机见 [`docs/MODERATION.md`](docs/MODERATION.md)。

### 9.1 敏感词：命中即待审

1. 发布/编辑**作品标题与简介**、**帖子标题与正文**、**作品评论**、**帖子评论**时，
   调用 `sensitive.hits(text, user, db)`。
2. 词库来自数据库 `sensitive_words` 表（后台可增删，**改完立即生效**，读取有 60 秒缓存）。
   代码里的内置词表是空列表（`SENSITIVE_WORDS = []`），仅在表为空时作为种子。
   匹配方式是**不区分大小写的子串包含**。
3. 命中后：内容以 `status="pending"` 落库 —— 也就是说**它虽然保存成功，但对外不可见**
   （列表接口对非管理员只返回已发布内容），同时写入一条
   `content_reviews` 记录（`source="sensitive"`、`status="pending"`）进入审议库。
4. **豁免用户**（`users.sensitive_exempt`，后台可开关）发布的内容**不做检测**：
   `hits()` 直接返回空列表，因此既不置为待审、也不进队列。
   注意豁免的只是「他发的内容」——用户名、昵称、工作室名仍然照常检测。
5. 用户名（注册）、昵称（改资料）、工作室名命中敏感词时是**直接拒绝**，不会进审议库。

### 9.2 举报：3 次触发处理

1. 举报者：**已登录用户**（`POST /api/reports` 用 `get_current_user`）。
2. 去重：同一个人对同一个 `(target_type, target_id)` 只能报一次，
   重复提交直接返回 `{"ok": true, "already": true}`。
3. 阈值：代码里是 `if pending_count >= 3:`（`app/routers/reports.py`）。
   **准确口径**：这是「该目标**累计**收到的举报条数」达到 3，且仅对 `work` / `post` 生效：
   - **作品**：若当前是 `published`，则改为 `pending`（＝**自动下架待审**），并通知作者
     「因多次举报已被暂时下架，等待管理员复核」。
   - **帖子**：**只给作者发通知**（「多次被举报，管理员将尽快复核」），
     **不会自动改变帖子的可见状态**。
4. 管理员在后台处理举报：通过 / 驳回 / 维持隐藏，可追加处罚并通知双方；
   处理结果会回显给举报人（`GET /api/reports/me`），后台还会展示
   「该内容共被举报几次、其中几条未处理」以及「该举报人共报过几次、被驳回几次」，
   用于识别滥用。

### 9.3 风纪委员会

**审议库（队列）由两类来源组成**（`committee.QUEUE_SOURCES = ("committee", "sensitive")`）：

- `committee`：委员巡逻时主动「隐藏并送审」的内容；
- `sensitive`：系统命中敏感词后自动送审的内容。

此外，**所有未处理的举报一定进队列**（去重），正常内容则**随机抽样**进入
（每次抽 `RANDOM_QUEUE_SIZE = 12` 条），让委员有内容可巡视。

**委员资格**：

- 申请门槛 **LV3 及以上**（`committee.MIN_LEVEL = 3`）。
- 提交申请理由 → `committee_status = "pending"` → **管理员审批**后变为 `active`（在职）；
  也可以是 `rejected`（未通过）或 `suspended`（已停职）。
- 「只有在职风纪委员可以使用该功能」——所有委员接口都先调用 `require_member()` 校验。
- 仓库内含通用考试系统供选拔使用，但**「题库 100 题 / 每次抽 20 题 / 15 题及格」以及
  「60 天任期」并不存在于代码常量中**，属于考试与人事配置，请以实际部署为准。

**委员的执法权限（有意收紧）**：

| 能做 | 不能做 |
| --- | --- |
| 隐藏内容并送管理员复审（必须写理由） | 删除内容 |
| 对**待审**内容投「无违规」 | 处罚用户 |
| 在面板里浏览统计 | 看到举报人是谁 |

- 每人每天最多隐藏 `DAILY_HIDE_LIMIT = 20` 条（防「一键全隐藏」式滥用）。
- 不能处理自己发布的内容；不能重复隐藏已在队列里的内容。
- 隐藏时创建 `content_reviews` 记录（`source="committee"`、`reviewer_id` 记录是谁办的），
  并**通知所有管理员**。

**「无违规」投票与状态流转**：

- `VOTE_THRESHOLD = 3`：**3 位风纪委员都选择「无违规」即判定无违规**。
- 只有**待审**内容可以投（被举报还没处理的，或被隐藏正等管理员复审的）；
  纯随机巡逻的正常内容没有「审」可投，前端也不显示按钮。
- 一个人对同一目标只能投一票（数据库唯一约束 `uq_committee_vote`）；
  不能给自己发布的内容投票。
- 满 3 票后（`_clear_by_vote`）：恢复展示 → 把仍在等待的复审记录按「内容没问题」结掉
  （`resolved_by = "committee_vote"`）→ 该内容上尚未处理的举报一并驳回 → 通知作者。

**管理员复审与误判统计**：

- 管理员在后台一个队列里处理两类来源（`committee` / `sensitive`）的送审，处理逻辑与
  敏感词复审共用同一条流水线：通过＝恢复展示，驳回＝维持隐藏并可追加处罚，均通知作者。
- 若管理员判定内容其实没问题（通过）且**不是**投票判定，则记在送审委员名下；
  后台可见每个委员的「累计送审 / 今天送审 / 被判定为误判」数，可据此停职。

### 9.4 内容可见状态一览

| 状态值 | 含义 | 谁会把内容设成它 |
| --- | --- | --- |
| `published` / `active` | 正常对外可见 | 正常发布；被判定无违规后恢复 |
| `pending` | 待审，**不对外展示** | 命中敏感词；被举报≥3 次的作品；委员隐藏；作者选择「先审后发」 |
| `rejected` | 未通过审核 | 管理员驳回 |
| （回收站） | 已删除但可还原 | 作者或管理员删除 |

## 10. 部署说明

`deploy/` 下提供了**与服务器无关**的示例配置，所有域名与 IP 都是占位符，
用之前请全文替换成你自己的值。

### 10.1 需要改的占位符

| 占位符 | 替换为 |
| --- | --- |
| `example.com` | 你的站点主域名 |
| `pages.example.com` | 你的 Pages 托管域名（不用该功能可删掉对应 server 块） |
| `/srv/kitterhub` | 你的实际部署路径 |
| `kitterhub` | systemd 服务名 / 系统用户名（可选） |

### 10.2 大致流程

```bash
# 1) 拉代码
cd /srv && git clone <你的仓库地址> kitterhub && cd kitterhub

# 2) 后端
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
# 用 systemd 的 EnvironmentFile 注入环境变量（不要用 .env 提交进仓库）
sudo install -m 600 /dev/null /etc/kitterhub/backend.env
sudo editor /etc/kitterhub/backend.env     # 至少填 NIMAO_SECRET_KEY
python run.py                              # 或用 systemd 托管
```

```bash
# 3) 前端构建（在本地或服务器上构建后上传均可）
cd frontend && npm ci && npm run build     # → frontend/dist/
cd ../frontend-se && npm ci && npm run build   # → frontend-se/dist/（可选）
```

```bash
# 4) 装 nginx 与 systemd 配置
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/kitterhub.conf
sudo cp deploy/kitterhub-backend.service.example /etc/systemd/system/kitterhub-backend.service
sudo editor /etc/nginx/conf.d/kitterhub.conf   # 改域名与路径
sudo editor /etc/systemd/system/kitterhub-backend.service
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload && sudo systemctl enable --now kitterhub-backend
```

### 10.3 几点注意

- **后端不要直接对公网监听**：`run.py` 固定 `127.0.0.1:8000`，公网流量统一由 nginx 进来，
  这样 `X-Forwarded-For` 才可信（后端已配置 `proxy_headers=True` 且
  `forwarded_allow_ips="127.0.0.1"`）。
- **上传体积要对齐**：nginx 的 `client_max_body_size` 必须 ≥ 应用侧的
  `NIMAO_MAX_VIDEO_SIZE` / `NIMAO_SCRATCH_MAX_SIZE`，否则大文件会在 nginx 层被 413 掉。
- **`backend/private/` 绝对不要用 nginx 暴露**：护照等证件图只能由后端校验权限后读取。
  示例配置里只暴露了 `/uploads/`。
- **`/cloud` 需要额外服务**：本仓库不含云变量服务，示例配置里的 `/cloud` 反代请按需删除
  或指向你自己的实现，并相应设置 `NIMAO_CLOUD_ENABLED=0`。
- **HTTPS**：对外站点务必启用 TLS（证书可直接用 certbot 申请），
  示例配置留了注释位置。
- **备份**：需要备份的只有 `backend/nimao.db`、`backend/uploads/`、`backend/private/`
  与你的 `.env`/`EnvironmentFile`。**备份文件绝不能提交进仓库。**

## 11. 开源协议

本项目采用 **MIT 许可证**，全文见 [`LICENSE`](LICENSE)。

也就是说：**你可以自由使用、修改、商用、闭源再发布**，只需保留版权声明与许可证文本。我们是有意选择宽松许可的。

但 **MIT 只授权代码，不授权品牌** —— 名称 **KitterHub**、站标/图标、线上域名都不在授权范围内，详见 [`TRADEMARK.md`](TRADEMARK.md)。如果你想用这套代码搭自己的社区，请替换名称与站标，并保留一句来源说明（如 "Based on KitterHub, MIT licensed"）。

> 注意：许可证只约束**代码**。代码开源**不包含任何用户数据**；部署者需自行负责数据合规、未成年人保护与内容审核，详见 [`docs/SECURITY.md`](docs/SECURITY.md)。

## 12. 贡献指南

完整的贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，要点：

1. 先读 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)——本项目面向青少年用户，
   **绝不允许**在 issue / PR 里粘贴真实用户名、UID、截图、数据库、日志或任何服务器信息。
2. 环境要求：Python 3.10+、Node.js 18+。
3. 提交前必做：
   - `cd backend && python run.py` 能正常启动；
   - `cd frontend && npm run build` 无报错；
   - 改了 SE 版则 `cd frontend-se && npm run build`，并确认产物是 IIFE（不含 `type="module"`）；
   - `git status` 里**没有** `.env`、`*.db`、`uploads/`、`node_modules/`。
4. 提交信息用 `<type>(<scope>): <中文描述>`，例如
   `fix(uploads): 修正护照图片超限时返回 413 而非 500`。
5. 新增接口/页面/词条的具体步骤见 `CONTRIBUTING.md` §5–§7。

## 13. 常见问题

### Q1. 这个仓库能直接跑成一个完整的 KitterHub 站点吗？

**后端、主站前端、SE 版都能跑**，但有三项功能需要你自行补齐：

1. **Scratch 云变量服务**（`cloud/` 目录）——本仓库未包含，
   所以 `NIMAO_CLOUD_ENABLED` 建议先置 `0`。
2. **ip2region 离线 IP 库**（`backend/data/ip2region_v4.xdb`，约 11MB）——
   需要自行下载；缺失时 IP 属地功能自动降级为空值，不影响其他功能。
3. **邮件通道** —— 不配 SMTP / Resend 时，邮箱注册与找回密码不可用。

另外，浏览器扩展（`extensions/`）与内网代理脚本（`proxy/`）也**不在**本仓库内。

### Q2. 为什么后端不填 `NIMAO_SECRET_KEY` 就启动不了？

这是刻意设计。`app/config.py` 在导入时就检查该变量：缺失、等于占位符、或长度不足 32 字符，
一律 `raise RuntimeError`。宁可启动失败，也不要用一个可预测的密钥签发 JWT——
那等于任何人都能伪造登录态。生成方式：

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

### Q3. 数据库怎么初始化？需要跑迁移脚本吗？

**不需要**。首次 `python run.py` 时 `app/main.py` 会调用 `init_db()`，
由 SQLAlchemy 的 `Base.metadata.create_all` 一次性建好全部表，文件默认落在
`backend/nimao.db`。

本项目**不使用 Alembic**。原始私有仓库里有一批 `migrate_*.py` 脚本用于给**已经存在数据的库**
补列/改表，它们没有包含在开源版本里（见 `CHANGELOG.md`）。
如果你修改了 `models.py` 并需要升级一个已有数据库，请自己写一个幂等的迁移脚本，
或直接对开发库执行 `ALTER TABLE`。详见 [`docs/DATABASE.md`](docs/DATABASE.md)。

### Q4. 前端页面能打开，但所有数据都不显示？

按顺序检查：

1. 后端是否在跑？（`curl http://127.0.0.1:8000/api/public/works?limit=1`）
2. 页面端口是不是 **5173**（或 5273）？
   开发模式判定写死在 `src/api/base.js` 的 `isViteDev()` 里——用别的端口访问时
   前端会走「同源 `/api`」，而 Vite 开发服务器没有配代理，于是 404。
3. 浏览器控制台是否有 CORS 报错？后端 `config.CORS_ORIGINS` 默认只允许
   `localhost:5173` / `127.0.0.1:5173`。

### Q5. 敏感词库是空的，是不是治理功能坏了？

不是。`app/sensitive.py` 里的内置词表被**有意清空**（`SENSITIVE_WORDS = []`），
设计上词库完全由数据库 `sensitive_words` 表驱动，由管理员在后台维护。
新库的表是空的，所以一开始不会有任何内容因敏感词被拦。

用法：用管理员账号登录后台 → 敏感词管理 → 添加词条，**改完立即生效**（读取有 60 秒缓存）。

### Q6. 上传大文件总是 413，怎么改？

这是 nginx 在应用之前就挡掉了。把 nginx 配置里的
`client_max_body_size` 调到 **大于**你想要的 `NIMAO_SCRATCH_MAX_SIZE`
（默认 50MB）或 `NIMAO_MAX_VIDEO_SIZE`（默认 30MB），然后 `nginx -s reload`。
应用层的上限由环境变量控制，两层都要改。参考 `deploy/nginx.conf.example`。

### Q7. 「3 位风纪委员判定无违规」和「被举报 3 次隐藏」是同一个 3 吗？

不是，是两个独立的阈值，含义完全不同：

- **被举报 3 次**（`app/routers/reports.py`）= 该内容累计收到的**举报条数**达 3 →
  作品自动下架为 `pending`；帖子**只通知作者**，不改变可见状态。
- **无违规 3 票**（`app/committee.py` 的 `VOTE_THRESHOLD = 3`）= **3 位不同的风纪委员**
  都投「无违规」→ 恢复内容展示、结掉复审记录、驳回未处理举报。

### Q8. 为什么截图里没有首页、发现页和个人主页？

因为这些页面天然会显示真实用户的昵称、头像、作品标题与评论内容。
本项目用户以未成年人为主，出于隐私考虑只收录了**不含任何用户信息**的界面截图
（文档中心、规则中心、SE 版登录、头像工具页、维护页）。
需要更多截图时请自行在**本地空白数据**的实例上截取。

---

## 相关文档

| 文档 | 内容 |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 整体架构、请求链路、鉴权流程、目录职责 |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | 本地开发、代码规范、i18n、新增页面/接口 |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | 环境变量完整速查表 |
| [`docs/API.md`](docs/API.md) | 全部 373 个接口（方法 / 路径 / 鉴权 / 说明） |
| [`docs/DATABASE.md`](docs/DATABASE.md) | 50 张表、字段、外键与关系图 |
| [`docs/MODERATION.md`](docs/MODERATION.md) | 内容治理与风纪委员会状态机（含「未合并」规则清单） |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 安全实践、密钥管理、上传限制、漏洞上报 |
| [`docs/FAQ.md`](docs/FAQ.md) | 常见问题 |
| [`docs/public-api.md`](docs/public-api.md) | 对外公开只读 API 的字段契约 |
| [`backend/README.md`](backend/README.md) | 后端目录职责、依赖、启动与迁移 |
| [`frontend/README.md`](frontend/README.md) | 主站前端结构、依赖、开发与构建 |
| [`frontend-se/README.md`](frontend-se/README.md) | SE 精简版的定位与构建约束 |
| [`deploy/README.md`](deploy/README.md) | 部署示例配置的用法与必须修改的占位符 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献指南 |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | 贡献者公约 |
| [`CHANGELOG.md`](CHANGELOG.md) | 更新日志 |
