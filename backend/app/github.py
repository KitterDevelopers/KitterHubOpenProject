"""GitHub OAuth 客户端（只用标准库 urllib，不引第三方依赖）。

流程：
    1. 前端调 `POST /auth/github/authorize-url` 拿授权地址（后端生成并记住 state）
    2. 浏览器跳到 GitHub 授权页
    3. GitHub 带 `?code=&state=` 回到 GITHUB_REDIRECT_URI（本站是后端 /api/auth/github/callback）
    4. 后端用 code 换 access_token，再取用户资料与邮箱
    5. 生成一次性票据 302 回前端，前端拿票据换登录态

安全要点：
  · **state 必须服务端生成、一次性消费、有有效期** —— 否则就是 CSRF：攻击者可以
    把别人骗去点一个带自己 code 的链接，让受害者的浏览器把攻击者的 GitHub 绑到自己的号上。
  · Client Secret 只在服务端使用，绝不返回给前端。
  · 只申请 `read:user user:email`，不碰任何仓库权限。
"""
from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

TIMEOUT = 20
UA = "KitterHub/1.0 (+https://kitterhub)"
AVATAR_MAX = 3 * 1024 * 1024   # 头像上限 3MB
_AVATAR_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class GitHubError(RuntimeError):
    """GitHub 交互失败；message 可直接展示给用户。

    transient=True 表示「GitHub 那边临时抽风」（5xx / 网络抖动）——
    这类错误值得自动重试一次，而且给用户的提示应该是「稍后再试」，
    而不是让人以为自己的账号或授权出了问题。
    """

    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


def _with_retry(fn, attempts: int = 3, delays=(1.0, 3.0)):
    """只对「临时性」错误重试。

    为什么要重试：① GitHub 偶尔 5xx；② **国内线路到 github.com 时通时断**
    （实测 api.github.com 一直正常，而 github.com 会连续 000/500 一段时间再恢复）。
    换 token 用的 code 在 10 分钟内有效，重试几次能扛过短的抖动。
    """
    last = None
    for i in range(attempts):
        try:
            return fn()
        except GitHubError as e:
            last = e
            if not getattr(e, "transient", False) or i == attempts - 1:
                raise
            time.sleep(delays[min(i, len(delays) - 1)])
    raise last if last else GitHubError("GitHub 请求失败")


def enabled() -> bool:
    return bool(config.GITHUB_CLIENT_ID and config.GITHUB_CLIENT_SECRET)


def _request(url: str, *, data: dict | None = None, token: str | None = None, accept: str = "application/json"):
    headers = {"User-Agent": UA, "Accept": accept}
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        if e.code == 401:
            raise GitHubError("GitHub 授权已失效，请重新登录") from e
        if e.code == 403:
            raise GitHubError("GitHub 拒绝了这次请求（可能是频率限制），请稍后再试", transient=True) from e
        if 500 <= e.code < 600:
            # GitHub 自己出错（实测会返回 500 HTML 错误页）。code 没被消费，重试通常能成。
            raise GitHubError(f"GitHub 服务暂时不可用（HTTP {e.code}），请稍后重试", transient=True) from e
        raise GitHubError(f"GitHub 返回错误（HTTP {e.code}）：{raw[:160]}") from e
    except GitHubError:
        raise
    except Exception as e:  # noqa: BLE001
        raise GitHubError(f"连接 GitHub 失败：{e}", transient=True) from e


def authorize_url(state: str) -> str:
    """拼授权地址（用户在浏览器里打开它）。"""
    if not enabled():
        raise GitHubError("GitHub 登录还没配置好（缺少 Client ID / Secret）")
    params = {
        "client_id": config.GITHUB_CLIENT_ID,
        "redirect_uri": config.GITHUB_REDIRECT_URI,
        "scope": config.GITHUB_SCOPE,
        "state": state,
        "allow_signup": "true",
    }
    return f"{config.GITHUB_OAUTH_BASE}/login/oauth/authorize?" + urllib.parse.urlencode(params)


def exchange_code(code: str) -> str:
    """用 code 换 access_token。对 GitHub 偶发的 5xx 自动重试一次。"""
    def once() -> str:
        raw = _request(
            f"{config.GITHUB_OAUTH_BASE}/login/oauth/access_token",
            data={
                "client_id": config.GITHUB_CLIENT_ID,
                "client_secret": config.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": config.GITHUB_REDIRECT_URI,
            },
        )
        try:
            data = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            raise GitHubError("GitHub 返回了无法解析的授权结果", transient=True) from e
        token = (data or {}).get("access_token")
        if not token:
            err = (data or {}).get("error_description") or (data or {}).get("error") or "未知错误"
            raise GitHubError(f"GitHub 授权失败：{err}")
        return str(token)

    return _with_retry(once)


def fetch_user(token: str) -> dict:
    """取 GitHub 用户资料（含邮箱）。返回 {id, login, name, avatar, email}。"""
    return _with_retry(lambda: _fetch_user_once(token))


def _fetch_user_once(token: str) -> dict:
    prof = json.loads(_request(f"{config.GITHUB_API_BASE}/user", token=token, accept="application/vnd.github+json"))
    uid = prof.get("id")
    if not uid:
        raise GitHubError("没能从 GitHub 取到用户信息")

    email = (prof.get("email") or "").strip().lower()
    if not email:
        # 公开邮箱为空是常态（用户设了隐私），单独问一次 /user/emails，取「主邮箱且已验证」的那个
        try:
            emails = json.loads(
                _request(f"{config.GITHUB_API_BASE}/user/emails", token=token, accept="application/vnd.github+json")
            )
            if isinstance(emails, list):
                best = next((e for e in emails if e.get("primary") and e.get("verified")), None)
                best = best or next((e for e in emails if e.get("verified")), None)
                if best:
                    email = str(best.get("email") or "").strip().lower()
        except GitHubError:
            email = ""  # 拿不到邮箱不影响登录，之后可以在「账号设置」里自己绑

    return {
        "id": str(uid),
        "login": str(prof.get("login") or ""),
        "name": str(prof.get("name") or ""),
        "avatar": prof.get("avatar_url") or None,
        "email": email if ("@" in email) else "",
    }


def save_avatar_locally(avatar_url: str | None, user_id: int) -> str | None:
    """把 GitHub 头像下载到本站 uploads，返回 `/uploads/xxx`；失败返回 None。

    ★ 为什么必须落本地：`avatars.githubusercontent.com` 在国内经常连不上/极慢，
    前端头像组件 onError 会退化成字母头像 —— 用户看到的就是「GitHub 注册后头像显示不出来」。
    （编程猫那边是 CDN 防盗链下不动才只能留外链，GitHub 没有防盗链，能下就下。）
    """
    if not avatar_url or not str(avatar_url).startswith(("http://", "https://")):
        return None
    try:
        req = urllib.request.Request(
            avatar_url, headers={"User-Agent": UA, "Accept": "image/*,*/*;q=0.8"}
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if ctype not in _AVATAR_EXT:
                return None
            data = resp.read(AVATAR_MAX + 1)
    except Exception:  # noqa: BLE001 下载失败就退回外链，不影响注册
        return None
    if not data or len(data) > AVATAR_MAX:
        return None

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    name = f"{user_id}_gh{secrets.token_hex(4)}{_AVATAR_EXT[ctype]}"
    try:
        with open(os.path.join(config.UPLOAD_DIR, name), "wb") as f:
            f.write(data)
    except OSError:
        return None
    return f"/uploads/{name}"
