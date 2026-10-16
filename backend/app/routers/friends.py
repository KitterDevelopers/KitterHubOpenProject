"""好友系统：请求 / 接受 / 列表 / 移除（对外统一使用用户ID uid）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, serializers
from ..deps import get_active_user, get_current_user, get_db

router = APIRouter(prefix="/friends", tags=["friends"])


def _user_by_uid(db: Session, uid: str) -> models.User | None:
    return db.query(models.User).filter(models.User.uid == uid).first()


@router.get("")
def my_friends(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.Friendship).filter_by(user_id=user.id, status="active").all()
    return [serializers.user_brief(db.get(models.User, r.friend_id)) for r in rows if db.get(models.User, r.friend_id) is not None]


@router.get("/requests")
def friend_requests(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.Friendship).filter_by(friend_id=user.id, status="pending").all()
    return [serializers.user_brief(db.get(models.User, r.user_id)) for r in rows if db.get(models.User, r.user_id) is not None]


@router.post("/{uid}/request")
def send_friend_request(uid: str, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None or target.is_deactivated:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="不能加自己为好友")
    tid = target.id
    existing = db.query(models.Friendship).filter_by(user_id=user.id, friend_id=tid).first()
    reverse = db.query(models.Friendship).filter_by(user_id=tid, friend_id=user.id).first()
    if existing and existing.status == "active":
        return {"status": "active"}
    if reverse and reverse.status == "pending":
        reverse.status = "active"
        db.add(models.Friendship(user_id=user.id, friend_id=tid, status="active"))
        db.commit()
        serializers.notify_user(db, tid, user.id, "admin", None, None, f"{user.display_name} 接受了你的好友请求，你们已成为好友！")
        return {"status": "active"}
    if existing is None:
        db.add(models.Friendship(user_id=user.id, friend_id=tid, status="pending"))
        db.commit()
        serializers.notify_user(db, tid, user.id, "admin", None, None, f"{user.display_name} 请求添加你为好友")
    return {"status": "pending"}


@router.post("/{uid}/accept")
def accept_friend(uid: str, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    tid = target.id
    row = db.query(models.Friendship).filter_by(user_id=tid, friend_id=user.id, status="pending").first()
    if row is None:
        raise HTTPException(status_code=404, detail="没有该好友请求")
    row.status = "active"
    if db.query(models.Friendship).filter_by(user_id=user.id, friend_id=tid).first() is None:
        db.add(models.Friendship(user_id=user.id, friend_id=tid, status="active"))
    db.commit()
    serializers.notify_user(db, tid, user.id, "admin", None, None, f"{user.display_name} 接受了你的好友请求，你们已成为好友！")
    return {"ok": True}


@router.delete("/{uid}", status_code=204)
def remove_friend(uid: str, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    tid = target.id
    db.query(models.Friendship).filter(
        ((models.Friendship.user_id == user.id) & (models.Friendship.friend_id == tid))
        | ((models.Friendship.user_id == tid) & (models.Friendship.friend_id == user.id))
    ).delete()
    db.commit()
