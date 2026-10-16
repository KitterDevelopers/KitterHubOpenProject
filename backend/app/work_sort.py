"""稿件列表排序：发现页与个人主页共用同一套 sort 取值。

站长 2026-09-27：「发现页加上作品排序方式：按时间、热度等，个人主页作品也加上排序」。
所以排序口径只此一处，别再各写一份（发现页原来把 hot 的 join 写在自己函数里，
个人主页干脆写死 created_at desc）。

取值：
  new   最新发布（默认）
  hot   综合热度 = 浏览 + 喜欢×10 + 收藏×5
  likes 喜欢最多
  favs  收藏最多
  views 浏览最多
置顶（is_pinned）在任何排序下都在最前 —— 这是全站既有约定。
"""
from sqlalchemy import func

from . import models

SORT_KEYS = ("new", "hot", "likes", "favs", "views")


def _count_sub(db, model, target_type: str, label: str):
    return (
        db.query(model.target_id, func.count(model.id).label(label))
        .filter(model.target_type == target_type)
        .group_by(model.target_id)
        .subquery()
    )


def order_works(query, db, sort: str = "new", pinned_first: bool = True):
    """给稿件查询套上排序。传进来的 query 应已做完过滤（status/分类/搜索等）。"""
    head = [models.Work.is_pinned.desc()] if pinned_first else []
    if sort == "views":
        return query.order_by(*head, models.Work.views.desc(), models.Work.created_at.desc())
    if sort in ("likes", "favs", "hot"):
        likes = _count_sub(db, models.Like, "work", "cnt")
        favs = _count_sub(db, models.Favorite, "work", "fnt")
        query = query.outerjoin(likes, models.Work.id == likes.c.target_id).outerjoin(
            favs, models.Work.id == favs.c.target_id
        )
        lc = func.coalesce(likes.c.cnt, 0)
        fc = func.coalesce(favs.c.fnt, 0)
        if sort == "likes":
            return query.order_by(*head, lc.desc(), models.Work.created_at.desc())
        if sort == "favs":
            return query.order_by(*head, fc.desc(), models.Work.created_at.desc())
        return query.order_by(
            *head, (models.Work.views + lc * 10 + fc * 5).desc(), models.Work.created_at.desc()
        )
    # new（以及任何未知取值）
    return query.order_by(*head, models.Work.created_at.desc())
