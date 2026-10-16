"""删除内容时的关联数据清理：稿件 / 帖子 / 评论。

为什么单独抽一个模块：删除入口有 6 个（用户自己删、管理员删、管理员批量删），
以前每一处都只写 `db.delete(x)`，于是关联表留下一堆指向已删对象的行。
线上实测的悬空外键就是这么来的：
    work_views -> works 55 行、play_history -> works 9 行、work_versions -> works 2 行、
    work_comments/post_comments 的 parent_id 各 3/1 行
（另外 19 行指向已删用户的，是早期 purge 版本留下的，与本模块无关。）

约定：
- 只清关联，**不删本体**（本体由调用方 db.delete，回收站/通知等业务动作也由调用方做）。
- 评论走 ORM 的 cascade（Work.comments / Post.comments 都是 cascade="all, delete-orphan"），
  这里不重复删，否则 SQLAlchemy 会因为「预计删 1 行实际 0 行」报错。
- 评论删除时**不连坐删别人的回复**，而是把回复提升一层挂到被删评论的父级。
"""
from sqlalchemy import delete as sa_delete

from . import models

T = models.Base.metadata.tables


def _has(table: str, col: str) -> bool:
    return table in T and col in T[table].c


def _del(db, table: str, *conds) -> int:
    if table not in T:
        return 0
    return int(db.execute(sa_delete(T[table]).where(*conds)).rowcount or 0)


def _upd(db, table: str, cond, values: dict) -> int:
    return int(db.execute(T[table].update().where(cond).values(**values)).rowcount or 0)


def _poly(table: str, target_type: str, target_id: int):
    """多态关联条件（target_type + target_id）；表里没这两列就返回 None。"""
    if not (_has(table, "target_type") and _has(table, "target_id")):
        return None
    return (T[table].c.target_type == target_type) & (T[table].c.target_id == target_id)


def _drop_poly(db, target_type: str, target_id: int) -> dict:
    """删掉打在这个对象上的点赞 / 收藏 / 表态。"""
    out = {}
    for table in ("likes", "favorites", "reactions"):
        cond = _poly(table, target_type, target_id)
        if cond is not None:
            out[table] = _del(db, table, cond)
    return {k: v for k, v in out.items() if v}


def clean_work_deps(db, work) -> dict:
    """清掉所有指向该稿件的关联行（不含评论，评论由 ORM cascade 处理）。"""
    wid = work.id
    n = _drop_poly(db, "work", wid)
    if _has("work_ratings", "work_id"):
        n["work_ratings"] = _del(db, "work_ratings", T["work_ratings"].c.work_id == wid)
    # 这几张是真正会破坏外键的：work_views / play_history / work_versions
    for table in ("work_views", "play_history", "work_versions", "studio_works", "series_works", "collection_items"):
        if _has(table, "work_id"):
            n[table] = _del(db, table, T[table].c.work_id == wid)
    nc = _poly("notifications", "work", wid)
    if nc is not None:
        n["notifications"] = _del(db, "notifications", nc)
    cr = _poly("content_reviews", "work", wid)
    if cr is not None:
        n["content_reviews"] = _del(db, "content_reviews", cr)
    return {k: v for k, v in n.items() if v}


def clean_post_deps(db, post) -> dict:
    """清掉所有指向该帖子的关联行（不含评论）。"""
    pid = post.id
    n = _drop_poly(db, "post", pid)
    if _has("post_versions", "post_id"):
        n["post_versions"] = _del(db, "post_versions", T["post_versions"].c.post_id == pid)
    nc = _poly("notifications", "post", pid)
    if nc is not None:
        n["notifications"] = _del(db, "notifications", nc)
    cr = _poly("content_reviews", "post", pid)
    if cr is not None:
        n["content_reviews"] = _del(db, "content_reviews", cr)
    return {k: v for k, v in n.items() if v}


def clean_comment_deps(db, comment) -> dict:
    """删评论前：清掉打在它身上的点赞/表态，并把它的回复提升一层。

    ★ 为什么不连坐删回复：回复是别人写的内容，删自己的评论不该顺手删掉别人的回复。
      但要处理 parent_id——否则回复会指向一个不存在的评论（线上已有 4 行这种悬空）。
    """
    is_post = isinstance(comment, models.PostComment)
    table = "post_comments" if is_post else "work_comments"
    n = _drop_poly(db, "post_comment" if is_post else "work_comment", comment.id)
    n["replies_reparented"] = _upd(db, table, T[table].c.parent_id == comment.id, {"parent_id": comment.parent_id})
    return {k: v for k, v in n.items() if v}
