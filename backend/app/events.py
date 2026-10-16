"""限时活动奖励：按**北京时间的自然日**发放、一人一次。

目前只有一个活动（站长在公告里承诺过的）：
    9 月 30 日当天登录 → +300 经验、+100 小鱼干

三个设计点，都是踩过坑才会想到的：

1. **按北京时间取日期**。数据库里 `models.now()` 是 UTC，如果直接拿它取日期，
   「9 月 30 日」实际会变成北京时间 9/30 08:00 ~ 10/1 08:00 —— 公告承诺的那一天就对不上了。
   所以这里显式转成 UTC+8 再取日。（每日签到目前用的是 UTC 日期，属于同一类瑕疵，但不在本次活动范围内。）

2. **发放在「当天第一次带登录态的请求」里**，不是只在 /auth/login 里发。
   用户绝大多数时候是「早就登录着、直接打开网站」，根本不会走登录接口 ——
   只在登录接口里发，等于这批人永远领不到。（见 deps.touch_daily 的调用点。）

3. **一人一次**靠 event_claims 表的唯一约束兜底，并发重复请求不会发两份。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models

log = logging.getLogger(__name__)

BEIJING = timezone(timedelta(hours=8))

# 活动清单。加活动只要往这里加一条：key 必须唯一且此后不再改（它就是领取记录的凭据）。
EVENTS = [
    {
        "key": "login-2026-09-30",
        "date": "2026-09-30",          # 北京时间哪一天
        "xp": 300,
        "fish": 100,
        "notice": "9月30日登录奖励已到账：+300 经验、+100 小鱼干",
    },
]


def beijing_today(now: datetime | None = None) -> str:
    """北京时间今天是几号（YYYY-MM-DD）。"""
    return (now or models.now()).astimezone(BEIJING).strftime("%Y-%m-%d")


def due_events(today: str | None = None) -> list[dict]:
    """今天该发哪些活动（纯内存比较，不查库）。"""
    day = today or beijing_today()
    return [e for e in EVENTS if e["date"] == day]


def grant_due_events(user, db: Session, today: str | None = None) -> list[dict]:
    """把今天该发、且这个用户还没领过的活动奖励发掉；返回本次实际发出去的清单。

    调用点：deps 里每个带登录态的请求都会调一次。**没有活动命中时不会碰数据库**
    （due_events 是纯内存判断），所以平时零开销。
    """
    due = due_events(today)
    if not due or user is None or getattr(user, "id", None) is None:
        return []

    granted = []
    for ev in due:
        exists = (
            db.query(models.EventClaim.id)
            .filter(models.EventClaim.user_id == user.id, models.EventClaim.event_key == ev["key"])
            .first()
        )
        if exists:
            continue
        claim = models.EventClaim(user_id=user.id, event_key=ev["key"], xp=ev["xp"], fish=ev["fish"])
        db.add(claim)
        user.fish_count = (user.fish_count or 0) + ev["fish"]
        try:
            db.commit()
        except IntegrityError:
            # 并发请求同时发放：唯一约束挡下第二条，回滚即可（经验按记录算，不会多发）
            db.rollback()
            continue
        granted.append(ev)
        try:
            from . import serializers

            # actor 用 None（系统通知）：notify_user 会跳过「自己发给自己」，
            # 传 user.id 当 actor 的话这条通知会被静默丢弃（踩过）。
            # 前端对 actor 为空的通知显示盾牌图标，和 verify/reports 的系统通知一致。
            serializers.notify_user(db, user.id, None, "admin", None, None, ev["notice"])
        except Exception:  # 通知失败不影响奖励本身
            log.warning("活动奖励通知发送失败：%s", ev["key"], exc_info=True)
    if granted:
        log.info("活动奖励已发放：user=%s events=%s", user.id, json.dumps([g["key"] for g in granted], ensure_ascii=False))
    return granted


def claimed_total(db: Session, user) -> tuple[int, int]:
    """(已领取的活动奖励项数, 合计经验)。经验明细里的「活动奖励」就是这么算出来的。"""
    rows = db.query(models.EventClaim.xp).filter(models.EventClaim.user_id == user.id).all()
    return len(rows), sum(r[0] or 0 for r in rows)
