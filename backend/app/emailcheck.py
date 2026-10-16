"""注册邮箱预检：判断「格式 / 一次性（临时）邮箱 / MX 记录是否存在」。

用免费接口 https://disify.com/api/email/<地址>（无需 key、无频率限制）。

三条原则，缺一不可：
  1. **失败开放（fail-open）**：接口超时、报错、返回格式变了 —— 一律放行。
     绝不能因为一个第三方免费接口挂了，就把全站注册堵死。
  2. **结果缓存**：同一个地址 10 分钟内只查一次，避免用户狂点「获取验证码」时
     把外部请求打爆、也减少把用户邮箱暴露给第三方的次数。
  3. **可一键关闭**：`NIMAO_EMAIL_PRECHECK=0` 即完全跳过（不联网、不校验）。
     （站长若在意「用户邮箱不外发给第三方」，关掉它即可，其它逻辑不受影响。）

注意：这是**减少无效注册**的体验优化，不是安全边界 —— 真正拦住人的是
「注册后锁定 + 护照实名审核」。
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://disify.com/api/email/"
TIMEOUT = 4          # 秒；注册是同步路径，不能让用户等太久
CACHE_TTL = 600      # 秒

_lock = threading.Lock()
_cache: dict[str, tuple[float, str]] = {}   # email -> (ts, reason)；reason 为空串表示通过

# 原因码 -> 面向用户的中文说明（前端会按这里的原文翻译成英文）
REASON_TEXT = {
    "format": "邮箱地址格式不正确，请检查后重试",
    "disposable": "这是一次性（临时）邮箱，收不到验证码也容易被回收，请用常用邮箱注册",
    "dns": "这个邮箱域名收不到邮件（查不到 MX 记录），请检查是不是拼错了",
    "unreachable": "",   # 预检服务不可用 → 放行
}


def _query(email: str) -> str:
    """返回原因码；空串 = 通过。异常一律返回空串（放行）。"""
    url = ENDPOINT + urllib.parse.quote(email, safe="@.")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "KitterHub/1.0 (+https://kitterhub)", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    except Exception:  # noqa: BLE001  —— 网络问题、超时、限流、返回非 JSON 全部放行
        return ""

    if not isinstance(data, dict):
        return ""
    if data.get("format") is False:
        return "format"
    # 一次性邮箱：disposable 为真，或 signals 里出现黑名单/关键词命中
    if data.get("disposable") is True:
        return "disposable"
    signals = data.get("signals") or []
    if any(s in ("blacklist_exact", "keyword_match", "mx_blacklist_exact") for s in signals):
        return "disposable"
    if data.get("dns") is False:
        return "dns"
    return ""


def check(email: str) -> str:
    """返回原因码（空串=通过）。阻塞时间上限 TIMEOUT 秒，异常一律放行。"""
    if not enabled():
        return ""
    addr = (email or "").strip().lower()
    if not addr:
        return "format"

    now = time.time()
    with _lock:
        hit = _cache.get(addr)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]

    reason = _query(addr)

    with _lock:
        # 缓存不要无限增长（去掉过期项；正常量级下几十条而已）
        for k, (ts, _) in list(_cache.items()):
            if now - ts >= CACHE_TTL:
                _cache.pop(k, None)
        _cache[addr] = (now, reason)
    return reason


def message(reason: str) -> str:
    return REASON_TEXT.get(reason, "") or "邮箱地址不可用，请更换后重试"


def enabled() -> bool:
    from . import config

    return bool(getattr(config, "EMAIL_PRECHECK", True))
