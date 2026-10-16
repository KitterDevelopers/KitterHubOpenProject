"""发现页：稿件浏览/搜索/标签/排行/关注动态。"""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import config, models, serializers, work_sort
from ..deps import get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/discover", tags=["discover"])

WORK_CATEGORIES = ["全部", "游戏", "动画", "故事", "音乐", "绘画", "数学", "科学", "其他"]


@router.get("/categories")
def categories():
    return WORK_CATEGORIES


@router.get("/tags")
def popular_tags(limit: int = 30, db: Session = Depends(get_db)):
    counts: dict[str, int] = {}
    for (tags,) in db.query(models.Work.tags).filter(models.Work.tags != "").all():
        for t in [x.strip() for x in tags.split(",") if x.strip()]:
            counts[t] = counts.get(t, 0) + 1
    sorted_tags = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    return [{"name": k, "count": v} for k, v in sorted_tags]


@router.get("/random")
def random_work(
    exclude: int | None = None,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """随机来一个**已上架**作品（发现页「随机看看」用）。

    `exclude` 传当前作品 id 可以避免连着两次抽到同一个 —— 前端连点时会带上上一次的结果。
    只返回一条，代价是 SQLite 上 order by random() 需要扫一遍已上架稿件；
    本站这个量级（几十到几千）完全没问题，真到十万级再换「随机起点 + 取一条」的写法。
    """
    from fastapi import HTTPException

    q = db.query(models.Work).filter(models.Work.status == "published")
    if exclude:
        q = q.filter(models.Work.id != int(exclude))
    work = q.order_by(func.random()).first()
    if work is None:
        raise HTTPException(status_code=404, detail="还没有已上架的稿件")
    return serializers.work_out(work, db, current.id if current else None)


@router.get("/works")
def discover_works(    q: str | None = None,
    category: str | None = None,
    tag: str | None = None,
    editor: str | None = None,  # codemao=全部编程猫作品；scratch=Scratch 作品；或具体编辑器 code（KN/kitten4/kitten3/coco/nemo）
    origin: str | None = None,  # original=只要原创（非转载）；repost=只要转载
    sort: str = "new",  # new / hot
    skip: int = 0,
    limit: int = 24,
    with_total: bool = False,  # 为 True 时返回 {items, total, skip, limit}，供分页使用
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    query = db.query(models.Work).filter(models.Work.status == "published")
    if q:
        like = f"%{q}%"
        query = query.filter(
            models.Work.title.like(like) | models.Work.description.like(like) | models.Work.tags.like(like)
        )
    if category and category != "全部":
        query = query.filter(models.Work.category == category)
    if tag:
        query = query.filter(models.Work.tags.like(f"%{tag}%"))
    # 作品来源：原创 = 非转载。站长 2026-09-27 要的筛选项。
    if origin == "original":
        query = query.filter(models.Work.is_repost.is_(False))
    elif origin == "repost":
        query = query.filter(models.Work.is_repost.is_(True))
    if editor:
        if editor == "codemao":
            query = query.filter(models.Work.editor_code.in_(config.EDITOR_CODEMAO_CODES))
        elif editor == "scratch":
            # ⚠️ Scratch 作品在库里是 work_type='scratch'，**editor_code 是空的** ——
            # 按 editor_code == 'scratch' 过滤会一件都查不到（上传 .sb3 的稿件都长这样）。
            query = query.filter(models.Work.work_type == "scratch")
        else:
            query = query.filter(models.Work.editor_code == editor)

    # 排序口径统一在 app/work_sort.py（发现页 / 个人主页共用）：
    # new 最新 / hot 综合热度 / likes 喜欢最多 / favs 收藏最多 / views 浏览最多
    query = work_sort.order_works(query, db, sort)

    page_size = max(1, min(limit, 100))
    skip = max(0, skip)
    total = query.count() if with_total else 0
    works = query.offset(skip).limit(page_size).all()
    items = [serializers.work_out(w, db, current.id if current else None) for w in works]
    if with_total:
        return {"items": items, "total": total, "skip": skip, "limit": page_size}
    return items


# ---- 首页聚合 ----
@router.get("/home")
def home_data(
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """编程猫式首页：轮播 Banner + 官方精选 + 大家都在玩 + 最新投稿 + 关注动态。"""
    me = current.id if current else None
    # 1. 轮播 Banner
    banners = (
        db.query(models.Banner)
        .filter(models.Banner.enabled.is_(True))
        .order_by(models.Banner.sort_order.asc(), models.Banner.id.desc())
        .limit(8)
        .all()
    )
    # 2. 官方精选
    featured = (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.is_featured.is_(True))
        .order_by(models.Work.created_at.desc())
        .limit(12)
        .all()
    )
    # 2.5 推荐位帖子（官方精选帖）
    featured_posts = (
        db.query(models.Post)
        .filter(models.Post.is_featured.is_(True), models.Post.status == "published")
        .order_by(models.Post.created_at.desc())
        .limit(5)
        .all()
    )
    # 3. 大家都在玩（热度加权）
    hot = (
        db.query(models.Work)
        .filter(models.Work.status == "published")
        .order_by(models.Work.views.desc())
        .limit(40)
        .all()
    )
    hot.sort(key=lambda w: (w.views + serializers.count_likes(db, "work", w.id) * 10), reverse=True)
    hot = hot[:12]
    # 4. 最新投稿
    newest = (
        db.query(models.Work)
        .filter(models.Work.status == "published")
        .order_by(models.Work.created_at.desc())
        .limit(12)
        .all()
    )
    # 4.5 编程猫专区（最新编程猫编辑器作品）
    codemao = (
        db.query(models.Work)
        .filter(
            models.Work.status == "published",
            models.Work.editor_code.in_(config.EDITOR_CODEMAO_CODES),
        )
        .order_by(models.Work.created_at.desc())
        .limit(12)
        .all()
    )
    # 5. 热门话题
    import re as _re
    from collections import Counter

    counter: Counter = Counter()
    for (topics,) in db.query(models.Post.topics).filter(models.Post.topics != "").limit(300).all():
        for t in (topics or "").split(","):
            if t.strip():
                counter[t.strip()] += 1
    topics = [{"topic": t, "count": c} for t, c in counter.most_common(8)]
    # 6. 猜你喜欢（个性化）—— 重做过一版。老实现的实测毛病（用户 2，61 赞 14 关注）：
    #    · 12 条里 11 条是他已经赞过的；· 12 条全是同一个分类（他明明互动过 8 个分类）；
    #    · 同一作者占 4 席；· 候选池只有"最新 200 件"，老作品永远进不来。
    #    现在：候选池 = 近 90 天 + 全站播放量前 200（合并去重）；
    #         质量分 = 归一化(播放 + 点赞×10 + 收藏×8) ×2 + 新鲜度 ×1.5；
    #         个性化 = 近期互动分类（按互动时间半衰期 60 天衰减，最多 +3）+ 关注作者 +4；
    #         并排除自己的 / 已赞 / 已收藏 / 已看过，同一作者最多 2 席。
    for_you = hot  # 未登录时退化为热度榜
    if current:
        try:
            from datetime import timedelta as _td
            from sqlalchemy import func as _func

            def _naive(dt):
                # ⚠️ models.now() 是带时区的，数据库列是不带时区的：
                #    直接 now_ts - w.created_at 会抛
                #    TypeError: can't subtract offset-naive and offset-aware datetimes
                return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo is not None else dt

            now_ts = _naive(models.now())
            recent_pool = (
                db.query(models.Work)
                .filter(models.Work.status == "published", models.Work.created_at >= now_ts - _td(days=90))
                .order_by(models.Work.created_at.desc())
                .limit(300)
                .all()
            )
            top_pool = (
                db.query(models.Work)
                .filter(models.Work.status == "published")
                .order_by(models.Work.views.desc())
                .limit(200)
                .all()
            )
            pool_map = {w.id: w for w in top_pool}
            pool_map.update({w.id: w for w in recent_pool})
            pool = list(pool_map.values())

            # 互动记录：(作品 id, 时间, 权重)。收藏比点赞更"重"，播放最轻。
            interactions = []
            for r in (
                db.query(models.Like)
                .filter(models.Like.user_id == current.id, models.Like.target_type == "work")
                .all()
            ):
                interactions.append((r.target_id, _naive(r.created_at), 1.0))
            for r in (
                db.query(models.Favorite)
                .filter(models.Favorite.user_id == current.id, models.Favorite.target_type == "work")
                .all()
            ):
                interactions.append((r.target_id, _naive(r.created_at), 1.5))
            # 只取最近 300 条浏览：半衰期 60 天，更早的互动对分类偏好几乎没影响，
            # 但历史表可能几千行，全量拉取会拖慢接口
            for r in (
                db.query(models.PlayHistory)
                .filter(models.PlayHistory.user_id == current.id)
                .order_by(models.PlayHistory.viewed_at.desc())
                .limit(300)
                .all()
            ):
                interactions.append((r.work_id, _naive(r.viewed_at), 0.5))
            seen_ids = {wid for wid, _t, _w in interactions}

            # 分类偏好：越近的互动越重（半衰期 60 天）
            cat_weight = {}
            if interactions:
                # ⚠️ 必须分批：互动记录多的用户（几百上千条）一次性塞进 IN(...) 会撞
                # SQLite 的变量上限（too many SQL variables），整段逻辑会被 except 吞掉、
                # 悄悄退化成热度榜 —— 这正是第一次改完出现的问题。
                cmap = {}
                iids = [wid for wid, _t, _w in interactions]
                for i in range(0, len(iids), 400):
                    cmap.update(dict(
                        db.query(models.Work.id, models.Work.category)
                        .filter(models.Work.id.in_(iids[i:i + 400]))
                        .all()
                    ))
                for wid, when, wgt in interactions:
                    cat = cmap.get(wid)
                    if not cat or not when:
                        continue
                    days = max(0.0, (now_ts - when).total_seconds() / 86400.0)
                    cat_weight[cat] = cat_weight.get(cat, 0.0) + wgt * (0.5 ** (days / 60.0))

            followed_ids = {
                f.following_id
                for f in db.query(models.Follow).filter(models.Follow.follower_id == current.id).all()
            }

            # 点赞/收藏数批量聚合（绝不在循环里逐条 count，否则池子一放大会拖慢接口）
            ids = [w.id for w in pool]
            like_cnt, fav_cnt = {}, {}
            for i in range(0, len(ids), 400):
                chunk = ids[i:i + 400]
                like_cnt.update(dict(
                    db.query(models.Like.target_id, _func.count())
                    .filter(models.Like.target_type == "work", models.Like.target_id.in_(chunk))
                    .group_by(models.Like.target_id)
                    .all()
                ))
                fav_cnt.update(dict(
                    db.query(models.Favorite.target_id, _func.count())
                    .filter(models.Favorite.target_type == "work", models.Favorite.target_id.in_(chunk))
                    .group_by(models.Favorite.target_id)
                    .all()
                ))
            pop_max = max(
                ((w.views or 0) + like_cnt.get(w.id, 0) * 10 + fav_cnt.get(w.id, 0) * 8) for w in pool
            ) or 1

            def _score(w):
                pop = ((w.views or 0) + like_cnt.get(w.id, 0) * 10 + fav_cnt.get(w.id, 0) * 8) / pop_max
                age = (now_ts - _naive(w.created_at)).total_seconds() / 86400.0 if w.created_at else 999.0
                fresh = max(0.0, 1.0 - age / 90.0)
                sc = pop * 2.0 + fresh * 1.5
                cw = cat_weight.get(w.category or "", 0.0)
                if cw > 0:
                    sc += 3.0 * min(1.0, cw)
                if w.user_id in followed_ids:
                    sc += 4.0
                return sc

            candidates = [w for w in pool if w.user_id != current.id and w.id not in seen_ids]
            candidates.sort(key=_score, reverse=True)
            picked, per_author = [], {}
            for w in candidates:
                if per_author.get(w.user_id, 0) >= 2:   # 同一作者最多 2 席
                    continue
                per_author[w.user_id] = per_author.get(w.user_id, 0) + 1
                picked.append(w)
                if len(picked) >= 12:
                    break
            if picked:
                for_you = picked
        except Exception:
            # 不能静默吞：出过"用户只看到热度榜、没人知道为什么"的事故
            import traceback
            traceback.print_exc()
            for_you = hot
    return {
        "banners": [serializers.banner_out(b, db) for b in banners],
        "featured": [serializers.work_out(w, db, me) for w in featured],
        "featured_posts": [serializers.post_out(p, db, me) for p in featured_posts],
        "for_you": [serializers.work_out(w, db, me) for w in for_you],
        "hot": [serializers.work_out(w, db, me) for w in hot],
        "newest": [serializers.work_out(w, db, me) for w in newest],
        "codemao": [serializers.work_out(w, db, me) for w in codemao],
        "topics": topics,
    }


@router.get("/posts/hot_today")
def hot_posts_today(limit: int = 8, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    """今日热帖：24 小时内按浏览/点赞综合排序。"""
    from datetime import timedelta

    since = models.now() - timedelta(hours=24)
    posts = db.query(models.Post).filter(models.Post.created_at >= since, models.Post.status == "published").all()
    def score(p):
        likes = serializers.count_likes(db, "post", p.id)
        return (p.views or 0) + likes * 5
    posts.sort(key=score, reverse=True)
    return [serializers.post_out(p, db, current.id if current else None) for p in posts[:limit]]


@router.get("/works/hot_week")
def hot_week(limit: int = 10, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    """本周黑马：近 7 天发布、按浏览/点赞/收藏综合增长排序（首页最下面；支持 limit 出 TOP50）。"""
    from datetime import timedelta

    since = models.now() - timedelta(days=7)
    works = (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.created_at >= since)
        .all()
    )
    def score(w):
        likes = serializers.count_likes(db, "work", w.id)
        favs = db.query(models.Favorite).filter(models.Favorite.target_type == "work", models.Favorite.target_id == w.id).count()
        return (w.views or 0) + likes * 10 + favs * 8
    works.sort(key=score, reverse=True)
    return [serializers.work_out(w, db, current.id if current else None) for w in works[: min(limit, 50)]]


@router.get("/feed")
def follow_feed(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 10,
    offset: int = 0,
):
    """关注的人的最新稿件与帖子，合并成动态流（支持分页，前端用「加载更多」翻页）。

    ⚠️ 两条线必须各自多取一些再合并：稿件和帖子是两张表，按时间合并后，
    「全局第 offset+limit 条」在单张表里可能排在 offset+limit 之后。
    所以每条线都取 offset+limit 条，合并排序后再切出 [offset, offset+limit)。
    """
    limit = max(1, min(limit, 50))
    offset = max(0, min(offset, 500))
    followed_ids = [r[0] for r in db.query(models.Follow.following_id).filter(models.Follow.follower_id == user.id).all()]
    if not followed_ids:
        return []
    fetch_n = offset + limit
    works = (
        db.query(models.Work)
        .filter(models.Work.user_id.in_(followed_ids), models.Work.status == "published")
        .order_by(models.Work.created_at.desc())
        .limit(fetch_n)
        .all()
    )
    posts = (
        db.query(models.Post)
        .filter(models.Post.user_id.in_(followed_ids), models.Post.status == "published")
        .order_by(models.Post.created_at.desc())
        .limit(fetch_n)
        .all()
    )
    feed = [{"kind": "work", "data": serializers.work_out(w, db, user.id)} for w in works]
    feed += [{"kind": "post", "data": serializers.post_out(p, db, user.id)} for p in posts]
    feed.sort(key=lambda x: x["data"]["created_at"], reverse=True)
    return feed[offset:offset + limit]
