"""应用配置。所有可调参数都集中在这里，支持通过环境变量覆盖。"""
import os

# backend 目录（本文件在 backend/app/ 下，所以向上一级是 backend）
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 可选：把 backend/.env 里的键值对读进环境变量，方便本地开发（`cp .env.example .env`）。
# override=False —— 真实环境变量优先级更高，线上用 systemd EnvironmentFile 注入时不会被 .env 顶掉。
# python-dotenv 没装也不影响：静默跳过，一切以系统环境变量为准。
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(BASE_DIR, ".env"), override=False)
except ImportError:
    pass

# ---------------------------------------------------------------------------
# 站点标识
# ---------------------------------------------------------------------------
# 本仓库是对外开源版本，所有示例值一律使用 example.com 占位符。
# 部署到自己的域名时，用下面这些环境变量覆盖即可，**不要**把真实域名写回代码。
# 主站对外地址（SEO canonical / 分享链接 / SE 版回跳），不带结尾斜杠
SITE_URL = (os.getenv("NIMAO_SITE_URL", "https://example.com") or "").strip().rstrip("/")
# KitterHub Pages（用户静态项目托管）使用的独立域名，只写主机名，不带协议
PAGES_DOMAIN = (os.getenv("NIMAO_PAGES_DOMAIN", "pages.example.com") or "").strip()
# 对外支持邮箱（页脚、社区规则文档中的联系方式）
SUPPORT_EMAIL = (os.getenv("NIMAO_SUPPORT_EMAIL", "support@example.com") or "").strip()
# 头像工具（pickCat）后端接口地址
PICKCAT_API_BASE = (
    os.getenv("NIMAO_PICKCAT_API_BASE", "https://example.com/pickcat-avatar/api/v1") or ""
).strip().rstrip("/")

# 生产环境务必通过环境变量覆盖 SECRET_KEY
# 下面这个常量只是「占位哨兵」：任何等于它的值都会被视为未配置并拒绝启动，
# 它本身不是、也不得被当作可用密钥。
_PLACEHOLDER_SECRET = "replace-me-with-a-random-32-plus-byte-secret"
SECRET_KEY = os.getenv("NIMAO_SECRET_KEY", "") or ""
if not SECRET_KEY or SECRET_KEY == _PLACEHOLDER_SECRET or len(SECRET_KEY) < 32:
    raise RuntimeError(
        "NIMAO_SECRET_KEY 未正确注入（缺失/仍为默认值/长度不足）。"
        "拒绝以不安全的签名密钥启动。"
    )
ALGORITHM = "HS256"
# token 有效期（分钟），默认 24 小时
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("NIMAO_TOKEN_EXPIRE", str(24 * 60)))

# 聊天功能总开关（临时关闭聊天用；置 0 后聊天 REST 返回 503、Socket 聊天事件被拦截，通知不受影响）
CHAT_ENABLED = os.getenv("NIMAO_CHAT_ENABLED", "1") == "1"

# ---------------------------------------------------------------------------
# 邮件（Resend）—— 邮箱注册 / 找回密码验证码
# ---------------------------------------------------------------------------
# ★★★ 请通过环境变量 NIMAO_RESEND_API_KEY 注入你自己的 Resend API Key ★★★
# 只写在服务器的环境变量/密钥文件里（权限 600），不要提交进代码仓库。
# 默认留空 = 不配置 Resend 通道（此时若也没配 SMTP，邮件相关功能会明确报错而不是静默失败）。
RESEND_API_KEY = os.getenv("NIMAO_RESEND_API_KEY", "")
# 发件人。用 onboarding@resend.dev（Resend 测试域名）时只能发给 Resend 账号绑定的那个邮箱；
# 想发给任意用户，需先在 resend.com/domains 验证自己的域名，再把这里改成 noreply@你的域名。
MAIL_FROM = os.getenv("NIMAO_MAIL_FROM", "onboarding@resend.dev")
# 邮箱注册总开关（置 0 后发码接口与邮箱注册一起关闭）
EMAIL_REGISTER = os.getenv("NIMAO_EMAIL_REGISTER", "1") == "1"
# 注册邮箱预检：查「格式 / 一次性邮箱 / MX 记录」。第三方免费接口，失败一律放行。
# 置 0 则完全不联网校验（在意「用户邮箱不外发给第三方」就关掉它）。
EMAIL_PRECHECK = os.getenv("NIMAO_EMAIL_PRECHECK", "1") == "1"
# 全站每天最多发多少封验证码邮件。保护发信邮箱不被服务商的频率限制封掉
# （个人 QQ 邮箱日发信量有限，被人刷满会导致所有人都收不到码）。
MAIL_DAILY_LIMIT = int(os.getenv("NIMAO_MAIL_DAILY_LIMIT", "80"))
# 仅联调用：置 1 时不真的发信、验证码直接随接口返回（正式环境务必保持 0）
EMAIL_CODE_ECHO = os.getenv("NIMAO_EMAIL_CODE_ECHO", "0") == "1"
# 固定验证码：非空时，邮箱**注册**这一步接受这个固定码（且不再真的发信）。
# 用途：邮件服务还没接通时也能把英文注册 → 护照审核 → 解锁整条链路跑通。
# 只对 purpose=register 生效；找回密码必须走真实下发的验证码，否则任何人都能用它重置别人密码。
# 接通真实邮件后把这一项清空即可（`NIMAO_EMAIL_FIXED_CODE=`），无需改代码。
EMAIL_FIXED_CODE = os.getenv("NIMAO_EMAIL_FIXED_CODE", "").strip()
# 测试期收件人改写：不为空时，不管用户填的是哪个邮箱，验证码一律发到这个地址。
# 原因：Resend 测试域名（onboarding@resend.dev）只能发给账号绑定的邮箱，
# 联调阶段用它兜底；等 resend.com 验证过自己的域名后清空本项即可。
MAIL_OVERRIDE_TO = os.getenv("NIMAO_MAIL_OVERRIDE_TO", "")

# 发件人显示名（SMTP 用）
MAIL_FROM_NAME = os.getenv("NIMAO_MAIL_FROM_NAME", "KitterHub")

# ---------------------------------------------------------------------------
# GitHub OAuth（第三方登录 / 绑定）
# ---------------------------------------------------------------------------
# 在 https://github.com/settings/applications/new 注册 OAuth App，回调地址填下面这个
# （必须与 GitHub 表单里填的 **一字不差**：协议、域名、端口、路径全都要对）：
#     <你的站点地址>/api/auth/github/callback
# 本地/自建部署时用 NIMAO_SITE_URL 统一定义站点地址；也可单独用
# NIMAO_GITHUB_REDIRECT_URI / NIMAO_GITHUB_FRONTEND_BASE 覆盖。
# Client ID / Secret 只放在服务器的环境变量或权限 600 的密钥文件里，不进仓库。
GITHUB_CLIENT_ID = (os.getenv("NIMAO_GITHUB_CLIENT_ID", "") or "").strip()
GITHUB_CLIENT_SECRET = (os.getenv("NIMAO_GITHUB_CLIENT_SECRET", "") or "").strip()
# 必须与 GitHub OAuth App 里填的 **Redirect URI 完全一致**（2024 新版可以填多个，但这里只用一个）
GITHUB_REDIRECT_URI = (
    os.getenv("NIMAO_GITHUB_REDIRECT_URI", "") or f"{SITE_URL}/api/auth/github/callback"
).strip()
# 回调处理完后把浏览器送回前端的哪个地址（同源）
GITHUB_FRONTEND_BASE = (os.getenv("NIMAO_GITHUB_FRONTEND_BASE", "") or SITE_URL).rstrip("/")
# 只要「读公开资料 + 读邮箱」，不碰仓库
GITHUB_SCOPE = (os.getenv("NIMAO_GITHUB_SCOPE", "read:user user:email") or "").strip()
# 联调时可把这两个指到本地假 GitHub（测试脚本用），正式环境留空即用官方地址
GITHUB_OAUTH_BASE = (os.getenv("NIMAO_GITHUB_OAUTH_BASE", "") or "https://github.com").rstrip("/")
GITHUB_API_BASE = (os.getenv("NIMAO_GITHUB_API_BASE", "") or "https://api.github.com").rstrip("/")

# ---------------------------------------------------------------------------
# 邮件模板
# ---------------------------------------------------------------------------
# 站点 LOGO 直接**内嵌进邮件**（CID 引用），不依赖「网站能不能被外网访问到」，
# 也不怕对方邮箱把远程图片拦掉。文件跟随后端一起部署。
APP_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(APP_DIR, "assets")
MAIL_LOGO_PATH = os.getenv("NIMAO_MAIL_LOGO", os.path.join(ASSETS_DIR, "kitter-logo.png"))
# 邮件里「访问网站」按钮的地址；留空则不显示按钮（避免写死一个可能失效的域名）
MAIL_SITE_URL = (os.getenv("NIMAO_MAIL_SITE_URL", "") or "").strip()

# ---------------------------------------------------------------------------
# SMTP 通道（用邮箱服务商的「授权码」直接发信）
# ---------------------------------------------------------------------------
# 不需要域名验证、也不需要第三方平台账号，国内网络也稳。
# QQ 邮箱：设置 → 账户 → 开启 IMAP/SMTP 服务 → 生成 16 位「授权码」，
#          密码栏填授权码（不是 QQ 密码）。发件人必须等于登录账号，否则 QQ 会改写发件人。
#
#   NIMAO_SMTP_USER=you@qq.com
#   NIMAO_SMTP_PASS=授权码
#
# 通道选择：NIMAO_MAIL_PROVIDER=smtp|resend；留空自动判断
# （配了 SMTP 账号密码就走 SMTP，否则走 Resend）。
MAIL_PROVIDER = (os.getenv("NIMAO_MAIL_PROVIDER", "") or "").strip().lower()
SMTP_HOST = os.getenv("NIMAO_SMTP_HOST", "smtp.qq.com").strip()
SMTP_PORT = int(os.getenv("NIMAO_SMTP_PORT", "465"))
SMTP_USER = (os.getenv("NIMAO_SMTP_USER", "") or "").strip()
SMTP_PASS = (os.getenv("NIMAO_SMTP_PASS", "") or "").strip()
SMTP_SSL = os.getenv("NIMAO_SMTP_SSL", "1") == "1"   # 465 用 SSL；587 端口则置 0 走 STARTTLS

# ---- 限流总开关（默认全部关闭 = 无任何限流；需要时对应项置 1 并重启即可恢复）----
ENABLE_RATE_LIMIT = os.getenv("NIMAO_LIMIT_RATE", "0") == "1"     # 全局限流（每IP每分钟请求数）
ENABLE_FREQ_LIMIT = os.getenv("NIMAO_LIMIT_FREQ", "0") == "1"     # 发帖/评论/投稿短时频率限制
ENABLE_DAILY_LIMIT = os.getenv("NIMAO_LIMIT_DAILY", "0") == "1"   # 每日内容数量上限
ENABLE_LOGIN_LOCK = os.getenv("NIMAO_LIMIT_LOGIN", "0") == "1"    # 登录失败次数锁定
ENABLE_REG_CAP = os.getenv("NIMAO_LIMIT_REG", "0") == "1"         # 自动注册配额

DATABASE_URL = os.getenv("NIMAO_DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'nimao.db')}")

# ---------------------------------------------------------------------------
# IP 属地（个人主页 / 评论上展示「IP属地」）
# ---------------------------------------------------------------------------
# 离线 IP 库文件（ip2region 的 xdb，约 11MB）。用离线库而不是在线接口：
# 不把用户 IP 发给第三方、没有调用额度、不受网络抖动影响。
# 文件缺失/损坏时功能自动降级（不展示属地），不影响其它任何逻辑。
DATA_DIR = os.path.join(BASE_DIR, "data")
IP2REGION_XDB = os.getenv("NIMAO_IP2REGION_XDB", os.path.join(DATA_DIR, "ip2region_v4.xdb"))
# 属地刷新节流（分钟）：同一用户在这段时间内访问，不再查库、也不再写库。
# 取 1 小时——属地本来就是个粗粒度信息，没必要每次请求都更新。
IP_REGION_REFRESH_MINUTES = int(os.getenv("NIMAO_IP_REGION_REFRESH", "60"))
# 管理员账号的属地**固定**成这个值，不按 IP 判定（站长 2026-09-25 要求：官号统一显示香港）。
# 站点对外显示的固定属地（对 role=admin 的账号生效）。默认**空**：按真实 IP 判定。
# 如果自建站点不希望暴露管理员的真实位置，可在这里填一个地区名（例：NIMAO_IP_REGION_ADMIN_FIXED=某省某市）。
IP_REGION_ADMIN_FIXED = os.getenv("NIMAO_IP_REGION_ADMIN_FIXED", "").strip()
# 除了 role=admin 之外，**再单独指名固定**的账号（逗号分隔的 uid）。默认空。
IP_REGION_FIXED_UIDS = {
    u.strip() for u in os.getenv("NIMAO_IP_REGION_FIXED_UIDS", "").split(",") if u.strip()
}
# **豁免名单**：即使 role=admin 也不固定，照常按真实 IP 显示（逗号分隔的 uid）。默认空。
IP_REGION_PIN_EXEMPT_UIDS = {
    u.strip() for u in os.getenv("NIMAO_IP_REGION_PIN_EXEMPT_UIDS", "").split(",") if u.strip()
}

# ---------------------------------------------------------------------------
# 图片上传
# ---------------------------------------------------------------------------
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
# 私有上传目录：nginx 不挂载、不对外暴露，只能由后端校验权限后读取。
# 用于护照等敏感证件——绝不能放进 UPLOAD_DIR（那个目录是公开静态服务）。
PRIVATE_DIR = os.path.join(BASE_DIR, "private")
# 护照图片上限（手机拍的证件照常 3~6MB）
PASSPORT_MAX_SIZE = int(os.getenv("NIMAO_PASSPORT_MAX_SIZE", str(8 * 1024 * 1024)))
# 单张图片最大 3MB
MAX_UPLOAD_SIZE = int(os.getenv("NIMAO_MAX_UPLOAD_SIZE", str(3 * 1024 * 1024)))
# 允许的图片类型 -> 扩展名
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
# 视频上传（意见反馈附件）：单文件上限与允许格式
MAX_VIDEO_SIZE = int(os.getenv("NIMAO_MAX_VIDEO_SIZE", str(30 * 1024 * 1024)))  # 30MB
ALLOWED_VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
# 单条意见反馈最多几个附件
FEEDBACK_MEDIA_MAX = int(os.getenv("NIMAO_FEEDBACK_MEDIA_MAX", "6"))

# ---------------------------------------------------------------------------
# 防刷爆限制
# ---------------------------------------------------------------------------
# 全局限流：每个 IP 每分钟最多请求数（对 /api/* 生效）
RATE_LIMIT_PER_MINUTE = int(os.getenv("NIMAO_RATE_LIMIT", "300"))
# 每人每日内容上限（防刷屏）
DAILY_WORK_LIMIT = int(os.getenv("NIMAO_DAILY_WORK_LIMIT", "20"))
DAILY_POST_LIMIT = int(os.getenv("NIMAO_DAILY_POST_LIMIT", "20"))
DAILY_COMMENT_LIMIT = int(os.getenv("NIMAO_DAILY_COMMENT_LIMIT", "50"))

# ---------------------------------------------------------------------------
# 对外开放接口（/api/public/*）
# ---------------------------------------------------------------------------
# 公开接口返回的图片/链接要拼绝对地址。这里配站点对外域名；留空则按请求的 Host 推断
# （用局域网 IP 或临时端口访问时就不会写死）。例：NIMAO_PUBLIC_BASE_URL=https://example.com
PUBLIC_BASE_URL = (os.getenv("NIMAO_PUBLIC_BASE_URL", "") or "").strip().rstrip("/")

# 允许跨域的前端来源
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3080",
    "http://127.0.0.1:3080",
]

# ---------------------------------------------------------------------------
# 稿件「编辑器规则」：用户选择编辑器 + 输入稿件编号后，按 url_template 拼接播放地址。
# 你可以在后台直接修改这里的规则，或把 {work_id} 替换成你们自己的播放域名。
# codemao=True 表示该编辑器属于「编程猫作品」体系，前端会展示 🐱 编程猫作品 标识。
# ---------------------------------------------------------------------------
EDITORS = [
    {
        "code": "kitten4",
        "name": "Kitten4 源码编辑器",
        "url_template": "https://player.codemao.cn/new/{work_id}",
        "hint": "输入 Kitten4 稿件编号（一串数字），例如 12345678",
        "logo": "🐱",
        "codemao": True,
    },
    {
        "code": "KN",
        "name": "KittenN 编辑器",
        "url_template": "https://kn.codemao.cn/player?type=2&workId={work_id}",
        "hint": "输入 KittenN 稿件编号（一串数字），例如 12345678",
        "logo": "🧩",
        "codemao": True,
    },
    {
        "code": "kitten3",
        "name": "Kitten3 编辑器",
        "url_template": "https://player.codemao.cn/old/{work_id}?origin=kitten_qrcode",
        "hint": "输入 Kitten3 稿件编号（一串数字），例如 12345678",
        "logo": "🐱",
        "codemao": True,
    },
    {
        "code": "coco",
        "name": "Coco 编辑器",
        "url_template": "https://coco.codemao.cn/editor/player/{work_id}?channel=h5",
        "hint": "输入 Coco 稿件编号（一串数字），例如 12345678",
        "logo": "🐶",
        "codemao": True,
    },
    {
        # 三维作品（编程猫 Nemo）。播放地址取自编程猫作品详情接口返回的 player_url，
        # 实测 https://nemo.codemao.cn/w/{id} 可直接嵌入播放。
        "code": "nemo",
        "name": "Nemo 三维编辑器",
        "url_template": "https://nemo.codemao.cn/w/{work_id}",
        "hint": "输入 Nemo 三维作品编号（一串数字），例如 12345678",
        # ⚠️ 这个 logo 字段**网页端没有用到**（前端用 components/EditorLogo.jsx 自己的图片映射），
        #    这里留空是为了不再往接口返回里塞 emoji。
        "logo": "",
        "codemao": True,
    },
]


# ---------------------------------------------------------------------------
# 邮箱绑定状态判定
# ---------------------------------------------------------------------------
# 这些域名下的地址**收不到信**，只是占位符，不能当成「已绑定邮箱」：
#   @codemao.bind    编程猫登录自动建号时的占位邮箱
#   @github.bind     GitHub 登录自动建号、且拿不到可用邮箱时的占位邮箱
#   @nomail.invalid  用户主动解绑邮箱后的占位地址（.invalid 是 RFC2606 保留后缀，永不解析）
PLACEHOLDER_EMAIL_DOMAINS = ("@codemao.bind", "@github.bind", "@nomail.invalid")
UNBOUND_EMAIL_DOMAIN = "@nomail.invalid"


def is_real_email(email: str | None) -> bool:
    """是不是一个真的能收信的邮箱（占位地址一律算「没绑定」）。"""
    e = (email or "").strip().lower()
    if not e or "@" not in e:
        return False
    return not any(e.endswith(d) for d in PLACEHOLDER_EMAIL_DOMAINS)


def unbound_placeholder(user_id: int) -> str:
    """解绑邮箱后写回的占位地址：唯一（带 user id）且不可达。"""
    return f"unbound-{user_id}{UNBOUND_EMAIL_DOMAIN}"


def build_play_url(editor_code: str, work_id: str) -> str | None:
    """根据编辑器规则拼接播放地址。"""
    for editor in EDITORS:
        if editor["code"] == editor_code:
            return editor["url_template"].format(work_id=work_id.strip())
    return None


# 编程猫作品体系的编辑器 code 集合
EDITOR_CODEMAO_CODES = {e["code"] for e in EDITORS if e.get("codemao")}


# ---------------------------------------------------------------------------
# Scratch 作品（.sb3 文件）投稿
# ---------------------------------------------------------------------------
# 播放用 TurboWarp 的**内嵌播放页**：
#   https://turbowarp.org/embed?project_url=<我们的 sb3 绝对地址>&autoplay
#
# ⚠️ 路径必须是 `/embed`（2026-09-26 实测）：TurboWarp 发现自己被 iframe 嵌进去时会校验路径，
#    用顶层写法 `https://turbowarp.org/?project_url=...` 会直接显示
#    「Invalid TurboWarp Embed :(」——站长就是这么发现的第一版不能播。
#
# ⚠️ 抓取 sb3 的是**用户浏览器里的 TurboWarp 页面**，不是我们的服务器，所以那条直链必须：
#   1. 公网 https 可达；
#   2. 带 Access-Control-Allow-Origin: *（见 nginx 的 /uploads/games/，缺了会白屏）；
#   3. 不能落到 /uploads/ 的防盗链规则里（TurboWarp 会带 Referer: https://turbowarp.org/）。
SCRATCH_EMBED_BASE = os.getenv("NIMAO_SCRATCH_EMBED_BASE", "https://turbowarp.org/embed")
SCRATCH_DIR_NAME = "games"          # 文件存在 uploads/games/ 下（与图片分开，单独配 nginx）
SCRATCH_MAX_SIZE = int(os.getenv("NIMAO_SCRATCH_MAX_SIZE", str(50 * 1024 * 1024)))
# ---------------------------------------------------------------------------
# 账号存储空间（站长 2026-09-30：**每个账号默认 100MB**，剩余不足 **20MB** 时可申请扩容；
# 早先是 500MB / 50MB）。这个空间算的是这个账号上传的全部东西：投稿的 .sb3 源文件、
# 头像/背景图/封面、帖子与评论配图、聊天的图片与语音、工作室与系列封面、反馈附件……
# 见 app/storage_quota.py（上传校验、账号设置页、后台审核都调它）。
# 旧的「只算 sb3 的 200MB Scratch 容量」机制已作废（users.scratch_quota_mb 不再读）。
# 快满时仍可申请扩容：剩余不足 STORAGE_QUOTA_APPLY_REMAINING_MB 才有资格申请，
# 管理员在后台审核并决定给多少；用户级配额写在 users.storage_quota_mb（为空就用默认值）。
# ---------------------------------------------------------------------------
STORAGE_PER_USER_MB = int(os.getenv("NIMAO_STORAGE_PER_USER_MB", "100"))
STORAGE_QUOTA_APPLY_REMAINING_MB = int(os.getenv("NIMAO_STORAGE_QUOTA_APPLY_REMAINING_MB", "20"))
# 管理员批配额时的上限（防手滑多打一个 0）：20GB
STORAGE_QUOTA_MAX_MB = int(os.getenv("NIMAO_STORAGE_QUOTA_MAX_MB", "20480"))


def scratch_dir() -> str:
    return os.path.join(UPLOAD_DIR, SCRATCH_DIR_NAME)


# ---------------------------------------------------------------- 自建云变量服务器
# 见 cloud/README.md。播放器（TurboWarp）会用 cloud_host= 连到我们自己的 WebSocket 服务，
# 身份由**我们后端签的票据**决定（作品 id + 用户 uid + 过期时间 + HMAC 签名），
# 所以"云端数据按本站账号划分"，客户端伪造不了。
CLOUD_ENABLED = os.getenv("NIMAO_CLOUD_ENABLED", "1") == "1"
# 云变量服务对外的 WebSocket 地址（nginx 把 /cloud 反代到本机 9080）
CLOUD_HOST = (os.getenv("NIMAO_CLOUD_HOST", "wss://example.com/cloud") or "").strip()
# 签票据用的密钥：与云变量服务共用；不配就退回 SECRET_KEY（两边都读同一个值）
CLOUD_SECRET = (os.getenv("NIMAO_CLOUD_SECRET", "") or "").strip() or SECRET_KEY
CLOUD_TICKET_TTL = int(os.getenv("NIMAO_CLOUD_TICKET_TTL", str(6 * 3600)))   # 票据有效期（秒）
# 云变量服务的管理接口（只监听 127.0.0.1，后端代理过去给后台用）
CLOUD_ADMIN_URL = (os.getenv("NIMAO_CLOUD_ADMIN_URL", "http://127.0.0.1:9081") or "").strip().rstrip("/")
CLOUD_ADMIN_KEY = (os.getenv("NIMAO_CLOUD_ADMIN_KEY", "") or "").strip()


def build_scratch_play_url(sb3_url: str | None) -> str | None:
    """Scratch 作品的播放地址（TurboWarp 播放器 + 我们自己的 sb3 直链）。

    PUBLIC_BASE_URL 没配时返回 None —— 前端会用 window.location.origin 自己拼，
    所以本地开发（localhost）也能正常预览。
    """
    from urllib.parse import quote

    v = (sb3_url or "").strip()
    if not v.startswith(f"/uploads/{SCRATCH_DIR_NAME}/"):
        return None
    base = (PUBLIC_BASE_URL or "").rstrip("/")
    if not base:
        return None
    return f"{SCRATCH_EMBED_BASE}?project_url={quote(base + v, safe='')}&autoplay"
