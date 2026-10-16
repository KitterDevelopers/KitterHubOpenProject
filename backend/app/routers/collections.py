"""公开精选集：把喜欢的稿件整理成可分享的专题。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, serializers
from ..deps import get_active_user, get_db, get_optional_user

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("/{collection_id}")
def get_collection(collection_id: int, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    c = db.get(models.Collection, collection_id)
    if c is None:
        raise HTTPException(status_code=404, detail="精选集不存在")
    items = db.query(models.CollectionItem).filter_by(collection_id=collection_id).order_by(models.CollectionItem.id.desc()).all()
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description or "",
        "owner": serializers.user_brief(db.get(models.User, c.user_id)),
        "items": [serializers.work_out(it.work, db, current.id if current else None) for it in items if it.work is not None],
    }


@router.post("/{collection_id}/items")
def add_collection_item(collection_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    c = db.get(models.Collection, collection_id)
    if c is None:
        raise HTTPException(status_code=404, detail="精选集不存在")
    if c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己的精选集")
    work_id = body.get("work_id")
    if not isinstance(work_id, int) or db.get(models.Work, work_id) is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if db.query(models.CollectionItem).filter_by(collection_id=collection_id, work_id=work_id).first() is None:
        db.add(models.CollectionItem(collection_id=collection_id, work_id=work_id))
        db.commit()
    return {"ok": True}


@router.delete("/{collection_id}/items/{work_id}", status_code=204)
def remove_collection_item(collection_id: int, work_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    c = db.get(models.Collection, collection_id)
    if c is None or c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己的精选集")
    db.query(models.CollectionItem).filter_by(collection_id=collection_id, work_id=work_id).delete()
    db.commit()


@router.delete("/{collection_id}", status_code=204)
def delete_collection(collection_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    c = db.get(models.Collection, collection_id)
    if c is None or c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的精选集")
    db.query(models.CollectionItem).filter_by(collection_id=collection_id).delete()
    db.delete(c)
    db.commit()
