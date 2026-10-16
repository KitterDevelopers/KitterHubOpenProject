"""通知系统：站内通知列表、未读数、已读。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, serializers
from ..deps import get_current_user, get_db

router = APIRouter(prefix="/notifications", tags=["notifications"])

NOTIF_TYPES = {
    "like": "点赞",
    "comment": "评论",
    "reply": "回复",
    "follow": "关注",
    "mention": "提到我",
    "chat_dm": "聊天消息",
    "admin": "系统通知",
    "follow_work": "关注动态",
    "follow_post": "关注动态",
    "studio": "工作室",
    "studio_work": "工作室",
    "studio_approve": "工作室",
}


@router.get("")
def list_notifications(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    type: str | None = None,
    unread: bool = False,
    skip: int = 0,
    limit: int = 30,
):
    query = db.query(models.Notification).filter(models.Notification.user_id == user.id)
    if type and type != "全部":
        # 支持逗号分隔的多个类型（前端把同显示名的类型合并成一组筛选）
        tlist = [x.strip() for x in type.split(",") if x.strip()]
        query = query.filter(models.Notification.type.in_(tlist))
    if unread:
        query = query.filter(models.Notification.is_read.is_(False))
    items = query.order_by(models.Notification.id.desc()).offset(skip).limit(min(limit, 100)).all()
    return [serializers.notification_out(n) for n in items]


@router.get("/types")
def notification_types():
    """按显示名去重分组：如 3 个「工作室」类型合并成一组，返回组内全部 type。"""
    groups: dict[str, list[str]] = {}
    for k, v in NOTIF_TYPES.items():
        groups.setdefault(v, []).append(k)
    return [
        {"type": ks[0], "label": label, "types": ks}
        for label, ks in groups.items()
    ]


@router.get("/unread_count")
def unread_count(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = (
        db.query(models.Notification)
        .filter(models.Notification.user_id == user.id, models.Notification.is_read.is_(False))
        .count()
    )
    return {"count": count}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.get(models.Notification, notification_id)
    if n is None or n.user_id != user.id:
        return {"ok": False}
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/read_all")
def mark_all_read(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(models.Notification).filter(
        models.Notification.user_id == user.id, models.Notification.is_read.is_(False)
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.post("/delete_batch")
def delete_batch(body: dict, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """批量删除通知。"""
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()]
    count = 0
    for nid in ids:
        n = db.get(models.Notification, nid)
        if n is not None and n.user_id == user.id:
            db.delete(n)
            count += 1
    db.commit()
    return {"count": count}


@router.delete("/{notification_id}", status_code=204)
def delete_notification(
    notification_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除单条通知。"""
    n = db.get(models.Notification, notification_id)
    if n is not None and n.user_id == user.id:
        db.delete(n)
        db.commit()
