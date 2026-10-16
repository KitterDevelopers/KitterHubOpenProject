"""发帖系统：帖子 + 评论(楼中楼) + 点赞 + 浏览 + 通知。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import config, imageurl, iplocate, limits, models, schemas, sensitive, serializers
from .. import cascade
from .. import comments_order
from ..deps import get_active_user, get_current_user, get_optional_user, get_db
from ..ratelimit import client_ip

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("")
def list_posts(
    category: str | None = None,
    topic: str | None = None,
    q: str | None = None,
    author: str | None = None,  # 按作者 uid 过滤（个人主页用）
    sort: str = "new",  # new / hot
    filter: str | None = None,  # featured 只看精华
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    query = db.query(models.Post)
    # 非管理员只看已发布（pending 敏感词待审不展示）
    if current is None or current.role != "admin":
        query = query.filter(models.Post.status == "published")
    if author:
        owner = db.query(models.User).filter(models.User.uid == str(author)).first()
        if owner is None:
            return []
        query = query.filter(models.Post.user_id == owner.id)
    if category and category != "全部":
        query = query.filter(models.Post.category == category)
    if topic:
        query = query.filter(models.Post.topics.contains(topic))
    if filter == "featured":
        query = query.filter(models.Post.is_featured.is_(True))
    if filter == "unanswered":
        query = query.filter(~models.Post.comments.any())
    if q:
        like = f"%{q}%"
        query = query.filter(models.Post.title.like(like) | models.Post.content.like(like))
    if sort == "hot":
        like_count = (
            db.query(models.Like.target_id, func.count(models.Like.id).label("cnt"))
            .filter(models.Like.target_type == "post")
            .group_by(models.Like.target_id)
            .subquery()
        )
        query = query.outerjoin(like_count, models.Post.id == like_count.c.target_id)
        query = query.order_by(models.Post.is_pinned.desc(), (models.Post.views + func.coalesce(like_count.c.cnt, 0) * 10).desc())
    else:
        query = query.order_by(models.Post.is_pinned.desc(), models.Post.created_at.desc())
    posts = query.offset(skip).limit(min(limit, 100)).all()
    return [serializers.post_out(p, db, current.id if current else None) for p in posts]


def _normalize_poll(poll: dict | None) -> str | None:
    """校验并规范化投票数据，返回 JSON 字符串；无效返回 None。支持截止时间 deadline。"""
    import json

    if not poll:
        return None
    question = (poll.get("question") or "").strip()[:50]
    options = [str(o).strip()[:30] for o in poll.get("options") or [] if str(o).strip()]
    if not question or len(options) < 2 or len(options) > 4:
        raise HTTPException(status_code=400, detail="投票需填写问题，并提供 2~4 个选项")
    deadline = None
    if poll.get("deadline"):
        from datetime import datetime as _dt

        try:
            deadline = _dt.fromisoformat(str(poll["deadline"]).replace("Z", "+00:00")).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="投票截止时间格式不正确")
    return json.dumps(
        {
            "question": question,
            "options": [{"id": i, "text": t, "votes": 0, "voter_ids": []} for i, t in enumerate(options)],
            "voted_user_ids": [],
            "deadline": deadline,
        },
        ensure_ascii=False,
    )


@router.get("/topics")
def hot_topics(limit: int = 10, db: Session = Depends(get_db)):
    """热门话题统计。"""
    import re
    from collections import Counter

    rows = db.query(models.Post.topics).filter(models.Post.topics != "").all()
    counter: Counter = Counter()
    for (topics,) in rows:
        for t in (topics or "").split(","):
            if t.strip():
                counter[t.strip()] += 1
    # 补充正文话题（取最近的 300 篇帖子正文）
    recent = db.query(models.Post.content).order_by(models.Post.created_at.desc()).limit(300).all()
    for (content,) in recent:
        for t in serializers.extract_topics(content):
            counter[t] += 1
    return [{"topic": t, "count": c} for t, c in counter.most_common(min(limit, 30))]


@router.post("", status_code=201)
def create_post(
    request: Request,
    body: schemas.PostCreate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    serializers.check_level(db, user, 1, "发布帖子")
    limits.ensure_under_limit(db, models.Post, user.id, config.DAILY_POST_LIMIT, "帖子")
    limits.check_frequency(f"u{user.id}:post")
    # 敏感词：不再硬拒绝，改为入库但标记待审（不展示），进入管理员审核队列（豁免用户不检测）
    sensitive_hits = sensitive.hits(f"{body.title} {body.content}", user, db)
    topics = ",".join(serializers.extract_topics(f"{body.title} {body.content}"))
    post = models.Post(
        user_id=user.id,
        title=body.title.strip(),
        content=body.content,
        status="pending" if sensitive_hits else "published",
        category=body.category or "讨论",
        topics=topics,
        # 发布时的属地快照（个人主页用的是实时属地，两者语义不同）
        ip_region=iplocate.publisher_region(client_ip(request), user),
        poll=_normalize_poll(body.poll),
        image_url=imageurl.check_uploaded_image(body.image_url, "帖子图片"),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    if sensitive_hits:
        serializers.queue_sensitive_review(db, "post", post.id, sensitive_hits, user.id, post.title)
        db.commit()
    serializers.notify_followers(db, user.id, "follow_post", "post", post.id, f"你关注的 {user.display_name} 发布了新帖子《{post.title}》")
    # @提及：通知被 @ 的用户（支持用户名与昵称）
    import re as _re

    for name in set(_re.findall(r"@([^\s@#]{1,20})", f"{body.title} {body.content}")):
        target = db.query(models.User).filter(
            (models.User.username == name) | (models.User.nickname == name)
        ).first()
        if target and target.id != user.id:
            serializers.notify_user(db, target.id, user.id, "mention", "post", post.id, f"{user.display_name} 在帖子《{post.title}》中 @了你")
    # 话题订阅通知：通知订阅了本帖子话题的用户
    if post.topics:
        post_topic_set = set(t for t in post.topics.split(",") if t.strip())
        subscribers = (
            db.query(models.User)
            .filter(models.User.subscribed_topics.isnot(None), models.User.subscribed_topics != "")
            .all()
        )
        for sub in subscribers:
            if sub.id == user.id:
                continue
            mine = set(t for t in (sub.subscribed_topics or "").split(",") if t.strip())
            hit = mine & post_topic_set
            if hit:
                t = next(iter(hit))
                serializers.notify_user(db, sub.id, user.id, "topic", "post", post.id, f"你订阅的话题 #{t}# 有新帖子《{post.title}》")
    return serializers.post_out(post, db, user.id)


@router.get("/{post_id}")
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    # 敏感词待审：仅作者本人或管理员可见
    if post.status != "published" and (current is None or (current.id != post.user_id and current.role != "admin")):
        raise HTTPException(status_code=404, detail="帖子不存在或未发布")
    post.views += 1
    db.commit()
    db.refresh(post)
    return serializers.post_out(post, db, current.id if current else None)


@router.patch("/{post_id}")
def update_post(
    post_id: int,
    body: schemas.PostUpdate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权修改他人帖子")
    changed = False
    if body.title is not None and body.title != post.title:
        changed = True
        post.title = body.title
    if body.content is not None and body.content != post.content:
        changed = True
        post.content = body.content
    if body.category is not None and body.category != post.category:
        post.category = body.category
    if body.poll is not None:
        normalized = _normalize_poll(body.poll)
        if normalized:
            post.poll = normalized
            changed = True
    if body.image_url is not None and body.image_url != (post.image_url or ""):
        post.image_url = imageurl.check_uploaded_image(body.image_url, "帖子图片")
        changed = True
    if changed:
        # 编辑留痕：保存旧版（每帖保留最近 5 版）
        db.add(models.PostVersion(post_id=post.id, title=post.title, content=post.content))
        post.edited_at = models.now()
        old = db.query(models.PostVersion).filter_by(post_id=post.id).order_by(models.PostVersion.id.desc()).offset(5).all()
        for v in old:
            db.delete(v)
    post.topics = ",".join(serializers.extract_topics(f"{post.title} {post.content}"))
    # 编辑后重新检测敏感词：命中则回到待审（不展示），进入审核队列（豁免用户不检测）
    edit_hits = sensitive.hits(f"{post.title} {post.content}", user, db)
    if edit_hits and post.status == "published":
        post.status = "pending"
        db.commit()
        serializers.queue_sensitive_review(db, "post", post.id, edit_hits, user.id, post.title)
        db.refresh(post)
    db.commit()
    db.refresh(post)
    return serializers.post_out(post, db, user.id)


# ---- 投票 ----
@router.post("/{post_id}/comments/{comment_id}/pin")
def pin_post_comment(post_id: int, comment_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """楼主置顶一条优质评论。"""
    post = db.get(models.Post, post_id)
    if post is None or post.user_id != user.id:
        raise HTTPException(status_code=403, detail="仅楼主可置顶评论")
    c = db.get(models.PostComment, comment_id)
    if c is None or c.post_id != post_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    # 同 works.py：先取值再批量清零，否则「取消置顶」取消不掉（批量 update 会同步内存对象）
    want_pinned = not bool(c.pinned)
    db.query(models.PostComment).filter(models.PostComment.post_id == post_id).update(
        {"pinned": False}, synchronize_session=False
    )
    c.pinned = want_pinned
    db.commit()
    return {"pinned": bool(c.pinned)}


@router.post("/{post_id}/poll/vote")
def vote_poll(post_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    import json

    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    poll = post.poll_data
    if not poll:
        raise HTTPException(status_code=400, detail="该帖子没有投票")
    # 投票截止校验
    if poll.get("deadline"):
        try:
            # 统一成带时区的 UTC（<input type="datetime-local"> 传来的串没有时区）
            dl = serializers.parse_dt_utc(poll["deadline"])
            if dl <= models.now():
                raise HTTPException(status_code=400, detail="投票已截止")
        except ValueError:
            pass
    option_id = body.get("option_id")
    option = next((o for o in poll.get("options", []) if o.get("id") == option_id), None)
    if option is None:
        raise HTTPException(status_code=400, detail="选项不存在")
    voted_ids = poll.get("voted_user_ids") or []
    # 可改票：先移除旧票
    for o in poll.get("options", []):
        vids = o.get("voter_ids") or []
        if user.id in vids:
            o["voter_ids"] = [x for x in vids if x != user.id]
            o["votes"] = max(0, (o.get("votes", 0) or 0) - 1)
    if user.id not in voted_ids:
        voted_ids.append(user.id)
    option.setdefault("voter_ids", []).append(user.id)
    option["votes"] = (option.get("votes", 0) or 0) + 1
    poll["voted_user_ids"] = voted_ids
    post.poll = json.dumps(poll, ensure_ascii=False)
    db.commit()
    db.refresh(post)
    return {"poll": serializers.poll_out(post, db, user.id)}


@router.post("/{post_id}/pin")
def toggle_own_pin(post_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """作者置顶自己的帖子（最多 1 个）。"""
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id != user.id:
        raise HTTPException(status_code=403, detail="仅作者可置顶自己的帖子")
    if not post.owner_pinned:
        db.query(models.Post).filter(models.Post.user_id == user.id, models.Post.owner_pinned.is_(True)).update({"owner_pinned": False})
        post.owner_pinned = True
    else:
        post.owner_pinned = False
    db.commit()
    return {"owner_pinned": post.owner_pinned}


@router.post("/{post_id}/favorite")
def favorite_post(post_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """收藏帖子。"""
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    fav = db.query(models.Favorite).filter_by(user_id=user.id, target_type="post", target_id=post_id).first()
    if fav:
        db.delete(fav)
        db.commit()
        return {"favorited": False}
    db.add(models.Favorite(user_id=user.id, target_type="post", target_id=post_id))
    db.commit()
    return {"favorited": True}


@router.post("/{post_id}/feed")
def feed_post(post_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """给帖子投喂小鱼干（1 或 2 个）。

    规则：作者拿到等量小鱼干，并被计为「被投喂」经验（每个 +1，按 feed_count 汇总）；
    投喂者拿到每个 +10 经验，每日上限 50。
    """
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id == user.id:
        raise HTTPException(status_code=400, detail="不能给自己的帖子投喂")
    count = int(body.get("count") or 1)
    if count not in (1, 2):
        raise HTTPException(status_code=400, detail="每次可投喂 1 或 2 个小鱼干")
    if (user.fish_count or 0) < count:
        raise HTTPException(status_code=400, detail="小鱼干不足，每日签到可获得小鱼干")
    user.fish_count = (user.fish_count or 0) - count
    gained_xp = serializers.grant_feed_xp(db, user, count)  # 投喂者经验（每日上限 50）
    author = db.get(models.User, post.user_id)
    if author:
        author.fish_count = (author.fish_count or 0) + count
        serializers.notify_user(db, author.id, user.id, "like", "post", post_id, f"投喂了你 {count} 个小鱼干")
    post.feed_count = (post.feed_count or 0) + count
    db.commit()
    return {"feed_count": post.feed_count, "my_fish": user.fish_count, "xp_gained": gained_xp}


@router.get("/{post_id}/versions")
def my_post_versions(
    post_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """编辑历史：作者本人（或管理员）查看自己的帖子历史版本。"""
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="只能查看自己帖子的编辑历史")
    rows = db.query(models.PostVersion).filter_by(post_id=post_id).order_by(models.PostVersion.id.desc()).limit(20).all()
    return [
        {"id": v.id, "title": v.title, "content": v.content, "created_at": v.created_at.isoformat() if v.created_at else None}
        for v in rows
    ]


@router.delete("/{post_id}", status_code=204)
def delete_post(
    post_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除")
    db.add(models.RecycleBin(target_type="post", target_id=post.id, title=post.title, deleted_by=user.id))
    cascade.clean_post_deps(db, post)  # 先清关联（版本/通知/点赞…），否则会留下悬空行
    db.delete(post)
    db.commit()


# ---- 评论 ----
@router.get("/{post_id}/comments")
def list_comments(
    post_id: int,
    sort: str = "new",  # new 最新 / hot 热评置顶
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    comments = (
        db.query(models.PostComment)
        .filter(models.PostComment.post_id == post_id, models.PostComment.status == "active")
        .order_by(models.PostComment.created_at.asc())
        .all()
    )
    likes_map = None
    if sort == "hot" and comments:
        cids = [c.id for c in comments]
        like_rows = (
            db.query(models.Like.target_id, func.count())
            .filter(models.Like.target_type == "post_comment", models.Like.target_id.in_(cids))
            .group_by(models.Like.target_id)
            .all()
        )
        likes_map = dict(like_rows)
    # 置顶必须真的排到最前（见 comments_order 模块注释）
    comments = comments_order.order_comments(comments, sort, likes_map)
    return [serializers.comment_out(c, db, current.id if current else None) for c in comments]


@router.post("/{post_id}/comments", status_code=201)
def add_comment(
    request: Request,
    post_id: int,
    body: schemas.CommentCreate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    serializers.check_level(db, user, 1, "评论帖子")
    limits.ensure_under_limit(db, models.PostComment, user.id, config.DAILY_COMMENT_LIMIT, "评论")
    limits.check_frequency(f"u{user.id}:postcomment")
    # 敏感词：评论照常入库但标记待审（不展示），进入管理员审核队列（豁免用户不检测）
    comment_sensitive = sensitive.hits(body.content, user, db)

    parent = None
    if body.parent_id is not None:
        parent = db.get(models.PostComment, body.parent_id)
        if parent is None or parent.post_id != post_id:
            raise HTTPException(status_code=400, detail="回复的评论不存在")

    comment = models.PostComment(
        post_id=post_id, user_id=user.id, content=body.content, parent_id=body.parent_id,
        image_url=imageurl.check_uploaded_image(body.image_url, "评论图片"),
        # 评论发表时的属地快照
        ip_region=iplocate.publisher_region(client_ip(request), user),
        status="pending" if comment_sensitive else "active",
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    if comment_sensitive:
        serializers.queue_sensitive_review(db, "post_comment", comment.id, comment_sensitive, user.id, body.content[:30])
        db.commit()

    if parent is not None:
        serializers.notify_user(db, parent.user_id, user.id, "reply", "post", post_id, f"回复了你的评论：{body.content[:50]}")
    else:
        serializers.notify_user(db, post.user_id, user.id, "comment", "post", post_id, f"评论了你的帖子《{post.title}》")
    serializers.notify_mentions(db, user.id, user.display_name, body.content, "post", post_id)
    return serializers.comment_out(comment, db, user.id)


@router.delete("/{post_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    post_id: int,
    comment_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    comment = db.get(models.PostComment, comment_id)
    if comment is None or comment.post_id != post_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    if comment.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除")
    cascade.clean_comment_deps(db, comment)  # 清点赞 + 把回复提升一层，避免 parent_id 悬空
    db.delete(comment)
    db.commit()


# ---- 点赞 ----
@router.post("/{post_id}/like")
def like_post(
    post_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    post = db.get(models.Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    existing = db.query(models.Like).filter_by(user_id=user.id, target_type="post", target_id=post_id).first()
    if existing is None:
        from .. import antispam

        if not antispam.throttle(f"like:post:{user.id}:{post_id}", 60):
            raise HTTPException(status_code=429, detail="操作太频繁，请稍后再试")
        db.add(models.Like(user_id=user.id, target_type="post", target_id=post_id))
        db.commit()
        liked = True
        serializers.notify_user(db, post.user_id, user.id, "like", "post", post_id, f"赞了你的帖子《{post.title}》")
    else:
        db.delete(existing)
        db.commit()
        liked = False
    return {"liked": liked, "like_count": serializers.count_likes(db, "post", post_id)}


# ---- 收藏 ----
@router.post("/{post_id}/favorite")
def favorite_post(
    post_id: int,
    body: dict | None = None,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    if db.get(models.Post, post_id) is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    folder_id = (body or {}).get("folder_id") if isinstance(body, dict) else None
    if folder_id is not None:
        folder = db.query(models.FavoriteFolder).filter_by(id=folder_id, user_id=user.id).first()
        if folder is None:
            raise HTTPException(status_code=400, detail="收藏夹不存在")
    existing = db.query(models.Favorite).filter_by(user_id=user.id, target_type="post", target_id=post_id).first()
    if existing is None:
        db.add(models.Favorite(user_id=user.id, target_type="post", target_id=post_id, folder_id=folder_id))
        db.commit()
        favorited = True
    else:
        db.delete(existing)
        db.commit()
        favorited = False
    return {"favorited": favorited}


# ---- 评论点赞 ----
@router.post("/{post_id}/comments/{comment_id}/like")
def like_post_comment(
    post_id: int,
    comment_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    comment = db.get(models.PostComment, comment_id)
    if comment is None or comment.post_id != post_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    existing = db.query(models.Like).filter_by(user_id=user.id, target_type="post_comment", target_id=comment_id).first()
    if existing is None:
        db.add(models.Like(user_id=user.id, target_type="post_comment", target_id=comment_id))
        db.commit()
        liked = True
    else:
        db.delete(existing)
        db.commit()
        liked = False
    return {"liked": liked, "like_count": serializers.count_likes(db, "post_comment", comment_id)}
