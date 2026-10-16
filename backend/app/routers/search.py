"""全局搜索：稿件 / 帖子 / 用户 / 工作室，支持分类/标签/时间过滤。"""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, serializers
from ..deps import get_db, get_optional_user

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/sensitive/check")
def sensitive_check(text: str = "", db: Session = Depends(get_db)):
    """敏感词实时检查：返回命中的词（前端输入时标红用）。"""
    from .. import sensitive as _s

    hits = _s.find_sensitive(text, db) if text else []
    return {"hits": hits[:10], "ok": not hits}


@router.get("/hot")
def hot_search(limit: int = 10, db: Session = Depends(get_db)):
    """热搜词（云端累计）。"""
    rows = (
        db.query(models.SearchHot)
        .order_by(models.SearchHot.count.desc(), models.SearchHot.updated_at.desc())
        .limit(min(limit, 30))
        .all()
    )
    return [{"keyword": r.keyword, "count": r.count} for r in rows]


@router.get("")
def global_search(
    q: str = "",
    category: str | None = None,
    tag: str | None = None,
    days: int | None = None,
    sort: str = "new",  # new 最新 / hot 最热
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    q = q.strip()
    if q:
        # 记录热搜词（云端）
        row = db.query(models.SearchHot).filter(models.SearchHot.keyword == q).first()
        if row:
            row.count = (row.count or 0) + 1
            row.updated_at = models.now()
        else:
            db.add(models.SearchHot(keyword=q, count=1))
        db.commit()
    like = f"%{q}%" if q else None
    since = models.now() - timedelta(days=days) if days and days > 0 else None

    work_query = db.query(models.Work).filter(models.Work.status == "published")
    post_query = db.query(models.Post).filter(models.Post.status == "published")
    if since is not None:
        work_query = work_query.filter(models.Work.created_at >= since)
        post_query = post_query.filter(models.Post.created_at >= since)
    if like:
        work_query = work_query.filter(models.Work.title.like(like) | models.Work.description.like(like) | models.Work.tags.like(like))
        post_query = post_query.filter(models.Post.title.like(like) | models.Post.content.like(like))
    if category and category != "全部":
        work_query = work_query.filter(models.Work.category == category)
    if tag:
        work_query = work_query.filter(models.Work.tags.like(f"%{tag}%"))

    works = work_query.order_by(models.Work.views.desc() if sort == "hot" else models.Work.created_at.desc()).limit(20).all()
    posts = post_query.order_by(models.Post.views.desc() if sort == "hot" else models.Post.created_at.desc()).limit(20).all()
    users = (
        db.query(models.User)
        .filter(models.User.username.like(like) | models.User.nickname.like(like))
        .limit(20)
        .all()
        if like
        else []
    )
    studios = (
        db.query(models.Studio)
        .filter(models.Studio.status == "active")
        .filter(models.Studio.name.like(like) | models.Studio.description.like(like))
        .limit(20)
        .all()
        if like
        else []
    )

    return {
        "works": [serializers.work_out(w, db, current.id if current else None) for w in works],
        "posts": [serializers.post_out(p, db, current.id if current else None) for p in posts],
        "users": [serializers.user_brief(u) for u in users],
        "studios": [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "cover_url": s.cover_url,
                "member_count": db.query(models.StudioMember).filter_by(studio_id=s.id).count(),
            }
            for s in studios
        ],
    }


@router.get("/suggest")
def suggest(q: str = "", db: Session = Depends(get_db)):
    """搜索联想：热搜 + 标签 + 稿件标题。"""
    q = q.strip()
    if not q:
        return []
    out = []
    seen = set()
    for h in (
        db.query(models.SearchHot)
        .filter(models.SearchHot.keyword.like(f"%{q}%"))
        .order_by(models.SearchHot.count.desc())
        .limit(3)
        .all()
    ):
        if h.keyword not in seen:
            seen.add(h.keyword)
            out.append({"type": "hot", "label": h.keyword})
    rows = db.query(models.Work.tags).filter(models.Work.tags.like(f"%{q}%")).limit(20).all()
    for (tags,) in rows:
        for t in (tags or "").split(","):
            t = t.strip()
            if t and q in t and t not in seen:
                seen.add(t)
                out.append({"type": "tag", "label": t})
        if len(out) >= 6:
            break
    for w in (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.title.like(f"%{q}%"))
        .order_by(models.Work.views.desc())
        .limit(3)
        .all()
    ):
        if w.title[:30] not in seen:
            seen.add(w.title[:30])
            out.append({"type": "work", "label": w.title[:30]})
    return out[:8]


@router.get("/users")
def search_users(q: str = "", limit: int = 8, db: Session = Depends(get_db)):
    """@ 联想用的轻量用户搜索（按用户名/昵称模糊匹配）。"""
    q = q.strip()
    if not q:
        return []
    like = f"%{q}%"
    users = (
        db.query(models.User)
        .filter(models.User.username.like(like) | models.User.nickname.like(like))
        .order_by(models.User.id.asc())
        .limit(min(limit, 20))
        .all()
    )
    return [serializers.user_brief(u) for u in users]
