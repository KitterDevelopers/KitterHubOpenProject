> English version: [CONFIGURATION.md](CONFIGURATION.zh-CN.md) · 本文件为中文版

# 配置速查（CONFIGURATION）

KitterHub 的全部可调参数都集中在 **`backend/app/config.py`**，通过环境变量注入。
本地开发放在 `backend/.env`（由 `python-dotenv` 读取，`override=False`；
**真实环境变量优先级更高**），生产环境建议用 systemd 的 `EnvironmentFile` 或容器 Secret。

所有变量名统一以 **`NIMAO_`** 开头（这是项目的历史前缀，保留是为了让既有的环境变量文件继续可用）。

> **只有一项是必填的**：`NIMAO_SECRET_KEY`。其余全部有默认值。

---

## 0. 速览：最小可用配置

```ini
# backend/.env —— 只写这一行就能跑起来
NIMAO_SECRET_KEY=<用下面的命令生成>
```

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

不填 / 太短 / 等于占位符时，后端会在**导入 `config.py` 的阶段**直接抛错并拒绝启动：

```
RuntimeError: NIMAO_SECRET_KEY 未正确注入（缺失/仍为默认值/长度不足）。拒绝以不安全的签名密钥启动。
```

---

## 1. 核心

| 变量 | 类型 | 默认值 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `NIMAO_SECRET_KEY` | str | **无** | **是** | JWT 签名密钥。长度 **≥ 32**，且不能等于 `replace-me-with-a-random-32-plus-byte-secret`。生成：`python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `NIMAO_TOKEN_EXPIRE` | int | `1440` | 否 | 访问令牌有效期（**分钟**），默认 24 小时 |
| `NIMAO_DATABASE_URL` | str | `sqlite:///<backend 目录>/nimao.db` | 否 | SQLAlchemy 连接串。SQLite 时自动加 `check_same_thread=False` |
| `NIMAO_DOCS` | `0`/`1` | `0`（即不设） | 否 | 置 `1` 开放 `/docs`、`/redoc`、`/openapi.json`。**生产环境建议保持关闭** |

## 2. 站点标识

> 开源仓库里的默认值一律是 `example.com` 占位符。部署时请用这些变量覆盖，
> **不要把真实域名写回代码**。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_SITE_URL` | `https://example.com` | 站点主地址（不带结尾斜杠）。用于 SEO canonical、分享链接、**GitHub OAuth 回调**、SE 版回跳链接 |
| `NIMAO_PAGES_DOMAIN` | `pages.example.com` | KitterHub Pages（用户静态项目托管）的域名，**只写主机名**，不带协议 |
| `NIMAO_PAGES_ROOT` | `/srv/kitterhub/pages` | 用户静态项目在服务器上的落盘根目录。开源版由该变量指定，留空用通用默认值 |
| `NIMAO_SUPPORT_EMAIL` | `support@example.com` | 对外支持邮箱：页脚展示、社区规则文档中的联系方式 |
| `NIMAO_PUBLIC_BASE_URL` | 空 | 公开接口（`/api/public/*`）拼接绝对地址用。**留空则按请求的 Host 推断** —— 用局域网 IP / 临时端口访问时建议留空 |
| `NIMAO_PICKCAT_API_BASE` | `https://example.com/pickcat-avatar/api/v1` | 头像工具（pickCat）后端接口地址。本站 nginx 会把它同源反代到同一路径 |
| `NIMAO_SCRATCH_EMBED_BASE` | `https://turbowarp.org/embed` | Scratch 作品在线试玩所用的嵌入播放器地址 |

## 3. 功能开关

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_CHAT_ENABLED` | `1` | 聊天总开关。置 `0` 后聊天 REST 返回 503、Socket 聊天事件被拦截；**通知不受影响** |
| `NIMAO_CLOUD_ENABLED` | `1` | 自建 Scratch 云变量服务开关。**本仓库不含该服务**，没有部署时请置 `0` |
| `NIMAO_CLOUD_HOST` | `wss://example.com/cloud` | 云变量服务对外 WebSocket 地址（nginx 把 `/cloud` 反代到本机 9080） |
| `NIMAO_CLOUD_SECRET` | 空 → 回退到 `NIMAO_SECRET_KEY` | 签云变量票据用的密钥，需与云变量服务端配置一致 |
| `NIMAO_CLOUD_TICKET_TTL` | `21600` | 云变量票据有效期（秒），默认 6 小时 |
| `NIMAO_CLOUD_ADMIN_URL` | `http://127.0.0.1:9081` | 云变量服务的管理接口（只监听本机，后端代理过去给后台用） |
| `NIMAO_CLOUD_ADMIN_KEY` | 空 | 调云变量服务管理接口的密钥 |

## 4. 邮件

邮件系统支持**两条通道**：SMTP（标准库直接发信）与 Resend（HTTP API）。
配了 SMTP 账号就优先走 SMTP，否则走 Resend；**两条都没配时，邮件相关接口会返回明确的配置提示**，
而不是静默失败。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_MAIL_PROVIDER` | 空（自动） | 强制指定通道：`smtp` 或 `resend` |

### 4.1 SMTP 通道

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_SMTP_HOST` | `smtp.qq.com` | SMTP 服务器。用别的服务商请改掉 |
| `NIMAO_SMTP_PORT` | `465` | `465` 配合 SSL；`587` 走 STARTTLS |
| `NIMAO_SMTP_USER` | 空 | 发信账号 |
| `NIMAO_SMTP_PASS` | 空 | **邮箱服务商的「授权码」，不是登录密码**。只放环境变量/密钥文件 |
| `NIMAO_SMTP_SSL` | `1` | `465` 端口用 SSL 置 `1`；`587` 端口置 `0` 走 STARTTLS |

### 4.2 Resend 通道

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_RESEND_API_KEY` | **空** | Resend API Key。只放环境变量/密钥文件 |
| `NIMAO_MAIL_FROM` | `onboarding@resend.dev` | 发件地址。用 Resend **测试域名**时只能发给该账号绑定的邮箱；要发给任意用户需先在 resend.com 验证自己的域名 |
| `NIMAO_MAIL_FROM_NAME` | `KitterHub` | 发件人显示名 |
| `NIMAO_MAIL_LOGO` | `<backend>/app/assets/kitter-logo.png` | 邮件里的站点 LOGO（CID 内嵌，不依赖外网可访问） |
| `NIMAO_MAIL_SITE_URL` | 空 | 邮件里「访问网站」按钮的地址。**留空则不显示按钮**（避免写死一个可能失效的域名） |

### 4.3 开关、预检与防刷

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_EMAIL_REGISTER` | `1` | 邮箱注册总开关。置 `0` 后发码接口与邮箱注册一起关闭 |
| `NIMAO_EMAIL_PRECHECK` | `1` | 注册邮箱预检：格式 / 一次性邮箱 / MX 记录。**会把邮箱发给第三方免费接口**，在意隐私请置 `0` |
| `NIMAO_MAIL_DAILY_LIMIT` | `80` | 全站每天最多发多少封验证码邮件（保护发信邮箱不被服务商封禁） |
| `NIMAO_MAIL_OVERRIDE_TO` | 空 | 测试期收件人改写：非空时所有验证码都发到这个地址。**正式环境请留空** |
| `NIMAO_EMAIL_CODE_ECHO` | `0` | ★ **仅联调**：置 `1` 时不真的发信，验证码直接随接口返回。**正式环境必须为 `0`** |
| `NIMAO_EMAIL_FIXED_CODE` | **空** | ★ **仅联调**：非空时「邮箱注册」这一步接受这个固定验证码（只对 `purpose=register` 生效，找回密码不走这条路）。**正式环境必须留空** —— 否则任何人填这个码就能注册 |

> 说明：开源版本已把 `NIMAO_EMAIL_FIXED_CODE` 的默认值从固定验证码改为**空**。
> 私有部署时曾用它对联调链路；公开仓库里保留它会被直接用来注册。

## 5. GitHub OAuth

用于第三方登录与账号绑定。**不需要就整段留空**。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_GITHUB_CLIENT_ID` | 空 | OAuth App 的 Client ID |
| `NIMAO_GITHUB_CLIENT_SECRET` | 空 | OAuth App 的 Client Secret |
| `NIMAO_GITHUB_REDIRECT_URI` | `{NIMAO_SITE_URL}/api/auth/github/callback` | 必须与 GitHub 后台填的 Redirect URI **一字不差**（协议、域名、端口、路径全都要对） |
| `NIMAO_GITHUB_FRONTEND_BASE` | `NIMAO_SITE_URL` | 回调处理完后把浏览器送回哪个前端地址（同源） |
| `NIMAO_GITHUB_SCOPE` | `read:user user:email` | 只读公开资料 + 邮箱，不碰仓库 |
| `NIMAO_GITHUB_OAUTH_BASE` | `https://github.com` | 仅在联调指向假 GitHub（测试脚本）时修改 |
| `NIMAO_GITHUB_API_BASE` | `https://api.github.com` | 同上 |

## 6. 限流与配额

**全部默认关闭**，需要时逐个打开。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_LIMIT_RATE` | `0` | 全局限流开关 |
| `NIMAO_RATE_LIMIT` | `300` | 开启后每 IP 每分钟允许的请求数 |
| `NIMAO_LIMIT_FREQ` | `0` | 发帖 / 评论 / 投稿的短时频率限制开关 |
| `NIMAO_LIMIT_DAILY` | `0` | 每日内容数量上限开关 |
| `NIMAO_DAILY_POST_LIMIT` | `20` | 每日发帖上限 |
| `NIMAO_DAILY_COMMENT_LIMIT` | `50` | 每日评论上限 |
| `NIMAO_DAILY_WORK_LIMIT` | `20` | 每日投稿上限 |
| `NIMAO_LIMIT_LOGIN` | `0` | 登录失败次数锁定开关 |
| `NIMAO_LIMIT_REG` | `0` | 自动注册配额开关 |

> ⚠️ 限流计数与邮箱验证码都存在**进程内存**里，多进程部署或重启会丢失。
> 当前部署是单进程（`run.py` 里 `reload=False`，未使用 `--workers`）。

## 7. 上传与存储

| 变量 | 默认值 | 换算 | 说明 |
| --- | --- | --- | --- |
| `NIMAO_MAX_UPLOAD_SIZE` | `3145728` | 3 MB | 单张图片上限 |
| `NIMAO_MAX_VIDEO_SIZE` | `31457280` | 30 MB | 视频上限 |
| `NIMAO_PASSPORT_MAX_SIZE` | `8388608` | 8 MB | 护照 / 证件图上限（手机拍摄的证件照常 3–6MB） |
| `NIMAO_SCRATCH_MAX_SIZE` | `52428800` | 50 MB | `.sb3` 作品包上限 |
| `NIMAO_FEEDBACK_MEDIA_MAX` | `6` | —— | 单条意见反馈最多带几张图 |
| `NIMAO_STORAGE_PER_USER_MB` | `100` | 100 MB | 每个用户的默认存储配额 |
| `NIMAO_STORAGE_QUOTA_MAX_MB` | `20480` | 20 GB | 单个账号可申请到的配额上限 |
| `NIMAO_STORAGE_QUOTA_APPLY_REMAINING_MB` | `20` | 20 MB | 剩余空间低于该值时自动应用待生效配额 |

> **别忘了 nginx**：`client_max_body_size` 必须 ≥ 这里配的上限，
> 否则大文件会在 nginx 层被 413 掉，根本到不了应用。
> 参考 `deploy/nginx.conf.example`。

## 8. IP 属地

基于 **ip2region 离线库**，全程不联网，只记录到「省 / 国家」这一档粗信息，
不存历史、不存轨迹、不存精确坐标。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NIMAO_IP2REGION_XDB` | `<backend>/data/ip2region_v4.xdb` | 离线库文件路径。**该文件需自行下载（约 11MB）**，缺失时 IP 属地功能自动降级为空值，不影响其他功能 |
| `NIMAO_IP_REGION_REFRESH` | `60` | 属地刷新节流间隔（分钟），不是每个请求都写库 |
| `NIMAO_IP_REGION_ADMIN_FIXED` | 空 | 给 `role=admin` 的账号固定显示的属地。**留空 = 按真实 IP 判定**。如果不希望暴露管理员的真实位置，可填一个地区名 |
| `NIMAO_IP_REGION_FIXED_UIDS` | 空 | 额外指名固定属地的账号 uid（逗号分隔） |
| `NIMAO_IP_REGION_PIN_EXEMPT_UIDS` | 空 | **豁免名单**：即使 `role=admin` 也不固定属地（逗号分隔的 uid） |

> 说明：开源版本已把这一组的默认值清空。私有版本里 `NIMAO_IP_REGION_ADMIN_FIXED`
> 默认是一个具体地区、`NIMAO_IP_REGION_PIN_EXEMPT_UIDS` 默认写死了一个真实用户 uid，
> 两者都属于部署专属信息，不适合出现在公开仓库。

## 9. 前端环境变量（构建期）

前端变量用 `VITE_` 前缀，只在**构建时**注入，运行期无法更改。
放在 `frontend/.env` 或 `frontend-se/.env`（均未被 `.gitignore` 忽略的是 `*.example`）。

### 主站 `frontend/`

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_URL` | 空 → 同源 `/api` | 覆盖后端基址。**开发模式下**未设置时会自动指向 `http://localhost:8000/api`（判定依据：页面端口为 `5173` 或 `5273`） |
| `VITE_SUPPORT_EMAIL` | `support@example.com` | 页脚展示的支持邮箱（`src/components/Footer.jsx`） |
| `VITE_PAGES_DOMAIN` | `pages.example.com` | Pages 托管域名，用于展示项目地址（`src/pages/Pages.jsx`） |

### SE 版 `frontend-se/`

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_SITE_ORIGIN` | `https://example.com` | 主站对外地址，用于「回主站」「在 KitterHub 打开」等外链 |

> SE 版是 ES5 + IIFE 构建，`import.meta.env.*` 会在**构建期**被 Vite 替换成字面量，
> 所以 IE11 最终只看到字符串常量，不存在 `import.meta` 语法问题。

## 10. 配置的加载顺序

```
真实环境变量（systemd EnvironmentFile / docker -e / shell export）
        ▲ 优先级更高
backend/.env（python-dotenv 读取，override=False）
        ▲ 都没有时
config.py 里的默认值
```

- `python-dotenv` 是**可选依赖**：没装就静默跳过，一切以系统环境变量为准。
- `config.py` 里 `BASE_DIR` 指向 `backend/`，所以 `.env` 的期望位置是 **`backend/.env`**。

## 11. 提交前必查

以下文件**绝对不能**进入版本库（`.gitignore` 已覆盖，但仍请人工确认）：

| 文件 | 原因 |
| --- | --- |
| `backend/.env` / 任何 `*.env`（`.env.example` 除外） | 含密钥 |
| `backend/nimao.db` / 任何 `*.db`、`*.sqlite*` | 含真实用户数据与密码哈希 |
| `backend/uploads/`、`backend/private/` | 真实用户上传内容、护照证件 |
| `*.pem`、`*.key`、`id_*`、`*token*`、`*cred*` | 私钥与凭据 |
| `node_modules/`、`.venv/`、`dist/` | 可重建、体积大 |

自检命令：

```bash
git status --short
git ls-files | grep -Ei "\.env$|\.db$|\.pem$|\.key$|token|cred|secret"
```

详见 [`SECURITY.md`](SECURITY.zh-CN.md)。
