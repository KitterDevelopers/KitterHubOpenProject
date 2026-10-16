"""彻底删除一个账号 —— 像从来没存在过一样（管理后台专用）。

★ 不可恢复，所以分两步走：
    preview(db, user)  只统计「会删掉什么」，不动数据
    purge(db, user)    真删；**全部在一个事务里**，中途出错整体回滚

★ 文件删除放在事务提交**之后**：如果先删文件再回滚，文件就找不回来了。

覆盖范围（一个账号到底牵连多少东西，这里逐项列清楚）：
  内容   稿件 / 帖子 / 草稿 / 合集 / 系列 / 收藏夹 / 帖子配图
  互动   点赞 / 收藏 / 表态 / 评分 / 播放历史 / 观看记录（他发出的 + 打在他内容上的）
  社交   关注（两个方向）/ 拉黑 / 好友
  消息   他参与的私聊**整个会话删掉**（对方那边也会消失，否则会留下一个没有对象的会话）；
         群聊只删他发的消息 + 退群，群还在
  工作室 他建的**整体解散**（含讨论群、成员、作品墙、拉黑名单）；他加入的只退成员
  其它   通知 / 举报 / 审核记录 / 版本历史 / 回收站 / 验证码重置记录 / 反馈
  文件   头像 / 背景图 / 稿件封面 / 帖子配图 / 评论配图 / 聊天图片 / 反馈附件 / 护照（私有目录）
  账号   最后删 users 本身

保留：audit_logs（安全审计）**不删**，只把 user_id 置空。
     那是站点的安全记录，删掉等于抹掉「这个人做过什么」的证据；
     而 admin_logs 里他作为管理员的记录会一并删除（本项目不允许删除管理员账号，通常为空）。
"""
from __future__ import annotations

import json
import os

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, select

from . import config, models

T = models.Base.metadata.tables


class PurgeError(RuntimeError):
    """不能删（比如目标不是普通用户）。"""


def _c(table: str, col: str):
    return T[table].c[col]


def _count(db, table: str, *conds) -> int:
    return int(db.execute(select(func.count()).select_from(T[table]).where(*conds)).scalar() or 0)


def _del(db, table: str, *conds) -> int:
    return int(db.execute(sa_delete(T[table]).where(*conds)).rowcount or 0)


def _upd(db, table: str, cond, values: dict) -> int:
    return int(db.execute(T[table].update().where(cond).values(**values)).rowcount or 0)


def _ids(db, table: str, col: str, *conds) -> list[int]:
    return [r[0] for r in db.execute(select(T[table].c[col]).where(*conds)).all()]


def _upload_path(url: str | None, base: str | None = None) -> str | None:
    """把 /uploads/xxx 还原成本地路径；只接受本站上传目录内的文件（防目录穿越）。"""
    if not url or not isinstance(url, str) or not url.startswith("/uploads/"):
        return None
    name = os.path.basename(url)
    if not name:
        return None
    root = base or config.UPLOAD_DIR
    path = os.path.join(root, name)
    return path if os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root) else None


def _collect_files(db, user: models.User) -> list[str]:
    uid = user.id
    out: list[str] = []

    # 用户自己的头像 / 背景图
    for u in (user.avatar_url, user.cover_url):
        p = _upload_path(u)
        if p:
            out.append(p)
    # 护照在私有目录
    if user.passport_file:
        out.append(os.path.join(config.PRIVATE_DIR, os.path.basename(user.passport_file)))

    work_ids = _ids(db, "works", "id", _c("works", "user_id") == uid)
    post_ids = _ids(db, "posts", "id", _c("posts", "user_id") == uid)
    wc_ids = _ids(db, "work_comments", "id", _c("work_comments", "user_id") == uid)
    pc_ids = _ids(db, "post_comments", "id", _c("post_comments", "user_id") == uid)
    studio_ids = _ids(db, "studios", "id", _c("studios", "owner_id") == uid)
    thread_ids = _ids(db, "chat_members", "thread_id", _c("chat_members", "user_id") == uid)

    if work_ids:
        for (url,) in db.execute(select(_c("works", "cover_url")).where(_c("works", "id").in_(work_ids))).all():
            p = _upload_path(url)
            if p:
                out.append(p)
        # Scratch 作品文件在 uploads/games/ 子目录，root 要换成那个目录（basename 才取得到）
        for (url,) in db.execute(select(_c("works", "sb3_url")).where(_c("works", "id").in_(work_ids))).all():
            p = _upload_path(url, config.scratch_dir())
            if p:
                out.append(p)
    if post_ids:
        for (url,) in db.execute(select(_c("posts", "image_url")).where(_c("posts", "id").in_(post_ids))).all():
            p = _upload_path(url)
            if p:
                out.append(p)
    for tbl, ids in (("work_comments", wc_ids), ("post_comments", pc_ids)):
        if ids:
            for (url,) in db.execute(select(_c(tbl, "image_url")).where(_c(tbl, "id").in_(ids))).all():
                p = _upload_path(url)
                if p:
                    out.append(p)
    # 聊天图片：他发的 + 他参与的私聊里的全部
    msg_cond = [_c("chat_messages", "sender_id") == uid]
    if thread_ids:
        msg_cond = [or_(*msg_cond, _c("chat_messages", "thread_id").in_(thread_ids))]
    for (url,) in db.execute(select(_c("chat_messages", "image_url")).where(*msg_cond)).all():
        p = _upload_path(url)
        if p:
            out.append(p)
    # 工作室形象
    if studio_ids:
        for col in ("avatar_url", "cover_url"):
            for (url,) in db.execute(select(_c("studios", col)).where(_c("studios", "id").in_(studio_ids))).all():
                p = _upload_path(url)
                if p:
                    out.append(p)
    # 反馈附件（JSON 数组）
    for (media,) in db.execute(select(_c("feedbacks", "media")).where(_c("feedbacks", "user_id") == uid)).all():
        try:
            items = json.loads(media or "[]")
        except Exception:  # noqa: BLE001
            items = []
        for it in items if isinstance(items, list) else []:
            p = _upload_path((it or {}).get("url"))
            if p:
                out.append(p)

    return sorted({p for p in out if p})


def _steps(db, user: models.User):
    """列出所有要删的 (统计名, 表, 条件)。preview 与 purge 共用，保证「说删什么就删什么」。"""
    uid = user.id
    work_ids = _ids(db, "works", "id", _c("works", "user_id") == uid)
    post_ids = _ids(db, "posts", "id", _c("posts", "user_id") == uid)
    wc_ids = _ids(db, "work_comments", "id", _c("work_comments", "user_id") == uid)
    pc_ids = _ids(db, "post_comments", "id", _c("post_comments", "user_id") == uid)
    coll_ids = _ids(db, "collections", "id", _c("collections", "user_id") == uid)
    series_ids = _ids(db, "series", "id", _c("series", "user_id") == uid)
    folder_ids = _ids(db, "favorite_folders", "id", _c("favorite_folders", "user_id") == uid)
    studio_ids = _ids(db, "studios", "id", _c("studios", "owner_id") == uid)

    # 他参与的聊天会话；其中私聊整体删，群聊只退群 + 删他的消息
    member_threads = _ids(db, "chat_members", "thread_id", _c("chat_members", "user_id") == uid)
    dm_threads = []
    group_threads = []
    if member_threads:
        rows = db.execute(
            select(_c("chat_threads", "id"), _c("chat_threads", "kind")).where(_c("chat_threads", "id").in_(member_threads))
        ).all()
        dm_threads = [r[0] for r in rows if (r[1] or "dm") == "dm"]
        group_threads = [r[0] for r in rows if (r[1] or "dm") != "dm"]

    # 打在他内容上的互动（work / post / comment）
    # ★ 表里不一定有 target_type/target_id（比如 work_ratings 用的是 work_id），
    #   所以先判列存在，否则 _c() 会直接 KeyError。
    def target_cond(table: str):
        t = T[table]
        if "target_type" not in t.c or "target_id" not in t.c:
            return None
        conds = []
        if work_ids:
            conds.append((t.c.target_type == "work") & t.c.target_id.in_(work_ids))
        if post_ids:
            conds.append((t.c.target_type == "post") & t.c.target_id.in_(post_ids))
        if wc_ids:
            conds.append(t.c.target_type.in_(("work_comment", "comment")) & t.c.target_id.in_(wc_ids))
        if pc_ids:
            conds.append(t.c.target_type.in_(("post_comment", "comment")) & t.c.target_id.in_(pc_ids))
        return or_(*conds) if conds else None

    steps = []

    def add(key, desc, table, *conds):
        for cond in conds:
            if cond is None:
                return
        steps.append((key, desc, table, list(conds)))

    # 需要「置空 / 改指向」而不是删除的（保留事件本身，只去掉对已删用户的引用）
    updates = []

    def add_upd(key, desc, table, cond, values):
        if cond is None:
            return
        updates.append((key, desc, table, cond, values))

    # 通知：他收到的 / 他触发的 / 指向他内容的 / 以他为目标的
    # ★ 必须合成**一个 or_**：add() 后面的多个条件是 AND 关系，
    #   第一版把两组条件分开传，结果变成「(他收到的或他触发的) 且 (指向他内容)」，漏删了一大半。
    n_conds = [
        _c("notifications", "user_id") == uid,
        _c("notifications", "actor_id") == uid,
        (_c("notifications", "target_type") == "user") & (_c("notifications", "target_id") == uid),
    ]
    nt = target_cond("notifications")
    if nt is not None:
        n_conds.append(nt)
    add("notifications", "通知", "notifications", or_(*n_conds))

    # 互动（他发出的）
    add("likes_mine", "点赞（他点的）", "likes", _c("likes", "user_id") == uid)
    add("favorites_mine", "收藏（他收的）", "favorites", _c("favorites", "user_id") == uid)
    add("reactions_mine", "表态（他发的）", "reactions", _c("reactions", "user_id") == uid)
    add("ratings_mine", "评分（他打的）", "work_ratings", _c("work_ratings", "user_id") == uid)
    add("history", "播放历史", "play_history", _c("play_history", "user_id") == uid)
    add("views", "观看记录", "work_views", _c("work_views", "user_id") == uid)

    # 打在他内容上的互动（target_type/target_id 那几张表）
    for tbl, key, desc in (("likes", "likes_on_his", "点赞（打在他内容上的）"),
                           ("favorites", "favs_on_his", "收藏（打在他内容上的）"),
                           ("reactions", "reactions_on_his", "表态（打在他内容上的）")):
        add(key, desc, tbl, target_cond(tbl))
    # 评分 / 观看 / 播放历史是按 work_id 直接关联的，不走多态
    if work_ids:
        add("ratings_on_his", "评分（打在他稿件上的）", "work_ratings", _c("work_ratings", "work_id").in_(work_ids))
        add("views_on_his", "观看记录（打在他稿件上的）", "work_views", _c("work_views", "work_id").in_(work_ids))
        add("history_on_his", "播放历史（打在他稿件上的）", "play_history", _c("play_history", "work_id").in_(work_ids))

    # 评论：他写的 + 写在他内容上的
    wc_cond = [_c("work_comments", "user_id") == uid]
    if work_ids:
        wc_cond.append(_c("work_comments", "work_id").in_(work_ids))
    pc_cond = [_c("post_comments", "user_id") == uid]
    if post_ids:
        pc_cond.append(_c("post_comments", "post_id").in_(post_ids))
    add("work_comments", "稿件评论", "work_comments", or_(*wc_cond))
    add("post_comments", "帖子评论", "post_comments", or_(*pc_cond))

    # 社交
    add("follows", "关注关系", "follows",
        or_(_c("follows", "follower_id") == uid, _c("follows", "following_id") == uid))
    add("blocks", "拉黑关系", "user_blocks",
        or_(_c("user_blocks", "blocker_id") == uid, _c("user_blocks", "blocked_id") == uid))
    add("chat_blocks", "聊天拉黑", "chat_blocks",
        or_(_c("chat_blocks", "blocker_id") == uid, _c("chat_blocks", "blocked_id") == uid))
    add("friendships", "好友关系", "friendships",
        or_(_c("friendships", "user_id") == uid, _c("friendships", "friend_id") == uid))

    # 工作室：他建的整间删
    add("studios", "工作室（他建的，整体解散）", "studios", _c("studios", "id").in_(studio_ids) if studio_ids else None)
    if studio_ids:
        for tbl, key, desc in (("studio_members", "sm", "工作室成员"),
                               ("studio_works", "sw", "工作室作品墙"),
                               ("studio_bans", "sb", "工作室黑名单"),
                               ("studio_follows", "sf", "工作室关注")):
            add(key, desc, tbl, _c(tbl, "studio_id").in_(studio_ids))
    add("studio_members_me", "我加入的工作室成员身份", "studio_members", _c("studio_members", "user_id") == uid)
    add("studio_works_mine", "我的稿件在作品墙上的记录", "studio_works",
        _c("studio_works", "work_id").in_(work_ids) if work_ids else None)
    add("studio_bans_me", "工作室拉黑记录", "studio_bans", _c("studio_bans", "user_id") == uid)
    add("studio_follows_me", "工作室关注记录", "studio_follows", _c("studio_follows", "user_id") == uid)

    # 聊天
    if dm_threads:
        add("chat_dm", "私聊会话（连对方的记录一起删）", "chat_threads", _c("chat_threads", "id").in_(dm_threads))
    if member_threads:
        add("chat_members", "聊天会话成员身份", "chat_members", _c("chat_members", "user_id") == uid)
    if dm_threads:
        add("chat_msgs_dm", "私聊消息", "chat_messages", _c("chat_messages", "thread_id").in_(dm_threads))
        add("chat_dm_index", "私聊索引", "chat_dm_index",
            or_(_c("chat_dm_index", "user_a") == uid, _c("chat_dm_index", "user_b") == uid))
    add("chat_msgs_mine", "群聊里他发的消息", "chat_messages", _c("chat_messages", "sender_id") == uid)

    # 他是群主的会话：有别的成员就把群主转给最早加入的那个；一个人都不剩就把群连消息一起删。
    # ★ 注意条件不能只在「他参与的群」里找 —— 他可能是群主但已经退群了，
    #   那种会话同样会留下指向他的 owner_id。
    if "owner_id" in T["chat_threads"].c:
        owned_all = _ids(db, "chat_threads", "id", _c("chat_threads", "owner_id") == uid)
        for tid in owned_all:
            others = _ids(db, "chat_members", "user_id",
                          _c("chat_members", "thread_id") == tid, _c("chat_members", "user_id") != uid)
            if others:
                add_upd("chat_owner_transfer", "群主转让给其他成员", "chat_threads",
                        _c("chat_threads", "id") == tid, {"owner_id": min(others)})
            else:
                add("chat_abandoned", "无人接收的会话（连消息一起删）", "chat_threads", _c("chat_threads", "id") == tid)
                add("chat_abandoned_msgs", "无人接收的会话消息", "chat_messages", _c("chat_messages", "thread_id") == tid)
                add("chat_abandoned_members", "无人接收的会话成员", "chat_members", _c("chat_members", "thread_id") == tid)

    # 内容本体
    add("drafts", "草稿", "drafts", _c("drafts", "user_id") == uid)
    add("series_works", "系列里的稿件", "series_works",
        _c("series_works", "series_id").in_(series_ids) if series_ids else None)
    if work_ids and "work_id" in T["series_works"].c:
        add("series_works_work", "系列里我的稿件", "series_works", _c("series_works", "work_id").in_(work_ids))
    add("series", "作品系列", "series", _c("series", "user_id") == uid)
    add("collection_items", "收藏集条目", "collection_items",
        _c("collection_items", "collection_id").in_(coll_ids) if coll_ids else None)
    add("collection_items_work", "收藏集里我的稿件", "collection_items",
        _c("collection_items", "work_id").in_(work_ids) if work_ids else None)
    add("collections", "收藏集", "collections", _c("collections", "user_id") == uid)
    add("folders", "收藏夹分组", "favorite_folders", _c("favorite_folders", "user_id") == uid)
    add("post_versions", "帖子历史版本", "post_versions",
        _c("post_versions", "post_id").in_(post_ids) if post_ids else None)
    add("work_versions", "稿件历史版本", "work_versions",
        _c("work_versions", "work_id").in_(work_ids) if work_ids else None)
    add("works", "稿件", "works", _c("works", "user_id") == uid)
    add("posts", "帖子", "posts", _c("posts", "user_id") == uid)

    # 举报 / 审核 / 回收站 / 反馈 / 重置记录
    rep = [or_(_c("reports", "reporter_id") == uid)]
    rt = target_cond("reports")
    if rt is not None:
        rep.append(rt)
    rep.append((_c("reports", "target_type") == "user") & (_c("reports", "target_id") == uid))
    add("reports", "举报记录", "reports", or_(*rep))
    cr = target_cond("content_reviews")
    add("content_reviews", "内容审核记录", "content_reviews", cr)
    add("recycle_bin", "回收站记录", "recycle_bin", target_cond("recycle_bin"))
    add("feedbacks", "意见反馈", "feedbacks", _c("feedbacks", "user_id") == uid)
    add("password_resets", "密码重置记录", "password_resets", _c("password_resets", "user_id") == uid)
    add("admin_logs", "管理员操作日志", "admin_logs", _c("admin_logs", "admin_id") == uid)

    # ---- 只置空、不删除的引用 ----
    # 审计日志：站点的安全记录，删掉等于抹掉「这个人做过什么」的证据
    add_upd("audit_logs_actor", "审计日志的操作人置空", "audit_logs",
            _c("audit_logs", "user_id") == uid, {"user_id": None})
    # 邀请人指向他的
    add_upd("invites", "别人记录里的邀请人置空", "users",
            _c("users", "invited_by") == uid, {"invited_by": None})
    # 实名审核人 / 工作室成员与作品审核人：审核这件事发生过，保留记录、只去掉人
    for tname in list(T.keys()):
        if "reviewed_by" in T[tname].c:
            add_upd(f"reviewer_{tname}", f"{tname} 的审核人置空", tname,
                    T[tname].c.reviewed_by == uid, {"reviewed_by": None})

    return steps, updates


def preview(db, user: models.User) -> dict:
    """只统计，不动数据。返回 [{key, desc, count}] 与文件数。"""
    if user.role == "admin":
        raise PurgeError("不能删除管理员账号")
    steps, updates = _steps(db, user)
    items = []
    for key, desc, table, conds in steps:
        n = _count(db, table, *conds)
        if n:
            items.append({"key": key, "desc": desc, "count": n})
    for key, desc, table, cond, _values in updates:
        n = _count(db, table, cond)
        if n:
            items.append({"key": key, "desc": desc + "（只置空，不删记录）", "count": n})
    files = _collect_files(db, user)
    return {
        "uid": user.uid,
        "username": user.username,
        "display_name": user.display_name,
        "items": items,
        "total_rows": sum(i["count"] for i in items),
        "files": len(files),
    }


def purge(db, user: models.User) -> dict:
    """真删。全部在一个事务里，出错整体回滚；文件在提交后才删。"""
    if user.role == "admin":
        raise PurgeError("不能删除管理员账号")

    uid = user.id
    # ★ 身份信息必须在删除**之前**取出来：提交之后这个 ORM 对象已经作废，
    #   再去访问 user.uid / user.username 会抛 ObjectDeletedError。
    ident = {"uid": user.uid, "username": user.username, "display_name": user.display_name}

    steps, updates = _steps(db, user)   # 先算好（里面会查库）
    files = _collect_files(db, user)

    counts = {}
    try:
        for key, _desc, table, conds in steps:
            n = _del(db, table, *conds)
            if n:
                counts[key] = counts.get(key, 0) + n
        # 置空类：保留记录本身，只去掉对已删用户的引用
        for key, _desc, table, cond, values in updates:
            n = _upd(db, table, cond, values)
            if n:
                counts[key] = counts.get(key, 0) + n
        counts["users"] = _del(db, "users", _c("users", "id") == uid)
        db.commit()
    except Exception:
        db.rollback()
        raise

    # 事务成功提交后再删文件
    removed = 0
    for p in files:
        try:
            os.remove(p)
            removed += 1
        except OSError:
            pass

    return {**ident, "rows": counts, "files_removed": removed, "total_rows": sum(counts.values())}
