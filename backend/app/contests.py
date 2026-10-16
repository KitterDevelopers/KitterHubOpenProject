"""国庆创作活动（排行榜赛制）：定义 + 资格判定 + 排名 + 开奖发奖。

站长 2026-09-27：「国庆假期期间发布作品（题材不限）……点赞第一名送 500 小鱼干，第二名 300，
第三名 100，第 5 到 10 名 50，以作品记，每人可以投稿多次重复领奖，但是不能投相同作品或转载作品，
十月七日截止即开奖」。

赛制要点（都在这里收口，页面与发奖用同一份数据，不会各算各的）：
  · **投稿窗口**：2026-10-01 00:00 ~ 2026-10-06 23:59（北京时间）—— 按作品 `created_at` 判；
  · **点赞截止**：2026-10-07 23:59（北京时间）—— 这天不再接受新投稿，只累计点赞，之后开奖；
  · **资格**：`status='published'` 且 **不是转载**（`is_repost=0`）。发布后又被下架的稿件自动掉出榜单；
  · **以作品记**：同一个人可以有多件作品上榜、重复领奖；
  · **排名**：点赞数降序；同赞数时**先发布的在前**（确定性，避免并列时结果飘）；
  · 奖品：1→500 / 2→300 / 3→100 / **4-10→50**（第 4 名站长当时漏说，追问后确认同样有奖）。

开奖是**管理员手动触发**的（`POST /admin/contests/{key}/award`，可重复执行且幂等）：
按工作 id 记一条 `event_claims`（event_key = `contest-<key>-w<work_id>`），
所以同一个人多件作品分别领、重复点开奖也不会重复发。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

BEIJING = timezone(timedelta(hours=8))

# 活动定义。加新活动只要往这里加一条，路由 /contests/<key> 会自动带上。
#
# 站长 2026-09-30：「把国庆创作活动给我停掉删了」——`national-day-2026` 这条定义整条删除
# （活动还没开始就下线了，没有任何参赛作品、也没有开奖记录）。
# 定义原文备份在 .forensics/backup/contest_national_day/contests.py。
# 榜单赛制的框架（本模块 + routers/contests.py）保留：以后要办活动，
# 往下面这个列表里加一条就自动有接口与开奖流程。
# ⚠️ `bj_time` 是公开函数，app/map_event.py（点亮中国）还在用它，别一起删。
CONTESTS = []


def bj_time(naive_s: str) -> datetime:
    """把我们约定的「北京时间字符串」转成带时区的 datetime（用于和库里的 UTC 比较）。

    公开函数（不带下划线）：活动的窗口口径全站只有这一处解析，第二个活动
    （app/map_event.py）也 import 它，免得两边各写一份时区转换、哪天又对不上。
    """
    dt = datetime.strptime(naive_s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=BEIJING)
    return dt.astimezone(timezone.utc)


# 兼容旧调用名（下划线版）：本模块内还有若干处按老名字引用
_bj = bj_time


def get_contest(key: str) -> dict | None:
    for c in CONTESTS:
        if c["key"] == key:
            return c
    return None


def contest_status(contest: dict, now: datetime | None = None) -> str:
    """upcoming（还没开始）/ open（可投稿，10.1-10.6）/ voting（10.7，只计点赞）/ ended（已截止待开奖或已开奖）。"""
    now = now or models.now()
    if now < _bj(contest["publish_start"]):
        return "upcoming"
    if now <= _bj(contest["publish_end"]):
        return "open"
    if now <= _bj(contest["vote_end"]):
        return "voting"
    return "ended"


def prize_of(rank: int, contest: dict) -> int:
    """第 rank 名的小鱼干（没奖返回 0）。"""
    return int(contest["prizes"].get(rank, 0) or 0)


def eligible_works(db: Session, contest: dict) -> list[dict]:
    """按点赞降序排出有资格的作品（同一份逻辑给页面和开奖用）。"""
    start, end = _bj(contest["publish_start"]), _bj(contest["publish_end"])
    like_count = func.count(models.Like.id)
    rows = (
        db.query(models.Work, func.coalesce(like_count, 0).label("likes"))
        .outerjoin(
            models.Like,
            (models.Like.target_type == "work") & (models.Like.target_id == models.Work.id),
        )
        .filter(
            models.Work.status == "published",
            models.Work.is_repost.is_(False),          # 转载作品不能参赛
            models.Work.created_at >= start,
            models.Work.created_at <= end,
        )
        .group_by(models.Work.id)
        # 点赞多的在前；同赞数**先发布的在前**，保证结果稳定
        .order_by(func.count(models.Like.id).desc(), models.Work.created_at.asc())
        .all()
    )
    out = []
    for i, (w, likes) in enumerate(rows, start=1):
        out.append({
            "rank": i,
            "work": w,
            "likes": int(likes or 0),
            "prize": prize_of(i, contest),
        })
    return out


def serialize_ranked(db: Session, contest: dict, limit: int | None = None) -> list[dict]:
    """给页面用的榜单（含作者简报）。"""
    from . import serializers

    items = eligible_works(db, contest)
    if limit:
        items = items[:limit]
    out = []
    for it in items:
        w = it["work"]
        brief = serializers.user_brief(w.author) if w.author else None
        out.append({
            "rank": it["rank"],
            "likes": it["likes"],
            "prize": it["prize"],
            "id": w.id,
            "title": w.title,
            "cover_url": w.cover_url,
            "created_at": w.created_at,
            "category": w.category,
            "author": brief,
        })
    return out


def contest_meta(contest: dict, db: Session | None = None) -> dict:
    """活动元信息 + 状态 + 开奖结果（如果开过）。"""
    from . import config, models as m

    status = contest_status(contest)
    awarded = None
    if db is not None:
        row = db.get(m.SiteSetting, f"contest.{contest['key']}.award")
        if row is not None and row.value:
            try:
                awarded = json.loads(row.value)
            except Exception:
                awarded = None
    return {
        "key": contest["key"],
        "title": contest["title"],
        "status": status,
        "publish_start": contest["publish_start"],
        "publish_end": contest["publish_end"],
        "vote_end": contest["vote_end"],
        "prizes": [{"rank": r, "fish": prize_of(r, contest)} for r in range(1, contest["max_prize_rank"] + 1)],
        "max_prize_rank": contest["max_prize_rank"],
        "awarded": awarded,
        "awarded_at": (awarded or {}).get("at") if awarded else None,
    }


def do_award(db: Session, contest: dict, admin_id: int) -> dict:
    """开奖：把小鱼干发给获奖作品的作者，并把结果写进 site_settings（页面/后台都能读）。

    幂等：每个获奖作品一条 `event_claims`（event_key 带作品 id），重复执行不会重复发。
    """
    from . import models as m

    items = [it for it in eligible_works(db, contest) if it["prize"] > 0]
    winners, granted_total = [], 0
    for it in items:
        w = it["work"]
        key = f"contest-{contest['key']}-w{w.id}"
        exists = (
            db.query(m.EventClaim.id)
            .filter(m.EventClaim.user_id == w.user_id, m.EventClaim.event_key == key)
            .first()
        )
        if exists:
            winners.append({"rank": it["rank"], "work_id": w.id, "title": w.title,
                            "uid": w.author.uid if w.author else "", "fish": 0, "skipped": True})
            continue
        db.add(m.EventClaim(user_id=w.user_id, event_key=key, xp=0, fish=it["prize"]))
        if w.author is not None:
            w.author.fish_count = (w.author.fish_count or 0) + it["prize"]
        granted_total += it["prize"]
        winners.append({
            "rank": it["rank"], "work_id": w.id, "title": w.title,
            "uid": w.author.uid if w.author else "",
            "nickname": (w.author.nickname or w.author.username) if w.author else "",
            "fish": it["prize"], "likes": it["likes"],
        })

    result = {
        "key": contest["key"],
        "at": models.now().astimezone(BEIJING).strftime("%Y-%m-%d %H:%M:%S"),
        "fish_total": granted_total,
        "winners": winners,
    }
    row = db.get(m.SiteSetting, f"contest.{contest['key']}.award")
    if row is None:
        row = m.SiteSetting(key=f"contest.{contest['key']}.award", value=json.dumps(result, ensure_ascii=False))
        db.add(row)
    else:
        row.value = json.dumps(result, ensure_ascii=False)
    db.commit()
    return result
