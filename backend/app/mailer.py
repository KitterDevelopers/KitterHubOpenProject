"""邮件发送：两条通道，按配置自动选。

通道一（推荐）SMTP —— 用邮箱服务商的「授权码」直发
    NIMAO_SMTP_USER=you@qq.com
    NIMAO_SMTP_PASS=授权码          # QQ 邮箱：设置→账户→开启 IMAP/SMTP→生成授权码
    可选 NIMAO_SMTP_HOST / NIMAO_SMTP_PORT / NIMAO_SMTP_SSL
    好处：不用域名验证、不用第三方平台账号、能给任意收件人发、国内网络稳定。
    注意：QQ/163 会强制「发件人 = 登录账号」，所以 From 直接用 SMTP_USER。

通道二 Resend —— 走 REST API
    NIMAO_RESEND_API_KEY=re_xxxxxxxxx
    NIMAO_MAIL_FROM=onboarding@resend.dev   # 测试域名只能发给账号本人那个邮箱

通道选择：NIMAO_MAIL_PROVIDER=smtp|resend；留空则自动判断（配了 SMTP 账号密码就用 SMTP）。
所有密钥只从环境变量读取，**绝不写进代码 / 不进仓库**（服务器上放 /etc/nimao/nimao.env，600 root）。
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr

from . import config

RESEND_ENDPOINT = "https://api.resend.com/emails"
PLACEHOLDER_KEY = "re_xxxxxxxxx"
SMTP_TIMEOUT = 25


class MailError(RuntimeError):
    """邮件发送失败；message 是可以直接给用户看的中文说明。"""


# ---------------------------------------------------------------------------
# 配置判定
# ---------------------------------------------------------------------------
def api_key() -> str:
    return (config.RESEND_API_KEY or "").strip()


def provider() -> str:
    """当前用哪条通道。显式配置优先，否则「配了 SMTP 账号密码就用 SMTP」。"""
    explicit = (getattr(config, "MAIL_PROVIDER", "") or "").strip().lower()
    if explicit in ("smtp", "resend"):
        return explicit
    if (config.SMTP_USER or "").strip() and (config.SMTP_PASS or "").strip():
        return "smtp"
    return "resend"


def mail_from() -> str:
    """发件人地址。SMTP 通道必须用登录账号本身，否则 QQ/163 会改写发件人。"""
    if provider() == "smtp":
        return (config.SMTP_USER or "").strip()
    return (config.MAIL_FROM or "").strip() or "onboarding@resend.dev"


def is_configured() -> bool:
    if provider() == "smtp":
        return bool((config.SMTP_USER or "").strip() and (config.SMTP_PASS or "").strip())
    key = api_key()
    return bool(key) and key != PLACEHOLDER_KEY and key.startswith("re_")


def not_configured_hint() -> str:
    return (
        "邮件服务还没配置好。请在 /etc/nimao/nimao.env 里配置任意一组并重启后端："
        "①SMTP：NIMAO_SMTP_USER + NIMAO_SMTP_PASS（邮箱授权码）；"
        "②Resend：NIMAO_RESEND_API_KEY。"
    )


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------
def send_email(*, to: str, subject: str, html: str, text: str | None = None, reply_to: str | None = None,
               images: list | None = None) -> str:
    """发送一封邮件；失败抛 MailError。返回服务商的邮件 id（SMTP 通道没有 id，返回空串）。

    images: [{"cid": "kitterhub-logo", "path": "/.../kitter-logo.png"}]，HTML 里用 src="cid:kitterhub-logo" 引用。
    """
    if not is_configured():
        raise MailError(not_configured_hint())

    to, subject, text = _apply_override(to, subject, text)

    if provider() == "smtp":
        return _send_via_smtp(to=to, subject=subject, html=html, text=text, reply_to=reply_to, images=images)
    # Resend 通道不做内嵌图（需要 content_id + 先上传），正文里有文字站名兜底
    return _send_via_resend(to=to, subject=subject, html=html, text=text, reply_to=reply_to)


def _apply_override(to: str, subject: str, text: str | None) -> tuple[str, str, str | None]:
    """测试期收件人改写：无论用户填了哪个邮箱，一律发到站长指定的地址。

    正文里仍然保留用户填写的原始邮箱，方便对照是谁申请的。
    """
    override = (getattr(config, "MAIL_OVERRIDE_TO", "") or "").strip()
    if not override or override.lower() == (to or "").lower():
        return to, subject, text
    body = (text or "") + f"\n(测试模式) 原收件人：{to}\n"
    return override, f"[测试·原收件人 {to}] {subject}", body


# ---------------------------------------------------------------------------
# 通道一：SMTP
# ---------------------------------------------------------------------------
def _send_via_smtp(*, to: str, subject: str, html: str, text: str | None = None, reply_to: str | None = None,
                   images: list | None = None) -> str:
    msg = EmailMessage()
    # 注意：EmailMessage 用的是新版 headerregistry，赋值必须是**普通字符串**——
    # 传 email.header.Header 老对象会报 TypeError: 'Header' object is not subscriptable。
    # 新版策略在序列化时会自动把非 ASCII 头（中文主题/发件人名）做 RFC2047 编码。
    msg["Subject"] = subject
    msg["From"] = formataddr((config.MAIL_FROM_NAME or "KitterHub", mail_from()))
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text or _html_to_text(html))
    msg.add_alternative(html, subtype="html")

    # 内嵌图片（LOGO）：把 HTML 那一段转成 multipart/related 再挂上去，
    # 这样收件人不用联网取图、也不受「对方邮箱拦截远程图片」影响。
    for img in images or []:
        try:
            with open(img["path"], "rb") as fp:
                data = fp.read()
        except OSError:
            continue  # 找不到图就不内嵌，邮件照发（正文里还有文字版站名兜底）
        ext = os.path.splitext(img["path"])[1].lower()
        subtype = "png" if ext == ".png" else "jpeg" if ext in (".jpg", ".jpeg") else "gif"
        try:
            part = msg.get_payload()[1]
            if part.get_content_maintype() != "multipart":
                part.make_related()
            part.add_related(data, maintype="image", subtype=subtype,
                             cid=f"<{img['cid']}>", filename=os.path.basename(img["path"]))
        except Exception:  # noqa: BLE001 内嵌失败不影响发信
            pass

    host = (config.SMTP_HOST or "smtp.qq.com").strip()
    port = int(config.SMTP_PORT or 465)
    try:
        if getattr(config, "SMTP_SSL", True):
            server = smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT)
        else:
            server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT)
            server.ehlo()
            server.starttls()
            server.ehlo()
        with server:
            server.login(config.SMTP_USER, config.SMTP_PASS)
            refused = server.send_message(msg)
    except smtplib.SMTPAuthenticationError as e:
        raise MailError(
            "SMTP 登录被拒：授权码不正确，或该邮箱还没开启 SMTP 服务（QQ 邮箱：设置→账户→开启 IMAP/SMTP 服务）"
        ) from e
    except smtplib.SMTPRecipientsRefused as e:
        raise MailError(f"收件人被拒绝：{e.recipients}") from e
    except smtplib.SMTPSenderRefused as e:
        raise MailError(f"发件人被拒绝（QQ/163 要求发件人必须是登录账号本身）：{e.smtp_error}") from e
    except (smtplib.SMTPException, OSError) as e:
        raise MailError(f"邮件发送失败（SMTP {host}:{port}）：{e}") from e

    if refused:
        raise MailError(f"部分收件人被拒绝：{refused}")
    return ""


def smtp_selftest() -> dict:
    """只做连接 + 登录自检，不发信；用于排障。"""
    host = (config.SMTP_HOST or "smtp.qq.com").strip()
    port = int(config.SMTP_PORT or 465)
    out = {"provider": provider(), "host": host, "port": port, "user": config.SMTP_USER, "from": mail_from()}
    try:
        if getattr(config, "SMTP_SSL", True):
            server = smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT)
        else:
            server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT)
            server.ehlo()
            server.starttls()
        with server:
            server.login(config.SMTP_USER, config.SMTP_PASS)
            out["login"] = "OK"
    except Exception as e:  # noqa: BLE001
        out["login"] = f"FAIL: {type(e).__name__}: {e}"
    return out


# ---------------------------------------------------------------------------
# 通道二：Resend
# ---------------------------------------------------------------------------
def _send_via_resend(*, to: str, subject: str, html: str, text: str | None = None, reply_to: str | None = None) -> str:
    payload: dict = {"from": mail_from(), "to": [to], "subject": subject, "html": html}
    if text:
        payload["text"] = text
    if reply_to:
        payload["reply_to"] = reply_to

    req = urllib.request.Request(
        RESEND_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "User-Agent": "KitterHub/1.0 (+https://kitterhub)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        raise MailError(_friendly_http_error(e.code, raw)) from e
    except Exception as e:  # noqa: BLE001
        raise MailError(f"邮件发送失败（网络异常）：{e}") from e

    try:
        return str((json.loads(body) or {}).get("id") or "")
    except Exception:  # noqa: BLE001
        return ""


def _friendly_http_error(code: int, raw: str) -> str:
    detail = raw
    try:
        parsed = json.loads(raw)
        detail = parsed.get("message") or parsed.get("error") or raw
    except Exception:  # noqa: BLE001
        pass
    detail = str(detail)[:200]
    if code == 401:
        return "邮件服务鉴权失败：Resend API Key 不正确或已失效，请重新设置 NIMAO_RESEND_API_KEY"
    if code == 403:
        return f"邮件发送被拒绝（可能是发件域名未验证）：{detail}"
    if code == 422:
        return f"邮件参数被拒绝（发件人/收件人格式或域名未验证）：{detail}"
    if code == 429:
        return "邮件发送过于频繁，请稍后再试"
    return f"邮件发送失败（HTTP {code}）：{detail}"


# ---------------------------------------------------------------------------
# 模板
# ---------------------------------------------------------------------------
def _html_to_text(html: str) -> str:
    """极简 HTML → 纯文本（只用于没有 text 版本时的兜底）。"""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def verify_code_email(code: str, *, purpose: str = "register", ttl_minutes: int = 10,
                      lang: str = "zh") -> tuple[str, str, str, list]:
    """返回 (subject, html, text, images)。images 给 send_email 做 LOGO 内嵌。

    ★ 设计原则（2026-09-24 站长要求重做）：**只突出验证码**。
      不要标语、不要宣传语、不要「访问 KitterHub」这类按钮 —— 验证码邮件只有一个任务，
      就是让对方一眼看到那 6 位数字。所以整封信只有：
        头部（LOGO + 站名） → 一句说明 → **验证码** → 有效期 → 「不是你本人？」 → 页脚一行

    技术约束（改版时保持不变）：
      · 色值按站点的 MD3 令牌写死十六进制，见 _MD3 —— 邮件客户端（尤其 Outlook 桌面版）
        **不支持 CSS 自定义属性**，`var(--md-sys-color-primary)` 会直接失效。
      · 表格布局 + 内联样式（Outlook 对 div/flex/max-width 支持很差）。
      · 圆角统一 12px = 站点的 `--radius`。
      · 不引任何外部资源：LOGO 走 CID 内嵌，图片默认不显示的客户端也不会破版。
      · 暗色模式用 `<style>` + prefers-color-scheme 覆盖（不支持的客户端就只显示亮色版）。
    """
    copy = _CODE_COPY.get("en" if str(lang).lower().startswith("en") else "zh")
    if purpose == "reset":
        action = copy["action_reset"]
    elif purpose == "bind":
        action = copy["action_bind"]
    else:
        action = copy["action_register"]
    subject = copy["subject"].format(code=code)

    logo_src = "cid:kitterhub-logo" if _logo_available() else ""

    # ── MD3 令牌：亮色直接用；暗色只用于 <style> 里的媒体查询覆盖 ──
    T = _MD3["light"]
    # 全信用同一套无衬线字体栈（正文、标题、连验证码也是）——站长要求「字体正常点」。
    # 邮件客户端不一定认 -apple-system，所以 Windows / macOS / Android / 中文各留一个候选。
    FONT = ("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,"
            "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif")
    # 行距统一口径：块与块之间 18~26px，同一块内的多行之间 6px。
    GAP_BLOCK = 22
    GAP_LINE = 6

    logo_cell = (
        f'<img src="{logo_src}" width="46" height="31" alt="KitterHub" '
        f'style="display:block;margin:0 auto;width:46px;height:31px;border:0;outline:none;text-decoration:none;" />'
        if logo_src
        else ""
    )

    # 说明类小字：三行同样的样式，行距靠 margin-top 统一控制
    def note(text: str, first: bool = False) -> str:
        top = 0 if first else GAP_LINE
        return (
            f'<div class="kh-note" style="font-family:{FONT};font-size:13px;'
            f'color:{T["on_surface_variant"]};line-height:20px;text-align:center;'
            f'margin-top:{top}px;">{text}</div>'
        )

    html = f"""\
<!DOCTYPE html>
<html lang="{'en' if copy is _CODE_COPY['en'] else 'zh-CN'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="x-apple-disable-message-reformatting" />
<title>{subject}</title>
{_DARK_STYLE}
</head>
<body class="kh-page" style="margin:0;padding:0;background:{T['page']};">
<!-- 预读文字：只在收件箱列表里显示，不占正文空间 -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{copy["preheader"].format(code=code, ttl=ttl_minutes)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kh-page" style="background:{T['page']};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <!-- MD3 card：surface-container-lowest + 12px 圆角 + elevation 1 -->
      <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" class="kh-card" style="width:440px;max-width:100%;background:{T['card']};border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.06),0 2px 8px rgba(0,0,0,0.06);">

        <!-- LOGO（居中，没有分隔线） -->
        <tr>
          <td align="center" style="padding:32px 32px 0;">{logo_cell}</td>
        </tr>

        <!-- 站名 -->
        <tr>
          <td align="center" style="padding:10px 32px 0;font-family:{FONT};">
            <div class="kh-wordmark" style="font-family:{FONT};font-size:18px;font-weight:700;color:{T['primary']};line-height:24px;text-align:center;">KitterHub</div>
          </td>
        </tr>

        <!-- 标题 + 一句说明，都居中 -->
        <tr>
          <td align="center" style="padding:26px 32px 0;font-family:{FONT};">
            <div class="kh-title" style="font-family:{FONT};font-size:19px;font-weight:700;color:{T['on_surface']};line-height:26px;text-align:center;">{copy["title"]}</div>
            <div class="kh-lead" style="font-family:{FONT};font-size:14px;color:{T['on_surface_variant']};line-height:22px;text-align:center;margin-top:6px;">{action}</div>
          </td>
        </tr>

        <!-- 验证码：整封信唯一的主角。普通无衬线字体 + 字重 700，只用 2px 字距便于读出数字 -->
        <tr>
          <td align="center" style="padding:{GAP_BLOCK}px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kh-codebox" style="background:{T['primary_container']};border-radius:12px;">
              <tr>
                <td align="center" style="padding:24px 16px;">
                  <div class="kh-code" style="font-family:{FONT};font-size:34px;font-weight:700;letter-spacing:2px;color:{T['on_primary_container']};line-height:40px;text-align:center;padding-left:2px;">{code}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- 三行必要说明：有效期 / 安全提示 / 不是你本人，居中、行距 6px -->
        <tr>
          <td align="center" style="padding:18px 32px 0;font-family:{FONT};">
            {note(copy["ttl"].format(ttl=ttl_minutes), first=True)}
            {note(copy["security"])}
            {note(copy["notyou"])}
          </td>
        </tr>

        <!-- 页脚：一行小字，没有底色也没有分隔线 -->
        <tr>
          <td align="center" style="padding:26px 32px 30px;font-family:{FONT};">
            <div class="kh-footer-t" style="font-family:{FONT};font-size:12px;color:{T['outline']};line-height:18px;text-align:center;">{copy["footer"]}</div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>"""

    text = copy["text"].format(code=code, ttl=ttl_minutes)
    images = [{"cid": "kitterhub-logo", "path": config.MAIL_LOGO_PATH}] if _logo_available() else []
    return subject, html, text, images


# MD3 设计令牌。**与 frontend/src/styles/global.css 的 --md-sys-color-* 保持一致**，
# 改站点配色时这里要同步改（邮件客户端读不到 CSS 变量，只能写死）。
_MD3 = {
    "light": {
        "primary": "#0061a4",
        "on_primary": "#ffffff",
        "primary_container": "#cfe5ff",
        "on_primary_container": "#001d33",
        "surface": "#f9f9ff",
        "on_surface": "#191c20",
        "on_surface_variant": "#43474e",
        "outline": "#73777f",
        "outline_variant": "#c3c6cf",
        # 页面底 = surface-container；卡片 = surface-container-lowest；
        # 提示块/页脚 = surface-container-low；分割线 = outline-variant 淡化后的近似值
        "page": "#edeef5",
        "card": "#ffffff",
        "notice_bg": "#f2f3fa",
        "footer_bg": "#f2f3fa",
        "divider": "#e7e8ec",
    },
    "dark": {
        "primary": "#a6c8ff",
        "on_primary": "#003258",
        "primary_container": "#00497d",
        "on_primary_container": "#cfe5ff",
        "surface": "#101418",
        "on_surface": "#dfe3e8",
        "on_surface_variant": "#c3c6cf",
        "outline": "#8d9199",
        "outline_variant": "#43474e",
        "page": "#101418",
        "card": "#1d2024",
        "notice_bg": "#191c20",
        "footer_bg": "#191c20",
        "divider": "#2b2e33",
    },
}

# 暗色模式覆盖。只写 class 选择器 + 媒体查询：支持的客户端（Apple Mail / iOS / Outlook.com /
# Gmail App）切到暗色，不支持的（Outlook 桌面版）继续用内联的亮色值，不会翻车。
# 改版后页脚没有底色、头部没有分隔线了，所以这里也不再需要 kh-footer / kh-tagline / kh-notice。
_DARK_STYLE = """<style type="text/css">
  @media (prefers-color-scheme: dark) {
    .kh-page, body.kh-page, table.kh-page { background: #101418 !important; }
    .kh-card { background: #1d2024 !important; }
    .kh-wordmark { color: #a6c8ff !important; }
    .kh-title { color: #dfe3e8 !important; }
    .kh-lead, .kh-note, .kh-footer-t { color: #c3c6cf !important; }
    .kh-codebox { background: #00497d !important; }
    .kh-code { color: #cfe5ff !important; }
  }
</style>"""


def _logo_available() -> bool:
    path = getattr(config, "MAIL_LOGO_PATH", "")
    return bool(path) and os.path.isfile(path)


_CODE_COPY = {
    "zh": {
        "subject": "KitterHub 验证码：{code}",
        "preheader": "你的验证码是 {code}，{ttl} 分钟内有效。",
        "title": "验证你的邮箱",
        "action_register": "你正在注册 KitterHub 账号，验证码是：",
        "action_reset": "你正在重置 KitterHub 账号的密码，验证码是：",
        "action_bind": "你正在把这个邮箱绑定到 KitterHub 账号，验证码是：",
        "ttl": "验证码 {ttl} 分钟内有效。",
        "security": "KitterHub 不会向你索要验证码，请不要转发给他人。",
        "notyou": "不是你本人操作？忽略这封邮件即可。",
        "footer": "这封邮件由 KitterHub 自动发送，请勿直接回复。",
        "text": "KitterHub 验证码：{code}\n\n验证码 {ttl} 分钟内有效。\nKitterHub 不会向你索要验证码，请不要转发给他人。\n不是你本人操作请忽略本邮件。",    },
    "en": {
        "subject": "Your KitterHub code: {code}",
        "preheader": "Your code is {code} — valid for {ttl} minutes.",
        "title": "Verify your email",
        "action_register": "You are creating a KitterHub account. Your verification code is:",
        "action_reset": "You are resetting your KitterHub password. Your verification code is:",
        "action_bind": "You are linking this email address to your KitterHub account. Your verification code is:",
        "ttl": "This code is valid for {ttl} minutes.",
        "security": "KitterHub will never ask you for this code. Please do not forward it to anyone.",
        "notyou": "Not you? Just ignore this email.",
        "footer": "This email was sent automatically by KitterHub. Please do not reply.",
        "text": "Your KitterHub verification code: {code}\n\nThis code is valid for {ttl} minutes.\nKitterHub will never ask you for this code. Please do not forward it to anyone.\nIf this was not you, just ignore this email.",
    },
}
