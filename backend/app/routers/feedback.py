"""用户反馈：报 Bug / 提建议（页脚「意见反馈」进入）。游客也可提交。

附件（图片 / 视频）先走 /upload 或 /upload/video 落到本地上传目录，
这里只接收本站上传路径并逐个校验文件确实存在，避免被塞外链或伪造路径。
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import config, models, serializers
from ..deps import get_db, get_optional_user, get_active_user

router = APIRouter(prefix="/feedback", tags=["feedback"])

KINDS = {"bug", "suggestion", "other"}
KIND_LABEL = {"bug": "Bug 反馈", "suggestion": "功能建议", "other": "其他"}
MEDIA_TYPES = {"image", "video"}


class FeedbackIn(BaseModel):
    kind: str = "suggestion"
    title: str = Field(default="", max_length=120)
    content: str = Field(min_length=1, max_length=5000)
    contact: str = Field(default="", max_length=200)
    media: list[dict] = Field(default_factory=list)  # [{type:'image'|'video', url:'/uploads/xx'}]


def _clean_media(raw: list) -> list[dict]:
    """只保留本站 uploads 下真实存在的图片/视频，最多 FEEDBACK_MEDIA_MAX 个。"""
    out: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        kind = str(item.get("type") or "").strip()
        if kind not in MEDIA_TYPES or not url.startswith("/uploads/"):
            continue
        name = os.path.basename(url)
        if not name or name != url[len("/uploads/"):]:
            continue
        if not os.path.isfile(os.path.join(config.UPLOAD_DIR, name)):
            continue
        out.append({"type": kind, "url": f"/uploads/{name}"})
        if len(out) >= config.FEEDBACK_MEDIA_MAX:
            break
    return out


def _parse_media(raw: str | None) -> list[dict]:
    try:
        data = json.loads(raw or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _out(f: models.Feedback) -> dict:
    return {
        "id": f.id,
        "kind": f.kind,
        "kind_label": KIND_LABEL.get(f.kind, f.kind),
        "title": f.title or "",
        "content": f.content,
        "contact": f.contact or "",
        "media": _parse_media(f.media),
        "status": f.status,
        "reply": f.reply,
        "user": serializers.user_brief(f.user) if f.user else None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "handled_at": f.handled_at.isoformat() if f.handled_at else None,
    }


@router.post("", status_code=201)
def create_feedback(
    body: FeedbackIn,
    user: models.User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    kind = body.kind.strip() if body.kind else "suggestion"
    if kind not in KINDS:
        kind = "other"
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="反馈内容不能为空")
    if body.media and not user:
        # 上传接口本身就要登录；这里再兜一道，防止游客引用别人已上传的文件
        raise HTTPException(status_code=400, detail="上传图片 / 视频需要先登录")
    media = _clean_media(body.media)
    item = models.Feedback(
        user_id=user.id if user else None,
        kind=kind,
        title=body.title.strip()[:120],
        content=content[:5000],
        contact=body.contact.strip()[:200],
        media=json.dumps(media, ensure_ascii=False) if media else "",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.get("")
def list_feedback(
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
    limit: int = 100,
):
    """仅管理员可查看全部反馈。"""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可查看反馈")
    rows = (
        db.query(models.Feedback)
        .order_by(models.Feedback.id.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [_out(f) for f in rows]


@router.post("/{feedback_id}/close")
def close_feedback(
    feedback_id: int,
    body: dict | None = None,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """管理员标记已处理 / 重新打开（body: {status: 'done'|'open'}）。"""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    item = db.get(models.Feedback, feedback_id)
    if item is None:
        raise HTTPException(status_code=404, detail="反馈不存在")
    status = (body or {}).get("status") or "done"
    if status not in ("open", "done"):
        raise HTTPException(status_code=400, detail="无效状态")
    item.status = status
    item.handled_at = models.now() if status == "done" else None
    db.commit()
    return {"ok": True, "status": item.status}
