"""安全审计中间件：自动把「后台写操作 + 登录/改密等敏感请求」写入 audit_logs。

策略（只记关键面，避免噪音）：
- /api/admin/** 的 POST/PATCH/PUT/DELETE（管理员的一切变更操作）
- /api/auth/** 的 POST（登录/注册/找回密码等全部认证尝试，含失败）
- /api/users/me/password、/api/users/me/deactivate（改密/注销）
记录：操作人(取 JWT sub)、用户名快照、方法、路径、状态码、来源 IP。
"""
import logging

from fastapi import Request

from . import models, security
from .database import SessionLocal

log = logging.getLogger("audit")


def _sensitive(path: str, method: str) -> bool:
    m = method.upper()
    if path.startswith("/api/admin/") and m in ("POST", "PATCH", "PUT", "DELETE"):
        return True
    if path.startswith("/api/auth/") and m == "POST":
        return True
    if path in ("/api/users/me/password", "/api/users/me/deactivate") and m == "POST":
        return True
    return False


async def record_request(request: Request, status_code: int) -> None:
    try:
        path = request.url.path
        if not _sensitive(path, request.method):
            return
        uid = None
        username = ""
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            try:
                payload = security.decode_token(auth[7:].strip())
                if payload and payload.get("sub"):
                    uid = int(payload["sub"])
            except Exception:
                uid = None
            if uid is not None:
                db0 = SessionLocal()
                try:
                    u = db0.get(models.User, uid)
                    username = u.username if u else ""
                finally:
                    db0.close()
        db = SessionLocal()
        try:
            db.add(
                models.AuditLog(
                    user_id=uid,
                    username=username[:60],
                    method=request.method.upper()[:10],
                    path=path[:300],
                    status=int(status_code or 0),
                    ip=(request.client.host if request.client else "")[:64],
                    detail="",
                )
            )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    except Exception:
        # 审计失败绝不能影响业务
        pass
