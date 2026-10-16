"""邮箱验证码：内存存储 + 有效期 + 重发冷却 + 试错上限。

不落库：验证码本身就是短时效凭据，后端重启后失效、让用户重新获取即可，
省掉一张表和一套清理任务。

频率限制只针对「同一个邮箱」，不是全站限流，目的是保护站长的 Resend 额度
不被刷爆（免费版每天 100 封 / 每月 3000 封）。
"""
from __future__ import annotations

import secrets
import threading
import time

from . import config

CODE_TTL = 600          # 验证码有效期：10 分钟
RESEND_COOLDOWN = 60    # 同一邮箱重发冷却：60 秒
HOURLY_LIMIT = 5        # 同一邮箱 1 小时内最多发 5 封
MAX_TRIES = 5           # 同一个验证码最多试错 5 次

_lock = threading.Lock()
_codes: dict[tuple[str, str], dict] = {}
_sends: dict[tuple[str, str], list[float]] = {}

# 全站每日发信总量上限（跨邮箱）。上面几条都是「按邮箱」的限制，
# 挡不住有人换着邮箱刷 —— 真发信一旦被刷爆，发信邮箱会被服务商限流，
# 结果是所有人都收不到验证码。所以再加一道全局闸门。
_daily_date = ""
_daily_count = 0


def _roll_day() -> None:
    """跨天清零。调用方必须已持有 _lock。"""
    global _daily_date, _daily_count
    today = time.strftime("%Y-%m-%d")
    if _daily_date != today:
        _daily_date = today
        _daily_count = 0


def global_stats() -> dict:
    """当天已发多少封 / 上限多少（排障用）。"""
    with _lock:
        _roll_day()
        return {"date": _daily_date, "sent": _daily_count, "limit": config.MAIL_DAILY_LIMIT}


class CodeError(Exception):
    """验证码相关的可预期错误；detail 可直接展示给用户。"""

    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status = status


def _key(purpose: str, email: str) -> tuple[str, str]:
    return (purpose or "register", (email or "").strip().lower())


def _purge(now: float) -> None:
    for k, v in list(_codes.items()):
        if v["expires"] < now:
            _codes.pop(k, None)


def cooldown_left(purpose: str, email: str) -> int:
    """还需要等多少秒才能重发（0 = 可以发）。"""
    k = _key(purpose, email)
    with _lock:
        rec = _codes.get(k)
        if not rec:
            return 0
        return max(0, int(rec["sent_at"] + RESEND_COOLDOWN - time.time()))


def precheck(purpose: str, email: str) -> None:
    """发送前检查冷却、小时配额与全站每日总量；不通过抛 CodeError。"""
    k = _key(purpose, email)
    now = time.time()
    with _lock:
        _purge(now)
        _roll_day()
        if config.MAIL_DAILY_LIMIT > 0 and _daily_count >= config.MAIL_DAILY_LIMIT:
            raise CodeError("今天的验证码发送量已达上限，请明天再试", 429)
        rec = _codes.get(k)
        if rec:
            left = int(rec["sent_at"] + RESEND_COOLDOWN - now)
            if left > 0:
                raise CodeError(f"验证码刚发送过，请 {left} 秒后再试", 429)
        hist = [t for t in _sends.get(k, []) if now - t < 3600]
        _sends[k] = hist
        if len(hist) >= HOURLY_LIMIT:
            raise CodeError("该邮箱获取验证码过于频繁，请 1 小时后再试", 429)


def put(purpose: str, email: str) -> str:
    """生成并存下验证码（同时计入配额）。"""
    global _daily_count
    k = _key(purpose, email)
    code = f"{secrets.randbelow(1000000):06d}"
    now = time.time()
    with _lock:
        _codes[k] = {"code": code, "expires": now + CODE_TTL, "sent_at": now, "tries": 0}
        _sends.setdefault(k, []).append(now)
        _roll_day()
        _daily_count += 1
    return code


def drop(purpose: str, email: str) -> None:
    """发送失败时回滚：不要白白占掉用户的冷却时间、小时配额与全站每日额度。"""
    global _daily_count
    k = _key(purpose, email)
    with _lock:
        _codes.pop(k, None)
        hist = _sends.get(k)
        if hist:
            hist.pop()
        _roll_day()
        _daily_count = max(0, _daily_count - 1)


def check(purpose: str, email: str, code: str) -> None:
    """校验验证码；不通过抛 CodeError。校验通过后调用方应再调用 consume()。"""
    k = _key(purpose, email)
    code = (code or "").strip()

    # 邮件服务尚未接通时的固定码：**只对注册生效**。
    # 找回密码绝不能走这条分支，否则任何人都能用这个固定码重置别人的密码。
    fixed = getattr(config, "EMAIL_FIXED_CODE", "") or ""
    if fixed and purpose == "register" and code and secrets.compare_digest(fixed, code):
        return

    now = time.time()
    with _lock:
        rec = _codes.get(k)
        if rec is None:
            raise CodeError("请先获取邮箱验证码")
        if rec["expires"] < now:
            _codes.pop(k, None)
            raise CodeError("验证码已过期，请重新获取")
        if not code or not secrets.compare_digest(rec["code"], code):
            rec["tries"] += 1
            left = MAX_TRIES - rec["tries"]
            if left <= 0:
                _codes.pop(k, None)
                raise CodeError("验证码错误次数过多，请重新获取")
            raise CodeError(f"验证码不正确，还可以再试 {left} 次")


def consume(purpose: str, email: str) -> None:
    """用掉验证码（注册/重置成功后调用），同时清掉配额计数，方便下次重新获取。"""
    k = _key(purpose, email)
    with _lock:
        _codes.pop(k, None)
        _sends.pop(k, None)
