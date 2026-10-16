"""社区风纪委员会（站长 2026-10-01）。

规则（站长原话拆解）：
  · 「LV3 及以上可申请加入成为风纪委员」→ 申请要 LV3+，**管理员审批**后上任；
  · 「风纪委员系统页面可以刷一些用户的评论、稿件等」→ 页面给一条巡逻流；
  · 「可以先隐藏用户评论稿件等然后送给管理员复审」→ 一键「隐藏并送审」：内容立刻隐藏，
    同时进管理员复审队列（复用 `content_reviews` 表，source='committee'）。
  · 站长补充：「被举报的内容**一定**要进这个审核内容，正常的就**随机**进」
    → 队列 = 全部未处理的举报（必进，去重）+ 正常内容随机抽样。
  · 站长再补（2026-10-01）：「风纪委员对于待审内容可以选择无违规，**3 位风纪委员都选择无违规
    的话就算无违规**」→ `VOTE_THRESHOLD = 3`：待审内容（被举报的、或已被隐藏等管理员裁决的）


    的话就算无违规**」→ `VOTE_THRESHOLD = 3`：待审内容（被举报的、或已被隐藏等管理员裁决的）
    人人都能投「无违规」，满 3 票即判定无违规：恢复展示、把复审记录按「内容没问题」结掉、
    这条内容上还没处理的举报一并驳回、通知作者。

为什么复用 `content_reviews` 而不是另开一张送审表：
  管理端的复审逻辑（通过＝恢复展示、驳回＝维持隐藏并可追加处罚、通知作者）
  已经在那套里写好了（`routers/admin.py` 的 sensitive-reviews），
  加一个 `source` 字段就能把「风纪委员送审」并进同一条流水线，
  管理员只看一个队列，也不会出现两套处理逻辑各写一遍、行为还不一致。

风纪委员的权限边界（有意收紧）：
  · 只能**隐藏 + 送审**，不能删除、不能处罚、不能看举报人是谁；
  · 每人每天最多隐藏 `DAILY_HIDE_LIMIT` 条（防「一键全隐藏」式滥用）；
  · 管理员「通过」（内容其实没问题）会记在该委员名下，后台可见误判数，可停职。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from . import models, serializers
from .deps import get_active_user, get_current_user, get_db

router = APIRouter(prefix="/committee", tags=["committee"])

MIN_LEVEL = 3                 # 申请门槛：LV3
DAILY_HIDE_LIMIT = 20         # 每人每天最多隐藏多少条
RANDOM_QUEUE_SIZE = 12        # 正常内容每次随机抽多少条
VOTE_THRESHOLD = 3            # 「无违规」票数达到多少即判定无违规（站长：3 位风纪委员都选无违规）

# 进风纪委员会审核库的来源（站长 2026-10-04：命中敏感词的内容也要让风纪委员会能审）
#   committee = 风纪委员巡逻时「先隐藏、再送审」
#   sensitive = 系统命中敏感词后自动送审（原先进不了这个库，只能管理员在后台处理）
QUEUE_SOURCES = ("committee", "sensitive")

STATUS_LABEL = {
    "pending": "审核中",
    "active": "在职",
    "rejected": "未通过",
    "suspended": "已停职",
}

TARGET_TYPES = ("work", "post", "work_comment", "post_comment")


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def _status(user: models.User) -> str:
    return (getattr(user, "committee_status", None) or "").strip()


def is_member(user: models.User) -> bool:
    return _status(user) == "active"


def require_member(user: models.User) -> None:
    if not is_member(user):
        raise HTTPException(status_code=403, detail="只有在职风纪委员可以使用该功能")


def target_obj(db: Session, target_type: str, target_id: int):
    """把 (类型, id) 换成真实对象；不存在返回 None。"""
    if target_type == "work":
        return db.get(models.Work, target_id)
    if target_type == "post":
        return db.get(models.Post, target_id)
    if target_type == "work_comment":
        return db.get(models.WorkComment, target_id)
    if target_type == "post_comment":
        return db.get(models.PostComment, target_id)
    return None


def _target_author(obj) -> models.User | None:
    return getattr(obj, "author", None) or getattr(obj, "user", None)


def _hidden(obj) -> bool:
    """内容现在是不是处于「不可见」状态。"""
    st = (getattr(obj, "status", "") or "").lower()
    return st in ("pending", "rejected", "hidden")


def _hide(db: Session, obj) -> None:
    """隐藏内容（作品/帖子 -> pending，评论 -> pending）。不提交事务，调用方统一 commit。"""
    if isinstance(obj, (models.Work, models.Post)):
        obj.status = "pending"
    else:
        obj.status = "pending"


def _preview(obj) -> str:
    txt = getattr(obj, "content", None) or getattr(obj, "description", None) or ""
    return str(txt).replace("\n", " ")[:140]


def _title(db: Session, obj) -> str:
    """列表里给风纪委员看的标题：评论要带上所属作品/帖子，否则一屏全是「作品评论」看不出上下文。"""
    t = getattr(obj, "title", None)
    if t:
        return str(t)[:80]
    if isinstance(obj, models.WorkComment):
        w = db.get(models.Work, obj.work_id)
        return f"《{(w.title or '')[:40]}》的评论" if w else "作品评论"
    if isinstance(obj, models.PostComment):
        p = db.get(models.Post, obj.post_id)
        return f"《{(p.title or '')[:40]}》的评论" if p else "帖子评论"
    return "评论"


def _url_of(db: Session, target_type: str, target_id: int) -> str:
    """给前端的站内链接（评论跳到所属作品/帖子）。"""
    if target_type == "work":
        return f"/works/{target_id}"
    if target_type == "post":
        return f"/posts/{target_id}"
    if target_type == "work_comment":
        obj = db.get(models.WorkComment, target_id)
        return f"/works/{obj.work_id}" if obj else ""
    if target_type == "post_comment":
        obj = db.get(models.PostComment, target_id)
        return f"/posts/{obj.post_id}" if obj else ""
    return ""


def _pending_committee_review(db: Session, target_type: str, target_id: int):
    return (
        db.query(models.ContentReview)
        .filter(
            models.ContentReview.source.in_(QUEUE_SOURCES),
            models.ContentReview.target_type == target_type,
            models.ContentReview.target_id == target_id,
            models.ContentReview.status == "pending",
        )
        .first()
    )


def _daily_hidden(db: Session, member_id: int) -> int:
    today = models.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(models.ContentReview)
        .filter(
            models.ContentReview.source == "committee",
            models.ContentReview.reviewer_id == member_id,
            models.ContentReview.created_at >= today,
        )
        .count()
    )


def stats_of(db: Session, member: models.User) -> dict:
    """风纪委员的执法统计：累计送审、今天、以及被判定「内容没问题」的条数（误判）。

    ⚠️ 口径（站长 2026-10-01 加了投票机制后定的）：
      · 管理员亲自判「内容没问题」→ 算送审人的**误判**（revoked）；
      · **3 位风纪委员投票判定无违规**（resolved_by='committee_vote'）→ **不算误判**，
        单独计入 overturned（内容有争议、被委员会推翻，不等于送审人明显办错），
        否则大家都不敢隐藏，机制就废了。
    """
    base = db.query(models.ContentReview).filter(
        models.ContentReview.source == "committee",
        models.ContentReview.reviewer_id == member.id,
    )
    total = base.count()
    by_admin = base.filter(models.ContentReview.status == "approved", models.ContentReview.resolved_by != "committee_vote")
    approved = by_admin.count()
    overturned = base.filter(
        models.ContentReview.status == "approved", models.ContentReview.resolved_by == "committee_vote"
    ).count()
    rejected = base.filter(models.ContentReview.status == "rejected").count()
    pending = base.filter(models.ContentReview.status == "pending").count()
    return {
        "total": total,
        "today": _daily_hidden(db, member.id),
        "pending": pending,
        "upheld": rejected,      # 管理员维持隐藏 = 判对了
        "revoked": approved,     # 管理员恢复展示 = 误判
        "overturned": overturned,  # 被风纪委员投票判定无违规（不算误判）
        "daily_limit": DAILY_HIDE_LIMIT,
    }


# ---------------------------------------------------------------------------
# 「无违规」投票（站长 2026-10-01）
# ---------------------------------------------------------------------------
def vote_state(db: Session, target_type: str, target_id: int, me: models.User | None = None) -> dict:
    """某个目标的投票情况：已有几票、我投过没、是否已判定。"""
    rows = (
        db.query(models.CommitteeVote)
        .filter(models.CommitteeVote.target_type == target_type, models.CommitteeVote.target_id == target_id)
        .order_by(models.CommitteeVote.id.asc())
        .all()
    )
    voters = [db.get(models.User, r.voter_id) for r in rows]
    return {
        "count": len(rows),
        "threshold": VOTE_THRESHOLD,
        "done": len(rows) >= VOTE_THRESHOLD,
        "voted": bool(me and any(r.voter_id == me.id for r in rows)),
        # 投票人昵称：委员会内部公开，谁投的都能看到（管理端也用这个）
        "voters": [serializers.user_brief(v) for v in voters if v is not None],
    }


def _clear_by_vote(db: Session, target_type: str, target_id: int) -> dict:
    """满票判定无违规：恢复内容、结掉复审记录、驳回未处理举报、通知作者。"""
    obj = target_obj(db, target_type, target_id)
    if obj is None:
        return {"ok": False, "detail": "内容已不存在"}
    author = _target_author(obj)
    # ① 恢复展示
    if isinstance(obj, (models.Work, models.Post)):
        obj.status = "published"
    else:
        obj.status = "active"
    # ② 结掉还在等的送审记录（按「内容没问题」结，但标记是投票判的 → 不算送审人误判）
    review = _pending_committee_review(db, target_type, target_id)
    if review is not None:
        review.status = "approved"
        review.resolved_by = "committee_vote"
        review.handled_at = models.now()
    # ③ 这条内容上还没处理的举报一并驳回
    reports = (
        db.query(models.Report)
        .filter(
            models.Report.target_type == target_type,
            models.Report.target_id == target_id,
            models.Report.status == "pending",
        )
        .all()
    )
    for r in reports:
        r.status = "dismissed"
        r.note = f"{VOTE_THRESHOLD} 位风纪委员判定无违规"
        r.handled_at = models.now()
    db.commit()
    # ④ 通知作者（举报人也一并告知结果，跟管理员处理举报时的口径一致）
    try:
        title = _title(db, obj)
        serializers.notify_user(
            db, author.id if author else None, None, "admin", target_type, target_id,
            f"你的内容《{title}》经 {VOTE_THRESHOLD} 位风纪委员判定无违规，已恢复正常展示",
        )
        for r in reports:
            serializers.notify_user(
                db, r.reporter_id, None, "admin", target_type, target_id,
                f"你举报的内容经 {VOTE_THRESHOLD} 位风纪委员判定无违规，举报已驳回",
            )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "restored": True, "dismissed_reports": len(reports), "review_id": review.id if review else None}


# ---------------------------------------------------------------------------
# 我的状态 / 申请
# ---------------------------------------------------------------------------
@router.get("/me")
def my_state(db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    """风纪委员会首页要的一切：我的身份状态、能否申请、执法统计、规则数字。"""
    lv = serializers.level_info(db, current)["level"]
    st = _status(current)
    member = st == "active"
    can_apply = (not st or st == "rejected") and lv >= MIN_LEVEL
    reason = ""
    if st == "pending":
        reason = "申请已提交，等管理员审批"
    elif st == "suspended":
        reason = "你已被停职，如有疑问请联系管理员"
    elif st == "rejected":
        reason = "上次申请未通过" + ("，可以再次申请" if lv >= MIN_LEVEL else "")
    elif not st:
        reason = "" if lv >= MIN_LEVEL else f"需要 LV{MIN_LEVEL}（你当前 LV{lv}）"
    return {
        "status": st or "none",
        "status_label": STATUS_LABEL.get(st, "未加入"),
        "is_member": member,
        "level": lv,
        "min_level": MIN_LEVEL,
        "can_apply": can_apply,
        "reason": reason,
        "applied_reason": current.committee_reason or "",
        "joined_at": current.committee_at.isoformat() if current.committee_at else None,
        "stats": stats_of(db, current) if member else None,
        "daily_limit": DAILY_HIDE_LIMIT,
    }


@router.post("/apply")
def apply_join(
    body: dict,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_active_user),
):
    """申请加入风纪委员会（LV3 起，管理员审批）。"""
    st = _status(current)
    if st == "active":
        raise HTTPException(status_code=400, detail="你已经是在职风纪委员了")
    if st == "pending":
        raise HTTPException(status_code=400, detail="你已经提交过申请，请等管理员审批")
    if st == "suspended":
        raise HTTPException(status_code=400, detail="你当前处于停职状态，请联系管理员")
    serializers.check_level(db, current, MIN_LEVEL, "申请加入风纪委员会")
    reason = str((body or {}).get("reason") or "").strip()[:500]
    if not reason:
        raise HTTPException(status_code=400, detail="请写一句申请理由")
    current.committee_status = "pending"
    current.committee_reason = reason
    current.committee_at = models.now()
    db.commit()
    # 通知所有管理员
    try:
        for admin in db.query(models.User).filter(models.User.role == "admin").all():
            serializers.notify_user(
                db, admin.id, current.id, "admin", None, None,
                f"{current.display_name} 申请加入风纪委员会，等待审批",
            )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "status": "pending"}


# ---------------------------------------------------------------------------
# 巡逻队列
# ---------------------------------------------------------------------------
def _item(db: Session, target_type: str, target_id: int, reason: str, extra: dict | None = None,
          me: models.User | None = None) -> dict | None:
    obj = target_obj(db, target_type, target_id)
    if obj is None:
        return None
    author = _target_author(obj)
    # 待审 = 有未处理的举报，或有等管理员裁决的送审记录。只有这种才显示「无违规」投票。
    has_report = (
        db.query(models.Report)
        .filter(
            models.Report.target_type == target_type,
            models.Report.target_id == target_id,
            models.Report.status == "pending",
        )
        .count()
        > 0
    )
    pending_review = _pending_committee_review(db, target_type, target_id)
    item = {
        "target_type": target_type,
        "target_id": target_id,
        "title": _title(db, obj),
        "preview": _preview(obj),
        "url": _url_of(db, target_type, target_id),
        "reason": reason,                       # reported = 被举报（必进）；random = 随机抽样；review = 已隐藏待裁决
        "created_at": obj.created_at.isoformat() if getattr(obj, "created_at", None) else None,
        "author": serializers.user_brief(author) if author else None,
        "hidden": _hidden(obj),
        "votable": bool(has_report or pending_review is not None) and (author is None or author.id != (me.id if me else -1)),
        "vote": vote_state(db, target_type, target_id, me),
    }
    if extra:
        item.update(extra)
    return item


@router.get("/queue")
def queue(
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    """巡逻队列：被举报的**必进**（哪怕只有一条举报），再随机抽一批正常内容。

    另外单独给一段 `pending`（已隐藏、等管理员裁决）—— 这些内容不在普通队列里（已隐藏会被排除），
    但风纪委员要能对它们投「无违规」，所以必须单独列出来。
    排除：自己发的内容、已被隐藏的（除 pending 段）、已经在审的。
    """
    require_member(current)
    seen: set[tuple[str, int]] = set()
    items: list[dict] = []

    # ① 被举报的：按举报数从多到少，全部进
    reported = (
        db.query(
            models.Report.target_type,
            models.Report.target_id,
            func.count(models.Report.id).label("n"),
        )
        .filter(models.Report.status == "pending")
        .group_by(models.Report.target_type, models.Report.target_id)
        .order_by(func.count(models.Report.id).desc(), models.Report.target_id.desc())
        .limit(limit)
        .all()
    )
    for r in reported:
        key = (r.target_type, r.target_id)
        if key in seen:
            continue
        it = _item(db, r.target_type, r.target_id, "reported", {"report_count": r.n}, me=current)
        if it is None or it["hidden"]:
            continue
        if (it["author"] or {}).get("id") == current.id:
            continue
        seen.add(key)
        items.append(it)

    # ② 正常的：随机抽样（评论为主，掺一些稿件/帖子）
    room = max(0, limit - len(items))
    if room > 0:
        pick_comments = max(1, int(room * 0.6))
        pick_works = max(1, room - pick_comments)
        pairs: list[tuple[str, int]] = []
        for model, ttype, n in (
            (models.WorkComment, "work_comment", pick_comments // 2 + 1),
            (models.PostComment, "post_comment", pick_comments // 2 + 1),
            (models.Work, "work", (pick_works + 1) // 2),
            (models.Post, "post", max(1, pick_works // 2)),
        ):
            rows = (
                db.query(model.id)
                .filter(model.status.in_(("active", "published")))
                .order_by(func.random())
                .limit(n * 3)
                .all()
            )
            for (tid,) in rows:
                pairs.append((ttype, tid))
        for ttype, tid in pairs:
            if len(items) >= limit:
                break
            key = (ttype, tid)
            if key in seen:
                continue
            it = _item(db, ttype, tid, "random", me=current)
            if it is None or it["hidden"]:
                continue
            if (it["author"] or {}).get("id") == current.id:
                continue
            if _pending_committee_review(db, ttype, tid) is not None:
                continue          # 已经在审了
            seen.add(key)
            items.append(it)

    # ③ 待复审（已被风纪委员隐藏、等管理员裁决）：这些内容已隐藏、不在上面两段里，
    #    但风纪委员要能对它们投「无违规」，所以单独一段列出来（最多 10 条）。
    pending_items: list[dict] = []
    pending_rows = (
        db.query(models.ContentReview)
        .filter(models.ContentReview.source.in_(QUEUE_SOURCES), models.ContentReview.status == "pending")
        .order_by(models.ContentReview.id.desc())
        .limit(20)
        .all()
    )
    for r in pending_rows:
        if (r.target_type, r.target_id) in seen:
            continue
        it = _item(db, r.target_type, r.target_id, "review", {
            # 不显示送审人是谁（避免委员之间互相针对），只给理由和管理员看的人
            "note": r.reviewer_note or "",
            "review_id": r.id,
            "source": r.source or "committee",
            "sensitive_words": [w.strip() for w in (r.sensitive_words or "").split(",") if w.strip()],
        }, me=current)
        if it is None:
            continue
        if (it["author"] or {}).get("id") == current.id:
            continue
        seen.add((r.target_type, r.target_id))
        pending_items.append(it)

    return {
        "items": items,
        "pending": pending_items,
        "reported_count": sum(1 for i in items if i["reason"] == "reported"),
        "vote_threshold": VOTE_THRESHOLD,
        "daily_left": max(0, DAILY_HIDE_LIMIT - _daily_hidden(db, current.id)),
        "daily_limit": DAILY_HIDE_LIMIT,
    }


@router.post("/hide")
def hide_and_escalate(
    body: dict,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_active_user),
):
    """隐藏内容并送给管理员复审（风纪委员的核心动作）。"""
    require_member(current)
    target_type = str((body or {}).get("target_type") or "")
    try:
        target_id = int((body or {}).get("target_id") or 0)
    except (TypeError, ValueError):
        target_id = 0
    if target_type not in TARGET_TYPES or target_id <= 0:
        raise HTTPException(status_code=400, detail="目标内容不正确")
    reason = str((body or {}).get("reason") or "").strip()[:200]
    if not reason:
        raise HTTPException(status_code=400, detail="请写明理由（会展示给管理员）")

    left = DAILY_HIDE_LIMIT - _daily_hidden(db, current.id)
    if left <= 0:
        raise HTTPException(status_code=400, detail=f"今天的处理额度已用完（每天 {DAILY_HIDE_LIMIT} 条）")

    obj = target_obj(db, target_type, target_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="内容不存在或已被删除")
    author = _target_author(obj)
    if author is not None and author.id == current.id:
        raise HTTPException(status_code=400, detail="不能处理自己发布的内容")
    if _hidden(obj):
        raise HTTPException(status_code=400, detail="该内容已经是隐藏状态")
    if _pending_committee_review(db, target_type, target_id) is not None:
        raise HTTPException(status_code=400, detail="该内容已经在复审队列里了")

    _hide(db, obj)
    review = models.ContentReview(
        target_type=target_type,
        target_id=target_id,
        sensitive_words="",
        status="pending",
        source="committee",
        reviewer_id=current.id,
        reviewer_note=reason,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    # 通知管理员（复审队列有新条目）
    try:
        for admin in db.query(models.User).filter(models.User.role == "admin").all():
            serializers.notify_user(
                db, admin.id, current.id, "admin", target_type, target_id,
                f"风纪委员 {current.display_name} 隐藏了一条内容并送审：{reason}",
            )
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": True,
        "review_id": review.id,
        "daily_left": max(0, left - 1),
    }


@router.post("/vote")
def vote_no_violation(
    body: dict,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_active_user),
):
    """投「无违规」（站长 2026-10-01）：待审内容满 VOTE_THRESHOLD 票即判定无违规。

    只有**待审**内容能投：被举报还没处理的，或者被风纪委员隐藏、正等管理员复审的
    （纯随机巡逻的正常内容没有「审」可投，前端也不显示这个按钮）。
    """
    require_member(current)
    target_type = str((body or {}).get("target_type") or "")
    try:
        target_id = int((body or {}).get("target_id") or 0)
    except (TypeError, ValueError):
        target_id = 0
    if target_type not in TARGET_TYPES or target_id <= 0:
        raise HTTPException(status_code=400, detail="目标内容不正确")
    obj = target_obj(db, target_type, target_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="内容不存在或已被删除")
    author = _target_author(obj)
    if author is not None and author.id == current.id:
        raise HTTPException(status_code=400, detail="不能对自己发布的内容投票")
    # 必须是「待审」状态：有未处理的举报，或有等管理员裁决的送审记录
    has_report = (
        db.query(models.Report)
        .filter(
            models.Report.target_type == target_type,
            models.Report.target_id == target_id,
            models.Report.status == "pending",
        )
        .count()
        > 0
    )
    review = _pending_committee_review(db, target_type, target_id)
    if not has_report and review is None:
        raise HTTPException(status_code=400, detail="这条内容当前不在待审状态，不需要投票")

    existing = (
        db.query(models.CommitteeVote)
        .filter(
            models.CommitteeVote.voter_id == current.id,
            models.CommitteeVote.target_type == target_type,
            models.CommitteeVote.target_id == target_id,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=400, detail="你已经投过票了")

    db.add(models.CommitteeVote(voter_id=current.id, target_type=target_type, target_id=target_id))
    db.commit()
    st = vote_state(db, target_type, target_id, current)
    cleared = None
    if st["count"] >= VOTE_THRESHOLD:
        cleared = _clear_by_vote(db, target_type, target_id)
    return {"ok": True, "vote": st, "cleared": cleared}


@router.get("/mine")
def my_actions(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    """我送审过的记录 + 管理员裁决结果（判对 / 误判一眼可见）。"""
    require_member(current)
    rows = (
        db.query(models.ContentReview)
        .filter(models.ContentReview.source == "committee", models.ContentReview.reviewer_id == current.id)
        .order_by(models.ContentReview.id.desc())
        .limit(limit)
        .all()
    )
    out = []
    for r in rows:
        it = _item(db, r.target_type, r.target_id, "committee", me=current) or {
            "target_type": r.target_type,
            "target_id": r.target_id,
            "title": "（内容已删除）",
            "preview": "",
            "url": "",
            "author": None,
        }
        out.append({
            **it,
            "review_id": r.id,
            "note": r.reviewer_note or "",
            "status": r.status,      # pending / approved / rejected
            "resolved_by": r.resolved_by or "",   # '' / admin / committee_vote
            "at": r.created_at.isoformat() if r.created_at else None,
            "handled_at": r.handled_at.isoformat() if r.handled_at else None,
        })
    return {"items": out, "stats": stats_of(db, current)}
