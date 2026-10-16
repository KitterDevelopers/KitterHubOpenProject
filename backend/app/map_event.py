"""「锦绣山河·点亮中国」：省级地图点亮 + 国庆祝福领取 + 每省投稿榜。

站长 2026-09-27（第二个国庆活动；**和 app/contests.py 的排行榜赛制是两个页面、互不影响**）：
「做一个页面上面放上类似管理后台的地图，只要一个省有用户就用红色点亮，每点亮一省那个页面
就提示某某省已点亮，然后领取来自那个省的国庆祝福（两个小鱼干，所有人都可以领）。用户还可以
在这个页面上代表自己的省投出一个作品（国庆题材，发布时间 10.1 日以后），10 月 12 日截止，
每省的投稿作品点赞量最多的发 50 个小鱼干，每省独立分区。」

口径是在动手前**问过站长**的（不是自己猜的，上一版奖品空档就是猜错的教训）：
  · **点亮** = 活动期间（10.1 00:00 起）**有该省用户访问过站点**，不是「历史上有该省用户」
    —— 所以活动一开始地图是暗的，靠人来点亮；
  · **祝福** = 每个已点亮的省，**每个人都能各领一次 2 小鱼干**，可以累计领多个省；
  · **投稿分区** = 按**作品发布时记录的属地快照**（`works.ip_region`，见 iplocate.publisher_region），
    一人可投多件、都算他这个省；转载作品不参加；
  · **截止** 10 月 12 日 23:59（投稿 + 点亮 + 计赞都到这一刻），**每省点赞第一名**发 50 小鱼干。

和其它活动模块一样：**页面不算名次**，窗口 / 资格 / 名次 / 奖品 / 领取状态全部从这里出，
免得前后端两套算法对不上。
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import iplocate, models
from .contests import bj_time

log = logging.getLogger(__name__)

EVENT = {
    "key": "lit-china-2026",
    "title": "锦绣山河·点亮中国",
    # 点亮 + 投稿 + 计赞都在这段窗口里（北京时间为准）
    "start": "2026-10-01 00:00:00",
    "end": "2026-10-12 23:59:59",   # 站长 2026-10-07：活动延长到 10 月 12 日
    "bless_fish": 2,        # 每个已点亮省份的「国庆祝福」= 2 小鱼干，人人可领、可累计
    "province_prize": 50,   # 每省点赞第一名 = 50 小鱼干
}

BLESS_PREFIX = "maplit-bless:"      # event_claims.event_key = maplit-bless:<省>
AWARD_PREFIX = "maplit-award:"      # event_claims.event_key = maplit-award:<作品 id>
AWARD_SETTING = f"maplit.{EVENT['key']}.award"

BEIJING = timezone(timedelta(hours=8))


class MapEventError(ValueError):
    """业务错误（例如「这个省还没点亮」），路由层转成 400。"""


# ---------------------------------------------------------------------------
# 状态与窗口
# ---------------------------------------------------------------------------
def event_status(now: datetime | None = None) -> str:
    """upcoming（10.1 之前）/ open（活动进行中）/ ended（10.12 23:59 之后）。"""
    now = now or models.now()
    if now < bj_time(EVENT["start"]):
        return "upcoming"
    if now <= bj_time(EVENT["end"]):
        return "open"
    return "ended"


def _window():
    return bj_time(EVENT["start"]), bj_time(EVENT["end"])


# ---------------------------------------------------------------------------
# 点亮
# ---------------------------------------------------------------------------
# 内存缓存已点亮的省：**每个请求都要判断一次**（见 note_visit），所以不能每次查库。
# 34 行的小表，30 秒刷一次足够，页面轮询间隔也是十几秒这个量级。
_lit_cache: set[str] = set()
_lit_cache_at: float = 0.0
_lit_lock = threading.Lock()
_LIT_TTL = 30.0


def lit_regions(db: Session, force: bool = False) -> set[str]:
    """已点亮的省（全称集合）。带 30 秒内存缓存。"""
    global _lit_cache, _lit_cache_at
    now = models.now().timestamp()
    with _lit_lock:
        if not force and _lit_cache_at and now - _lit_cache_at < _LIT_TTL:
            return set(_lit_cache)
    rows = (
        db.query(models.MapLight.region)
        .filter(models.MapLight.event_key == EVENT["key"])
        .all()
    )
    fresh = {r[0] for r in rows if r[0]}
    with _lit_lock:
        _lit_cache, _lit_cache_at = fresh, now
    return set(fresh)


def note_visit(region_display: str, user=None, db: Session | None = None) -> dict | None:
    """把「有该省的人来访问了」落实成点亮。**新点亮**才返回记录，否则 None。

    调用点：deps.touch_ip_region（带登录态的请求）与 main.py 的中间件（访客请求）。
    只有活动期间才点亮；境外 / 只到国家一级 / 查不到属地的一律不算。
    任何异常都必须吞掉：点亮只是活动效果，不能影响正常请求。
    """
    if db is None:
        return None
    try:
        if event_status() != "open":
            return None
        region = iplocate.province_of(region_display)
        if not region:
            return None
        if region in lit_regions(db):
            return None
        light = models.MapLight(
            event_key=EVENT["key"],
            region=region,
            first_uid=str(getattr(user, "uid", "") or "")[:32],
            first_nickname=(getattr(user, "nickname", "") or "")[:64],
        )
        db.add(light)
        try:
            db.commit()
        except IntegrityError:
            # 并发：另一个请求刚点亮了同一个省 —— 唯一约束挡下，正常情况
            db.rollback()
            lit_regions(db, force=True)
            return None
        with _lit_lock:
            _lit_cache.add(region)
        log.info("点亮：%s（by %s）", region, light.first_nickname or "访客")
        return {
            "region": region,
            "at": light.first_at.isoformat() if light.first_at else None,
            "by": light.first_nickname or "",
        }
    except Exception:  # pragma: no cover - 兜底，绝不让活动效果影响请求
        try:
            db.rollback()
        except Exception:
            pass
        log.warning("点亮处理失败", exc_info=True)
        return None


# 访客（未登录）访问：中间件没法用依赖注入的会话，这里自己开一个；
# 同一个 IP 一分钟只判一次（ip2region 查询 + 可能的写库都不便宜）。
_GUEST_TTL = 60.0
_guest_seen: dict[str, float] = {}
_guest_lock = threading.Lock()


def note_guest(ip: str) -> None:
    """访客访问 → 尝试点亮他所在的省。异常一律吞掉。"""
    if not ip or ip == "unknown":
        return
    now = time.monotonic()
    with _guest_lock:
        if now - _guest_seen.get(ip, 0.0) < _GUEST_TTL:
            return
        if len(_guest_seen) > 4096:      # 防止这张表无限长大
            _guest_seen.clear()
        _guest_seen[ip] = now
    try:
        region = iplocate.region_of(ip)
        if not region:
            return
        from .database import SessionLocal

        db = SessionLocal()
        try:
            note_visit(region, None, db)
        finally:
            db.close()
    except Exception:  # pragma: no cover - 兜底
        log.warning("访客点亮处理失败", exc_info=True)


def lit_list(db: Session) -> list[dict]:
    """已点亮省份列表（按点亮时间升序；前端自己取最新的几条播报）。"""
    rows = (
        db.query(models.MapLight)
        .filter(models.MapLight.event_key == EVENT["key"])
        .order_by(models.MapLight.first_at.asc(), models.MapLight.id.asc())
        .all()
    )
    return [
        {
            "region": r.region,
            "at": r.first_at.isoformat() if r.first_at else None,
            "by": r.first_nickname or "",
            "by_uid": r.first_uid or "",
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# 投稿与排名（每省独立分区）
# ---------------------------------------------------------------------------
def _works_query(db: Session, region: str | None = None):
    """有资格的作品 + 点赞数（资格与 contests 同口径：已发布、非转载、窗口内、属地能落到省）。"""
    start, end = _window()
    like_count = func.count(models.Like.id)
    q = (
        db.query(models.Work, func.coalesce(like_count, 0).label("likes"))
        .outerjoin(
            models.Like,
            (models.Like.target_type == "work") & (models.Like.target_id == models.Work.id),
        )
        .filter(
            models.Work.status == "published",
            models.Work.is_repost.is_(False),                 # 转载作品不参加
            models.Work.created_at >= start,
            models.Work.created_at <= end,
            models.Work.ip_region.in_(iplocate.PROVINCES),    # 属地必须是 34 个省级行政区之一
        )
        .group_by(models.Work.id)
        # 点赞多的在前；同赞数先发布的在前（确定性）
        .order_by(models.Work.ip_region.asc(), func.count(models.Like.id).desc(), models.Work.created_at.asc())
    )
    if region:
        q = q.filter(models.Work.ip_region == region)
    return q


def ranked_by_province(db: Session) -> dict[str, list[dict]]:
    """{省: [按点赞排好的作品]}，名次在省内单独算（每省独立分区）。"""
    out: dict[str, list[dict]] = {}
    for w, likes in _works_query(db).all():
        lst = out.setdefault(w.ip_region, [])
        rank = len(lst) + 1
        lst.append({
            "rank": rank,
            "work": w,
            "likes": int(likes or 0),
            # 只有本省第一名有奖（其它名次列出来只是让人看到差距）
            "prize": EVENT["province_prize"] if rank == 1 else 0,
        })
    return out


def serialize_ranked(items: list[dict], limit: int | None = None) -> list[dict]:
    """给页面用的榜单（含作者简报）。"""
    from . import serializers

    if limit:
        items = items[:limit]
    out = []
    for it in items:
        w = it["work"]
        out.append({
            "rank": it["rank"],
            "likes": it["likes"],
            "prize": it["prize"],
            "region": w.ip_region,
            "id": w.id,
            "title": w.title,
            "cover_url": w.cover_url,
            "created_at": w.created_at,
            "category": w.category,
            "author": serializers.user_brief(w.author) if w.author else None,
        })
    return out


# ---------------------------------------------------------------------------
# 祝福领取（一人一省一次，可累计领多个省）
# ---------------------------------------------------------------------------
def _bless_key(region: str) -> str:
    return f"{BLESS_PREFIX}{region}"


def claimed_regions(db: Session, user) -> set[str]:
    """这个用户已经领过祝福的省。"""
    if user is None or getattr(user, "id", None) is None:
        return set()
    rows = (
        db.query(models.EventClaim.event_key)
        .filter(
            models.EventClaim.user_id == user.id,
            models.EventClaim.event_key.like(f"{BLESS_PREFIX}%"),
        )
        .all()
    )
    return {r[0][len(BLESS_PREFIX):] for r in rows if r[0]}


def claim(db: Session, user, region: str) -> dict:
    """领一个省的国庆祝福。幂等：领过就直接返回 already=True，不会再发鱼。"""
    region = (region or "").strip()
    if region not in lit_regions(db):
        raise MapEventError("这个省还没有点亮，等有该省的用户来访问就能领了")
    if user is None or getattr(user, "id", None) is None:
        raise MapEventError("请先登录再领祝福")
    key = _bless_key(region)
    exists = (
        db.query(models.EventClaim.id)
        .filter(models.EventClaim.user_id == user.id, models.EventClaim.event_key == key)
        .first()
    )
    if exists:
        return {"region": region, "fish": 0, "already": True, "claims": len(claimed_regions(db, user))}
    c = models.EventClaim(user_id=user.id, event_key=key, xp=0, fish=EVENT["bless_fish"])
    db.add(c)
    user.fish_count = (user.fish_count or 0) + EVENT["bless_fish"]
    try:
        db.commit()
    except IntegrityError:
        # 并发重复领取：唯一约束挡下，回滚即可（不会多发）
        db.rollback()
        return {"region": region, "fish": 0, "already": True, "claims": len(claimed_regions(db, user))}
    return {
        "region": region,
        "fish": EVENT["bless_fish"],
        "already": False,
        "claims": len(claimed_regions(db, user)),
    }


def claim_all(db: Session, user) -> dict:
    """一键领掉所有「已点亮但我还没领」的省。"""
    if user is None or getattr(user, "id", None) is None:
        raise MapEventError("请先登录再领祝福")
    done = claimed_regions(db, user)
    pending = sorted(lit_regions(db) - done)
    granted, skipped = [], []
    for region in pending:
        try:
            r = claim(db, user, region)
        except MapEventError:
            continue
        (skipped if r["already"] else granted).append(region)
    return {
        "granted": granted,
        "skipped": skipped,
        "fish": EVENT["bless_fish"] * len(granted),
        "claims": len(claimed_regions(db, user)),
    }


# ---------------------------------------------------------------------------
# 开奖：每省第一名 50 小鱼干
# ---------------------------------------------------------------------------
def award_result(db: Session) -> dict | None:
    row = db.get(models.SiteSetting, AWARD_SETTING)
    if row is None or not row.value:
        return None
    try:
        return json.loads(row.value)
    except Exception:
        return None


def preview(db: Session) -> list[dict]:
    """开奖预览：每个省现在会发给谁（没开奖前页面/后台都能看）。"""
    from . import serializers

    out = []
    for region, items in sorted(ranked_by_province(db).items()):
        top = items[0]
        w = top["work"]
        out.append({
            "region": region,
            "work_id": w.id,
            "title": w.title,
            "likes": top["likes"],
            "nickname": (w.author.nickname if w.author else "") or "",
            "uid": (w.author.uid if w.author else "") or "",
            "fish": EVENT["province_prize"],
            "author": serializers.user_brief(w.author) if w.author else None,
        })
    return out


def do_award(db: Session, admin_id: int | None = None) -> dict:
    """开奖：每省点赞第一名发 50 小鱼干。

    幂等：每个获奖作品一条 `event_claims`（event_key = `maplit-award:<work_id>`），
    重复执行只会跳过已发过的；结果另存一份到 site_settings 供页面展示。
    """
    now = models.now()
    winners, total = [], 0
    for region, items in sorted(ranked_by_province(db).items()):
        top = items[0]
        w = top["work"]
        author = w.author
        key = f"{AWARD_PREFIX}{w.id}"
        skipped = (
            db.query(models.EventClaim.id)
            .filter(models.EventClaim.event_key == key)
            .first()
            is not None
        )
        fish = 0
        if author is not None and not skipped:
            c = models.EventClaim(user_id=author.id, event_key=key, xp=0, fish=EVENT["province_prize"])
            db.add(c)
            author.fish_count = (author.fish_count or 0) + EVENT["province_prize"]
            try:
                db.commit()
                fish = EVENT["province_prize"]
                total += fish
            except IntegrityError:
                db.rollback()
                skipped = True
        winners.append({
            "region": region,
            "work_id": w.id,
            "title": w.title,
            "likes": top["likes"],
            "uid": (author.uid if author else "") or "",
            "nickname": (author.nickname if author else "") or "",
            "fish": fish,
            "skipped": skipped or author is None,
        })
    result = {
        "at": now.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M:%S"),
        "fish_total": total,
        "provinces": len(winners),
        "winners": winners,
    }
    row = db.get(models.SiteSetting, AWARD_SETTING)
    if row is None:
        row = models.SiteSetting(key=AWARD_SETTING, value=json.dumps(result, ensure_ascii=False))
        db.add(row)
    else:
        row.value = json.dumps(result, ensure_ascii=False)
    db.commit()
    log.info("点亮中国开奖：%s 个省，共发 %s 小鱼干", len(winners), total)
    return result


# ---------------------------------------------------------------------------
# 页面数据
# ---------------------------------------------------------------------------
def meta(db: Session, user=None) -> dict:
    """页面要的全部数据（榜单按省分区；每省只带前若干名，避免一次拉太多）。"""
    from . import iplocate as _ip

    status = event_status()
    lit = lit_list(db)
    lit_set = {l["region"] for l in lit}
    ranked = ranked_by_province(db)

    leaders = []
    for region, items in sorted(ranked.items(), key=lambda kv: (-kv[1][0]["likes"], kv[0])):
        leaders.append({
            "region": region,
            "work_id": items[0]["work"].id,
            "title": items[0]["work"].title,
            "likes": items[0]["likes"],
            "uid": (items[0]["work"].author.uid if items[0]["work"].author else "") or "",
            "nickname": (items[0]["work"].author.nickname if items[0]["work"].author else "") or "",
            "count": len(items),
            "fish": EVENT["province_prize"],
        })

    provinces_view = []
    for region, items in sorted(ranked.items()):
        provinces_view.append({
            "region": region,
            "count": len(items),
            "likes": sum(i["likes"] for i in items),
            "top": serialize_ranked(items, limit=10),
        })

    mine = None
    if user is not None and getattr(user, "id", None) is not None:
        my_region = _ip.province_of(getattr(user, "ip_region", "") or "")
        done = claimed_regions(db, user)
        my_works = []
        for region, items in ranked.items():
            for it in items:
                w = it["work"]
                if w.user_id == user.id:
                    my_works.append({
                        "region": region,
                        "rank": it["rank"],
                        "likes": it["likes"],
                        "prize": it["prize"],
                        "count": len(items),
                        "id": w.id,
                        "title": w.title,
                    })
        my_works.sort(key=lambda x: (x["rank"], -x["likes"]))
        mine = {
            "region": my_region,
            "claims": len(done),
            "fish": EVENT["bless_fish"] * len(done),
            "claimed": sorted(done),
            "can_claim": sorted(lit_set - done),
            "works": my_works,
        }

    awarded = award_result(db)
    return {
        "key": EVENT["key"],
        "title": EVENT["title"],
        "status": "awarded" if awarded else status,
        "start": EVENT["start"],
        "end": EVENT["end"],
        "bless_fish": EVENT["bless_fish"],
        "province_prize": EVENT["province_prize"],
        "total_provinces": len(iplocate.PROVINCES),
        "lit": lit,
        "lit_count": len(lit_set),
        "stats": {
            "works": sum(len(v) for v in ranked.values()),
            "provinces": len(ranked),
            "best": max((v[0]["likes"] for v in ranked.values()), default=0),
        },
        "leaders": leaders,
        "provinces": provinces_view,
        "mine": mine,
        "awarded": awarded,
    }
