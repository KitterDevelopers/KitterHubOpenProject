"""表情回应：对稿件/帖子/评论快速回应（👍❤️😂👏🎉🌹）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..deps import get_active_user, get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/reactions", tags=["reactions"])

VALID_TARGETS = {"work", "post", "work_comment", "post_comment"}
VALID_EMOJIS = {"👍", "❤️", "😂", "👏", "🎉", "🌹"}


def _target_exists(db: Session, target_type: str, target_id: int) -> bool:
    if target_type == "work":
        return db.get(models.Work, target_id) is not None
    if target_type == "post":
        return db.get(models.Post, target_id) is not None
    if target_type == "work_comment":
        return db.get(models.WorkComment, target_id) is not None
    if target_type == "post_comment":
        return db.get(models.PostComment, target_id) is not None
    return False


@router.get("")
def list_reactions(
    target_type: str,
    target_id: int,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    if target_type not in VALID_TARGETS:
        raise HTTPException(status_code=400, detail="无效的目标类型")
    rows = db.query(models.Reaction).filter_by(target_type=target_type, target_id=target_id).all()
    counts: dict[str, int] = {}
    reacted = set()
    for r in rows:
        counts[r.emoji] = counts.get(r.emoji, 0) + 1
        if current and r.user_id == current.id:
            reacted.add(r.emoji)
    result = [{"emoji": e, "count": c, "reacted": e in reacted} for e, c in counts.items()]
    result.sort(key=lambda x: (-x["count"], x["emoji"]))
    return result


@router.post("")
def toggle_reaction(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    target_type = body.get("target_type")
    target_id = body.get("target_id")
    emoji = body.get("emoji")
    if target_type not in VALID_TARGETS:
        raise HTTPException(status_code=400, detail="无效的目标类型")
    if emoji not in VALID_EMOJIS:
        raise HTTPException(status_code=400, detail="不支持的表情")
    if not isinstance(target_id, int) or not _target_exists(db, target_type, target_id):
        raise HTTPException(status_code=404, detail="目标不存在")
    existing = db.query(models.Reaction).filter_by(user_id=user.id, target_type=target_type, target_id=target_id, emoji=emoji).first()
    if existing:
        db.delete(existing)
        db.commit()
        reacted = False
    else:
        # 每目标最多 6 种表情
        my_count = db.query(models.Reaction).filter_by(user_id=user.id, target_type=target_type, target_id=target_id).count()
        if my_count >= 6:
            raise HTTPException(status_code=400, detail="同一内容最多回应 6 种表情")
        db.add(models.Reaction(user_id=user.id, target_type=target_type, target_id=target_id, emoji=emoji))
        db.commit()
        reacted = True
    rows = db.query(models.Reaction).filter_by(target_type=target_type, target_id=target_id).all()
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.emoji] = counts.get(r.emoji, 0) + 1
    result = [{"emoji": e, "count": c, "reacted": e == emoji and reacted} for e, c in counts.items()]
    result.sort(key=lambda x: (-x["count"], x["emoji"]))
    return {"reacted": reacted, "reactions": result}
