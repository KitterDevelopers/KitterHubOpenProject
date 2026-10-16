"""KitterHub 首页数据专用接口（仅供 KEHub 客户端/合作伙伴调用）。

GET /api/kh/home
返回三组首页作品数据：
  - featured  官方精选
  - newest    最新投稿
  - hot_week  本周黑马（近 7 天发布，按浏览/点赞/收藏综合得分）

每个作品条目包含：作品ID、作品名、封面、分类、播放量、作者、发布时间、编辑器标记。
响应中 brand 字段标注本接口为 KEHub 专用。
"""
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import config, models, serializers
from ..deps import get_db

router = APIRouter(prefix="/kh", tags=["kh-home"])


def _work_item(w, db) -> dict:
    """轻量作品条目（只做必要的关联查询，控制开销）。"""
    author = None
    if w.author is not None:
        b = serializers.user_brief(w.author)
        author = {
            "uid": b.get("uid"),
            "username": b.get("username"),
            "display_name": b.get("display_name"),
            "avatar_url": b.get("avatar_url"),
        }
    return {
        "id": w.id,
        "title": w.title,
        "cover_url": w.cover_url,
        "category": w.category,
        "views": w.views or 0,
        "editor_code": w.editor_code,
        "is_codemao": w.editor_code in config.EDITOR_CODEMAO_CODES if w.editor_code else False,
        "author": author,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


@router.get("/home")
def kh_home(
    limit_featured: int = 12,
    limit_new: int = 12,
    limit_hot: int = 10,
    db: Session = Depends(get_db),
):
    """首页三大板块数据（匿名可访问，只读）。"""
    featured = (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.is_featured.is_(True))
        .order_by(models.Work.created_at.desc())
        .limit(min(max(limit_featured, 1), 30))
        .all()
    )
    newest = (
        db.query(models.Work)
        .filter(models.Work.status == "published")
        .order_by(models.Work.created_at.desc())
        .limit(min(max(limit_new, 1), 30))
        .all()
    )
    since = models.now() - timedelta(days=7)
    hot_pool = (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.created_at >= since)
        .all()
    )

    def _score(w):
        likes = db.query(models.Like).filter(models.Like.target_type == "work", models.Like.target_id == w.id).count()
        favs = db.query(models.Favorite).filter(models.Favorite.target_type == "work", models.Favorite.target_id == w.id).count()
        return (w.views or 0) + likes * 10 + favs * 8

    hot_pool.sort(key=_score, reverse=True)
    hot_week = hot_pool[: min(max(limit_hot, 1), 30)]

    return {
        "api": "kitterhub-home-blocks",
        "version": 1,
        "brand": "KEHub",
        "dedicated_to": "KEHub",  # 本接口仅供 KEHub 专用
        "note": "KitterHub 首页数据接口：官方精选/最新投稿/本周黑马（只读公开数据，请按需缓存并注明来源 KitterHub）",
        "sections": {
            "featured": [_work_item(w, db) for w in featured],
            "newest": [_work_item(w, db) for w in newest],
            "hot_week": [_work_item(w, db) for w in hot_week],
        },
    }
