"""举报系统：提交举报 + 管理员审核。"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, serializers
from ..deps import get_current_admin, get_current_user, get_db

router = APIRouter(prefix="/reports", tags=["reports"])

REPORT_TYPES = (
    "work", "post", "studio",
    # 评论用**精确类型**（站长 2026-10-01：「评论加上举报功能」）：
    # 前端评论区本来就在用 work_comment / post_comment（点赞、表情也用这两个），
    # 风纪委员会的巡逻队列也只认这两个，所以举报必须用同一套，
    # 否则「被举报的评论」进不了风纪委员的队列。
    "work_comment", "post_comment",
    # 老的泛化 "comment" 保留兼容（历史数据）：它靠「先查帖子评论、再查稿件评论」猜，
    # 两表 id 相同时会指错对象，新客户端不要再传。
    "comment",
)


def _target_preview(db: Session, target_type: str, target_id: int):
    """被举报对象的摘要。带上 id 与站内路径，后台可以直接跳过去看。"""
    if target_type == "work":
        w = db.get(models.Work, target_id)
        if not w:
            return None
        return {"title": w.title, "author": w.author.display_name if w.author else None,
                "author_id": w.user_id, "path": f"/works/{w.id}", "status": w.status,
                "preview": (w.description or "")[:80]}
    if target_type == "post":
        p = db.get(models.Post, target_id)
        if not p:
            return None
        return {"title": p.title, "author": p.author.display_name if p.author else None,
                "author_id": p.user_id, "path": f"/posts/{p.id}", "status": p.status,
                "preview": (p.content or "")[:80]}
    if target_type == "studio":
        s = db.get(models.Studio, target_id)
        if s:
            return {"title": f"工作室《{s.name}》", "author": s.owner.display_name if s.owner else None,
                    "author_id": s.owner_id, "path": f"/studios/{s.id}", "status": s.status,
                    "preview": (s.description or "")[:80]}
        return None
    # 精确类型的评论举报（新前端用，id 不会和另一张表撞车）
    if target_type in ("work_comment", "post_comment"):
        c = db.get(models.WorkComment if target_type == "work_comment" else models.PostComment, target_id)
        if not c:
            return None
        is_post = target_type == "post_comment"
        parent = db.get(models.Post, c.post_id) if is_post else db.get(models.Work, c.work_id)
        return {
            "content": (c.content or "")[:80],
            "title": (c.content or "")[:80],
            "author": c.user.display_name if c.user else None,
            "author_id": c.user_id,
            "status": c.status,
            "path": (f"/posts/{c.post_id}" if is_post else f"/works/{c.work_id}") if parent else "",
            "parent_title": parent.title if parent else "",
        }
    # 老数据：泛化 comment —— 先查帖子评论，再查稿件评论（两张表 id 可能撞车，仅兼容历史）
    c = db.get(models.PostComment, target_id) or db.get(models.WorkComment, target_id)
    if not c:
        return None
    is_post = isinstance(c, models.PostComment)
    parent = db.get(models.Post, c.post_id) if is_post else db.get(models.Work, c.work_id)
    return {
        "content": (c.content or "")[:80],
        "title": (c.content or "")[:80],
        "author": c.user.display_name if c.user else None,
        "author_id": c.user_id,
        "status": c.status,
        # 评论没独立页面，跳到它所属的帖子/稿件
        "path": (f"/posts/{c.post_id}" if is_post else f"/works/{c.work_id}") if parent else "",
        "parent_title": parent.title if parent else "",
    }


def _report_out(db: Session, r: models.Report, target_counts: dict | None = None,
                reporter_counts: dict | None = None) -> dict:
    key = (r.target_type, r.target_id)
    tc = (target_counts or {}).get(key)
    rc = (reporter_counts or {}).get(r.reporter_id)
    return {
        "id": r.id,
        "target_type": r.target_type,
        "target_id": r.target_id,
        "reason": r.reason,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "note": r.note or "",
        "handled_at": r.handled_at.isoformat() if r.handled_at else None,
        "handled_by": serializers.user_brief(r.handler) if r.handler else None,
        "reporter": serializers.user_brief(r.reporter) if r.reporter else None,
        "target_preview": _target_preview(db, r.target_type, r.target_id),
        # 同一条内容一共被举报了几次、其中几条还没处理（反复举报要能一眼看出来）
        "target_total": (tc or {}).get("total", 1),
        "target_pending": (tc or {}).get("pending", 0),
        # 这个举报人一共报过多少、被驳回过多少（滥用举报的人也要看得出来）
        "reporter_total": (rc or {}).get("total", 1),
        "reporter_dismissed": (rc or {}).get("dismissed", 0),
    }


@router.post("", status_code=201)
def create_report(body: dict, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    target_type = body.get("target_type")
    target_id = body.get("target_id")
    reason = body.get("reason") or "其他"
    if target_type not in REPORT_TYPES:
        raise HTTPException(status_code=400, detail="无效的举报类型")
    if not isinstance(target_id, int):
        raise HTTPException(status_code=400, detail="无效的举报对象")
    existing = db.query(models.Report).filter_by(reporter_id=user.id, target_type=target_type, target_id=target_id).first()
    if existing:
        return {"ok": True, "already": True}
    r = models.Report(reporter_id=user.id, target_type=target_type, target_id=target_id, reason=reason)
    db.add(r)
    db.commit()
    db.refresh(r)
    # 举报阈值：同一稿件/帖子被举报达到 3 次 -> 自动下架待审（人工复核）
    if target_type in ("work", "post"):
        pending_count = db.query(models.Report).filter_by(target_type=target_type, target_id=target_id).count()
        if pending_count >= 3:
            if target_type == "work":
                w = db.get(models.Work, target_id)
                if w and w.status == "published":
                    w.status = "pending"
                    db.commit()
                    serializers.notify_user(db, w.user_id, None, "admin", "work", target_id, f"你的稿件《{w.title}》因多次举报已被暂时下架，等待管理员复核")
            else:
                p = db.get(models.Post, target_id)
                if p:
                    serializers.notify_user(db, p.user_id, None, "admin", "post", target_id, f"你的帖子《{p.title}》多次被举报，管理员将尽快复核")
    return {"ok": True, "id": r.id}


@router.get("/me")
def my_reports(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """我的举报及处理进度。"""
    rows = db.query(models.Report).filter_by(reporter_id=user.id).order_by(models.Report.id.desc()).limit(100).all()
    return [
        {
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "reason": r.reason,
            "status": r.status,
            "note": r.note or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "handled_at": r.handled_at.isoformat() if r.handled_at else None,
        }
        for r in rows
    ]


@router.get("")
def list_reports(
    response: Response,
    status: str | None = None,
    target_type: str | None = None,
    target_id: int | None = None,
    handled_by: str | None = None,
    days: int | None = None,
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """举报列表（后台）。状态/类型/具体对象/处理人/时间范围/关键词筛选 + 分页，总数走 X-Total-Count。

    原来这里是 `q.all()` 全量返回，举报一多就会把整个列表一次性塞给前端。
    """
    query = db.query(models.Report)
    if status:
        query = query.filter(models.Report.status == status)
    if target_type in REPORT_TYPES:
        query = query.filter(models.Report.target_type == target_type)
    if target_id is not None:
        query = query.filter(models.Report.target_id == target_id)
    # 处理人：支持 uid（前端下拉给的就是 uid）或内部 id；`none` 只看还没人处理的
    if handled_by and handled_by != "全部":
        if handled_by == "none":
            query = query.filter(models.Report.handled_by.is_(None))
        else:
            # ⚠️ uid 本身就是纯数字（如 59893629），不能用 isdigit() 去区分「uid 还是内部 id」——
            #    第一版就是这么写的，结果把 uid 当成内部 id，筛选永远返回 0 条。
            #    正确顺序：先按 uid 查，查不到再退回内部 id。
            key = str(handled_by)
            handler = db.query(models.User).filter(models.User.uid == key).first()
            if handler is None and key.isdigit():
                handler = db.get(models.User, int(key))
            query = query.filter(models.Report.handled_by == (handler.id if handler else -1))
    # 时间范围：只看最近 N 天提交的举报
    if days and days > 0:
        query = query.filter(models.Report.created_at >= models.now() - timedelta(days=int(days)))
    if q and q.strip():
        query = query.filter(models.Report.reason.like(f"%{q.strip()}%"))

    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    rows = (
        query.order_by(models.Report.id.desc())
        .offset(max(0, skip))
        .limit(min(max(1, limit), 200))
        .all()
    )

    # 批量取「同内容的举报数」与「举报人的举报数」，避免每条举报各查两次
    keys = {(r.target_type, r.target_id) for r in rows}
    target_counts: dict = {}
    for ttype, tid in keys:
        grouped = (
            db.query(models.Report.status, func.count(models.Report.id))
            .filter(models.Report.target_type == ttype, models.Report.target_id == tid)
            .group_by(models.Report.status)
            .all()
        )
        target_counts[(ttype, tid)] = {
            "total": sum(int(n) for _, n in grouped),
            "pending": sum(int(n) for s, n in grouped if s == "pending"),
        }
    reporter_ids = {r.reporter_id for r in rows}
    reporter_counts: dict = {}
    if reporter_ids:
        grouped = (
            db.query(models.Report.reporter_id, models.Report.status, func.count(models.Report.id))
            .filter(models.Report.reporter_id.in_(reporter_ids))
            .group_by(models.Report.reporter_id, models.Report.status)
            .all()
        )
        for uid, st, n in grouped:
            slot = reporter_counts.setdefault(uid, {"total": 0, "dismissed": 0})
            slot["total"] += int(n)
            if st == "dismissed":
                slot["dismissed"] += int(n)

    return [_report_out(db, r, target_counts, reporter_counts) for r in rows]


def _apply_handle(db: Session, r: models.Report, status_: str, note: str, admin: models.User) -> None:
    r.status = status_
    r.note = (note or "")[:200]
    r.handled_by = admin.id
    r.handled_at = models.now()


@router.post("/{report_id}/handle")
def handle_report(
    report_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """处理 / 驳回一条举报，可带处理备注（会一并告知举报人）。"""
    r = db.get(models.Report, report_id)
    if r is None:
        raise HTTPException(status_code=404, detail="举报不存在")
    status_ = body.get("status")
    if status_ not in ("handled", "dismissed"):
        raise HTTPException(status_code=400, detail="无效的处理状态")
    note = str(body.get("note") or "")
    _apply_handle(db, r, status_, note, admin)
    db.commit()
    serializers.log_admin_action(
        db, admin.id, f"report_{status_}", r.target_type, r.target_id,
        f"{'处理' if status_ == 'handled' else '驳回'}举报 #{r.id}（{r.reason}）" + (f"：{r.note}" if r.note else ""),
    )
    reporter = db.get(models.User, r.reporter_id)
    if reporter is not None:
        label = "已处理" if status_ == "handled" else "已驳回"
        msg = f"你举报的内容（{r.target_type}）已被管理员{label}"
        if r.note:
            msg += f"，说明：{r.note}"
        serializers.notify_user(db, reporter.id, admin.id, "admin", r.target_type, r.target_id, msg)
    return {"ok": True, "status": r.status, "note": r.note,
            "handled_at": r.handled_at.isoformat() if r.handled_at else None}
