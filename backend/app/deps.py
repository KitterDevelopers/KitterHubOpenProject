"""FastAPI 依赖：数据库会话与当前用户。"""
from datetime import timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import config, events, iplocate, map_event, models, security
from .database import SessionLocal
from .ratelimit import client_ip

bearer_scheme = HTTPBearer(auto_error=False)

# 实名审核锁定期间仍然放行的路径（前缀匹配）。
# 注意 /api/verify/passport 走的是 get_current_user，本就不经过这里；
# 列出来是为了以后有人改成 get_active_user 时不会把上传卡死。
#
# /api/users/me/treaty 必须放行：《友好条约》弹窗是**模态、关不掉**的（必须点同意），
# 而它又是一个写接口。锁定期间把它 403 掉，用户就被永久困在弹窗里、连护照页都点不到
# —— 这是线上真实发生的死锁。前端现在也改成「激活后才提示条约」，这里再兜一层。
_LOCKED_ALLOW = (
    "/api/auth/logout",
    "/api/verify/",
    "/api/users/me/treaty",
    # 2026-09-24：「绑定编程猫账号」成了激活账号的两条路之一，待激活用户走的正是这个接口。
    # 漏掉它，这条激活路对真正需要它的人完全不可用（只会拿到「请先上传护照」的 403），
    # 等于白加。前端 /verify 页上那个「绑定并激活」按钮以前必然是失败的。
    "/api/users/me/bind-codemao",
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _resolve_user(token: str, db: Session) -> models.User:
    payload = security.decode_token(token)
    if payload is None or payload.get("sub") is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")
    user = db.get(models.User, int(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    # token 版本号：修改密码后旧 token 失效（强制下线其他设备）
    if int(payload.get("ver", 0) or 0) != (user.token_version or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录")
    return user


def touch_ip_region(user: models.User, request: Request, db: Session) -> None:
    """顺手记录/刷新当前访问者的 IP 属地（个人主页与评论上的「IP属地」）。

    - 只存**归属地**这一档粗信息（省 / 国家），不存历史、不存轨迹、不存精确坐标；
    - 按 config.IP_REGION_REFRESH_MINUTES 节流（默认 1 小时），不是每个请求都写库；
    - 任何异常都吞掉：属地只是附加信息，绝不能因为它让正常请求变慢或 500。
    """
    try:
        # 属地固定的账号（管理员官号）不参与 IP 判定：既不查库也不写库，
        # last_ip 也不再记录 —— 固定的意思就是「和你在哪无关」。
        fixed = iplocate.fixed_region(user)
        if fixed:
            # 但「点亮中国」照常算：官号的固定属地就是它的属地
            map_event.note_visit(fixed, user, db)
            return
        ip = client_ip(request)
        if not ip or ip == "unknown":
            return
        last = user.ip_region_at
        if last is not None:
            if last.tzinfo is not None:      # SQLite 读出来是无时区的 UTC
                last = last.astimezone(timezone.utc).replace(tzinfo=None)
            elapsed = models.now().replace(tzinfo=None) - last
            if elapsed < timedelta(minutes=config.IP_REGION_REFRESH_MINUTES):
                # 属地这一轮不刷新，但点亮判断必须照跑：
                # 否则「1 小时内已经访问过」的用户永远点不亮自己那个省
                # （活动 10.1 开始，而他们可能 9 月就来过、被节流跳过）。
                map_event.note_visit(user.ip_region, user, db)
                return
        region = iplocate.region_of(ip)
        user.last_ip = ip[:64]
        if region:                            # 查不到就保留上一次的结果，别把已有属地抹掉
            user.ip_region = region[:50]
        user.ip_region_at = models.now()
        db.commit()
        # 「锦绣山河·点亮中国」：活动期间有该省的用户来访问就点亮这个省
        # （访客由 main.py 的中间件负责；这里能顺手记下「是谁点亮的」）
        map_event.note_visit(user.ip_region, user, db)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def touch_daily(user: models.User, db: Session) -> None:
    """每天一次的杂事（目前只有限时活动奖励）。

    放在这里而不是登录接口里：用户绝大多数时候是「早就登录着、直接打开网站」，
    不会走 /auth/login —— 只在登录接口发，这批人就永远领不到当天的活动奖励。
    **没有活动进行时是纯内存判断，不查库、零开销**（见 events.due_events）。
    异常一律吞掉：活动奖励不能拖垮正常请求。
    """
    try:
        events.grant_due_events(user, db)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """登录用户（含被封禁用户，可浏览）。"""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user = _resolve_user(credentials.credentials, db)
    touch_ip_region(user, request, db)
    touch_daily(user, db)
    return user


def _auto_unban(user: models.User, db: Session) -> models.User:
    """临时封禁到期自动解封。"""
    if user.ban_until:
        bu = user.ban_until
        if bu.tzinfo is None:
            bu = bu.replace(tzinfo=timezone.utc)
        if bu <= models.now():
            user.ban_until = None
            db.commit()
    return user


def get_active_user(
    request: Request,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """可互动的用户（封禁后禁止发帖/评论/点赞/关注等操作）。

    同时承担「账号未激活」的拦截：verify_state 不是 ok 时，**一切写操作**都被拦下
    （发评论、改资料、改密码、创作……），只放行激活自己所需的那几条路径（见 _LOCKED_ALLOW）。
    拦在这一层是因为全站几乎每个写接口都依赖它，改一处即可全覆盖，
    而且不影响任何读接口——未激活用户仍然可以正常浏览。
    """
    user = _auto_unban(user, db)
    if user.effective_banned:
        if user.ban_until:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"你已被封禁至 {user.ban_until.strftime('%Y-%m-%d %H:%M')}，无法进行此操作")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="你已被封禁，无法进行此操作")

    if (user.verify_state or "ok") != "ok":
        path = request.url.path if request is not None else ""
        if not any(path.startswith(p) for p in _LOCKED_ALLOW):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="账号还未激活：请先绑定编程猫账号，或上传护照个人信息页等管理员审核（二者其一即可）",
            )
    return user


def get_current_admin(
    user: models.User = Depends(get_active_user),
) -> models.User:
    """管理员权限校验。"""
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User | None:
    """可选登录：未登录返回 None，登录则返回用户（便于接口返回是否已点赞/收藏等）。"""
    if credentials is None:
        return None
    try:
        user = _resolve_user(credentials.credentials, db)
    except HTTPException:
        return None
    touch_ip_region(user, request, db)
    touch_daily(user, db)
    return user
