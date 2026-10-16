# 架构说明（ARCHITECTURE）

本文说明 KitterHub 的整体架构、一次请求的完整链路、鉴权流程，以及各目录的职责边界。
配合阅读：[`DEVELOPMENT.md`](DEVELOPMENT.md)（怎么改代码）、
[`DATABASE.md`](DATABASE.md)（数据模型）、[`MODERATION.md`](MODERATION.md)（治理流程）。

---

## 1. 总览

KitterHub 是一个**单体后端 + 两个前端**的经典结构，没有引入微服务、消息队列或独立缓存层。

```
                          ┌──────────────────────────────┐
                          │          浏览器               │
                          │  React 主站 / SE 版 / 第三方   │
                          └───────────────┬──────────────┘
                                          │ HTTPS
                          ┌───────────────▼──────────────┐
                          │            nginx             │
                          │  · 静态文件（主站 / SE 版）    │
                          │  · /api      → 127.0.0.1:8000│
                          │  · /socket.io→ 127.0.0.1:8000│
                          │  · /uploads  → 磁盘（公开）    │
                          │  · /cloud    → 云变量服务(可选) │
                          └───────────────┬──────────────┘
                                          │ HTTP（本机回环）
                          ┌───────────────▼──────────────┐
                          │   FastAPI 应用（uvicorn）      │
                          │   app/main.py                │
                          │                              │
                          │  ┌────────────────────────┐  │
                          │  │ 中间件                 │  │
                          │  │  · CORS                │  │
                          │  │  · RateLimitMiddleware │  │
                          │  │  · 安全审计中间件        │  │
                          │  └───────────┬────────────┘  │
                          │              ▼               │
                          │  ┌────────────────────────┐  │
                          │  │ routers/（~50 模块）    │  │
                          │  │  Depends(get_db /      │  │
                          │  │   get_current_user ...)│  │
                          │  └───────────┬────────────┘  │
                          │              ▼               │
                          │  ┌────────────────────────┐  │
                          │  │ 领域模块                │  │
                          │  │ committee / chat_core /│  │
                          │  │ sensitive / studio_core│  │
                          │  │ / mailer / iplocate …  │  │
                          │  └───────────┬────────────┘  │
                          │              ▼               │
                          │  ┌────────────────────────┐  │
                          │  │ SQLAlchemy ORM         │  │
                          │  └───────────┬────────────┘  │
                          │              ▼               │
                          │        SQLite（nimao.db）      │
                          │                              │
                          │  Socket.IO（python-socketio）  │
                          └──────────────────────────────┘
```

设计取舍：

- **单体**：所有业务在一个进程内，模块间用 Python 函数调用而不是网络调用，
  避免为一个中小规模社区引入分布式复杂度。
- **SQLite**：单文件数据库，`check_same_thread=False` 支持多线程访问。
  写入压力不大（社区站点），省掉了独立数据库服务的运维成本。
- **nginx 在最前面**：后端**只监听 127.0.0.1**，公网流量一律经过 nginx。
  这样 `X-Forwarded-For` 可信，`run.py` 里的 `proxy_headers=True` +
  `forwarded_allow_ips="127.0.0.1"` 才能安全地还原真实客户端 IP。
- **无独立缓存层**：少量缓存直接用模块级字典 + 时间戳
  （如敏感词 60 秒缓存 `sensitive._db_words_cache`）。
- **无 Alembic**：建表靠 `create_all`，已有库的变更靠一次性脚本。

## 2. 后端启动过程

`app/main.py` 在**导入时**就完成初始化（这是理解本项目的一个关键点）：

```python
init_db()                     # 1. 导入 models 并 Base.metadata.create_all
app = FastAPI(...)            # 2. 创建应用；/docs 是否开放由 NIMAO_DOCS 决定
app.add_middleware(...)       # 3. CORS、限流、审计
app.include_router(r, prefix="/api")   # 4. 注册全部路由（统一挂 /api）
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR))
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)   # 5. 包成 ASGI 应用
```

因此：

- **`config.py` 的校验发生在进程启动的最早期**。`NIMAO_SECRET_KEY` 不合法时，
  进程在导入阶段就崩掉，连端口都不会监听。
- **建表是幂等的**：`create_all` 只创建不存在的表，不会改动已存在的表结构。
  这意味着**修改 `models.py` 里已有表的字段不会自动生效**（见 [`DATABASE.md`](DATABASE.md)）。
- 路由**全部**统一用 `prefix="/api"`，各模块内部只写相对路径。

## 3. 请求链路

以「用户提交一条作品评论」为例：

```
1. 浏览器  POST /api/works/28/comments
              Authorization: Bearer <JWT>
2. nginx   → 反代到 127.0.0.1:8000，补上 X-Forwarded-For / X-Real-IP
3. uvicorn → 进入 ASGI 应用
4. 中间件  CORS → RateLimitMiddleware（按 client_ip 计数）→ 审计中间件（记录写操作）
5. FastAPI → 解析路由到 routers/works.py 的处理函数
6. 依赖注入（Depends）按顺序求值：
     get_db()            → 打开一个 SQLAlchemy 会话
     get_current_user()  → 解析并校验 JWT，取出 User；顺带刷新 IP 属地、发活动奖励
     get_active_user()   → 再检查「是否被封禁」「账号是否已激活」
7. 业务逻辑：
     sensitive.hits(内容, user, db)          → 命中敏感词？
     models.WorkComment(status = "active" 或 "pending")   → 落库
     serializers.notify_user(...)            → 给作者写通知
8. 返回 JSON；会话在 get_db 的 finally 里关闭
9. 审计中间件补写一条记录
```

要点：

- **所有写操作都经过 `get_active_user`**，所以「封禁」和「未激活」的拦截只写了一处。
- **IP 属地的刷新、活动奖励的发放都挂在 `get_current_user` 上**——
  因为用户绝大多数时候是「早就登录着直接打开网站」，不会走登录接口。
  这两件事都被 `try/except` 包住并且做了节流，绝不能影响正常请求。
- **`get_db` 保证会话关闭**，路由里不需要手动 `close()`。

## 4. 鉴权流程

### 4.1 令牌

- 登录成功 → `security.create_access_token({"sub": str(user.id), "ver": user.token_version})`
  → HS256 签名，载荷含 `exp`。
- 有效期默认 **1440 分钟（24 小时）**，由 `NIMAO_TOKEN_EXPIRE` 控制。
- 前端把令牌存在 `localStorage`，键名是 **`nimao_token`**
  （主站 `src/api/client.js` 与 SE 版 `frontend-se/src/api.js` 共用同一个键，
  所以在主站登录后 SE 版自动就是已登录状态）。
- 请求时带 `Authorization: Bearer <token>`。

### 4.2 校验链（`app/deps.py`）

使用的是 `HTTPBearer(auto_error=False)`，因此「没带令牌」和「令牌无效」的报错可以区分。

| 依赖 | 行为 | 用在 |
| --- | --- | --- |
| `get_db` | 提供 SQLAlchemy 会话，请求结束自动关闭 | 所有需要数据库的路由 |
| `get_current_user` | 无令牌 → 401「请先登录」；解码失败/`sub` 缺失 → 401；用户不存在 → 401；`ver` 与 `user.token_version` 不符 → 401「登录已失效」。**包含被封禁用户**。通过后刷新 IP 属地与活动奖励 | 只读接口；也用于举报等 |
| `get_active_user` | 在 `get_current_user` 之上：① 到期自动解封；② 仍在封禁期 → 403；③ `verify_state != "ok"` → 403（**账号未激活**），但白名单路径放行 | 所有写接口 |
| `get_current_admin` | 在 `get_active_user` 之上：`user.role != "admin"` → 403 | 全部 `/api/admin/*` |
| `get_optional_user` | 未登录或令牌无效 → 返回 `None`（不报错） | 需要「登录则附带个性化信息」的只读接口（如是否已点赞） |

### 4.3 「账号未激活」的白名单死锁

`deps._LOCKED_ALLOW` 是一个**必须存在**的设计，它列出的路径在账号未激活时仍然放行：

```python
_LOCKED_ALLOW = (
    "/api/auth/logout",
    "/api/verify/",
    "/api/users/me/treaty",          # 《友好条约》弹窗是模态、关不掉的
    "/api/users/me/bind-codemao",    # 绑定编程猫是两条激活路径之一
)
```

原因写在源码注释里：《友好条约》弹窗无法关闭，而它本身是一个写接口；
如果锁定期间把它 403 掉，用户就被永久困在弹窗里，连护照页都点不到。
这是线上真实发生过的死锁。

### 4.4 改密后强制下线

`User.token_version` 是一个自增计数。修改密码时递增，
旧令牌的 `ver` 与新值不符 → `_resolve_user` 抛 401，
实现「改密后其它设备全部失效」。

### 4.5 风纪委员会

委员会**不是**一个依赖项，而是在领域层校验：

```python
# app/committee.py
def is_member(user) -> bool:     return _status(user) == "active"
def require_member(user) -> None:
    if not is_member(user):
        raise HTTPException(status_code=403, detail="只有在职风纪委员可以使用该功能")
```

每个委员接口在处理函数开头调用 `require_member(current)`。
委员状态存在 `User.committee_status`（`pending` / `active` / `rejected` / `suspended`）。

## 5. 两个前端的关系

| | 主站 `frontend/` | SE 版 `frontend-se/` |
| --- | --- | --- |
| 目标浏览器 | 现代浏览器 | **IE11** 及同类老浏览器 |
| 框架 | React 18 | 无框架 |
| 语言级别 | ESNext（Vite 默认） | **纯 ES5**（不用箭头函数 / `let` / 模板字符串 / Promise） |
| 数据获取 | axios（+ 拦截器） | `XMLHttpRequest` 手写封装 |
| 实时通信 | socket.io-client | 无 |
| 构建产物 | `dist/`：ESM 脚本 + 分块资源 | `dist/`：`app.js`（**IIFE**）+ `style.css` + 手写 `index.html` |
| 能力 | 全部（读写） | 以浏览为主（只读 + 少量互动） |
| 鉴权 | `localStorage['nimao_token']` | 同一个键，因此与主站共享登录态 |

**两者不共享组件代码**。这是刻意的：SE 版的约束（ES5、无构建期 polyfill、
不用 module 脚本）与主站相冲突，强行共用会让主站退回到 ES5 或给 SE 版引入编译期负担。

SE 版构建中最关键的一点（`frontend-se/vite.config.js` 里有详细注释）：
默认的应用构建产出 `<script type="module">`，而 **IE11 不执行 module 脚本**，
页面会永远停在「正在载入」。因此 SE 版改用 **lib 模式输出 IIFE**，
并关闭 Rollup 注入的 `Symbol.toStringTag`（IE11 没有 `Symbol`，会直接抛错），
文件名不带 hash，HTML 手写在 `public/index.html` 里。

## 6. 目录职责

### 后端 `backend/app/`

| 文件 / 目录 | 职责 | 不该放什么 |
| --- | --- | --- |
| `config.py` | 全部配置项的**唯一**来源，集中读环境变量并做启动期校验 | 业务逻辑 |
| `database.py` | 引擎、会话工厂、`Base`、`init_db()` | 模型定义 |
| `models.py` | SQLAlchemy 表定义 | 查询逻辑 |
| `schemas.py` | Pydantic 出入参模型 | ORM 模型 |
| `serializers.py` | 模型 → JSON；通知 / 审计等**跨模块的公共写入** | 路由 |
| `deps.py` | 依赖注入与权限拦截 | 业务判断 |
| `security.py` | 密码哈希、JWT 签发校验 | 用户查询 |
| `main.py` | 应用装配：中间件、路由注册、静态挂载、Socket.IO | 业务处理 |
| `routers/` | HTTP 层：解析入参、调领域模块、返回响应 | 复杂领域逻辑 |
| `committee.py` / `chat_core.py` / `studio_core.py` | 领域逻辑（可被多个路由复用） | HTTP 细节 |
| `sensitive.py` | 敏感词检测 | 内容状态变更 |
| `mailer.py` / `emailcode.py` / `emailcheck.py` | 邮件发送、验证码、邮箱预检 | —— |
| `iplocate.py` | 离线 IP 库解析 | 属地策略（在 `deps.py`） |
| `ratelimit.py` | 限流中间件、真实客户端 IP 解析 | 业务限流额度 |
| `switches.py` | 运行期开关（后台可改） | —— |
| `cascade.py` / `purge.py` | 删除与注销的级联清理 | —— |

**分层约定**：`routers/` 只做 HTTP 适配，可被多个路由复用的逻辑下沉到领域模块
（`committee.py`、`chat_core.py`、`studio_core.py`），
跨模块的公共写入集中在 `serializers.py`。
本项目的领域模块**直接用 SQLAlchemy 会话**，没有引入 Repository 层——
规模上不值得，也避免多一层转发。

### 前端 `frontend/src/`

| 目录 | 职责 |
| --- | --- |
| `api/` | `base.js` 是**后端地址的唯一来源**（`client.js` 与 `socket.js` 共用），`client.js` 是 axios 实例与 401 拦截 |
| `pages/` | 页面级组件，一个文件 ≈ 一个路由；后台在 `pages/admin/` |
| `components/` | 可复用组件（顶栏、页脚、卡片、评论区、聊天、Markdown 编辑器、图片裁剪器…） |
| `context/` | React Context：登录态、主题模式 |
| `chat/` | 聊天状态与通知偏好 |
| `i18n/` | 自研国际化：`index.jsx`（收集与 `t()`）、`dict/*.js`（词条）、`server.js`（后端中文提示翻译） |
| `pickcat/` | 头像工具面板 |
| `styles/` | 全局 CSS 与主题变量 |
| `ui/` | Material Web 组件封装（统一导出） |

## 7. 前端如何找到后端

`src/api/base.js` 是唯一的决策点：

```js
const DEV_API = 'http://localhost:8000/api';
export const API_BASE = import.meta.env.VITE_API_URL || (isViteDev() ? DEV_API : '/api');
export const SOCKET_URL = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;
```

优先级：`VITE_API_URL` → 开发模式（页面端口 5173 / 5273）直连本机 8000 → **同源 `/api`**。

源码注释记录了一次真实事故：默认值曾经是 `http://localhost:8000/api`，
本地构建时没有环境变量，产物里就写死了 localhost:8000，
上线后**所有用户的浏览器都去连自己电脑的 8000 端口**，整站接口 Network Error。
所以现在默认值就是同源的 `/api`。

## 8. 实时通信（Socket.IO）

- 服务端 `app/socket.py` 定义事件；`main.py` 里用
  `socketio.ASGIApp(sio, other_asgi_app=app)` 与 FastAPI 合成一个 ASGI 应用，
  **共用同一个端口**（8000），由 nginx 按路径 `/socket.io` 分流。
- 客户端 `frontend/src/api/socket.js` + `frontend/src/chat/useChat.js`。
- 认证方式与 REST 一致（携带同一个 JWT）。
- 聊天受 `NIMAO_CHAT_ENABLED` 总开关控制：置 0 时 REST 返回 503、Socket 聊天事件被拦截，
  但**通知不受影响**。
- 聊天内容同样过敏感词检测。此时没有请求级数据库会话，
  `sensitive.get_db_words(db=None)` 会退回到上一次的 60 秒缓存。

## 9. 上传与文件

| 目录 | 用途 | 是否对外可访问 |
| --- | --- | --- |
| `backend/uploads/` | 公开上传：作品封面、帖子图、视频、`.sb3` 作品包（`uploads/games/`） | ✅ 由 nginx 直接托管 `/uploads/` |
| `backend/private/` | **敏感**：护照/证件图等 | ❌ 后端校验权限后读取，**绝不能**被 nginx 挂载 |
| `backend/data/` | ip2region 离线库等 | ❌ |

- 图片类型有白名单（`config.ALLOWED_IMAGE_TYPES` / `ALLOWED_VIDEO_TYPES`），
  各类大小上限见 [`CONFIGURATION.md`](CONFIGURATION.md) 第 7 节。
- **两层限制**：nginx 的 `client_max_body_size` 与应用层的上限必须都够大，否则会在 nginx 层被 413。
- 用户静态项目（Pages）的上传会解压 zip，实现里针对
  **Zip Slip**（路径穿越）、**Zip Bomb**（解压总量 / 文件数 / 压缩比）、
  **symlink**、**可执行后缀**做了防护，并采用「解压到临时目录 → 校验 → rename 原子切换」
  的方式，失败时保留旧版本。

## 10. 已知的架构限制

诚实列出，供二次开发时判断：

1. **前端打包体积偏大**：`frontend/public/` 里有若干大尺寸 PNG（头图、活动图），
   且未做按路由分包之外的高级优化。
2. **SQLite 单写者**：高并发写入会是瓶颈。写入量上来了需要迁移到 PostgreSQL
   （SQLAlchemy 层改动不大，但要处理 SQLite 方言特有写法）。
3. **无 Alembic**：`models.py` 的变更对已有数据库不会自动生效，需要手写迁移脚本。
4. **内存态数据**：邮箱验证码（`emailcode.py` 的 `_codes`）与限流计数存在进程内存里，
   **多进程部署或重启会丢失**。当前部署是单进程（`run.py` 里 `reload=False`、未用 `--workers`）。
5. **审计异步化缺失**：审计记录在同一次请求内同步写入。
6. **`routers/admin.py` 偏大**（约 96 个端点）：后续可按资源拆分。
7. **`frontend/public/help.html` 是独立的手写单页**，不走 React，与 i18n 体系不共享。
