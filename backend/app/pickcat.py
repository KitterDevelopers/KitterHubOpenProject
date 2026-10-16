"""PickCat 社区账号绑定（站长 2026-10-02）。

接口形状取自我们部署的 pickCat 头像工具源码（真实调用）：
  POST   https://cdsq.dao3.fun/api/v1/session   {username, password} -> Set-Cookie + {user, expiresAt}
  GET    /api/v1/users/{id}
  DELETE /api/v1/session

安全约定（重要）：
  · 密码**只用于这一次登录调用**，不写库、不写日志、不留存；
  · 绑定成功后**立刻注销对方会话**（DELETE /session），我们不留任何凭据；
  · 只保存 UID / 昵称 / 头像；
  · 绑定与解绑都要求账号已激活（get_active_user），解绑还要验本站密码（设过的话）。
"""
from __future__ import annotations

from datetime import datetime, timezone

import json
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from . import models, serializers, storage_quota  # noqa: F401  (与其他路由保持同一导入风格)
from .deps import get_active_user, get_db
from . import config, security

router = APIRouter(prefix="/pickcat", tags=["pickcat"])


def _state(user) -> dict:
    """绑定状态。刻意不依赖 serializers —— 那个模块在不同版本里字段不一致，
    依赖它会直接把接口打成 500（站长 2026-10-03 实测）。"""
    return {
        "bound": bool(getattr(user, "pickcat_uid", None)),
        "uid": getattr(user, "pickcat_uid", None),
        "nickname": getattr(user, "pickcat_nickname", "") or "",
        "avatar": getattr(user, "pickcat_avatar", None),
    }

# 头像工具后端地址（本站 nginx 反向代理到同一路径下）。
# 真实域名不要写死在这里：用环境变量 NIMAO_PICKCAT_API_BASE 覆盖。
BASE = config.PICKCAT_API_BASE
TIMEOUT = 20
UA = f"KitterHub/1.0 (+{config.SITE_URL})"


def _post_json(path: str, payload: dict, cookie: str | None = None):
    """请求 PickCat 接口；返回 (状态码, 解析后的 JSON 或 None, Set-Cookie 列表)。"""
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": UA,
            "Accept": "application/json",
        },
        method="POST",
    )
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(65536)
            cookies = resp.headers.get_all("Set-Cookie") or []
            try:
                return resp.status, json.loads(raw.decode("utf-8")), cookies
            except Exception:
                return resp.status, None, cookies
    except urllib.error.HTTPError as e:
        raw = e.read(4096) if hasattr(e, "read") else b""
        try:
            return e.code, json.loads(raw.decode("utf-8")), []
        except Exception:
            return e.code, None, []
    except Exception as e:  # noqa: BLE001 网络异常统一处理
        return 0, {"message": f"无法连接 PickCat：{type(e).__name__}"}, []


def _delete_session(cookie: str | None) -> None:
    if not cookie:
        return
    try:
        req = urllib.request.Request(BASE + "/session", headers={"Cookie": cookie, "User-Agent": UA}, method="DELETE")
        urllib.request.urlopen(req, timeout=TIMEOUT).read(1024)
    except Exception:  # noqa: BLE001 注销失败不影响绑定结果
        pass


def _session_cookie(cookies: list[str]) -> str | None:
    for c in cookies:
        head = c.split(";")[0].strip()
        if head.startswith("pickcat_session=") or head.startswith("session="):
            return head
    return None


@router.get("/me")
def pickcat_me(user: models.User = Depends(get_active_user)):
    """当前账号的 PickCat 绑定状态。前端以本接口为准，不依赖 /users/me 的字段。"""
    return _state(user)


@router.post("/bind")
def bind_pickcat(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """用 PickCat 账号密码验证一次并绑定（密码不保存）。"""
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="请填写 PickCat 的用户名与密码")
    if len(password) > 200:
        raise HTTPException(status_code=400, detail="密码长度异常")

    status, data, cookies = _post_json("/session", {"username": username, "password": password})
    if status == 0:
        raise HTTPException(status_code=502, detail="暂时连不上 PickCat，请稍后再试")
    if status in (400, 401, 403):
        raise HTTPException(status_code=400, detail="PickCat 用户名或密码不正确")
    if status >= 500:
        raise HTTPException(status_code=502, detail="PickCat 服务暂时不可用，请稍后再试")
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="PickCat 返回了无法识别的数据")

    u = data.get("user") or {}
    uid = u.get("id") or u.get("uid") or u.get("userId")
    if uid is None:
        _delete_session(_session_cookie(cookies))
        raise HTTPException(status_code=502, detail="PickCat 未返回账号信息")
    uid = str(uid)

    # 同一 PickCat 账号只能绑到一个 KitterHub 账号
    dup = db.query(models.User).filter(models.User.pickcat_uid == uid, models.User.id != user.id).first()
    if dup is not None:
        _delete_session(_session_cookie(cookies))
        raise HTTPException(status_code=400, detail="这个 PickCat 账号已经绑定过其他 KitterHub 账号")

    # PickCat 的 /session 只返回 username（没有 nickname 字段），所以回退到 username
    nickname = u.get("nickname") or u.get("displayName") or u.get("name") or u.get("username") or ""
    avatar = u.get("avatarUrl") or u.get("avatar") or None
    if isinstance(avatar, dict):
        avatar = avatar.get("url")
    # PickCat 返回的是相对路径（/api/v1/avatars/xxx），补成绝对地址才能直接展示
    if isinstance(avatar, str) and avatar.startswith("/"):
        avatar = "https://cdsq.dao3.fun" + avatar

    user.pickcat_uid = uid
    user.pickcat_nickname = str(nickname)[:64]
    user.pickcat_avatar = (str(avatar)[:300] if avatar else None)
    user.pickcat_at = datetime.now(timezone.utc)
    db.commit()

    # 不留对方的会话
    _delete_session(_session_cookie(cookies))
    db.refresh(user)
    return {"ok": True, "pickcat": _state(user)}


@router.post("/unbind")
def unbind_pickcat(body: dict | None = None, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """解绑 PickCat。设过本站密码的账号需要验证当前密码。"""
    if not user.pickcat_uid:
        raise HTTPException(status_code=400, detail="当前没有绑定 PickCat")
    body = body or {}
    if getattr(user, "local_pwd_set", 0):
        pwd = str(body.get("password") or "")
        if not pwd.strip():
            raise HTTPException(status_code=400, detail="这个操作需要验证身份：请先填好当前密码，再点一次")
        if not security.verify_password(pwd, user.hashed_password):
            raise HTTPException(status_code=400, detail="当前密码不正确")
    user.pickcat_uid = None
    user.pickcat_nickname = ""
    user.pickcat_avatar = None
    user.pickcat_at = None
    db.commit()
    return {"ok": True}
