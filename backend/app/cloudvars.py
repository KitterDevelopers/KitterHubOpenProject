"""自建 Scratch 云变量服务器：票据签发 + 播放地址装饰 + 管理代理。

背景：Scratch 官方的云变量服务器只对 Scratch 自己开放（要账号凭据），所以我们自建一套
（见 `cloud/server.py`）。播放器是 TurboWarp，它支持 `cloud_host=<自己的 ws 地址>`。

三件事在这里收口：

1. **票据**（`ticket_url`）：云地址里带 `p=<作品 id>&u=<uid>&e=<过期>&t=<HMAC>`。
   uid 用 **KitterHub 的账号 id**，票据由后端用密钥签，客户端改不了 →
   云数据天然按本站账号划分，也挡住了"随便连上来乱写"。
2. **播放地址装饰**（`decorate_play_url`）：给 Scratch 作品的 play_url 追加
   `&cloud_host=<票据地址>&username=<昵称>`（昵称只是给项目里的「用户名」积木和排行榜显示用，
   不参与鉴权）。开关关闭时不加，播放器就退回 TurboWarp 默认的公共云。
3. **管理代理**（`admin_get` / `admin_post`）：后台要看的统计、房间列表、清空，
   都转发给云变量服务本机的 9081 管理口（带 X-Cloud-Key）。

为什么 uid=0 也放行：游客（未登录）同样要能玩联机/多人作品，票据签成 uid=0，
云端记为「游客」；真要"只许登录用户上榜"，把 `CLOUD_GUEST` 关掉即可。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config, switches

CLOUD_GUEST = True  # 允许游客（uid=0）连云；关掉则未登录用户不加 cloud_host


def enabled() -> bool:
    """云变量总开关（后台「系统设置 → 站点开关」里可改）。"""
    return switches.enabled("cloud") and bool(config.CLOUD_HOST)


def _sign(work_id: int, uid: int, exp: int) -> str:
    msg = f"{work_id}|{uid}|{exp}".encode()
    return hmac.new(config.CLOUD_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def ticket_url(work_id: int, uid: int) -> str:
    """拼出带签名的 cloud_host 地址（过期时间也签在里面）。"""
    exp = int(time.time()) + config.CLOUD_TICKET_TTL
    base = config.CLOUD_HOST.rstrip("/")
    q = urllib.parse.urlencode({"p": work_id, "u": uid, "e": exp, "t": _sign(work_id, uid, exp)})
    return f"{base}?{q}"


def decorate_play_url(play_url: str | None, work_id: int, viewer) -> str | None:
    """给 Scratch 作品的播放地址加上我们自己的云变量服务器。

    ★ 关键坑（2026-09-27 实测出来的）：TurboWarp 的 embed 只有在 **URL 的路径或 hash 里
      带一个非 0 的数字** 时才认为"这个作品有 project id"，而 `canUseCloud` 要求
      `projectId && username` —— 我们用 `project_url=<自己的 sb3>` 直链，路径里没有 id，
      结果 projectId 默认 '0'，**云变量压根不连**（CDP 抓 WebSocket：0 条）。
      解决：在播放地址末尾追加 `#<我们的作品 id>` —— embed.jsx 的 getProjectId() 会读 hash
      （正则 `/#(\d+)/`），projectId 就成了这个作品的 id，云连接随即建立 ✓。
      这个 hash 里的 id 只用来"让云开关打开"，真正的房间号以签过名的 `?p=` 为准。

    只动 Scratch 作品；开关关闭、没配 CLOUD_HOST、或已经挂过 cloud_host 时原样返回。
    """
    if not play_url or not enabled():
        return play_url
    if "cloud_host=" in play_url:          # 幂等：重复序列化不要叠加
        return play_url
    uid = int(getattr(viewer, "id", 0) or 0)
    if uid == 0 and not CLOUD_GUEST:
        return play_url
    uname = ""
    if viewer is not None:
        uname = (getattr(viewer, "nickname", "") or getattr(viewer, "username", "") or "")[:32]
    host = ticket_url(work_id, uid)
    sep = "&" if "?" in play_url else "?"
    out = f"{play_url}{sep}cloud_host={urllib.parse.quote(host, safe='')}"
    if uname:
        out += f"&username={urllib.parse.quote(uname, safe='')}"
    # 末尾的 #<id>：让 TurboWarp 的 embed 认为项目有 id，从而启用云变量（见上面的说明）
    out += f"#{work_id}"
    return out


# ---------------------------------------------------------------- 管理代理
def _call(method: str, path: str, timeout: float = 8.0) -> dict:
    if not config.CLOUD_ADMIN_URL or not config.CLOUD_ADMIN_KEY:
        return {"ok": False, "detail": "云变量服务未配置管理接口"}
    url = f"{config.CLOUD_ADMIN_URL}{path}"
    req = urllib.request.Request(url, method=method, headers={"X-Cloud-Key": config.CLOUD_ADMIN_KEY})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "detail": f"云端返回 {e.code}"}
    except Exception as e:
        return {"ok": False, "detail": f"连不上云变量服务：{e}"}


def admin_stats() -> dict:
    return _call("GET", "/stats")


def admin_rooms(limit: int = 50) -> dict:
    return _call("GET", f"/rooms?limit={int(limit)}")


def admin_room(work_id: int) -> dict:
    return _call("GET", f"/room?work={int(work_id)}")


def admin_clear(work_id: int) -> dict:
    return _call("POST", f"/clear?work={int(work_id)}")


def admin_clear_all() -> dict:
    return _call("POST", "/clearall")
