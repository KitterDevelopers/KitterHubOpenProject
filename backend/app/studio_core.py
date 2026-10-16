"""工作室领域逻辑：角色权限、加入规则、批量序列化、通知。

从 routers/studios.py 里抽出来，目的：
- 权限判断只写一份（原来每个接口都手抄一遍 `if me is None or me.role not in (...)`）
- 列表/详情一次性把计数查出来（原来 _studio_out 每个工作室要跑 8~10 条 SQL）
- 修掉等级判断的 bug（原来 _user_level 既忽略 xp_bonus 又漏了条约门槛）
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import chat_core, models, sensitive, serializers

STUDIO_CATEGORIES = ["综合", "游戏", "美术", "音乐"]
MAX_STUDIOS = 3   # 每人最多同时加入（含待审核）
PIN_LIMIT = 3     # 作品墙最多置顶数量

ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
MANAGER_ROLES = (ROLE_OWNER, ROLE_ADMIN)

STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_REJECTED = "rejected"   # 仅用于 StudioWork


class StudioError(Exception):
    """带 HTTP 状态码的领域异常，由路由层转成 HTTPException。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def fail(status_code: int, detail: str):
    raise StudioError(status_code, detail)


# --------------------------------------------------------------------------
# 成员与权限
# --------------------------------------------------------------------------
def membership(db: Session, studio_id: int, user_id: int | None) -> models.StudioMember | None:
    if not user_id:
        return None
    return db.query(models.StudioMember).filter_by(studio_id=studio_id, user_id=user_id).first()


def memberships_for(db: Session, user_id: int | None, studio_ids: list[int]) -> dict[int, models.StudioMember]:
    """一次把我在这批工作室里的成员记录全查出来。"""
    if not user_id or not studio_ids:
        return {}
    rows = (
        db.query(models.StudioMember)
        .filter(models.StudioMember.user_id == user_id, models.StudioMember.studio_id.in_(studio_ids))
        .all()
    )
    return {m.studio_id: m for m in rows}


def require_manager(db: Session, studio_id: int, user_id: int) -> models.StudioMember:
    me = membership(db, studio_id, user_id)
    if me is None or me.status != STATUS_ACTIVE or me.role not in MANAGER_ROLES:
        fail(403, "仅室长或管理员可操作")
    return me


def require_owner(db: Session, studio_id: int, user_id: int) -> models.StudioMember:
    me = membership(db, studio_id, user_id)
    if me is None or me.status != STATUS_ACTIVE or me.role != ROLE_OWNER:
        fail(403, "仅室长可操作")
    return me


def require_active_member(db: Session, studio_id: int, user_id: int) -> models.StudioMember:
    me = membership(db, studio_id, user_id)
    if me is None or me.status != STATUS_ACTIVE:
        fail(403, "请先加入工作室")
    return me


def get_studio_or_404(db: Session, studio_id: int, current: models.User | None = None) -> models.Studio:
    studio = db.get(models.Studio, studio_id)
    if studio is None:
        fail(404, "工作室不存在")
    if studio.status == "banned" and (current is None or current.role != "admin"):
        fail(404, "工作室不存在")
    return studio


def joined_studio_count(db: Session, user_id: int) -> int:
    """当前用户占用的名额（active + pending）。"""
    return (
        db.query(func.count(models.StudioMember.id))
        .filter(
            models.StudioMember.user_id == user_id,
            models.StudioMember.status.in_([STATUS_ACTIVE, STATUS_PENDING]),
        )
        .scalar()
        or 0
    )


# --------------------------------------------------------------------------
# 等级与加入规则
# --------------------------------------------------------------------------
def user_level(db: Session, user: models.User) -> int:
    """真实等级：走 serializers.user_xp（含 xp_bonus）+ 条约门槛。

    旧实现自己重算了一遍经验并且漏掉了 xp_bonus，还把 compute_level 的
    treaty 参数留空，导致没签条约的人一律算成 Lv.0、签了的人少算经验，
    min_level 门槛两个方向都是错的。
    """
    xp = serializers.user_xp(db, user)
    return serializers.compute_level(xp, bool(user.treaty_signed_at))


def member_limit_for_level(level: int) -> int:
    return {4: 30, 5: 50, 6: 80, 7: 120}.get(level, 50)


def multi_studio_block(db: Session, studio: models.Studio, user: models.User) -> str | None:
    """多室籍规则：返回拒绝原因或 None。"""
    others = (
        db.query(models.StudioMember)
        .filter(models.StudioMember.user_id == user.id, models.StudioMember.status == STATUS_ACTIVE)
        .all()
    )
    others = [m for m in others if m.studio_id != studio.id]
    if not others:
        return None
    if studio.multi_studio_only:
        return "本工作室禁止多室籍：请先退出其他工作室再加入"
    other_ids = [m.studio_id for m in others]
    blocked = (
        db.query(models.Studio)
        .filter(models.Studio.id.in_(other_ids), models.Studio.multi_studio_only.is_(True))
        .first()
    )
    if blocked is not None:
        return f"你所在的『{blocked.name}』工作室禁止多室籍，请先退出再加入"
    return None


# --------------------------------------------------------------------------
# 批量计数与序列化
# --------------------------------------------------------------------------
def _empty_counts() -> dict:
    return {
        "member_count": 0, "pending_count": 0,
        "work_count": 0, "pending_work_count": 0,
        "follow_count": 0, "total_views": 0,
    }


def counts_for(db: Session, studio_ids: list[int]) -> dict[int, dict]:
    """一次性把这批工作室的各项计数查出来（原来是一个工作室 8~10 条 SQL）。"""
    data = {sid: _empty_counts() for sid in studio_ids}
    if not studio_ids:
        return data

    def group(query, key, field):
        for sid, n in query.filter(key.in_(studio_ids)).group_by(key).all():
            if sid in data:
                data[sid][field] = int(n or 0)

    group(
        db.query(models.StudioMember.studio_id, func.count(models.StudioMember.id))
        .filter(models.StudioMember.status == STATUS_ACTIVE),
        models.StudioMember.studio_id, "member_count",
    )
    group(
        db.query(models.StudioMember.studio_id, func.count(models.StudioMember.id))
        .filter(models.StudioMember.status == STATUS_PENDING),
        models.StudioMember.studio_id, "pending_count",
    )
    group(
        db.query(models.StudioWork.studio_id, func.count(models.StudioWork.id))
        .filter(models.StudioWork.status == STATUS_ACTIVE),
        models.StudioWork.studio_id, "work_count",
    )
    group(
        db.query(models.StudioWork.studio_id, func.count(models.StudioWork.id))
        .filter(models.StudioWork.status == STATUS_PENDING),
        models.StudioWork.studio_id, "pending_work_count",
    )
    group(
        db.query(models.StudioFollow.studio_id, func.count(models.StudioFollow.id)),
        models.StudioFollow.studio_id, "follow_count",
    )
    group(
        db.query(models.StudioWork.studio_id, func.coalesce(func.sum(models.Work.views), 0))
        .join(models.Work, models.Work.id == models.StudioWork.work_id)
        .filter(models.StudioWork.status == STATUS_ACTIVE),
        models.StudioWork.studio_id, "total_views",
    )
    return data


def discussion_thread(db: Session, studio_id: int) -> models.ChatThread | None:
    return chat_core.studio_thread(db, studio_id)


def studio_out(
    db: Session,
    studio: models.Studio,
    current_user_id: int | None = None,
    counts: dict | None = None,
    me: models.StudioMember | None = None,
    include_rooms: bool = True,
) -> dict:
    """把一个工作室序列化成前端要的形状。counts / me 可外部批量预取。"""
    c = counts or counts_for(db, [studio.id]).get(studio.id, _empty_counts())
    if me is None:
        me = membership(db, studio.id, current_user_id)

    is_followed = False
    if current_user_id:
        is_followed = (
            db.query(models.StudioFollow.id)
            .filter_by(user_id=current_user_id, studio_id=studio.id)
            .first()
            is not None
        )

    data = {
        "id": studio.id,
        "name": studio.name,
        "description": studio.description or "",
        "announcement": studio.announcement or "",
        "avatar_url": studio.avatar_url,
        "cover_url": studio.cover_url,
        "join_mode": studio.join_mode,
        "category": studio.category,
        "status": studio.status,
        "entry_rules": studio.entry_rules_dict,
        "min_level": int(studio.min_level or 0),
        "multi_studio_only": bool(studio.multi_studio_only),
        "apply_required": bool(studio.apply_required),
        "my_studio_count": joined_studio_count(db, current_user_id) if current_user_id else 0,
        "max_studios": MAX_STUDIOS,
        "owner": serializers.user_brief(studio.owner) if studio.owner else None,
        "member_count": c["member_count"],
        "member_limit": studio.member_limit or 50,
        "is_full": c["member_count"] >= (studio.member_limit or 50),
        "pending_count": c["pending_count"],
        "work_count": c["work_count"],
        "pending_work_count": c["pending_work_count"],
        "total_views": c["total_views"],
        "follow_count": c["follow_count"],
        "is_followed": is_followed,
        "pending_owner_id": studio.pending_owner_id,
        "my_role": me.role if me else None,
        "my_status": me.status if me else None,
        "my_muted": bool(me.muted) if me else False,
        "can_manage": bool(me and me.status == STATUS_ACTIVE and me.role in MANAGER_ROLES),
        "is_owner": bool(me and me.status == STATUS_ACTIVE and me.role == ROLE_OWNER),
        "created_at": studio.created_at,
    }
    if me and me.status == STATUS_ACTIVE and me.role in MANAGER_ROLES:
        data["invite_code"] = studio.invite_code
    if include_rooms:
        thread = discussion_thread(db, studio.id)
        if thread is not None:
            member_count = db.query(func.count(models.ChatMember.id)).filter_by(thread_id=thread.id).scalar() or 0
            data["rooms"] = [{
                "id": thread.id,
                "name": thread.title,
                "description": thread.announcement or "",
                "member_count": int(member_count),
                "mute_all_until": thread.mute_all_until,
            }]
            data["discussion_room_id"] = thread.id
        else:
            data["rooms"] = []
            data["discussion_room_id"] = None
    return data


def studios_out(db: Session, studios: list[models.Studio], current_user_id: int | None) -> list[dict]:
    """批量版：整个列表只跑固定几条 SQL。"""
    ids = [s.id for s in studios]
    counts = counts_for(db, ids)
    me_map = memberships_for(db, current_user_id, ids)
    return [
        studio_out(db, s, current_user_id, counts=counts.get(s.id), me=me_map.get(s.id))
        for s in studios
    ]


# --------------------------------------------------------------------------
# 通知
# --------------------------------------------------------------------------
def notify_admins(db: Session, studio: models.Studio, content: str, actor_id: int | None,
                  target_type: str | None = None, target_id: int | None = None) -> None:
    rows = (
        db.query(models.StudioMember.user_id)
        .filter(
            models.StudioMember.studio_id == studio.id,
            models.StudioMember.status == STATUS_ACTIVE,
            models.StudioMember.role.in_(MANAGER_ROLES),
        )
        .all()
    )
    for (uid,) in rows:
        serializers.notify_user(db, uid, actor_id, "studio", target_type, target_id, content)


def notify_followers(db: Session, studio: models.Studio, content: str, actor_id: int | None) -> None:
    rows = db.query(models.StudioFollow.user_id).filter_by(studio_id=studio.id).all()
    for (uid,) in rows:
        serializers.notify_user(db, uid, actor_id, "studio", "studio", studio.id, content)


# --------------------------------------------------------------------------
# 讨论群同步
# --------------------------------------------------------------------------
def sync_discussion(db: Session, studio_id: int, user_id: int, join: bool, role: str = ROLE_MEMBER) -> None:
    chat_core.sync_studio_member(db, studio_id, user_id, join=join, role=role)


def check_text(db: Session, text: str, what: str) -> None:
    """统一的敏感词校验。"""
    if text and sensitive.contains_sensitive(text, db):
        hits = sensitive.find_sensitive(text, db)
        fail(400, f"{what}包含敏感词：{'、'.join(hits[:5])}，请修改")
