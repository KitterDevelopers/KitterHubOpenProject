# backend/ —— KitterHub 后端

FastAPI + SQLAlchemy 2.x + SQLite + Socket.IO 的服务端。
前端（`frontend/` 与 `frontend-se/`）通过 **`/api`** 前缀访问它。

## 职责

一套单体 API 服务，同时对外提供三类能力：

1. **REST API**（`/api/...`）—— 社区的全部业务：用户与鉴权、作品、论坛、工作室、
   私信、通知、经验等级、内容治理、后台管理；
2. **Socket.IO 实时通信** —— 私信与通知推送，与 REST **共用同一个进程和端口**；
3. **静态文件** —— 公开上传目录以 `/uploads` 挂载（生产环境通常改由 nginx 直接托管）。

## 环境要求

- **Python 3.10+**（推荐 3.11 / 3.12）
- 不需要单独安装数据库：默认使用 SQLite

## 依赖

见 [`requirements.txt`](requirements.txt)。原则是**只列代码里直接 import 的第三方包**：

| 包 | 用途 |
| --- | --- |
| `fastapi>=0.115` | Web 框架 |
| `uvicorn[standard]>=0.34` | ASGI 服务器 |
| `sqlalchemy>=2.0.36` | ORM |
| `pydantic>=2.10` | 数据校验 |
| `email-validator>=2.2` | Pydantic `EmailStr`（邮箱注册 / 找回密码） |
| `PyJWT>=2.10` | JWT 签发与校验 |
| `bcrypt>=4.2` | 密码哈希 |
| `python-socketio>=5.11` | 实时通信 |
| `python-multipart>=0.0.20` | 文件上传（`UploadFile` / `Form`） |
| `python-dotenv>=1.0` | 本地开发读取 `backend/.env` |

> `starlette` 由 `fastapi` 传递安装，因此**不单独固定版本**，避免与 fastapi 的版本约束冲突。

## 启动

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

# ★ 必填：缺失或短于 32 字符后端会拒绝启动
export NIMAO_SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"   # Windows 用 $env:NIMAO_SECRET_KEY=...

python run.py
# → Uvicorn running on http://127.0.0.1:8000
```

也可以复制 [`.env.example`](.env.example) 为 `.env` 再填值——
后端会用 `python-dotenv` 读取（`load_dotenv(..., override=False)`，
**真实环境变量优先于 `.env`**）。

自测：

```bash
curl "http://127.0.0.1:8000/api/public/works?limit=1"
```

### 关于监听地址（别改）

[`run.py`](run.py) 把监听地址**写死为 `127.0.0.1:8000`**，并设置
`proxy_headers=True` + `forwarded_allow_ips="127.0.0.1"`：

- 后端**只监听本机**，公网流量一律经 nginx 反代进来；
- 只信任**本机 nginx** 写入的 `X-Forwarded-For` / `X-Real-IP`，
  这样日志、限流、审计才能拿到真实客户端 IP，同时避免客户端伪造 XFF 绕过限流。

**不要**改成 `0.0.0.0`，也不要在防火墙上放行 8000。

## 代码结构

```
backend/
├── app/
│   ├── main.py            FastAPI 实例、中间件、路由挂载（统一 prefix="/api"）、Socket.IO 装配
│   ├── config.py          全部配置（环境变量读取 + 启动校验），是配置的唯一来源
│   ├── database.py        引擎 / SessionLocal / Base / init_db()
│   ├── models.py          SQLAlchemy 模型（50 张表，见 docs/DATABASE.md）
│   ├── schemas.py         Pydantic 请求/响应模型
│   ├── serializers.py     模型 → dict 的输出层（含通知、管理员日志、送审入库等公共动作）
│   ├── deps.py            依赖注入：get_db / get_current_user / get_active_user / get_current_admin
│   ├── security.py        密码哈希与 JWT 签发/校验
│   ├── audit.py           请求级审计中间件（写 audit_logs）
│   ├── ratelimit.py       全局限流中间件与真实 IP 解析
│   ├── limits.py          每日内容上限与频率限制
│   ├── socket.py          Socket.IO 事件
│   ├── sensitive.py       敏感词检测
│   ├── imageurl.py        图片地址校验与外链白名单
│   ├── storage_quota.py   账号存储配额
│   ├── committee.py       风纪委员会
│   ├── pages_sites.py     KitterHub Pages（用户静态项目托管）
│   ├── pickcat.py         pickCat 头像工具对接
│   ├── mailer.py / emailcode.py / emailcheck.py   邮件发送与验证码
│   ├── github.py          GitHub OAuth
│   ├── iplocate.py        IP 属地（ip2region 离线库）
│   ├── cloudvars.py       自建云变量服务对接
│   ├── assets/            邮件用图片等静态资源
│   └── routers/           24 个路由模块 + 3 个应用级路由（共 373 个端点）
├── run.py                 启动脚本
├── requirements.txt       Python 依赖
└── .env.example           环境变量示例（★ 复制为 .env 后修改）
```

### 路由模块

`app/routers/` 下每个模块只写**相对路径**，统一前缀 `/api` 在 `main.py` 里挂载
（`app.include_router(r, prefix="/api")`）。按功能分组：

| 分组 | 模块 |
| --- | --- |
| 账号与鉴权 | `auth.py`、`users.py`、`verify.py`（实名审核）、`friends.py` |
| 内容 | `works.py`、`posts.py`、`collections.py`、`drafts.py`、`reactions.py`、`search.py`、`discover.py` |
| 社交 | `studios.py`、`chat.py`、`notifications.py`、`feedback.py` |
| 治理 | `reports.py`、`admin.py`（含敏感词复审、委员管理） |
| 运维与站点 | `uploads.py`、`public.py`（对外只读）、`site_events.py`、`contests.py`、`map_event.py`、`kh_feed.py`、`exam_api.py` |

另有 3 个**应用级路由**不在 `routers/` 里：`app/committee.py`（`/committee`）、
`app/pages_sites.py`（`/pages`）、`app/pickcat.py`。

完整端点清单（373 个，含方法 / 路径 / 鉴权 / 说明）见
[`../docs/API.md`](../docs/API.md)。

## 数据库

- **默认**：SQLite，文件在 `backend/nimao.db`（由 `NIMAO_DATABASE_URL` 决定）。
- **初始化**：不需要手动建库。启动时 `main.py` 调用 `init_db()`，
  SQLAlchemy 按模型 `create_all()` 自动建表。
- **⚠️ 改表结构**：`create_all()` **只建不存在的表，不会修改已有表的字段**。
  给已有表加列**不会生效**，必须自己写迁移。
- **50 张表**的字段、外键与关系图见 [`../docs/DATABASE.md`](../docs/DATABASE.md)。
- 一次性迁移脚本 `migrate_*.py` 与手工测试脚本 `test_*.py`
  **未包含在开源版本中**（见 [`../CHANGELOG.md`](../CHANGELOG.md)）。

## 配置

全部配置集中在 [`app/config.py`](app/config.py)，变量名前缀统一为 **`NIMAO_`**。
[`.env.example`](.env.example) 是权威清单。

- **唯一必填项是 `NIMAO_SECRET_KEY`**（≥32 字符，且不能是占位符），否则拒绝启动。
- 其余全部有默认值，不配也能启动。
- 完整清单（含默认值、是否必填）见 [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.md)；
  安全相关的取值建议见 [`../docs/SECURITY.md`](../docs/SECURITY.md)。

⚠️ **上线前务必确认这几个联调开关是关闭的**：
`NIMAO_EMAIL_CODE_ECHO=0`、`NIMAO_EMAIL_FIXED_CODE=`（空）、
`NIMAO_MAIL_OVERRIDE_TO=`（空）、`NIMAO_DOCS=0`。

## 目录隔离（安全红线）

| 目录 | 内容 | 可访问性 |
| --- | --- | --- |
| `backend/uploads/` | 作品封面、帖子配图、视频、`.sb3`（`uploads/games/`） | **公开**（后端 `/uploads` 挂载 + nginx 托管） |
| `backend/private/` | **护照/证件图** | **仅后端**，校验管理员权限后读取 |

**绝不要把 `backend/private/` 交给 nginx 或 CDN**。详见
[`../docs/SECURITY.md`](../docs/SECURITY.md) 第 3 节。

## 与其它部分的关系

```
浏览器
  ├─ frontend/      React 主站   ──┐
  └─ frontend-se/   SE 精简版    ──┤  都以 /api 与 /socket.io 访问后端
                                   ▼
                        nginx（TLS、静态文件、反代）
                                   │  /api、/socket.io
                                   ▼
                        backend（127.0.0.1:8000）
                                   │
                                   └─ SQLite（backend/nimao.db）
```

部署示例见 [`../deploy/`](../deploy/README.md)，
整体架构与请求链路见 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)。

## 相关文档

- [`../README.md`](../README.md) —— 项目总览与本地启动全流程
- [`../docs/API.md`](../docs/API.md) —— 全部接口清单
- [`../docs/DATABASE.md`](../docs/DATABASE.md) —— 数据模型
- [`../docs/MODERATION.md`](../docs/MODERATION.md) —— 内容治理流程
- [`../docs/SECURITY.md`](../docs/SECURITY.md) —— 密钥、鉴权、上传与加固
- [`../docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) —— 开发规范与踩坑记录
