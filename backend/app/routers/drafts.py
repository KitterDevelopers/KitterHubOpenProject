"""草稿箱：帖子/稿件草稿的保存、读取、复制、删除（同一类型支持多份）。"""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..deps import get_active_user, get_current_user, get_db

router = APIRouter(prefix="/drafts", tags=["drafts"])


def _out(d: models.Draft) -> dict:
    try:
        data = json.loads(d.data or "{}")
    except json.JSONDecodeError:
        data = {}
    return {
        "id": d.id,
        "draft_type": d.draft_type,
        "data": data,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.get("")
def list_drafts(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    drafts = db.query(models.Draft).filter(models.Draft.user_id == user.id).order_by(models.Draft.updated_at.desc()).all()
    return [_out(d) for d in drafts]


@router.get("/{draft_id}")
def get_draft(draft_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = db.get(models.Draft, draft_id)
    if d is None or d.user_id != user.id:
        raise HTTPException(status_code=404, detail="草稿不存在")
    return _out(d)


@router.post("")
def save_draft(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """保存草稿：带 draft_id 则更新该草稿，否则新建一份草稿。"""
    draft_type = body.get("draft_type")
    if draft_type not in ("post", "work"):
        raise HTTPException(status_code=400, detail="无效的草稿类型")
    data = body.get("data") or {}
    draft_id = body.get("draft_id")
    if draft_id:
        d = db.get(models.Draft, int(draft_id))
        if d is None or d.user_id != user.id:
            raise HTTPException(status_code=404, detail="草稿不存在")
        d.data = json.dumps(data, ensure_ascii=False)
    else:
        d = models.Draft(user_id=user.id, draft_type=draft_type, data=json.dumps(data, ensure_ascii=False))
        db.add(d)
    db.commit()
    db.refresh(d)
    return {"ok": True, "id": d.id}


@router.post("/{draft_id}/duplicate")
def duplicate_draft(draft_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """复制一份草稿（另存为新草稿）。"""
    d = db.get(models.Draft, draft_id)
    if d is None or d.user_id != user.id:
        raise HTTPException(status_code=404, detail="草稿不存在")
    new_d = models.Draft(user_id=user.id, draft_type=d.draft_type, data=d.data)
    db.add(new_d)
    db.commit()
    db.refresh(new_d)
    return {"ok": True, "id": new_d.id}


@router.delete("/{draft_id}", status_code=204)
def delete_draft(draft_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    draft = db.get(models.Draft, draft_id)
    if draft is not None and draft.user_id == user.id:
        db.delete(draft)
        db.commit()
