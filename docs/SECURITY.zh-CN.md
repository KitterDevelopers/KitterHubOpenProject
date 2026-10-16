> English version: [SECURITY.md](SECURITY.zh-CN.md) · 本文件为中文版

# 安全（SECURITY）

本文说明 KitterHub 的密钥管理、鉴权模型、上传与目录隔离、第三方集成清单，
以及部署加固建议与漏洞上报方式。

> 本文描述的是**代码里实际存在**的机制。凡是无法从代码确认的，都会明确标注「未确认」。
> 建议类的条目会标出「（建议）」，表示那是运维加固做法，不是代码强制行为。

## 目录

- [1. 密钥与敏感配置](#1-密钥与敏感配置)
- [2. 鉴权与权限模型](#2-鉴权与权限模型)
- [3. 上传与目录隔离](#3-上传与目录隔离)
- [4. 防盗链与外链图片](#4-防盗链与外链图片)
- [5. 限流与防刷](#5-限流与防刷)
- [6. 第三方集成清单](#6-第三方集成清单)
- [7. 审计与留痕](#7-审计与留痕)
- [8. 部署加固建议（清单）](#8-部署加固建议清单)
- [9. 漏洞上报](#9-漏洞上报)

---

## 1. 密钥与敏感配置

### 1.1 唯一必填项：`NIMAO_SECRET_KEY`

`backend/app/config.py` 在导入时就会校验它：

```python
_PLACEHOLDER_SECRET = "replace-me-with-a-random-32-plus-byte-secret"
SECRET_KEY = os.getenv("NIMAO_SECRET_KEY", "") or ""
if not SECRET_KEY or SECRET_KEY == _PLACEHOLDER_SECRET or len(SECRET_KEY) < 32:
    raise RuntimeError("NIMAO_SECRET_KEY 未正确注入（缺失/仍为默认值/长度不足）...")
```

也就是说：**缺失、等于占位符、或短于 32 字符，后端都会直接拒绝启动**。
这是刻意设计，防止用弱密钥上线。

生成方式（`.env.example` 里给出的）：

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

这个密钥用于 **JWT 签名**（`app/security.py`：`jwt.encode/decode`，算法见 `config.ALGORITHM`，
默认 `HS256`）。

> ⚠️ 它还是**云变量票据签名密钥的默认回退值**：`CLOUD_SECRET` 未单独配置时就用 `SECRET_KEY`
> （`config.py`：`CLOUD_SECRET = os.getenv("NIMAO_CLOUD_SECRET", "") or SECRET_KEY`）。
> 因此轮换 `SECRET_KEY` 会让所有登录令牌失效，并且（若未单独配 `CLOUD_SECRET`）
> 使已签发的云变量票据同时失效。

### 1.2 完整环境变量清单

`backend/.env.example` 是权威清单。除 `NIMAO_SECRET_KEY` 外**全部有默认值**，不配也能启动。
下面按「是否属于凭据」分组。

#### A. 必须由部署者提供（无默认值 / 空默认）

| 变量 | 用途 | 不配置的后果 |
| --- | --- | --- |
| `NIMAO_SECRET_KEY` | JWT 签名、云变量票据回退密钥 | **后端拒绝启动** |
| `NIMAO_DATABASE_URL` | 数据库连接串 | 用默认 SQLite：`backend/nimao.db`（可用，但生产建议显式指定） |
| `NIMAO_GITHUB_CLIENT_ID` | GitHub OAuth 应用 ID | GitHub 登录/绑定不可用 |
| `NIMAO_GITHUB_CLIENT_SECRET` | GitHub OAuth 应用密钥 | 同上 |
| `NIMAO_SMTP_HOST` / `NIMAO_SMTP_USER` / `NIMAO_SMTP_PASS` | 邮件发信（SMTP 通道） | 邮箱验证码、找回密码不可用 |
| `NIMAO_RESEND_API_KEY` | 邮件发信（Resend 通道，与 SMTP 二选一） | 同上 |
| `NIMAO_CLOUD_ADMIN_KEY` | 云变量服务管理接口密钥 | 云变量后台功能不可用 |
| `NIMAO_CLOUD_SECRET` | 云变量票据签名密钥（留空回退 `NIMAO_SECRET_KEY`） | 回退到 `SECRET_KEY` |

> SMTP 与 Resend **二选一**即可；两条通道都没配时，邮件相关接口会返回明确的配置提示，
> 而不是静默失败。

#### B. 有默认值，但**生产必须覆盖**（否则等于把口令写死在代码里）

| 变量 | 说明 |
| --- | --- |
| `NIMAO_ADMIN_*` / 管理员口令类 | **本仓库不含任何硬编码口令**；管理员账号由部署者自行创建与授权（见 §2.5） |
| `NIMAO_TOKEN_EXPIRE` | JWT 有效期（分钟），默认 `1440`（24 小时）。缩短可降低令牌泄露风险 |

#### C. 联调专用 —— **正式环境必须保持关闭**

这几个变量的默认值已经是安全的一侧，但如果照抄联调配置上线会造成严重问题：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NIMAO_EMAIL_CODE_ECHO` | `0` | 置 `1` 时**不真的发信、验证码直接随接口返回**。上线必须为 `0` |
| `NIMAO_EMAIL_FIXED_CODE` | 空 | 非空时「邮箱注册」接受这个**固定验证码**，等于任何人都能注册。上线必须留空 |
| `NIMAO_MAIL_OVERRIDE_TO` | 空 | 非空时所有验证码都发到这个地址。上线必须留空 |
| `NIMAO_GITHUB_OAUTH_BASE` / `NIMAO_GITHUB_API_BASE` | 官方地址 | 仅指向假 GitHub 联调时改，上线留空 |
| `NIMAO_DOCS` | `0` | 置 `1` 会开放 `/docs`、`/redoc`、`/openapi.json`，**暴露完整路由面**。上线建议保持 `0` |

#### D. 站点标识（占位符，改成你自己的）

`NIMAO_SITE_URL`（默认 `https://example.com`）、`NIMAO_PAGES_DOMAIN`
（默认 `pages.example.com`）、`NIMAO_PAGES_ROOT`（默认 `/srv/kitterhub/pages`）、
`NIMAO_SUPPORT_EMAIL`（默认 `support@example.com`）、
`NIMAO_PICKCAT_API_BASE`（占位符）、`NIMAO_CLOUD_HOST`（占位符 `wss://example.com/cloud`）、
`NIMAO_PUBLIC_BASE_URL`（留空按请求 Host 推断）。

完整清单（含默认值与逐条说明）见 [`CONFIGURATION.md`](CONFIGURATION.zh-CN.md)。

### 1.3 密钥的存放方式

- **推荐**：不落文件，用 systemd 的 `EnvironmentFile` 或容器 Secret 注入
  （示例见 [`../deploy/kitterhub-backend.service.example`](../deploy/kitterhub-backend.service.example)）。
- 本地开发可用 `backend/.env`（由 `python-dotenv` 读取，
  且 `load_dotenv(..., override=False)` —— **真实环境变量优先于 `.env`**）。
- `.env` 已被 `.gitignore` 忽略（`.gitignore` 明确只放行 `*.example`）。
- 环境变量文件权限建议 `600`，属主为服务运行用户（建议）。
- 轮换 `SECRET_KEY` 会使所有已签发 JWT 立即失效（用户需重新登录），
  这是预期的强制下线手段。

## 2. 鉴权与权限模型

### 2.1 密码

- 用 **bcrypt** 哈希（`app/security.py`：`bcrypt.hashpw` / `bcrypt.checkpw`，
  `gensalt()` 使用默认 cost）。
- `verify_password` 在遇到非法哈希格式时返回 `False`（不抛异常），避免把内部错误暴露成 500。

### 2.2 令牌

- **JWT**，签名算法取自 `config.ALGORITHM`（默认 `HS256`），
  载荷含 `sub`（用户 id）、`exp`（过期时间），以及 **`ver`（令牌版本号）**。
- 由 `app/security.py` 的 `create_access_token()` 签发，
  有效期 `config.ACCESS_TOKEN_EXPIRE_MINUTES`（`NIMAO_TOKEN_EXPIRE`，默认 1440 分钟）。
- 客户端通过 `Authorization: Bearer <JWT>` 提交
  （`app/deps.py` 使用 `HTTPBearer(auto_error=False)`）。

### 2.3 令牌版本号 —— 改密即强制下线

`app/deps.py:_resolve_user()` 除校验签名与过期外，还会比对：

```python
if int(payload.get("ver", 0) or 0) != (user.token_version or 0):
    raise HTTPException(401, "登录已失效，请重新登录")
```

修改密码会提升 `token_version`，从而**让旧令牌立刻失效**（踢掉其它设备）。

### 2.4 三道权限闸门

`app/deps.py` 提供三个递进的依赖，全站写接口几乎都挂在第二道上：

| 依赖 | 通过条件 | 用途 |
| --- | --- | --- |
| `get_current_user` | 令牌有效且用户存在 | **只读**接口；被封禁用户仍可浏览 |
| `get_active_user` | 在上者基础上：未封禁（含定时封禁到期自动解封）、`verify_state == "ok"` | **一切写操作**（发帖、评论、点赞、关注、改资料…） |
| `get_current_admin` | 在上者基础上：`user.role == "admin"` | 全部 `/api/admin/*` |

补充两点：

- **未激活账号的锁定**在 `get_active_user` 里集中处理：`verify_state` 不是 `ok` 时，
  除 `_LOCKED_ALLOW` 白名单（登出、`/api/verify/`、签条约、绑定编程猫）外的写操作一律 403。
  这是为了「注册后必须先完成实名/绑定」的产品要求，也顺带限制了未验证账号的破坏面。
- `get_current_admin` 只认 `role == "admin"`（`users.role`），
  没有任何「按邮箱/域名白名单自动提权」的旁路。

### 2.5 管理员账号从哪来

**代码里没有自动创建管理员的逻辑**（没有「第一个注册用户自动成为管理员」这类引导）：

- `users.role` 默认值是 `"user"`（`app/models.py`）。
- 后台有改角色的接口（`routers/admin.py` 校验 `role in ("user", "admin")`），
  但它本身要求调用者已经是管理员。

因此首次部署需要一个**带外（out-of-band）**步骤把某个账号提升为管理员，
例如直接用 SQLite 工具更新该行：

```bash
# 在部署机上执行；数据库路径以 NIMAO_DATABASE_URL 为准
sqlite3 backend/nimao.db "UPDATE users SET role='admin' WHERE username='<你的账号>';"
```

> 具体推荐做法在仓库文档中**未确认**（README 与 DEVELOPMENT.md 未给出统一脚本），
> 上例是通用做法，执行前请自行确认数据库路径。

### 2.6 CORS

`app/main.py` 用 `CORSMiddleware`，来源白名单为 `config.CORS_ORIGINS`，
`allow_credentials=True`、`allow_methods=["*"]`。默认白名单是本机开发地址
（`http://127.0.0.1:5173`、`http://127.0.0.1:8000`、`http://127.0.0.1:3080`）。

- **部署时务必把线上域名加入 `CORS_ORIGINS`**，不要保留 `*`。
- 公开接口（`/api/public/*`）另有一套中间件，**不受该白名单限制**
  （它们返回的本就是公开数据，且刻意开放跨域以便第三方调用，
  见 [`public-api.md`](public-api.zh-CN.md)）。因此**不要把任何敏感数据放进 `/api/public/*`**。

## 3. 上传与目录隔离

实现主要在 `app/routers/uploads.py`、`app/routers/verify.py`、`app/imageurl.py`、
`app/pages_sites.py`。

### 3.1 两类目录，安全等级完全不同

| 目录 | 内容 | 谁能读 | 说明 |
| --- | --- | --- | --- |
| `backend/uploads/`（`config.UPLOAD_DIR`） | 作品封面、帖子配图、视频、`.sb3` 作品包（`uploads/games/`） | **公开** | 由后端 `app.mount("/uploads", StaticFiles(...))` 挂载，nginx 也直接托管 `/uploads/` |
| `backend/private/`（`config.PRIVATE_DIR`） | **护照/证件图等敏感证件** | **仅后端** | 必须由后端校验权限后读取 |

> ### ⚠️ 红线：绝不要把 `backend/private/` 暴露出去
>
> `app/routers/verify.py` 顶部明确写着：
> 「护照图片存到 `config.PRIVATE_DIR`，**这个目录 nginx 完全没有挂载，公网访问不到**」。
>
> 请**不要**：
> - 在 nginx 里写 `location /private/ { alias .../backend/private/; }`；
> - 把 `PRIVATE_DIR` 改成 `UPLOAD_DIR` 的子目录；
> - 把 `private/` 放进任何 CDN、对象存储的公开桶；
> - 在 `deploy/nginx.conf.example` 的基础上去掉那条警告注释。
>
> 读取证件图的唯一合法入口是 `GET /api/admin/verify-docs/{uid}`，它要求
> `get_current_admin`（即 `role == "admin"`）；并且读取时只取
> `os.path.basename(passport_file)` 再拼接，**杜绝 `../` 目录穿越**。
> [`../deploy/nginx.conf.example`](../deploy/nginx.conf.example) 里已用注释重复了这条红线。
>
> `backend/uploads/`、`backend/private/`、`backend/data/` 均已在 `.gitignore` 中忽略，
> 不会被提交。

### 3.2 上传限制一览

| 类别 | 允许的 MIME | 后缀 | 大小上限（默认） | 环境变量 |
| --- | --- | --- | --- | --- |
| 图片（头像/封面/配图） | `image/jpeg`、`image/png`、`image/webp`、`image/gif` | `.jpg` `.png` `.webp` `.gif` | **3 MB** | `NIMAO_MAX_UPLOAD_SIZE` |
| 视频（意见反馈附件） | `video/mp4`、`video/webm`、`video/quicktime` | `.mp4` `.webm` `.mov` | **30 MB** | `NIMAO_MAX_VIDEO_SIZE` |
| Scratch 作品包 `.sb3` | （按 zip 魔数判断） | `.sb3` | **50 MB** | `NIMAO_SCRATCH_MAX_SIZE` |
| 护照/证件图 | `image/jpeg`、`image/png`、`image/webp`（**不含 GIF**） | `.jpg` `.png` `.webp` | **8 MB** | `NIMAO_PASSPORT_MAX_SIZE` |
| 单条反馈附件数量 | — | — | **6 个** | `NIMAO_FEEDBACK_MEDIA_MAX` |

### 3.3 具体的防护措施

1. **不信任客户端 `Content-Type`，校验真实文件头（magic bytes）**
   - 图片：JPEG `FF D8 FF`、PNG `89 50 4E 47 0D 0A 1A 0A`、GIF `GIF87a`/`GIF89a`、
     WebP 需同时满足 `RIFF` 且第 8–12 字节为 `WEBP`。
     不匹配则 400「文件内容与声明格式不符」。
   - 视频：MP4/MOV 要求第 5–8 字节为 `ftyp`；WebM 要求 EBML 头 `1A 45 DF A3`。
   - `.sb3`：首 4 字节必须是 zip 魔数 `PK\x03\x04`。
2. **文件名完全由服务端生成**，不含任何用户输入：
   - 图片/视频：`{user_id}_{uuid4().hex[:16]}{ext}`；
   - `.sb3`：内容 **sha256 前 16 位**（天然去重，且内容变则文件名变，可安全长缓存）；
   - 护照：同样是服务端生成名，**不采用用户提交的文件名**。
3. **路径穿越防护**
   - 图片地址校验（`imageurl._resolve_path`）拒绝文件名中含 `/`、`\`、`..` 的值，
     并要求文件**真实存在**于 `UPLOAD_DIR`；
   - 证件图读取只取 `basename`。
4. **流式写入 + 失败清理**：视频与 `.sb3` 按 1MB 分块写盘，边写边累计大小，
   超限立即中断；任何失败路径都会调用 `_safe_remove()` 删除半成品，不留下垃圾文件。
5. **`Content-Type` 白名单而非黑名单**：不在允许表里的类型直接拒绝，
   因此「上传 `.php`/`.py`/`.sh` 再想办法执行」这条路在上传层就断了。
6. **`.sb3` 的 zip 炸弹防护**（`_sb3_project_ok`）：只读 `namelist` 与
   `project.json` 的**压缩前大小**，**绝不整包解压**；
   要求包含 `project.json`、`project.json` ≤ 20MB、包内所有条目声明大小合计 ≤ 1GB。
7. **KitterHub Pages 静态托管的解压防护**（`app/pages_sites.py`）：
   Zip Slip（逐条校验解析后路径必须落在目标目录内）、Zip Bomb
   （单包 20MB / 解压总量 200MB / 文件数 2000 / 压缩比 200 四重上限）、
   只接受普通文件（按 zip 里的 unix mode 判断，拒绝 symlink）、
   拒绝 `php/py/sh/exe` 等可执行后缀、原子发布（解压到 `tmp/<uuid>` 校验后 `rename` 切换，失败保留旧版本）。
8. **两层大小限制必须都够大**：nginx 的 `client_max_body_size` 与应用层上限是**两道独立闸门**。
   只改应用层会在 nginx 层被 413 拦下；只改 nginx 会在应用层被拒。
   示例配置给的是 `64m`（[`../deploy/nginx.conf.example`](../deploy/nginx.conf.example)）。

### 3.4 存储配额

`app/storage_quota.py` 统计用户占用（默认每用户 100MB，
`NIMAO_STORAGE_PER_USER_MB`；可申请上限 `NIMAO_STORAGE_QUOTA_MAX_MB`，默认 20480MB）。
上传前调用 `check_room()` 预检，超配额返回明确提示。
这个机制用于**防止单账号撑爆磁盘**，属于配额而非安全边界。

## 4. 防盗链与外链图片

先说结论，避免误解：**代码层面没有基于 `Referer` 的通用防盗链实现**。
实际存在的相关保护是下面这几条。

### 4.1 图片只能来自本站（`app/imageurl.py`）

- **普通图片字段**（如帖子配图、头像）：`check_uploaded_image()` 只接受
  `/uploads/...`，任何外部链接一律 400「只支持本站上传的图片」。
- **封面图**（`check_cover_image()`）是**唯一例外**：额外放行编程猫官方 CDN，
  因为导入编程猫作品时封面本就存在其 CDN 上。白名单为
  `CODEMAO_CDN_DOMAINS = ("bcmcdn.com", "codemao.cn", "codemao.com", "codemao.net")`。
- 白名单匹配是**精确域名或其子域**：
  `host == d or host.endswith("." + d)`，因此 `codemao.cn.evil.com`
  这类子串绕过会被拒绝。

### 4.2 `.sb3` 的 Referer 相关注意事项

`config.py` 在 `SCRATCH_EMBED_BASE` 附近留下一条**实测记录**：
TurboWarp 播放器加载 `.sb3` 时会带 `Referer: https://turbowarp.org/`，
因此 **nginx 侧若为 `/uploads/` 配置了 Referer 防盗链，
必须把 `turbowarp.org` 加入白名单**，否则在线试玩会失效。

> 「未确认」：仓库中**没有包含**这项 `Referer` 防盗链的 nginx 示例配置，
> 也就是说**当前示例配置里并没有启用 Referer 防盗链**。
> 如果你打算启用它，请自行按上面这条注意事项放行 `turbowarp.org`。
> 若确需防盗链，`valid_referers` 是 nginx 的标准做法（（建议））。

### 4.3 值得注意的一点

**`.sb3` 与 `/uploads/` 下的文件本身是公开可直链的**（无鉴权）。
这是设计使然（作品要能被播放器和第三方嵌入），
但意味着**用户上传的作品文件不能视为私密**。敏感材料请勿放入 `uploads/`。

## 5. 限流与防刷

`app/ratelimit.py` 提供 `RateLimitMiddleware`，并且**由后台开关控制**：

- **默认关闭**（`NIMAO_LIMIT_RATE=0`）。开启后对 `/api/*` 每 IP 每窗口
  （默认 60 秒，`RATE_LIMIT_PER_MINUTE` 默认 300 次）限流，超出返回
  `429 {"detail": "请求过于频繁，请稍后再试"}`。
- 开关也可在后台「系统开关」里动态切换（`app/switches.py` → `site_settings` 表）。

**客户端真实 IP 的取得方式是安全相关的**：`ratelimit.client_ip()` 优先用
`request.client.host`，即依赖 uvicorn 的 `proxy_headers` +
`forwarded_allow_ips="127.0.0.1"`（**只信任本机 nginx** 写入的 `X-Forwarded-For`），
而**不直接信任客户端可伪造的 XFF 首值**——否则攻击者伪造一个 XFF 就能绕过限流。
这也正是后端必须只监听 `127.0.0.1` 的原因之一。

其它防刷开关（同样默认关闭）：`NIMAO_LIMIT_FREQ`（发帖/评论/投稿短时频率）、
`NIMAO_LIMIT_DAILY`（每日内容上限，默认稿件 20 / 帖子 20 / 评论 50）、
`NIMAO_LIMIT_REG`（自动注册配额）。

> `NIMAO_LIMIT_LOGIN`（登录失败锁定）在 `config.py` 中**仍存在该开关**，
> 但 `ratelimit.py` 顶部注释写明「登录限流已按产品要求移除」。
> 因此**登录爆破防护主要依赖全局限流**，请务必在公网部署时**开启** `NIMAO_LIMIT_RATE`。

## 6. 第三方集成清单

> **说明**：下列域名是**集成对象，不是本项目资产**，也不代表任何形式的归属关系。
> 本项目只是在代码里与这些外部服务对接。仓库内出现的这些域名均为**集成事实**
> （播放地址模板、CDN 白名单、嵌入播放器），**不含任何凭据**。
> 示例文档（如 [`public-api.md`](public-api.zh-CN.md)）中展示的响应数据均为**虚构示例**，
> 已替换为 `example.com` 与示例用户，不是本站真实数据。

### 6.1 代码中对接的外部服务

| 外部服务 / 域名 | 用途 | 代码位置 | 需要你自备凭据？ |
| --- | --- | --- | --- |
| `player.codemao.cn` | 编程猫作品播放地址模板（新版/旧版） | `config.py` 的 `EDITORS[].url_template` | 否 |
| `kn.codemao.cn` | KittenN（KN）作品播放器（`/player?type=2&workId=…`） | 同上 | 否 |
| `coco.codemao.cn` | COCO 编辑器作品播放（H5 通道） | 同上 | 否 |
| `nemo.codemao.cn` | NEKO 作品可直接嵌入播放的地址 | 同上 | 否 |
| `bcmcdn.com`（含 `creation.` / `cdn-community.` 子域） | 编程猫官方 CDN：封面图与头像外链白名单 | `imageurl.CODEMAO_CDN_DOMAINS`、`frontend/src/pages/work-detail/poster.js` | 否 |
| `turbowarp.org` | Scratch 作品在线试玩的嵌入播放器 | `config.SCRATCH_EMBED_BASE`（`NIMAO_SCRATCH_EMBED_BASE`） | 否 |
| `github.com` / `api.github.com` | GitHub OAuth 登录与绑定 | `config.GITHUB_OAUTH_BASE` / `GITHUB_API_BASE`、`routers/auth.py` | **是**：`NIMAO_GITHUB_CLIENT_ID` + `NIMAO_GITHUB_CLIENT_SECRET` |
| `resend.dev`（`onboarding@resend.dev`） | Resend 邮件通道的测试发件域名（默认 `NIMAO_MAIL_FROM`） | `config.MAIL_FROM` | **是**：`NIMAO_RESEND_API_KEY`（生产建议换成你自己的已验证域名） |
| pickCat 头像工具 | 头像生成的独立服务，经同源反代访问 | `NIMAO_PICKCAT_API_BASE` | 需自行部署该服务（地址自填） |
| 自建云变量服务 | Scratch cloud variables（TurboWarp） | `app/cloudvars.py`、`NIMAO_CLOUD_HOST` | 需自行部署；**本次开源的仓库不含 `cloud/` 服务**（见 [`../CHANGELOG.md`](../CHANGELOG.zh-CN.md)） |
| ip2region 离线库 | IP 属地判定（纯本地，**不联网**） | `config.IP2REGION_XDB`、`app/iplocate.py` | 需自行下载约 11MB 数据文件；缺失则属地功能降级为空值 |

### 6.2 会把数据发给第三方的行为（请注意）

- **`NIMAO_EMAIL_PRECHECK`（默认开启）**：注册邮箱预检（格式、一次性邮箱、MX 记录）
  会把邮箱地址发给**第三方免费接口**。`.env.example` 明确提示：
  「会把邮箱发给第三方免费接口，在意就置 0」。
- **GitHub OAuth**：启用后会把用户重定向到 GitHub 并接收其返回的资料与邮箱。
- **业务上必须明确告知用户**的事项：作品封面/头像可能托管在编程猫 CDN 上
  （即这些图片请求会打到第三方域名）。

### 6.3 第三方素材与商标

`frontend/public/` 与 `frontend-se/public/` 下包含若干**第三方品牌素材**，
其版权与商标权属于各自权利人：

| 素材 | 文件（示例） | 权利人/说明 |
| --- | --- | --- |
| 编程猫（Codemao）标识与等级徽章 | `codemao-logo.png`、`badge/codemao-lv2.png` … `codemao-lv5.gif` | 编程猫。用于展示「该作品来自编程猫」与用户等级 |
| Kitten / KittenN / COCO / NEKO 编辑器图标 | `kitten3.png`、`kitten4.png`、`kittenn.ico`、`coco.png`、`nemo.png` | 编程猫旗下编辑器 |
| Scratch 图标 | `scratch.png` | Scratch 基金会（Scratch Foundation） |
| pickCat 文字标识 | `pickcat-wordmark-light.png`、`pickcat-wordmark-dark.png` | pickCat 头像工具 |
| 支付渠道 LOGO | `donate/pay-alipay.png`、`donate/pay-wechat.png`、`donate/pay-paypal.png` | 支付宝 / 微信支付 / PayPal |

**重要**：

- **这些素材不因本项目选择的许可证而改变授权状态**（见
  [`../LICENSE-待定.md`](../LICENSE-待定.zh-CN.md)）。若你要商用或再分发，
  请自行确认对这些商标/素材的使用是否合规，必要时替换为你自己的素材。
- 本项目仅在这些素材**指代对应服务本身**的语境下使用它们（例如标明作品来源、
  展示编辑器类型、提供捐赠入口），**不主张任何权利，也不代表与上述权利人存在
  合作、赞助或背书关系**。
- 站长的**个人收款二维码已从开源版本中移除**
  （`frontend/public/donate/` 下现仅保留支付渠道 LOGO，不含个人收款码）。

### 6.4 本项目自身**不包含**的凭据

仓库内**没有**任何真实凭据、令牌、私钥、密码或服务器地址：

- `.forensics/`（曾含服务器 SSH 私钥、管理员令牌、凭据文件）已整目录移除；
- 所有 `*.db`（含真实用户数据与密码哈希）已移除；
- 收款二维码、站点验证令牌文件已移除；
- 环境变量默认值中的固定验证码、假 API Key 前缀、真实管理员 uid 等均已改为空或占位符。

详见 [`../CHANGELOG.md`](../CHANGELOG.zh-CN.md) 的「移除（安全原因）」与「变更」两节。

## 7. 审计与留痕

- **请求级审计**（`app/audit.py`）：自动记录 `/api/admin/**` 的写操作、
  `/api/auth/**` 的 POST（**含失败尝试**）、改密与注销。
  记录操作人 id、用户名快照、方法、路径、状态码、来源 IP。
  审计失败不影响业务。
- **业务级留痕**（`admin_logs`）：管理员的具体动作（如 `sensitive_approve`、
  `report_handled`、`committee_suspend`）含目标与说明。
- 治理相关的审计细节见 [`MODERATION.md`](MODERATION.zh-CN.md) 第 6 节。

## 8. 部署加固建议（清单）

以下均为**建议**（运维层面），不是代码强制：

- [ ] **后端不要直接对公网监听**。`backend/run.py` 已写死 `127.0.0.1:8000`，
      请保持；不要改成 `0.0.0.0`，不要在防火墙上放行 8000。
- [ ] **强制 HTTPS**，并把 HTTP 301 跳到 HTTPS（示例配置已含）。JWT 走明文 HTTP 等于泄露会话。
- [ ] **开启全局限流**：`NIMAO_LIMIT_RATE=1`（默认是关的）。
      它是目前登录爆破的主要防线（登录失败锁定已被移除）。
- [ ] **保持 `NIMAO_DOCS=0`**，不要在公网暴露 `/docs`、`/openapi.json`。
- [ ] **确认联调开关全部关闭**：`NIMAO_EMAIL_CODE_ECHO=0`、
      `NIMAO_EMAIL_FIXED_CODE=`（空）、`NIMAO_MAIL_OVERRIDE_TO=`（空）。
- [ ] **`CORS_ORIGINS` 收紧到你的真实前端域名**，不要用 `*`。
- [ ] **`NIMAO_SECRET_KEY` 用足够强随机的值**（≥32 字符），不要复用其它系统的密钥；
      计划轮换时注意云变量票据会一起失效。
- [ ] **环境变量文件权限 600**，属主为服务用户；用 systemd `EnvironmentFile` 而非提交 `.env`。
- [ ] **目录隔离**：`backend/private/` 绝不被 Web 服务器或 CDN 挂载；
      `backend/uploads/` 只作为静态文件，**禁止执行任何脚本**（示例配置已加 `deny all` 规则）。
- [ ] **数据库文件不要放在 Web 根目录**，也不要对外暴露；SQLite 文件权限收紧到服务用户可读写。
- [ ] **上传上限两层都要配**：nginx 的 `client_max_body_size` ≥ 应用层上限（示例给 64m）。
- [ ] **服务降权运行**：专用低权限系统用户 + systemd 沙箱选项
      （示例单元已含 `NoNewPrivileges`、`ProtectSystem`、`ProtectHome`、`PrivateTmp` 等）。
- [ ] **开启并保管审计日志**：`audit_logs` / `admin_logs` 是事后追溯的唯一依据；
      定期备份，并限制谁能读库。
- [ ] **备份数据库**：SQLite 用 `sqlite3 .backup` 或停机复制，避免直接拷贝正在写入的文件。
- [ ] **复核 `NIMAO_EMAIL_PRECHECK`**：会把邮箱发给第三方，若隐私合规要求严格请置 `0`。
- [ ] **（建议）关注依赖漏洞**：定期更新
      `backend/requirements.txt` 与两个前端的 `package-lock.json`。

## 9. 漏洞上报

如果你发现安全漏洞，请**不要**公开提交 Issue，而是通过邮件私下报告。

> 📧 **安全联系邮箱：`security@example.com`**
>
> ⚠️ **这是占位符，必须由维护者替换为真实可用的邮箱后才会生效。**
> 在替换之前，本仓库**没有**有效的私密上报渠道——若你只是 clone 了本仓库自建站点，
> 请自行指定一个联系地址并写进本节。

报告中建议包含：

- 受影响的组件与版本/提交号；
- 复现步骤（最小可复现示例）；
- 影响评估（能否未授权读取/修改/删除数据、能否提权）；
- 你的联系方式与希望的署名方式。

请**不要**在报告中附带真实用户的个人数据、证件图或生产环境凭据。
维护者确认后会尽力在合理时间内修复并致谢（是否公开致谢尊重报告者意愿）。

---

## 相关文档

- [`CONFIGURATION.md`](CONFIGURATION.zh-CN.md) —— 全部环境变量（含默认值）
- [`MODERATION.md`](MODERATION.zh-CN.md) —— 内容治理、后台鉴权与审计流程
- [`ARCHITECTURE.md`](ARCHITECTURE.zh-CN.md) —— 请求链路与鉴权分层
- [`../deploy/README.md`](../deploy/README.zh-CN.md) —— nginx 与 systemd 示例的用法
- [`../CONTRIBUTING.md`](../CONTRIBUTING.zh-CN.md) —— 提交代码前的检查清单
