"""管理员后台：统计、用户管理(封禁/临时封禁/改资料)、内容管理(删除/置顶/审核/精选)、
操作日志、系统公告、敏感词管理、首页 Banner 管理。

所有管理操作都会：1) 记录操作日志  2) 在适当时通知被操作用户。
"""
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import cascade, chat_core, cloudvars, committee, config, imageurl, models, purge, schemas, sensitive, serializers, storage_quota, studio_core, switches
from ..deps import get_current_admin, get_db

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_by_uid(db: Session, uid: str) -> models.User | None:
    return db.query(models.User).filter(models.User.uid == uid).first()


def _parse_ban_until(value: str | None) -> datetime | None:
    """解析封禁时长：permanent -> None(表示永久)；1d/7d/30d -> 对应时长；ISO 时间字符串 -> 原样。"""
    if value is None or value == "permanent":
        return None
    now = datetime.now(timezone.utc)
    unit = (value or "").strip().lower()
    if unit.endswith("d") and unit[:-1].isdigit():
        return now + timedelta(days=int(unit[:-1]))
    if unit.endswith("h") and unit[:-1].isdigit():
        return now + timedelta(hours=int(unit[:-1]))
    try:
        return datetime.fromisoformat(unit)
    except ValueError:
        raise HTTPException(status_code=400, detail="封禁时长格式不正确（如 permanent / 1d / 7d / 30d 或 ISO 时间）")


@router.get("/stats")
def stats(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    days = [(now - timedelta(days=i)).strftime("%m-%d") for i in range(6, -1, -1)]
    user_series = []
    work_series = []
    post_series = []
    comment_series = []
    for d in days:
        start = datetime.strptime(d, "%m-%d").replace(year=now.year, tzinfo=timezone.utc)
        end = start + timedelta(days=1)
        user_series.append(db.query(models.User).filter(models.User.created_at >= start, models.User.created_at < end).count())
        work_series.append(db.query(models.Work).filter(models.Work.created_at >= start, models.Work.created_at < end).count())
        post_series.append(db.query(models.Post).filter(models.Post.created_at >= start, models.Post.created_at < end).count())
        comment_series.append(
            db.query(models.PostComment).filter(models.PostComment.created_at >= start, models.PostComment.created_at < end).count()
            + db.query(models.WorkComment).filter(models.WorkComment.created_at >= start, models.WorkComment.created_at < end).count()
        )
    banned = db.query(models.User).filter(
        models.User.is_banned.is_(True) | (models.User.ban_until > now)
    ).count()
    # 分类分布（稿件）
    cat_rows = db.query(models.Work.category, func.count(models.Work.id)).group_by(models.Work.category).all()
    categories = [{"name": c or "其他", "count": n} for c, n in cat_rows]
    categories.sort(key=lambda x: x["count"], reverse=True)
    # 稿件状态分布
    status_rows = db.query(models.Work.status, func.count(models.Work.id)).group_by(models.Work.status).all()
    work_statuses = {s or "unknown": n for s, n in status_rows}
    return {
        "users": db.query(models.User).count(),
        "works": db.query(models.Work).count(),
        "posts": db.query(models.Post).count(),
        "comments": db.query(models.PostComment).count() + db.query(models.WorkComment).count(),
        "studios": db.query(models.Studio).count(),
        "pending_reports": db.query(models.Report).filter(models.Report.status == "pending").count(),
        # 风纪委员会（站长 2026-10-01）：待审申请 + 风纪委员送来的待复审内容，左侧导航角标用
        "pending_committee": (
            db.query(models.User).filter(models.User.committee_status == "pending").count()
            + db.query(models.ContentReview)
            .filter(models.ContentReview.source == "committee", models.ContentReview.status == "pending")
            .count()
        ),
        "pending_works": db.query(models.Work).filter(models.Work.status == "pending").count(),
        "banned_users": banned,
        # 回收站条数 + 敏感词待审（后台新面板/开关需要的两个指标）
        "recycle_total": db.query(models.RecycleBin).count(),
        "pending_sensitive": db.query(models.ContentReview).filter(models.ContentReview.status == "pending").count(),
        # 存储扩容申请待审数（后台左侧导航的角标用）
        "pending_scratch_quota": db.query(models.ScratchQuotaRequest)
        .filter(models.ScratchQuotaRequest.status == "pending")
        .count(),
        # 全站上传占用（GB，后台概览）与用量排行前几名
        "storage_total_mb": int(math.ceil(storage_quota.total_used_bytes(db) / 1048576)),
        "storage_top": storage_quota.users_used_mb(db, 5),
        "scratch_works": db.query(models.Work).filter(models.Work.work_type == "scratch").count(),
        "series": {
            "days": days,
            "users": user_series,
            "works": work_series,
            "posts": post_series,
            "comments": comment_series,
        },
        "categories": categories,
        "work_statuses": work_statuses,
    }


# ==================== 用户管理 ====================
# 排序方式：键 -> (排序表达式, 中文名)。全是库里的列，不需要把每个人的总经验算一遍
# （总经验要跑 4 条聚合 SQL/人，50 人就是 200 条，列表页扛不住；准确的经验构成在详情里给）。
USER_SORTS = {
    "newest": "注册时间（新→旧）",
    "oldest": "注册时间（旧→新）",
    "login": "最后登录（近→远）",
    "fish": "小鱼干（多→少）",
    "signin": "签到天数（多→少）",
    "xpbonus": "调整经验（多→少）",
}


@router.get("/users")
def list_users(
    response: Response,
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
    login: str | None = None,
    verify: str | None = None,
    region: str | None = None,
    sort: str = "newest",
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """用户列表：关键词 + 角色/状态/登录/实名筛选 + 排序 + 分页。

    总数走 `X-Total-Count` 响应头，保持返回体仍是纯数组（前端与导出脚本的既有约定不变）。
    """
    query = db.query(models.User)
    if q:
        qs = q.strip()
        if qs.isdigit():
            # UID 精确匹配优先，同时保留用户名/昵称模糊
            query = query.filter(
                or_(models.User.uid == qs, models.User.username.contains(qs), models.User.nickname.contains(qs))
            )
        else:
            query = query.filter(models.User.username.contains(qs) | models.User.nickname.contains(qs))
    if role in ("user", "admin"):
        query = query.filter(models.User.role == role)

    now_ = models.now()
    if status == "banned":
        query = query.filter(or_(models.User.is_banned.is_(True), models.User.ban_until > now_))
    elif status == "deactivated":
        query = query.filter(models.User.is_deactivated.is_(True))
    elif status == "active":
        query = query.filter(
            models.User.is_banned.is_(False),
            models.User.is_deactivated.is_(False),
            or_(models.User.ban_until.is_(None), models.User.ban_until <= now_),
        )

    if login == "never":
        query = query.filter(models.User.last_login_at.is_(None))
    elif login and login.isdigit():
        query = query.filter(models.User.last_login_at >= now_ - timedelta(days=int(login)))

    if verify == "ok":
        query = query.filter(or_(models.User.verify_state == "ok", models.User.verify_state.is_(None)))
    elif verify == "pending":
        query = query.filter(models.User.verify_state.in_(("awaiting_passport", "pending_review")))
    elif verify == "rejected":
        query = query.filter(models.User.verify_state == "rejected")

    # IP 属地筛选：空串/全部 不筛；`unknown` 只看没识别出属地的
    if region and region != "全部":
        if region == "unknown":
            query = query.filter(or_(models.User.ip_region.is_(None), models.User.ip_region == ""))
        else:
            query = query.filter(models.User.ip_region == region)

    if sort == "oldest":
        order = [models.User.id.asc()]
    elif sort == "login":
        # 没登录过的排最后（NULLS LAST 在不同 SQLite 版本上表现不一，用 is_(None) 显式排序）
        order = [models.User.last_login_at.is_(None), models.User.last_login_at.desc()]
    elif sort == "fish":
        order = [models.User.fish_count.desc()]
    elif sort == "signin":
        order = [models.User.signin_days.desc()]
    elif sort == "xpbonus":
        order = [models.User.xp_bonus.desc()]
    else:
        order = [models.User.id.desc()]

    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    users = query.order_by(*order).offset(max(0, skip)).limit(min(limit, 200)).all()

    result = []
    # 同 IP 账号数：一次分组查询搞定，避免每行各查一次（马甲排查用）
    ip_counts = {
        ip: n
        for ip, n in db.query(models.User.last_ip, func.count(models.User.id))
        .filter(models.User.last_ip.isnot(None), models.User.last_ip != "")
        .group_by(models.User.last_ip)
        .all()
    }
    for u in users:
        item = serializers.user_brief(u)
        item["created_at"] = u.created_at.isoformat() if u.created_at else None
        item["works_count"] = db.query(models.Work).filter(models.Work.user_id == u.id).count()
        item["posts_count"] = db.query(models.Post).filter(models.Post.user_id == u.id).count()
        item["last_login_at"] = u.last_login_at.isoformat() if u.last_login_at else None
        item["ban_until"] = u.ban_until.isoformat() if u.ban_until else None
        item["ban_reason"] = u.ban_reason or ""
        item["sensitive_exempt"] = bool(getattr(u, "sensitive_exempt", False))
        item["fish_count"] = u.fish_count or 0
        item["signin_days"] = u.signin_days or 0
        item["xp_bonus"] = u.xp_bonus or 0
        item["has_local_pwd"] = bool(getattr(u, "local_pwd_set", 0))
        # IP 属地：后台管理用途，**不受用户「展示属地」开关影响**，直接给库里的真值；
        # last_ip 只给管理员看（批量排查同 IP 多账号注册时要用）。
        item["ip_region"] = u.ip_region or ""
        item["last_ip"] = u.last_ip or ""
        item["ip_region_at"] = u.ip_region_at.isoformat() if u.ip_region_at else None
        # 同 IP 多账号：同一个 last_ip 下有几个账号（马甲排查用；只统计能识别到 IP 的）
        item["same_ip_count"] = ip_counts.get(u.last_ip or "", 0)
        # 绑定情况：一眼看出是「只绑了编程猫所以没有密码」还是真有本站账号
        item["bind"] = {
            "codemao": bool(u.codemao_uid),
            "github": bool(u.github_id),
            "email": serializers.is_email_bound(u),
        }
        result.append(item)
    return result


@router.get("/user-regions")
def list_user_regions(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """用户属地分布：给「按属地筛选」当选项，也能一眼看出用户都来自哪儿。

    只统计**识别出属地**的用户（`users.ip_region` 是最近一次识别的结果）；
    另外单独回一个 `unknown` 计数，方便排查「怎么这么多没属地」。
    """
    rows = (
        db.query(models.User.ip_region, func.count(models.User.id))
        .filter(models.User.ip_region.isnot(None), models.User.ip_region != "")
        .group_by(models.User.ip_region)
        .all()
    )
    items = sorted(
        ({"region": r, "count": n} for r, n in rows),
        key=lambda x: x["count"],
        reverse=True,
    )
    unknown = db.query(models.User).filter(
        or_(models.User.ip_region.is_(None), models.User.ip_region == "")
    ).count()
    return {"items": items, "unknown": unknown, "total": db.query(models.User).count()}


@router.get("/users/{uid}/detail")
def user_detail(uid: str, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """用户详情：完整资料 + 内容统计 + 操作历史。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    data = serializers.user_public(target, db, target.id)
    data["email"] = target.email
    data["last_login_at"] = target.last_login_at.isoformat() if target.last_login_at else None
    data["invited_by"] = serializers.user_brief(db.get(models.User, target.invited_by)) if target.invited_by else None
    data["logs"] = [
        {"action": l.action, "detail": l.detail, "created_at": l.created_at.isoformat() if l.created_at else None}
        for l in db.query(models.AdminLog).filter(models.AdminLog.target_type == "user", models.AdminLog.target_id == target.id).order_by(models.AdminLog.id.desc()).limit(20).all()
    ]
    data["reports"] = [
        {"id": r.id, "target_type": r.target_type, "reason": r.reason, "status": r.status}
        for r in db.query(models.Report).filter_by(reporter_id=target.id).order_by(models.Report.id.desc()).limit(20).all()
    ]
    # 后台专供：经验构成、绑定情况、工作室、内容规模、开关状态
    data["xp_breakdown"] = serializers.xp_breakdown(db, target)
    data["fish_count"] = target.fish_count or 0
    data["signin_days"] = target.signin_days or 0
    data["xp_bonus"] = target.xp_bonus or 0
    data["codemao_xp_bonus"] = target.codemao_xp_bonus or 0
    data["ban_reason"] = target.ban_reason or ""
    data["ban_until"] = target.ban_until.isoformat() if target.ban_until else None
    data["sensitive_exempt"] = bool(getattr(target, "sensitive_exempt", False))
    data["token_version"] = target.token_version or 0
    data["has_local_pwd"] = bool(getattr(target, "local_pwd_set", 0))
    data["show_personal"] = bool(target.show_personal)
    data["show_cover"] = bool(target.show_cover)
    data["bind"] = {
        "codemao": bool(target.codemao_uid),
        "codemao_uid": target.codemao_uid or "",
        "github": bool(target.github_id),
        "github_login": target.github_login or "",
        "email": serializers.is_email_bound(target),
    }
    data["comments_count"] = (
        db.query(models.PostComment).filter(models.PostComment.user_id == target.id).count()
        + db.query(models.WorkComment).filter(models.WorkComment.user_id == target.id).count()
    )
    data["notifications_count"] = db.query(models.Notification).filter(models.Notification.user_id == target.id).count()
    rows = (
        db.query(models.StudioMember, models.Studio)
        .join(models.Studio, models.Studio.id == models.StudioMember.studio_id)
        .filter(models.StudioMember.user_id == target.id)
        .all()
    )
    data["studios"] = [
        {
            "id": s.id,
            "name": s.name,
            "role": m.role,
            "status": m.status,
            "muted": bool(m.muted),
        }
        for m, s in rows
    ]
    return data


@router.get("/users/banned")
def banned_users(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """封禁用户列表（含到期提醒）。"""
    from datetime import timezone as _tz

    now = datetime.now(timezone.utc)
    rows = db.query(models.User).filter(models.User.is_banned.is_(True) | (models.User.ban_until > now)).order_by(models.User.id.desc()).all()
    result = []
    for u in rows:
        item = serializers.user_brief(u)
        item["ban_until"] = u.ban_until.isoformat() if u.ban_until else None
        result.append(item)
    return result


@router.get("/export/users.csv")
def export_users_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出用户数据 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "uid", "username", "nickname", "email", "role", "ip_region", "last_ip", "created_at", "last_login_at", "works", "posts"])
    for u in db.query(models.User).order_by(models.User.id.asc()).all():
        w.writerow([
            u.id, u.uid, u.username, u.nickname, u.email, u.role,
            u.ip_region or "", u.last_ip or "",
            u.created_at.isoformat() if u.created_at else "",
            u.last_login_at.isoformat() if u.last_login_at else "",
            db.query(models.Work).filter(models.Work.user_id == u.id).count(),
            db.query(models.Post).filter(models.Post.user_id == u.id).count(),
        ])
    from fastapi.responses import Response

    return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=users.csv"})


def _csv_response(buf, filename: str):
    from fastapi.responses import Response

    return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/export/works.csv")
def export_works_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出稿件数据 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "title", "category", "tags", "status", "views", "feed_count", "author_uid", "author", "created_at"])
    for v in db.query(models.Work).order_by(models.Work.id.asc()).all():
        w.writerow([
            v.id, v.title, v.category, v.tags, v.status, v.views, v.feed_count or 0,
            v.author.uid if v.author else "", v.author.display_name if v.author else "",
            v.created_at.isoformat() if v.created_at else "",
        ])
    return _csv_response(buf, "works.csv")


@router.get("/export/posts.csv")
def export_posts_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出帖子数据 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "title", "category", "views", "feed_count", "author_uid", "author", "created_at"])
    for p in db.query(models.Post).order_by(models.Post.id.asc()).all():
        w.writerow([
            p.id, p.title, p.category, p.views, p.feed_count or 0,
            p.author.uid if p.author else "", p.author.display_name if p.author else "",
            p.created_at.isoformat() if p.created_at else "",
        ])
    return _csv_response(buf, "posts.csv")


@router.get("/export/comments.csv")
def export_comments_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出评论数据 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "target_type", "target_id", "content", "author_uid", "author", "created_at"])
    for c in db.query(models.PostComment).order_by(models.PostComment.id.asc()).all():
        w.writerow(["post", c.post_id, c.content, c.user.uid if c.user else "", c.user.display_name if c.user else "", c.created_at.isoformat() if c.created_at else ""])
    for c in db.query(models.WorkComment).order_by(models.WorkComment.id.asc()).all():
        w.writerow(["work", c.work_id, c.content, c.user.uid if c.user else "", c.user.display_name if c.user else "", c.created_at.isoformat() if c.created_at else ""])
    return _csv_response(buf, "comments.csv")


@router.get("/export/reports.csv")
def export_reports_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出举报数据 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "target_type", "target_id", "reason", "status", "reporter_uid", "reporter", "created_at"])
    for r in db.query(models.Report).order_by(models.Report.id.asc()).all():
        w.writerow([
            r.id, r.target_type, r.target_id, r.reason, r.status,
            r.reporter.uid if r.reporter else "", r.reporter.display_name if r.reporter else "",
            r.created_at.isoformat() if r.created_at else "",
        ])
    return _csv_response(buf, "reports.csv")


@router.get("/export/logs.csv")
def export_logs_csv(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """导出操作日志 CSV。"""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "action", "detail", "admin_uid", "admin", "created_at"])
    for l in db.query(models.AdminLog).order_by(models.AdminLog.id.asc()).all():
        w.writerow([
            l.id, l.action, l.detail,
            l.admin.uid if l.admin else "", l.admin.display_name if l.admin else "",
            l.created_at.isoformat() if l.created_at else "",
        ])
    return _csv_response(buf, "logs.csv")


@router.post("/users/{uid}/ban")
def ban_user(
    uid: str,
    body: dict | None = None,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="不能封禁管理员")
    reason = (body or {}).get("reason") if isinstance(body, dict) else ""
    until = _parse_ban_until((body or {}).get("until") if isinstance(body, dict) else None)
    target.ban_reason = (reason or "")[:200]
    if until is None:
        target.is_banned = True
        target.ban_until = None
        note = "你已被管理员永久封禁"
        if reason:
            note += f"，原因：{reason}"
    else:
        target.is_banned = False
        target.ban_until = until
        note = f"你已被管理员封禁至 {until.strftime('%Y-%m-%d %H:%M')}"
        if reason:
            note += f"，原因：{reason}"
    db.commit()
    serializers.log_admin_action(db, admin.id, "ban", "user", target.id, note)
    serializers.notify_admin_action(db, target.id, admin.id, note, "user", target.id)
    return {"ok": True, "is_banned": target.effective_banned, "ban_until": target.ban_until.isoformat() if target.ban_until else None}


@router.post("/users/{uid}/unban")
def unban_user(uid: str, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.is_banned = False
    target.ban_until = None
    target.ban_reason = ""
    db.commit()
    serializers.log_admin_action(db, admin.id, "unban", "user", target.id, f"解封了 {target.display_name}")
    serializers.notify_admin_action(db, target.id, admin.id, "你的账号已被管理员解封，欢迎回来！", "user", target.id)
    return {"ok": True, "is_banned": False}


@router.patch("/users/{uid}")
def edit_user(
    uid: str,
    body: schemas.AdminUserUpdate,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员修改他人资料：昵称/简介/头像/临时封禁时间。每次修改都通知该用户。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    changes: list[str] = []
    if body.nickname is not None:
        new_nick = body.nickname.strip()
        if sensitive.contains_sensitive(new_nick, db):
            raise HTTPException(status_code=400, detail="昵称包含敏感词")
        if new_nick != target.nickname:
            changes.append(f"昵称修改为「{new_nick}」")
            target.nickname = new_nick
    if body.bio is not None and body.bio != target.bio:
        changes.append("简介已更新")
        target.bio = body.bio
    if body.avatar_url is not None and body.avatar_url != (target.avatar_url or ""):
        changes.append("头像已更新")
        target.avatar_url = imageurl.check_uploaded_image(body.avatar_url, "头像")
    if body.ban_until is not None:
        if body.ban_until == "":
            target.ban_until = None
            changes.append("临时封禁已解除")
        else:
            until = _parse_ban_until(body.ban_until)
            target.ban_until = until
            target.is_banned = False
            changes.append(f"临时封禁至 {until.strftime('%Y-%m-%d %H:%M')}")
    # 豁免违禁词审核：开了之后他发的稿件/帖子/评论不做敏感词检测（既不置待审也不进队列）
    if body.sensitive_exempt is not None and bool(body.sensitive_exempt) != bool(target.sensitive_exempt):
        target.sensitive_exempt = bool(body.sensitive_exempt)
        changes.append("已开启违禁词审核豁免" if target.sensitive_exempt else "已关闭违禁词审核豁免")
    db.commit()
    db.refresh(target)
    detail = "；".join(changes) if changes else "资料无变动"
    serializers.log_admin_action(db, admin.id, "edit_user", "user", target.id, detail)
    if changes:
        serializers.notify_admin_action(db, target.id, admin.id, f"管理员修改了你的资料：{detail}", "user", target.id)
    return serializers.user_brief(target)


@router.post("/users/{uid}/force_logout")
def force_logout_user(uid: str, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """强制下线：把 token_version +1，该用户手上所有 token 立刻失效（下次请求 401）。

    用于账号疑似被盗、或用户主动求助「帮我把别的设备踢掉」。用户重新登录即可继续用。
    """
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="不能把自己踢下线")
    target.token_version = (target.token_version or 0) + 1
    db.commit()
    serializers.log_admin_action(db, admin.id, "force_logout", "user", target.id, f"强制 {target.display_name} 下线（所有设备）")
    serializers.notify_admin_action(db, target.id, admin.id, "你的登录状态已被管理员重置，请重新登录。", "user", target.id)
    return {"ok": True, "token_version": target.token_version}


@router.post("/users/batch")
def batch_users(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """批量操作用户。一次最多 200 个，管理员账号与（对封禁类）自己会被跳过并回报。

    action：ban / unban / force_logout / xp / fish
    """
    uids = [str(x) for x in (body.get("uids") or [])][:200]
    action = body.get("action")
    if action not in ("ban", "unban", "force_logout", "xp", "fish"):
        raise HTTPException(status_code=400, detail="无效的批量操作")
    reason = str(body.get("reason") or "")[:200]

    affected = 0
    skipped: list[str] = []
    detail_bits: list[str] = []

    if action in ("xp", "fish"):
        try:
            delta = int(body.get("delta") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="数量必须是整数")
        if delta == 0:
            raise HTTPException(status_code=400, detail="数量不能为 0")
        cap = 10000 if action == "xp" else 100000
        if abs(delta) > cap:
            raise HTTPException(status_code=400, detail=f"数量范围 -{cap} ~ {cap}")
        detail_bits.append(f"{delta:+d}")

    until = _parse_ban_until(body.get("until")) if action == "ban" else None

    seen = set()
    for uid in uids:
        target = _user_by_uid(db, uid)
        if target is None or target.id in seen:
            skipped.append(uid)
            continue
        seen.add(target.id)
        if target.role == "admin":
            skipped.append(uid)
            continue
        if action == "ban":
            target.ban_reason = reason
            if until is None:
                target.is_banned = True
                target.ban_until = None
                note = "你已被管理员永久封禁"
            else:
                target.is_banned = False
                target.ban_until = until
                note = f"你已被管理员封禁至 {until.strftime('%Y-%m-%d %H:%M')}"
            if reason:
                note += f"，原因：{reason}"
        elif action == "unban":
            target.is_banned = False
            target.ban_until = None
            target.ban_reason = ""
            note = "你的账号已被管理员解封，欢迎回来！"
        elif action == "force_logout":
            if target.id == admin.id:
                skipped.append(uid)
                continue
            target.token_version = (target.token_version or 0) + 1
            note = "你的登录状态已被管理员重置，请重新登录。"
        elif action == "xp":
            target.xp_bonus = (target.xp_bonus or 0) + int(body["delta"])
            note = f"管理员调整了你的经验：{int(body['delta']):+d}"
        else:  # fish
            target.fish_count = max(0, (target.fish_count or 0) + int(body["delta"]))
            note = f"管理员调整了你的小鱼干：{int(body['delta']):+d}"
        affected += 1
        serializers.notify_admin_action(db, target.id, admin.id, note, "user", target.id)
    db.commit()

    label = {"ban": "批量封禁", "unban": "批量解封", "force_logout": "批量强制下线", "xp": "批量调整经验", "fish": "批量调整小鱼干"}[action]
    serializers.log_admin_action(
        db, admin.id, f"batch_{action}", "user", None,
        f"{label} {affected} 人" + (f"（{'；'.join(detail_bits)}）" if detail_bits else "") + (f"，跳过 {len(skipped)} 个" if skipped else ""),
    )
    return {"affected": affected, "skipped": skipped}


@router.post("/users/{uid}/purge")
def purge_user(
    uid: str,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """一键清空用户内容：稿件下架、帖子/评论删除。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="不能清空管理员账号")
    works = db.query(models.Work).filter(models.Work.user_id == target.id).all()
    for w in works:
        if w.status == "published":
            w.status = "pending"
    posts = db.query(models.Post).filter(models.Post.user_id == target.id).all()
    for p in posts:
        db.delete(p)
    db.query(models.PostComment).filter(models.PostComment.user_id == target.id).delete()
    db.query(models.WorkComment).filter(models.WorkComment.user_id == target.id).delete()
    db.commit()
    serializers.log_admin_action(db, admin.id, "purge_user", "user", target.id, f"清空用户 {target.display_name} 的全部内容（{len(works)} 稿件下架，{len(posts)} 帖子删除）")
    serializers.notify_admin_action(db, target.id, admin.id, "你的全部内容已被管理员清空（违规内容处理）", "user", target.id)
    return {"works": len(works), "posts": len(posts)}


@router.get("/users/{uid}/delete-preview")
def user_delete_preview(
    uid: str,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """彻底删除前的预览：这个账号到底牵连多少东西（只统计，不动数据）。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        return purge.preview(db, target)
    except purge.PurgeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/users/{uid}")
def user_delete(
    uid: str,
    confirm: str = "",
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """彻底删除账号 —— 像从来没存在过一样。

    必须把用户名原样传进 `confirm` 才执行：不可恢复的操作不能只靠一次点击。
    管理员账号与自己都删不了。
    """
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="不能删除管理员账号")
    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    if (confirm or "").strip() != target.username:
        raise HTTPException(status_code=400, detail=f"请输入要删除的用户名（{target.username}）以确认")

    info = {"username": target.username, "display_name": target.display_name, "uid": target.uid, "id": target.id}
    try:
        result = purge.purge(db, target)
    except purge.PurgeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"删除失败，已整体回滚：{e}")

    # 审计日志在删除之后写：这个账号做过什么，是站点的安全记录，不随账号一起消失
    serializers.log_admin_action(
        db, admin.id, "delete_user", "user", info["id"],
        f"彻底删除账号 @{info['username']}（{info['display_name']} · UID {info['uid']}）："
        f"{result['total_rows']} 行数据、{result['files_removed']} 个文件",
    )
    result["display_name"] = info["display_name"]
    return result


@router.post("/reports/batch")
def batch_reports(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """举报批量处理。可带统一备注，并记录处理人与处理时间。"""
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()][:200]
    status_ = body.get("status")
    if status_ not in ("handled", "dismissed"):
        raise HTTPException(status_code=400, detail="无效的处理状态")
    if not ids:
        raise HTTPException(status_code=400, detail="未选择举报")
    note = str(body.get("note") or "")[:200]
    now_ = models.now()
    count = 0
    for rid in ids:
        r = db.get(models.Report, rid)
        if r is not None:
            r.status = status_
            r.note = note
            r.handled_by = admin.id
            r.handled_at = now_
            count += 1
    db.commit()
    label = "处理" if status_ == "handled" else "驳回"
    serializers.log_admin_action(db, admin.id, f"batch_report_{status_}", "report", None,
                                 f"批量{label} {count} 条举报" + (f"：{note}" if note else ""))
    return {"count": count}


# ==================== 内容管理 ====================
@router.get("/recycle")
def list_recycle(
    response: Response,
    target_type: str | None = None,
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """回收站：被删除的内容，可恢复（支持类型/关键词筛选与分页）。"""
    query = db.query(models.RecycleBin)
    if target_type in ("work", "post"):
        query = query.filter(models.RecycleBin.target_type == target_type)
    if q and q.strip():
        query = query.filter(models.RecycleBin.title.like(f"%{q.strip()}%"))
    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    rows = (
        query.order_by(models.RecycleBin.id.desc())
        .offset(max(0, skip))
        .limit(min(limit, 200))
        .all()
    )
    return [
        {
            "id": r.id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "title": r.title,
            "reason": r.reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/recycle/{recycle_id}/restore")
def restore_recycle(recycle_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """恢复回收站内容（稿件恢复为发布，帖子恢复）。"""
    r = db.get(models.RecycleBin, recycle_id)
    if r is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    if r.target_type == "work":
        w = db.get(models.Work, r.target_id)
        if w is None:
            raise HTTPException(status_code=404, detail="稿件已不存在")
        w.status = "published"
    elif r.target_type == "post":
        p = db.get(models.Post, r.target_id)
        if p is None:
            raise HTTPException(status_code=404, detail="帖子已不存在")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.post("/users/{uid}/fish")
def grant_fish(uid: str, body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """管理员授予用户小鱼干（可为负）。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    delta = int(body.get("delta") or 0)
    if delta == 0 or abs(delta) > 100000:
        raise HTTPException(status_code=400, detail="小鱼干调整范围 -100000 ~ 100000")
    target.fish_count = max(0, (target.fish_count or 0) + delta)
    db.commit()
    serializers.log_admin_action(db, admin.id, "grant_fish", "user", target.id, f"调整 {target.display_name} 小鱼干 {delta:+d}")
    serializers.notify_admin_action(db, target.id, admin.id, f"管理员调整了你的小鱼干：{delta:+d}", "user", target.id)
    return {"fish_count": target.fish_count}


@router.post("/users/{uid}/xp")
def adjust_user_xp(uid: str, body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """管理员加减用户经验（调整 xp_bonus）。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    delta = int(body.get("delta") or 0)
    if delta == 0 or abs(delta) > 10000:
        raise HTTPException(status_code=400, detail="经验调整范围 -10000 ~ 10000")
    target.xp_bonus = (target.xp_bonus or 0) + delta
    db.commit()
    serializers.log_admin_action(db, admin.id, "adjust_xp", "user", target.id, f"调整 {target.display_name} 经验 {delta:+d}")
    serializers.notify_admin_action(db, target.id, admin.id, f"管理员调整了你的经验：{delta:+d}", "user", target.id)
    return {"xp_bonus": target.xp_bonus}


@router.get("/sensitive-stats")
def sensitive_stats(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """敏感词命中统计（依据举报理由 + 敏感词表）。"""
    words = db.query(models.SensitiveWord).all()
    from collections import Counter

    counter = Counter()
    reasons = db.query(models.Report.reason).all()
    for (reason,) in reasons:
        for w in words:
            if w.word and w.word in (reason or ""):
                counter[w.word] += 1
    top = counter.most_common(10)
    return {"total_words": len(words), "top_hits": [{"word": w, "count": c} for w, c in top]}


# ==================== 内容管理 ====================
def _work_categories() -> list[str]:
    """稿件分类的唯一来源在 discover.WORK_CATEGORIES，这里懒加载引用，避免路由间循环导入。"""
    from .discover import WORK_CATEGORIES

    return [c for c in WORK_CATEGORIES if c != "全部"]


ADMIN_POST_CATEGORIES = ["讨论", "教程", "求助", "展示"]
WORK_STATUSES = ("published", "pending", "rejected", "scheduled")
POST_STATUSES = ("published", "pending", "rejected")


def _author_subquery(db: Session, author: str):
    """按作者筛：用户名 / 昵称 模糊，UID 精确。返回 user_id 子查询，不做 join。"""
    a = author.strip()
    return db.query(models.User.id).filter(
        or_(models.User.username.contains(a), models.User.nickname.contains(a), models.User.uid == a)
    )


@router.get("/works")
def list_admin_works(
    response: Response,
    status: str | None = None,
    q: str | None = None,
    category: str | None = None,
    author: str | None = None,
    featured: bool | None = None,
    pinned: bool | None = None,
    editor: str | None = None,
    sort: str = "newest",
    skip: int = 0,
    limit: int = 20,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """稿件列表：状态/分类/作者/精选/置顶/编辑器筛选 + 排序 + 分页，总数走 X-Total-Count。

    `editor`：编辑器 code（kitten4 / KN / kitten3 / coco / nemo）或 `scratch`（本地上传的 .sb3）
    或 `url`（内嵌外链）。Scratch 投稿上线后，审稿时要能单独把这类稿件筛出来看。
    """
    query = db.query(models.Work)
    if status and status != "全部":
        query = query.filter(models.Work.status == status)
    if editor and editor != "全部":
        if editor == "scratch":
            query = query.filter(models.Work.work_type == "scratch")
        elif editor == "url":
            query = query.filter(models.Work.work_type == "url")
        else:
            query = query.filter(models.Work.editor_code == editor)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Work.title.like(like) | models.Work.tags.like(like))
    if category and category != "全部":
        query = query.filter(models.Work.category == category)
    if author and author.strip():
        query = query.filter(models.Work.user_id.in_(_author_subquery(db, author)))
    if featured is not None:
        query = query.filter(models.Work.is_featured.is_(featured))
    if pinned is not None:
        query = query.filter(models.Work.is_pinned.is_(pinned))

    order = {
        "oldest": models.Work.created_at.asc(),
        "views": models.Work.views.desc(),
        "likes": models.Work.feed_count.desc(),
    }.get(sort, models.Work.created_at.desc())

    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    works = query.order_by(order).offset(max(0, skip)).limit(min(limit, 100)).all()
    result = []
    for w in works:
        item = serializers.work_out(w, db)
        item["sensitive_hits"] = sensitive.find_sensitive(f"{w.title} {w.description} {w.tags}", db)[:5] or []
        result.append(item)
    return result


@router.patch("/works/{work_id}")
def edit_work_admin(
    work_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员直接改稿件资料（标题/简介/分类/标签/状态/封面/置顶/精选）。

    与用户自己编辑不同：**不拦敏感词**（管理员本来就是在处理违规内容），
    但会把命中词回给前端显示，方便顺手清理。
    """
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    changes: list[str] = []

    if body.get("title") is not None:
        t = str(body["title"]).strip()
        if not t:
            raise HTTPException(status_code=400, detail="标题不能为空")
        if t != w.title:
            w.title = t[:200]
            changes.append("标题已修改")

    if body.get("description") is not None:
        d = str(body["description"])[:5000]
        if d != (w.description or ""):
            w.description = d
            changes.append("简介已修改")

    if body.get("category") is not None:
        if body["category"] not in _work_categories():
            raise HTTPException(status_code=400, detail="无效的稿件分类")
        if body["category"] != w.category:
            w.category = body["category"]
            changes.append(f"分类改为{body['category']}")

    if body.get("tags") is not None:
        tags = str(body["tags"])[:200]
        if tags != (w.tags or ""):
            w.tags = tags
            changes.append("标签已修改")

    if body.get("status") is not None:
        if body["status"] not in WORK_STATUSES:
            raise HTTPException(status_code=400, detail="无效的稿件状态")
        if body["status"] != w.status:
            w.status = body["status"]
            changes.append(f"状态改为{body['status']}")

    if body.get("cover_url") is not None:
        url = imageurl.check_uploaded_image(body["cover_url"], "封面") or None
        if url != w.cover_url:
            w.cover_url = url
            changes.append("封面已更换" if url else "封面已清除")

    if body.get("is_pinned") is not None:
        v = bool(body["is_pinned"])
        if v != bool(w.is_pinned):
            w.is_pinned = v
            changes.append("已置顶" if v else "已取消置顶")

    if body.get("is_featured") is not None:
        v = bool(body["is_featured"])
        if v != bool(w.is_featured):
            w.is_featured = v
            changes.append("已设为精选" if v else "已取消精选")

    if changes:
        w.edited_at = models.now()
    db.commit()
    detail = "；".join(changes) if changes else "无变动"
    serializers.log_admin_action(db, admin.id, "edit_work", "work", work_id, f"修改稿件《{w.title}》：{detail}")
    if changes:
        serializers.notify_admin_action(db, w.user_id, admin.id, f"管理员修改了你的稿件《{w.title}》：{detail}", "work", work_id)
    item = serializers.work_out(w, db)
    item["sensitive_hits"] = sensitive.find_sensitive(f"{w.title} {w.description} {w.tags}", db)[:5] or []
    return item


@router.get("/posts")
def list_admin_posts(
    response: Response,
    status: str | None = None,
    q: str | None = None,
    category: str | None = None,
    author: str | None = None,
    featured: bool | None = None,
    pinned: bool | None = None,
    sort: str = "newest",
    skip: int = 0,
    limit: int = 20,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """帖子列表：状态/分类/作者/精华/置顶筛选 + 排序 + 分页，总数走 X-Total-Count。"""
    query = db.query(models.Post)
    if q:
        like = f"%{q}%"
        query = query.filter(models.Post.title.like(like) | models.Post.content.like(like))
    if status and status != "全部":
        query = query.filter(models.Post.status == status)
    if category and category != "全部":
        query = query.filter(models.Post.category == category)
    if author and author.strip():
        query = query.filter(models.Post.user_id.in_(_author_subquery(db, author)))
    if featured is not None:
        query = query.filter(models.Post.is_featured.is_(featured))
    if pinned is not None:
        query = query.filter(models.Post.is_pinned.is_(pinned))

    order = {
        "oldest": models.Post.created_at.asc(),
        "views": models.Post.views.desc(),
        "likes": models.Post.feed_count.desc(),
    }.get(sort, models.Post.created_at.desc())

    total = query.count()
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    posts = query.order_by(order).offset(max(0, skip)).limit(min(limit, 100)).all()
    result = []
    for p in posts:
        item = serializers.post_out(p, db)
        # post_out 是给前台用的，不含 status；后台必须能看到「待审核 / 已驳回」
        item["status"] = p.status
        item["sensitive_hits"] = sensitive.find_sensitive(f"{p.title} {p.content}", db)[:5] or []
        result.append(item)
    return result


@router.patch("/posts/{post_id}")
def edit_post_admin(
    post_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员直接改帖子（标题/正文/分类/话题/状态/置顶/加精）。同样不拦敏感词，只回报命中。"""
    p = db.get(models.Post, post_id)
    if p is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    changes: list[str] = []

    if body.get("title") is not None:
        t = str(body["title"]).strip()
        if not t:
            raise HTTPException(status_code=400, detail="标题不能为空")
        if t != p.title:
            p.title = t[:200]
            changes.append("标题已修改")

    if body.get("content") is not None:
        c = str(body["content"])
        if not c.strip():
            raise HTTPException(status_code=400, detail="正文不能为空")
        if c != (p.content or ""):
            p.content = c
            changes.append("正文已修改")

    if body.get("category") is not None:
        if body["category"] not in ADMIN_POST_CATEGORIES:
            raise HTTPException(status_code=400, detail="无效的帖子分类")
        if body["category"] != p.category:
            p.category = body["category"]
            changes.append(f"分类改为{body['category']}")

    if body.get("topics") is not None:
        topics = str(body["topics"])[:200]
        if topics != (p.topics or ""):
            p.topics = topics
            changes.append("话题已修改")

    if body.get("status") is not None:
        if body["status"] not in POST_STATUSES:
            raise HTTPException(status_code=400, detail="无效的帖子状态")
        if body["status"] != p.status:
            p.status = body["status"]
            changes.append(f"状态改为{body['status']}")

    if body.get("is_pinned") is not None:
        v = bool(body["is_pinned"])
        if v != bool(p.is_pinned):
            p.is_pinned = v
            changes.append("已置顶" if v else "已取消置顶")

    if body.get("is_featured") is not None:
        v = bool(body["is_featured"])
        if v != bool(p.is_featured):
            p.is_featured = v
            changes.append("已加精" if v else "已取消加精")

    if changes:
        p.edited_at = models.now()
    db.commit()
    detail = "；".join(changes) if changes else "无变动"
    serializers.log_admin_action(db, admin.id, "edit_post", "post", post_id, f"修改帖子《{p.title}》：{detail}")
    if changes:
        serializers.notify_admin_action(db, p.user_id, admin.id, f"管理员修改了你的帖子《{p.title}》：{detail}", "post", post_id)
    item = serializers.post_out(p, db)
    item["status"] = p.status
    item["sensitive_hits"] = sensitive.find_sensitive(f"{p.title} {p.content}", db)[:5] or []
    return item


@router.get("/comments")
def list_admin_comments(
    response: Response,
    q: str | None = None,
    target_type: str | None = None,
    skip: int = 0,
    limit: int = 20,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """评论列表（帖子评论 + 稿件评论合并）。

    原来的分页是坏的：它给两张表各取 `skip..skip+limit` 再合并取前 limit 条，
    得到的并不是「全站第 skip..skip+limit 条」，翻页会漏项和重复。
    正确做法与发现页 feed 一致：**每张表都取 skip+limit 条**，合并排序后再切 [skip, skip+limit)。
    """
    limit = max(1, min(limit, 100))
    skip = max(0, skip)
    need = skip + limit

    buckets: list[dict] = []
    total = 0

    def collect(model, ttype: str, id_attr: str):
        nonlocal total
        query = db.query(model)
        if q:
            query = query.filter(model.content.like(f"%{q}%"))
        total += query.count()
        rows = query.order_by(model.id.desc()).limit(need).all()
        # 批量取所属内容的标题，省得每条评论查一次
        ids = {getattr(c, id_attr) for c in rows}
        parent = models.Post if ttype == "post" else models.Work
        titles = {r.id: r.title for r in db.query(parent).filter(parent.id.in_(ids)).all()} if ids else {}
        out = []
        for c in rows:
            item = serializers.comment_out(c, db)
            item["target_type"] = ttype
            item["target_id"] = getattr(c, id_attr)
            item["target_title"] = titles.get(getattr(c, id_attr), "")
            out.append(item)
        return out

    if target_type != "work":
        buckets += collect(models.PostComment, "post", "post_id")
    if target_type != "post":
        buckets += collect(models.WorkComment, "work", "work_id")

    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    buckets.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return buckets[skip:skip + limit]


@router.delete("/works/{work_id}", status_code=204)
def delete_work_admin(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.Work, work_id)
    if w is not None:
        title = w.title
        author_id = w.user_id
        cascade.clean_work_deps(db, w)  # 清关联，避免留下悬空行
        db.delete(w)
        db.commit()
        serializers.log_admin_action(db, admin.id, "delete_work", "work", work_id, f"删除稿件《{title}》")
        serializers.notify_admin_action(db, author_id, admin.id, f"你的稿件《{title}》因违规被管理员删除", "work", work_id)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post_admin(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    p = db.get(models.Post, post_id)
    if p is not None:
        title = p.title
        author_id = p.user_id
        cascade.clean_post_deps(db, p)  # 清关联，避免留下悬空行
        db.delete(p)
        db.commit()
        serializers.log_admin_action(db, admin.id, "delete_post", "post", post_id, f"删除帖子《{title}》")
        serializers.notify_admin_action(db, author_id, admin.id, f"你的帖子《{title}》因违规被管理员删除", "post", post_id)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment_admin(comment_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    c = db.get(models.PostComment, comment_id) or db.get(models.WorkComment, comment_id)
    if c is not None:
        ctype = "post_comment" if isinstance(c, models.PostComment) else "work_comment"
        author_id = c.user_id
        cascade.clean_comment_deps(db, c)  # 清点赞 + 回复提升一层
        db.delete(c)
        db.commit()
        serializers.log_admin_action(db, admin.id, "delete_comment", ctype, comment_id, "删除违规评论")
        serializers.notify_admin_action(db, author_id, admin.id, "你的评论因违规被管理员删除", "comment", comment_id)


@router.post("/comments/batch")
def batch_delete_comments(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """评论批量删除。"""
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()]
    count = 0
    for cid in ids:
        c = db.get(models.PostComment, cid) or db.get(models.WorkComment, cid)
        if c is not None:
            ctype = "post_comment" if isinstance(c, models.PostComment) else "work_comment"
            author_id = c.user_id
            cascade.clean_comment_deps(db, c)  # 清点赞 + 回复提升一层
            db.delete(c)
            count += 1
            serializers.notify_admin_action(db, author_id, admin.id, "你的评论因违规被管理员删除", "comment", cid)
    db.commit()
    serializers.log_admin_action(db, admin.id, "delete_comments_batch", "comment", None, f"批量删除 {count} 条评论")
    return {"count": count}


# ---- 稿件置顶 / 精选 / 审核 ----
@router.post("/works/{work_id}/pin")
def pin_work(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    w.is_pinned = True
    db.commit()
    serializers.log_admin_action(db, admin.id, "pin", "work", work_id, f"置顶《{w.title}》")
    return {"ok": True, "is_pinned": True}


@router.post("/works/{work_id}/unpin")
def unpin_work(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    w.is_pinned = False
    db.commit()
    serializers.log_admin_action(db, admin.id, "unpin", "work", work_id, f"取消置顶《{w.title}》")
    return {"ok": True, "is_pinned": False}


@router.post("/works/{work_id}/feature")
def feature_work(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    w.is_featured = True
    db.commit()
    serializers.log_admin_action(db, admin.id, "feature", "work", work_id, f"设为官方精选《{w.title}》")
    return {"ok": True, "is_featured": True}


@router.post("/works/{work_id}/unfeature")
def unfeature_work(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    w.is_featured = False
    db.commit()
    serializers.log_admin_action(db, admin.id, "unfeature", "work", work_id, f"取消精选《{w.title}》")
    return {"ok": True, "is_featured": False}


# ---- 帖子置顶/加精 + 版本留痕 ----
@router.post("/posts/{post_id}/pin")
def pin_post(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    p = db.get(models.Post, post_id)
    if p is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    p.is_pinned = True
    db.commit()
    serializers.log_admin_action(db, admin.id, "pin_post", "post", post_id, f"置顶帖子《{p.title}》")
    serializers.notify_admin_action(db, p.user_id, admin.id, f"你的帖子《{p.title}》已被管理员置顶", "post", post_id)
    return {"ok": True, "is_pinned": True}


@router.post("/posts/{post_id}/unpin")
def unpin_post(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    p = db.get(models.Post, post_id)
    if p is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    p.is_pinned = False
    db.commit()
    serializers.log_admin_action(db, admin.id, "unpin_post", "post", post_id, f"取消置顶《{p.title}》")
    return {"ok": True, "is_pinned": False}


@router.post("/posts/{post_id}/feature")
def feature_post(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    p = db.get(models.Post, post_id)
    if p is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    p.is_featured = True
    db.commit()
    serializers.log_admin_action(db, admin.id, "feature_post", "post", post_id, f"帖子加精《{p.title}》")
    serializers.notify_admin_action(db, p.user_id, admin.id, f"你的帖子《{p.title}》已被加精", "post", post_id)
    return {"ok": True, "is_featured": True}


@router.post("/posts/{post_id}/unfeature")
def unfeature_post(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    p = db.get(models.Post, post_id)
    if p is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    p.is_featured = False
    db.commit()
    serializers.log_admin_action(db, admin.id, "unfeature_post", "post", post_id, f"取消加精《{p.title}》")
    return {"ok": True, "is_featured": False}


@router.get("/works/{work_id}/versions")
def work_versions(work_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    rows = db.query(models.WorkVersion).filter_by(work_id=work_id).order_by(models.WorkVersion.id.desc()).limit(20).all()
    return [
        {"id": v.id, "title": v.title, "description": v.description, "created_at": v.created_at.isoformat() if v.created_at else None}
        for v in rows
    ]


@router.get("/posts/{post_id}/versions")
def post_versions(post_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    rows = db.query(models.PostVersion).filter_by(post_id=post_id).order_by(models.PostVersion.id.desc()).limit(20).all()
    return [
        {"id": v.id, "title": v.title, "content": v.content, "created_at": v.created_at.isoformat() if v.created_at else None}
        for v in rows
    ]


@router.post("/works/{work_id}/review")
def review_work(
    work_id: int,
    body: schemas.ReviewIn,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """稿件审核：approve 通过 / reject 驳回（通知作者）。"""
    w = db.get(models.Work, work_id)
    if w is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if body.decision == "approve":
        w.status = "published"
        note = f"你的稿件《{w.title}》已通过审核并上架！"
    else:
        w.status = "rejected"
        note = f"你的稿件《{w.title}》未通过审核"
        if body.reason:
            note += f"：{body.reason}"
    db.commit()
    serializers.log_admin_action(db, admin.id, f"review_{body.decision}", "work", work_id, note)
    serializers.notify_admin_action(db, w.user_id, admin.id, note, "work", work_id)
    return {"ok": True, "status": w.status}


@router.get("/review_queue")
def review_queue(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """审核队列：待审核稿件 + 定时稿件 + 待处理举报。"""
    pending_works = (
        db.query(models.Work)
        .filter(models.Work.status == "pending")
        .order_by(models.Work.created_at.asc())
        .limit(50)
        .all()
    )
    scheduled_works = (
        db.query(models.Work)
        .filter(models.Work.status == "scheduled")
        .order_by(models.Work.scheduled_at.asc())
        .limit(50)
        .all()
    )
    pending_reports = (
        db.query(models.Report)
        .filter(models.Report.status == "pending")
        .order_by(models.Report.id.desc())
        .limit(50)
        .all()
    )

    def _preview(target_type, target_id):
        if target_type == "work":
            w = db.get(models.Work, target_id)
            return {"title": w.title, "author": w.author.display_name if w.author else None} if w else None
        if target_type == "post":
            p = db.get(models.Post, target_id)
            return {"title": p.title, "author": p.author.display_name if p.author else None} if p else None
        if target_type == "studio":
            s = db.get(models.Studio, target_id)
            return {"title": f"工作室《{s.name}》"} if s else None
        c = db.get(models.PostComment, target_id) or db.get(models.WorkComment, target_id)
        return {"content": (c.content or "")[:80]} if c else None

    return {
        "pending_works": [serializers.work_out(w, db, admin.id) for w in pending_works],
        "scheduled_works": [serializers.work_out(w, db, admin.id) for w in scheduled_works],
        "pending_reports": [
            {
                "id": r.id,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "reason": r.reason,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "reporter": serializers.user_brief(r.reporter) if r.reporter else None,
                "target_preview": _preview(r.target_type, r.target_id),
            }
            for r in pending_reports
        ],
    }


# ---- 操作日志 ----
@router.get("/logs")
def list_logs(
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(models.AdminLog)
    if q:
        like = f"%{q}%"
        query = query.filter(models.AdminLog.detail.like(like) | models.AdminLog.action.like(like))
    logs = query.order_by(models.AdminLog.id.desc()).offset(skip).limit(min(limit, 200)).all()
    return [serializers.admin_log_out(l) for l in logs]


@router.get("/audit_logs")
def list_audit_logs(
    skip: int = 0,
    limit: int = 200,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """安全审计日志：自动记录的后台写操作 + 登录/改密等敏感请求（支持分页）。"""
    rows = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.id.desc())
        .offset(max(0, skip))
        .limit(min(limit, 500))
        .all()
    )
    return [
        {
            "id": r.id,
            "created_at": r.created_at,
            "user_id": r.user_id,
            "username": r.username or "",
            "method": r.method,
            "path": r.path,
            "status": r.status,
            "ip": r.ip or "",
        }
        for r in rows
    ]


# ==================== 工作室管理（社区管理员） ====================
STUDIO_STATUSES = ("active", "frozen", "banned")
STUDIO_JOIN_MODES = ("open", "approval")


def _admin_studio_out(s: models.Studio, c: dict) -> dict:
    """后台用的工作室结构：把室长能改的字段全带出来，另外附上六项计数。

    之前这里只返回 name/category/status，前端却读 s.avatar_url —— 永远读到 undefined，
    列表里所有工作室都退化成同一个图标。
    """
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description or "",
        "announcement": s.announcement or "",
        "avatar_url": s.avatar_url,
        "cover_url": s.cover_url,
        "category": s.category,
        "status": s.status,
        "join_mode": s.join_mode or "open",
        "invite_code": s.invite_code,
        "min_level": int(s.min_level or 0),
        "multi_studio_only": bool(s.multi_studio_only),
        "apply_required": bool(s.apply_required),
        "member_limit": int(s.member_limit or 50),
        "owner_id": s.owner_id,
        "owner": serializers.user_brief(s.owner) if s.owner else None,
        # 计数一次批量查（studio_core.counts_for 只跑 6 条聚合 SQL，不是每个室 8 条）
        "member_count": c["member_count"],
        "pending_count": c["pending_count"],
        "work_count": c["work_count"],
        "pending_work_count": c["pending_work_count"],
        "follow_count": c["follow_count"],
        "total_views": c["total_views"],
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/studios")
def list_admin_studios(
    q: str | None = None,
    status: str | None = None,
    category: str | None = None,
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    query = db.query(models.Studio)
    if q:
        # 名称、简介、邀请码都能搜，省得只记得邀请码或简介里的字就查不到
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                models.Studio.name.like(like),
                models.Studio.description.like(like),
                models.Studio.invite_code.like(like),
            )
        )
    if status and status != "全部":
        query = query.filter(models.Studio.status == status)
    if category and category != "全部":
        query = query.filter(models.Studio.category == category)
    studios = (
        query.order_by(models.Studio.id.desc())
        .offset(max(0, skip))
        .limit(min(limit, 200))
        .all()
    )
    counts = studio_core.counts_for(db, [s.id for s in studios])
    return [_admin_studio_out(s, counts[s.id]) for s in studios]


@router.get("/studios/{studio_id}")
def get_admin_studio(
    studio_id: int,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """单个工作室的完整资料 + 计数（弹窗打开/操作后刷新用，不必重载整页）。"""
    s = _studio_owner(db, studio_id)
    return _admin_studio_out(s, studio_core.counts_for(db, [s.id])[s.id])


def _studio_owner(db: Session, studio_id: int):
    s = db.get(models.Studio, studio_id)
    if s is None:
        raise HTTPException(status_code=404, detail="工作室不存在")
    return s


@router.post("/studios/{studio_id}/freeze")
def freeze_studio(studio_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = _studio_owner(db, studio_id)
    s.status = "frozen"
    db.commit()
    serializers.log_admin_action(db, admin.id, "freeze_studio", "studio", studio_id, f"冻结工作室《{s.name}》")
    serializers.notify_admin_action(db, s.owner_id, admin.id, f"工作室《{s.name}》已被社区管理员冻结（成员暂不能发言、投稿）", "studio", studio_id)
    return {"ok": True, "status": s.status}


@router.post("/studios/{studio_id}/unfreeze")
def unfreeze_studio(studio_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = _studio_owner(db, studio_id)
    s.status = "active"
    db.commit()
    serializers.log_admin_action(db, admin.id, "unfreeze_studio", "studio", studio_id, f"解冻工作室《{s.name}》")
    serializers.notify_admin_action(db, s.owner_id, admin.id, f"工作室《{s.name}》已解冻，恢复正常", "studio", studio_id)
    return {"ok": True, "status": s.status}


@router.post("/studios/{studio_id}/ban")
def ban_studio(studio_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = _studio_owner(db, studio_id)
    s.status = "banned"
    db.commit()
    serializers.log_admin_action(db, admin.id, "ban_studio", "studio", studio_id, f"封禁工作室《{s.name}》（全站隐藏）")
    serializers.notify_admin_action(db, s.owner_id, admin.id, f"工作室《{s.name}》已被社区管理员封禁（全站隐藏）", "studio", studio_id)
    return {"ok": True, "status": s.status}


@router.post("/studios/{studio_id}/unban")
def unban_studio(studio_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = _studio_owner(db, studio_id)
    s.status = "active"
    db.commit()
    serializers.log_admin_action(db, admin.id, "unban_studio", "studio", studio_id, f"解除封禁《{s.name}》")
    serializers.notify_admin_action(db, s.owner_id, admin.id, f"工作室《{s.name}》已解除封禁", "studio", studio_id)
    return {"ok": True, "status": s.status}


@router.post("/studios/{studio_id}/force_disband")
def force_disband_studio(studio_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """社区管理员强制解散工作室。"""
    s = _studio_owner(db, studio_id)
    name = s.name
    owner_id = s.owner_id
    chat_core.dissolve_studio_thread(db, studio_id)
    db.query(models.StudioMember).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioWork).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioBan).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioFollow).filter_by(studio_id=studio_id).delete()
    db.delete(s)
    db.commit()
    serializers.log_admin_action(db, admin.id, "force_disband_studio", "studio", studio_id, f"强制解散工作室《{name}》")
    serializers.notify_admin_action(db, owner_id, admin.id, f"工作室《{name}》因违规被社区管理员强制解散", "studio", studio_id)
    return {"ok": True}


@router.patch("/studios/{studio_id}")
def edit_studio_admin(
    studio_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员直接编辑工作室资料（室里改不动的、或室长跑路了都能救）。

    可改：名称、分类、状态、简介、公告、头像、封面、加入方式、最低等级、
          禁止多室籍、申请必填留言、成员上限。
    管理员改这些**不走敏感词**（与后台其它改资料一致），但长度仍然封顶。
    """
    s = _studio_owner(db, studio_id)
    changes = []

    # 「申请必填留言」只在需审核的工作室上讲得通（与前台 PATCH /studios/{id} 同一规则）。
    # 先按「改完之后」的值校验，避免改了一半再回滚。
    will_join_mode = body.get("join_mode") if body.get("join_mode") is not None else (s.join_mode or "open")
    will_apply = body.get("apply_required") if body.get("apply_required") is not None else bool(s.apply_required)
    if will_apply and will_join_mode != "approval":
        raise HTTPException(status_code=400, detail="「申请时必须填留言」只能在「需审核加入」的工作室上开启，请先把加入方式改为需审核")

    if body.get("name") is not None:
        name = str(body["name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="工作室名称不能为空")
        if name != s.name:
            s.name = name[:100]
            changes.append(f"名称改为「{s.name}」")

    if body.get("category") is not None:
        if body["category"] not in studio_core.STUDIO_CATEGORIES:
            raise HTTPException(status_code=400, detail="无效的工作室分类")
        if body["category"] != s.category:
            s.category = body["category"]
            changes.append(f"分类改为{body['category']}")

    if body.get("status") is not None:
        if body["status"] not in STUDIO_STATUSES:
            raise HTTPException(status_code=400, detail="无效的工作室状态")
        if body["status"] != s.status:
            s.status = body["status"]
            changes.append(f"状态改为{s.status}")

    if body.get("description") is not None:
        desc = str(body["description"])[:2000]
        if desc != (s.description or ""):
            s.description = desc
            changes.append("简介已修改")

    if body.get("announcement") is not None:
        ann = str(body["announcement"])[:2000]
        if ann != (s.announcement or ""):
            s.announcement = ann
            changes.append("公告已修改")

    # 图片：只收本站上传的（清空传空串）
    if body.get("avatar_url") is not None:
        url = imageurl.check_uploaded_image(body["avatar_url"], "工作室头像") or None
        if url != s.avatar_url:
            s.avatar_url = url
            changes.append("头像已更换" if url else "头像已清除")

    if body.get("cover_url") is not None:
        url = imageurl.check_uploaded_image(body["cover_url"], "工作室封面") or None
        if url != s.cover_url:
            s.cover_url = url
            changes.append("封面已更换" if url else "封面已清除")

    if body.get("join_mode") is not None:
        if body["join_mode"] not in STUDIO_JOIN_MODES:
            raise HTTPException(status_code=400, detail="无效的加入方式")
        if body["join_mode"] != s.join_mode:
            s.join_mode = body["join_mode"]
            changes.append("加入方式改为" + ("需审核" if s.join_mode == "approval" else "直接加入"))

    if body.get("min_level") is not None:
        try:
            lv = max(0, min(99, int(body["min_level"] or 0)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="最低等级必须是数字")
        if lv != int(s.min_level or 0):
            s.min_level = lv
            changes.append(f"加入门槛改为 LV{lv}" if lv else "取消了等级门槛")

    if body.get("multi_studio_only") is not None:
        v = bool(body["multi_studio_only"])
        if v != bool(s.multi_studio_only):
            s.multi_studio_only = v
            changes.append("已开启禁止多室籍" if v else "已关闭禁止多室籍")

    if body.get("apply_required") is not None:
        v = bool(body["apply_required"])
        if v != bool(s.apply_required):
            s.apply_required = v
            changes.append("申请必须填留言" if v else "申请不再要求填留言")

    if body.get("member_limit") is not None:
        try:
            lim = max(1, min(500, int(body["member_limit"] or 50)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="成员上限必须是数字")
        if lim != int(s.member_limit or 50):
            s.member_limit = lim
            changes.append(f"成员上限改为 {lim}")

    # 「申请必填留言」只在需审核的工作室上讲得通（与前台 PATCH /studios/{id} 同一规则）
    db.commit()
    detail = "；".join(changes) if changes else "无变动"
    serializers.log_admin_action(db, admin.id, "edit_studio", "studio", studio_id, f"修改工作室《{s.name}》：{detail}")
    if changes:
        serializers.notify_admin_action(db, s.owner_id, admin.id, f"管理员修改了工作室《{s.name}》：{detail}", "studio", studio_id)
    return _admin_studio_out(s, studio_core.counts_for(db, [s.id])[s.id])


@router.post("/studios/{studio_id}/invite")
def regenerate_studio_invite(
    studio_id: int,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """重新生成邀请码（旧码立即失效）。"""
    import secrets

    s = _studio_owner(db, studio_id)
    old = s.invite_code
    s.invite_code = secrets.token_hex(3).upper()
    db.commit()
    serializers.log_admin_action(db, admin.id, "reset_studio_invite", "studio", studio_id,
                                 f"重置工作室《{s.name}》邀请码（旧码 {old or '无'}）")
    return {"ok": True, "invite_code": s.invite_code}


@router.delete("/studios/{studio_id}/invite", status_code=204)
def clear_studio_invite(
    studio_id: int,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """清空邀请码：只能凭审核加入，不能再凭码进。"""
    s = _studio_owner(db, studio_id)
    old = s.invite_code
    s.invite_code = None
    db.commit()
    serializers.log_admin_action(db, admin.id, "clear_studio_invite", "studio", studio_id,
                                 f"清空工作室《{s.name}》邀请码（原 {old or '无'}）")


@router.get("/studios/{studio_id}/members")
def list_studio_members(
    studio_id: int,
    status: str | None = None,
    limit: int = 200,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """成员 / 待审申请列表。室长排最前，管理员次之，其余按加入时间。"""
    _studio_owner(db, studio_id)
    query = db.query(models.StudioMember).filter(models.StudioMember.studio_id == studio_id)
    if status in ("active", "pending"):
        query = query.filter(models.StudioMember.status == status)
    rows = query.limit(min(max(1, limit), 500)).all()
    rank = {studio_core.ROLE_OWNER: 0, studio_core.ROLE_ADMIN: 1, studio_core.ROLE_MEMBER: 2}
    rows.sort(key=lambda m: (0 if m.status == studio_core.STATUS_ACTIVE else 1,
                             rank.get(m.role, 9),
                             m.joined_at or datetime.min))
    return [
        {
            "user_id": m.user_id,
            "user": serializers.user_brief(m.user) if m.user else None,
            "role": m.role or studio_core.ROLE_MEMBER,
            "status": m.status,
            "muted": bool(m.muted),
            "apply_note": m.apply_note or "",
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            "reviewed_at": m.reviewed_at.isoformat() if m.reviewed_at else None,
        }
        for m in rows
    ]


def _studio_member_or_404(db: Session, studio_id: int, user_id: int) -> models.StudioMember:
    m = studio_core.membership(db, studio_id, user_id)
    if m is None:
        raise HTTPException(status_code=404, detail="该用户不是本工作室成员")
    return m


@router.post("/studios/{studio_id}/members/{user_id}/role")
def set_studio_member_role(
    studio_id: int,
    user_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员任免工作室管理员。室长本身要换请走 /transfer_owner。"""
    s = _studio_owner(db, studio_id)
    m = _studio_member_or_404(db, studio_id, user_id)
    if m.role == studio_core.ROLE_OWNER:
        raise HTTPException(status_code=400, detail="室长的角色不能直接改，请先转让室长")
    role = body.get("role")
    if role not in (studio_core.ROLE_ADMIN, studio_core.ROLE_MEMBER):
        raise HTTPException(status_code=400, detail="无效的角色")
    if m.status != studio_core.STATUS_ACTIVE:
        raise HTTPException(status_code=400, detail="对方还不是正式成员，先通过加入申请")
    m.role = role
    db.commit()
    studio_core.sync_discussion(db, studio_id, user_id, join=True, role=role)
    label = "管理员" if role == studio_core.ROLE_ADMIN else "普通成员"
    serializers.log_admin_action(db, admin.id, "set_studio_role", "studio", studio_id,
                                 f"把 {m.user.display_name if m.user else user_id} 设为工作室《{s.name}》的{label}")
    serializers.notify_admin_action(db, user_id, admin.id, f"你在工作室《{s.name}》里的角色被管理员调整为{label}", "studio", studio_id)
    return {"ok": True, "role": role}


@router.delete("/studios/{studio_id}/members/{user_id}", status_code=204)
def remove_studio_member(
    studio_id: int,
    user_id: int,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """把成员移出工作室（也用于驳回待审申请）。室长不能这样移，先转让。"""
    s = _studio_owner(db, studio_id)
    m = _studio_member_or_404(db, studio_id, user_id)
    if m.role == studio_core.ROLE_OWNER:
        raise HTTPException(status_code=400, detail="不能移出室长，请先转让室长")
    was_pending = m.status == studio_core.STATUS_PENDING
    name = m.user.display_name if m.user else user_id
    studio_core.sync_discussion(db, studio_id, user_id, join=False)
    db.delete(m)
    db.commit()
    serializers.log_admin_action(db, admin.id, "remove_studio_member", "studio", studio_id,
                                 f"把 {name} 从工作室《{s.name}》移出" + ("（驳回申请）" if was_pending else ""))
    serializers.notify_admin_action(db, user_id, admin.id,
                                    f"你已被移出工作室《{s.name}》" if not was_pending else f"你加入工作室《{s.name}》的申请未通过",
                                    "studio", studio_id)


@router.post("/studios/{studio_id}/members/{user_id}/mute")
def mute_studio_member(
    studio_id: int,
    user_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """在工作室里禁言 / 解除禁言（不影响站内其它地方发言）。"""
    s = _studio_owner(db, studio_id)
    m = _studio_member_or_404(db, studio_id, user_id)
    if m.role == studio_core.ROLE_OWNER:
        raise HTTPException(status_code=400, detail="不能禁言室长")
    muted = bool(body.get("muted", True))
    if muted != bool(m.muted):
        m.muted = muted
        db.commit()
        name = m.user.display_name if m.user else user_id
        serializers.log_admin_action(db, admin.id, "mute_studio_member", "studio", studio_id,
                                     f"{'禁言' if muted else '解除禁言'}：{name} @ 工作室《{s.name}》")
        serializers.notify_admin_action(db, user_id, admin.id,
                                        f"你在工作室《{s.name}》里{'被禁言' if muted else '已被解除禁言'}", "studio", studio_id)
    return {"ok": True, "muted": bool(m.muted)}


@router.post("/studios/{studio_id}/transfer_owner")
def transfer_studio_owner(
    studio_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """管理员强制转让室长：立即生效，不需要对方确认（与室长自己发起的「待确认」不同）。

    用途：室长把号注销了 / 跑路了 / 违规被封，工作室还得有人管。
    """
    s = _studio_owner(db, studio_id)
    target_id = body.get("user_id")
    if not isinstance(target_id, int):
        raise HTTPException(status_code=400, detail="请选择新的室长")
    if target_id == s.owner_id:
        raise HTTPException(status_code=400, detail="对方已经是室长了")
    target = studio_core.membership(db, studio_id, target_id)
    if target is None or target.status != studio_core.STATUS_ACTIVE:
        raise HTTPException(status_code=400, detail="新室长必须是本工作室的正式成员")

    old_owner_id = s.owner_id
    old_owner = studio_core.membership(db, studio_id, old_owner_id)
    if old_owner is not None:
        old_owner.role = studio_core.ROLE_ADMIN
    target.role = studio_core.ROLE_OWNER
    s.owner_id = target_id
    s.pending_owner_id = None
    db.commit()

    studio_core.sync_discussion(db, studio_id, target_id, join=True, role=studio_core.ROLE_OWNER)
    if old_owner is not None:
        studio_core.sync_discussion(db, studio_id, old_owner_id, join=True, role=studio_core.ROLE_ADMIN)

    new_name = target.user.display_name if target.user else target_id
    serializers.log_admin_action(db, admin.id, "transfer_studio_owner", "studio", studio_id,
                                 f"工作室《{s.name}》室长由 {old_owner_id} 变更为 {new_name}（{target_id}）")
    serializers.notify_admin_action(db, target_id, admin.id,
                                    f"管理员把工作室《{s.name}》的室长转给了你", "studio", studio_id)
    if old_owner_id:
        serializers.notify_admin_action(db, old_owner_id, admin.id,
                                        f"你在工作室《{s.name}》的室长已转给 {new_name}，你成为管理员", "studio", studio_id)
    return _admin_studio_out(s, studio_core.counts_for(db, [s.id])[s.id])


@router.get("/featured")
def list_featured(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """官方精选作品列表（管理用，含全部稿件供检索）。"""
    featured = db.query(models.Work).filter_by(is_featured=True).order_by(models.Work.created_at.desc()).limit(100).all()
    return [serializers.work_out(w, db) for w in featured]


@router.post("/notify")
def send_site_notification(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """向全体用户发送系统通知。"""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="通知内容不能为空")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="通知内容过长（最多 500 字）")
    user_ids = [r[0] for r in db.query(models.User.id).filter(models.User.id != admin.id, models.User.is_deactivated.is_(False)).all()]
    count = 0
    for uid in user_ids:
        n = serializers.notify_user(db, uid, admin.id, "admin", None, None, content)
        if n is not None:
            count += 1
    serializers.log_admin_action(db, admin.id, "site_notify", None, None, f"全站通知：{content[:40]}")
    return {"ok": True, "sent": count}


# ==================== 官方认证管理 ====================
@router.get("/verifications")
def list_verifications(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    users = db.query(models.User).filter(models.User.verification_type.isnot(None)).order_by(models.User.id.desc()).limit(200).all()
    result = []
    for u in users:
        item = serializers.user_brief(u)
        item["created_at"] = u.created_at.isoformat() if u.created_at else None
        result.append(item)
    return result


@router.post("/users/{uid}/verify")
def verify_user(uid: str, body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    vtype = body.get("type")
    if vtype not in ("blue", "gold"):
        raise HTTPException(status_code=400, detail="认证类型须为 blue 或 gold")
    title = (body.get("title") or "").strip()[:50]
    target.verification_type = vtype
    target.verification_title = title
    db.commit()
    label = "官方认证（蓝标）" if vtype == "blue" else "官方认证（黄标）"
    serializers.log_admin_action(db, admin.id, "verify", "user", target.id, f"授予 {target.display_name} {label}：{title or '无头衔'}")
    serializers.notify_admin_action(db, target.id, admin.id, f"恭喜！你获得了{label}：{title or ''}", "user", target.id)
    return serializers.user_brief(target)


@router.delete("/users/{uid}/verify", status_code=204)
def unverify_user(uid: str, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.verification_type = None
    target.verification_title = ""
    db.commit()
    serializers.log_admin_action(db, admin.id, "unverify", "user", target.id, f"取消 {target.display_name} 的官方认证")
    serializers.notify_admin_action(db, target.id, admin.id, "你的官方认证已被取消", "user", target.id)


# ==================== 用户审计 ====================
@router.get("/audit/{uid}")
def audit_user(uid: str, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    user_id = target.id
    logs = (
        db.query(models.AdminLog)
        .filter(models.AdminLog.target_type == "user", models.AdminLog.target_id == user_id)
        .order_by(models.AdminLog.id.desc())
        .limit(50)
        .all()
    )
    return {
        "user": serializers.user_brief(target),
        "created_at": target.created_at,
        "last_login_at": target.last_login_at,
        "works_count": db.query(models.Work).filter_by(user_id=user_id).count(),
        "posts_count": db.query(models.Post).filter_by(user_id=user_id).count(),
        "comments_count": db.query(models.PostComment).filter_by(user_id=user_id).count() + db.query(models.WorkComment).filter_by(user_id=user_id).count(),
        "reports_received": db.query(models.Report).filter(
            models.Report.target_type.in_(["work", "post"]),
            models.Report.target_id.in_([w.id for w in db.query(models.Work.id).filter_by(user_id=user_id).all()] + [p.id for p in db.query(models.Post.id).filter_by(user_id=user_id).all()] or [0]),
        ).count(),
        "admin_logs": [serializers.admin_log_out(l) for l in logs],
    }


# ==================== 批量管理 ====================
@router.post("/works/batch")
def batch_works(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """稿件批量：delete（彻底删）/ hide（下架待审）/ restore（重新上架）。

    注意：批量删除必须和单条删除一样走 `cascade.clean_work_deps` 并通知作者，
    否则会留下悬空的点赞/评论/收藏行（原来这里直接 db.delete，是漏的）。
    """
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()][:200]
    action = body.get("action")
    if not ids:
        raise HTTPException(status_code=400, detail="未选择稿件")
    if action not in ("delete", "hide", "restore"):
        raise HTTPException(status_code=400, detail="无效操作")
    rows = db.query(models.Work).filter(models.Work.id.in_(ids)).all()
    affected = 0
    for w in rows:
        if action == "delete":
            title, author_id = w.title, w.user_id
            cascade.clean_work_deps(db, w)
            db.delete(w)
            serializers.notify_admin_action(db, author_id, admin.id, f"你的稿件《{title}》因违规被管理员删除", "work", w.id)
        elif action == "hide":
            w.status = "pending"
        else:
            w.status = "published"
        affected += 1
    db.commit()
    label = {"delete": "删除", "hide": "下架", "restore": "重新上架"}[action]
    serializers.log_admin_action(db, admin.id, f"batch_{action}", "work", None, f"批量{label} {affected} 个稿件")
    return {"ok": True, "count": affected}


@router.post("/posts/batch")
def batch_posts(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """帖子批量：delete / hide / restore（与稿件批量同规则，删除走级联清理并通知作者）。"""
    ids = [int(x) for x in (body.get("ids") or []) if str(x).isdigit()][:200]
    action = body.get("action")
    if not ids:
        raise HTTPException(status_code=400, detail="未选择帖子")
    if action not in ("delete", "hide", "restore"):
        raise HTTPException(status_code=400, detail="无效操作")
    rows = db.query(models.Post).filter(models.Post.id.in_(ids)).all()
    affected = 0
    for p in rows:
        if action == "delete":
            title, author_id = p.title, p.user_id
            cascade.clean_post_deps(db, p)
            db.delete(p)
            serializers.notify_admin_action(db, author_id, admin.id, f"你的帖子《{title}》因违规被管理员删除", "post", p.id)
        elif action == "hide":
            p.status = "pending"
        else:
            p.status = "published"
        affected += 1
    db.commit()
    label = {"delete": "删除", "hide": "下架", "restore": "重新上架"}[action]
    serializers.log_admin_action(db, admin.id, f"batch_posts_{action}", "post", None, f"批量{label} {affected} 个帖子")
    return {"ok": True, "count": affected}


# ==================== 站点开关（运行时，改完立刻生效） ====================
@router.get("/switches")
def list_switches(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """站点开关当前状态。默认值来自环境变量，后台改过的会标 changed。"""
    return switches.all_switches(db)


@router.patch("/switches/{key}")
def set_switch(
    key: str,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """打开/关闭一个站点开关。写入后立刻刷新进程缓存，无需重启。"""
    if key not in switches.SWITCHES:
        raise HTTPException(status_code=404, detail="没有这个开关")
    if "value" not in body:
        raise HTTPException(status_code=400, detail="缺少 value")
    value = bool(body["value"])
    switches.set_value(db, key, value)
    label = switches.SWITCHES[key][1]
    serializers.log_admin_action(db, admin.id, "switch", "site", None, f"{label}：{'开启' if value else '关闭'}")
    return {"key": key, "value": value}


# ==================== 自建云变量服务器（方案 C） ====================
# 播放器的 cloud_host 指向我们自己的服务（cloud/server.py），身份按本站账号签发票据。
# 这里给后台看统计、房间列表、清理某个作品的云数据。
@router.get("/cloud/stats")
def cloud_stats(admin: models.User = Depends(get_current_admin)):
    """云变量服务总览：在线连接、房间、变量数、日志条数、库大小。"""
    data = cloudvars.admin_stats()
    data["enabled"] = cloudvars.enabled()
    data["host"] = config.CLOUD_HOST
    return data


@router.get("/cloud/rooms")
def cloud_rooms(
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """有云数据的作品列表（带作品标题，方便后台认）。"""
    data = cloudvars.admin_rooms(limit)
    items = data.get("items") or []
    ids = [int(it["work"]) for it in items if str(it.get("work", "")).isdigit()]
    titles = {}
    if ids:
        rows = db.query(models.Work.id, models.Work.title).filter(models.Work.id.in_(ids)).all()
        titles = {wid: title for wid, title in rows}
    for it in items:
        it["title"] = titles.get(int(it["work"]), "（作品已删除）")
    data["items"] = items
    return data


@router.get("/cloud/rooms/{work_id}")
def cloud_room_detail(work_id: int, admin: models.User = Depends(get_current_admin)):
    """某个作品当前的云变量（含写入者 uid / 昵称 / 时间）。"""
    return cloudvars.admin_room(work_id)


@router.post("/cloud/rooms/{work_id}/clear")
def cloud_room_clear(
    work_id: int,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """清空某个作品的云数据（在线客户端会收到空值，等于重置）。"""
    out = cloudvars.admin_clear(work_id)
    serializers.log_admin_action(db, admin.id, "cloud_clear", "work", work_id, "清空该作品的云变量数据")
    return out


# ==================== 系统公告 ====================
@router.get("/announcement")
def get_announcement(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    s = db.get(models.SiteSetting, "announcement")
    live = s.value if s else ""
    scheduled = None
    ss = db.get(models.SiteSetting, "announcement_scheduled")
    if ss and ss.value:
        try:
            import json

            data = json.loads(ss.value)
            scheduled = {"text": data.get("text") or "", "at": data.get("at") or ""}
        except Exception:
            scheduled = None
    return {"announcement": live, "scheduled": scheduled}


@router.post("/announcement")
def set_announcement(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """设置公告：带 scheduled_at（未来时间）则定时发布，否则立即生效。"""
    text = (body.get("announcement") or "").strip()
    scheduled_at = (body.get("scheduled_at") or "").strip()
    if scheduled_at:
        try:
            # 统一成带时区的 UTC（前端 datetime-local 传来的串没有时区）
            at = serializers.parse_dt_utc(scheduled_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="定时时间格式不正确")
        if at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="定时时间必须是未来时间")
        import json

        ss = db.get(models.SiteSetting, "announcement_scheduled")
        if ss is None:
            ss = models.SiteSetting(key="announcement_scheduled", value="{}")
            db.add(ss)
        ss.value = json.dumps({"text": text, "at": at.isoformat()}, ensure_ascii=False)
        db.commit()
        serializers.log_admin_action(db, admin.id, "announcement", None, None, f"公告定时发布：{at.strftime('%Y-%m-%d %H:%M')}")
        return {"ok": True, "scheduled": True, "at": at.isoformat()}
    # 立即生效
    s = db.get(models.SiteSetting, "announcement")
    if s is None:
        s = models.SiteSetting(key="announcement", value=text)
        db.add(s)
    else:
        s.value = text
    db.query(models.SiteSetting).filter(models.SiteSetting.key == "announcement_scheduled").delete()
    db.commit()
    serializers.log_admin_action(db, admin.id, "announcement", None, None, "更新全站公告")
    return {"ok": True, "scheduled": False}


# ==================== 首页 Banner 管理 ====================
@router.get("/banners")
def list_banners(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    banners = db.query(models.Banner).order_by(models.Banner.sort_order.asc(), models.Banner.id.desc()).all()
    return [serializers.banner_out(b, db) for b in banners]


@router.post("/banners", status_code=201)
def create_banner(body: schemas.BannerCreate, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    body.image_url = imageurl.check_uploaded_image(body.image_url, "Banner 图片") or ""
    b = models.Banner(**body.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    serializers.log_admin_action(db, admin.id, "create_banner", "banner", b.id, f"新建 Banner《{b.title}》")
    return serializers.banner_out(b, db)


@router.patch("/banners/{banner_id}")
def update_banner(banner_id: int, body: schemas.BannerCreate, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    b = db.get(models.Banner, banner_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Banner 不存在")
    body.image_url = imageurl.check_uploaded_image(body.image_url, "Banner 图片") or ""
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    serializers.log_admin_action(db, admin.id, "update_banner", "banner", b.id, f"更新 Banner《{b.title}》")
    return serializers.banner_out(b, db)


@router.delete("/banners/{banner_id}", status_code=204)
def delete_banner(banner_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    b = db.get(models.Banner, banner_id)
    if b is not None:
        db.delete(b)
        db.commit()
        serializers.log_admin_action(db, admin.id, "delete_banner", "banner", banner_id, "删除 Banner")


# ==================== 敏感词管理 ====================
@router.get("/sensitive-words")
def list_sensitive_words(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    words = db.query(models.SensitiveWord).order_by(models.SensitiveWord.builtin.desc(), models.SensitiveWord.id.asc()).all()
    return [{"id": w.id, "word": w.word, "builtin": bool(w.builtin)} for w in words]


@router.post("/sensitive-words", status_code=201)
def add_sensitive_word(body: dict, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """添加敏感词：支持英文逗号分隔的一长串，自动拆分为多个独立词（兼容中文逗号/空格/换行）。"""
    raw = (body.get("word") or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="词不能为空")
    # 统一分隔符：英文逗号 / 中文逗号 / 顿号 / 空格 / 换行
    parts = []
    for chunk in raw.replace("，", ",").replace("、", ",").replace("\n", ",").replace(" ", ",").split(","):
        w = chunk.strip()
        if w and w not in parts:
            parts.append(w)
    if not parts:
        raise HTTPException(status_code=400, detail="词不能为空")
    added, skipped, truncated = 0, 0, 0
    for word in parts:
        if len(word) > 50:
            word = word[:50]
            truncated += 1
        if db.query(models.SensitiveWord).filter_by(word=word).first() is None:
            db.add(models.SensitiveWord(word=word))
            added += 1
        else:
            skipped += 1
    db.commit()
    detail = f"添加敏感词 {added} 个（{raw[:80]}{'…' if len(raw) > 80 else ''}）"
    if truncated:
        detail += f"，{truncated} 个超长词已截断"
    serializers.log_admin_action(db, admin.id, "add_sensitive_word", "sensitive_word", None, detail)
    sensitive._db_words_cache["words"] = None  # 清缓存
    return {"ok": True, "added": added, "skipped": skipped, "truncated": truncated}


@router.delete("/sensitive-words/{word_id}", status_code=204)
def delete_sensitive_word(word_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    w = db.get(models.SensitiveWord, word_id)
    if w is not None:
        db.delete(w)
        db.commit()
        serializers.log_admin_action(db, admin.id, "delete_sensitive_word", "sensitive_word", word_id, f"删除敏感词「{w.word}」")
    sensitive._db_words_cache["words"] = None  # 清缓存


# ==================== 敏感词审核队列 ====================
def _review_target_info(db: Session, r: models.ContentReview) -> dict:
    """取审核目标的内容预览 + 作者。"""
    if r.target_type == "work":
        obj = db.get(models.Work, r.target_id)
        if obj is None:
            return None
        return {
            "title": obj.title,
            "preview": (obj.description or "")[:120],
            "author_id": obj.user_id,
            "author_name": obj.author.display_name if obj.author else "",
            "status": obj.status,
        }
    if r.target_type == "post":
        obj = db.get(models.Post, r.target_id)
        if obj is None:
            return None
        return {
            "title": obj.title,
            "preview": (obj.content or "")[:120],
            "author_id": obj.user_id,
            "author_name": obj.author.display_name if obj.author else "",
            "status": obj.status,
        }
    if r.target_type == "work_comment":
        obj = db.get(models.WorkComment, r.target_id)
        if obj is None:
            return None
        return {
            "title": "作品评论",
            "preview": (obj.content or "")[:120],
            "author_id": obj.user_id,
            "author_name": obj.user.display_name if obj.user else "",
            "status": obj.status,
        }
    if r.target_type == "post_comment":
        obj = db.get(models.PostComment, r.target_id)
        if obj is None:
            return None
        return {
            "title": "帖子评论",
            "preview": (obj.content or "")[:120],
            "author_id": obj.user_id,
            "author_name": obj.user.display_name if obj.user else "",
            "status": obj.status,
        }
    return None


@router.get("/sensitive-reviews")
def list_sensitive_reviews(
    status: str = "pending",  # pending / approved / rejected / all
    source: str = "sensitive",  # sensitive（敏感词）/ committee（风纪委员送审）/ all
    skip: int = 0,
    limit: int = 50,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """敏感词审核队列：被隐藏的内容 + 命中词，管理员审核通过后展示。

    `source` 可筛来源：sensitive（敏感词命中）/ committee（风纪委员送审）/ all。
    """
    query = db.query(models.ContentReview)
    if source and source != "all":
        query = query.filter(models.ContentReview.source == (source or "sensitive"))
    if status and status != "all":
        query = query.filter(models.ContentReview.status == status)
    reviews = query.order_by(models.ContentReview.id.desc()).offset(skip).limit(min(limit, 100)).all()
    result = []
    for r in reviews:
        info = _review_target_info(db, r)
        reviewer = db.get(models.User, r.reviewer_id) if r.reviewer_id else None
        result.append(
            {
                "id": r.id,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "sensitive_words": [w for w in (r.sensitive_words or "").split(",") if w],
                "status": r.status,
                "penalty": r.penalty,
                "penalty_detail": r.penalty_detail,
                "source": r.source or "sensitive",
                "reviewer": (serializers.user_brief(reviewer) if reviewer else None),
                "reviewer_note": r.reviewer_note or "",
                # 风纪委员的「无违规」投票进度（满 3 票自动判定，见 app/committee.py）
                "votes": (committee.vote_state(db, r.target_type, r.target_id) if (r.source or "") == "committee" else None),
                "resolved_by": r.resolved_by or "",
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "handled_at": r.handled_at.isoformat() if r.handled_at else None,
                "target": info,
            }
        )
    return result


@router.post("/sensitive-reviews/{review_id}/approve")
def approve_sensitive_review(review_id: int, admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """审核通过：恢复内容展示（作品/帖子 -> published，评论 -> active），通知作者。"""
    r = db.get(models.ContentReview, review_id)
    if r is None:
        raise HTTPException(status_code=404, detail="审核记录不存在")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="该记录已处理")
    info = _review_target_info(db, r)
    if info is None:
        r.status = "rejected"
        r.handled_at = models.now()
        r.handled_by = admin.id
        db.commit()
        return {"ok": False, "detail": "目标内容已不存在，记录已关闭"}
    if r.target_type in ("work", "post"):
        obj = db.get(models.Work, r.target_id) if r.target_type == "work" else db.get(models.Post, r.target_id)
        obj.status = "published"
    else:
        obj = db.get(models.WorkComment, r.target_id) if r.target_type == "work_comment" else db.get(models.PostComment, r.target_id)
        obj.status = "active"
    r.status = "approved"
    r.handled_at = models.now()
    r.handled_by = admin.id
    db.commit()
    serializers.log_admin_action(db, admin.id, "sensitive_approve", r.target_type, r.target_id, f"敏感词审核通过：{info['title']}")
    serializers.notify_admin_action(db, info["author_id"], admin.id, f"你的内容《{info['title']}》已通过审核并恢复展示", r.target_type, r.target_id)
    return {"ok": True}


@router.post("/sensitive-reviews/{review_id}/reject")
def reject_sensitive_review(
    review_id: int,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审核不通过：内容保持隐藏（作品/帖子 -> rejected，评论删除），可一键追加惩罚，通知作者。"""
    r = db.get(models.ContentReview, review_id)
    if r is None:
        raise HTTPException(status_code=404, detail="审核记录不存在")
    if r.status != "pending":
        raise HTTPException(status_code=400, detail="该记录已处理")
    info = _review_target_info(db, r)
    if info is None:
        r.status = "rejected"
        r.handled_at = models.now()
        r.handled_by = admin.id
        db.commit()
        return {"ok": False, "detail": "目标内容已不存在，记录已关闭"}

    # 内容处理：作品/帖子 -> rejected（不展示，作者可见可申诉）；评论 -> 删除
    if r.target_type in ("work", "post"):
        obj = db.get(models.Work, r.target_id) if r.target_type == "work" else db.get(models.Post, r.target_id)
        obj.status = "rejected"
    else:
        obj = db.get(models.WorkComment, r.target_id) if r.target_type == "work_comment" else db.get(models.PostComment, r.target_id)
        db.delete(obj)

    # 追加惩罚
    penalty = (body or {}).get("penalty") or ""
    reason = (body or {}).get("reason") or ""
    author = db.get(models.User, info["author_id"])
    penalty_detail = ""
    note = f"你的内容《{info['title']}》未通过敏感词审核"
    if reason:
        note += f"：{reason}"
    if penalty == "warn":
        penalty_detail = "警告"
        note += "，给予警告一次"
    elif penalty == "mute":
        days = int((body or {}).get("days") or 1)
        author.ban_until = datetime.now(timezone.utc) + timedelta(days=days)
        author.ban_reason = f"敏感词内容：{info['title']}"
        penalty_detail = f"禁言 {days} 天"
        note += f"，禁言 {days} 天"
    elif penalty == "ban":
        author.is_banned = True
        author.ban_until = None
        author.ban_reason = f"敏感词内容：{info['title']}"
        penalty_detail = "永久封禁"
        note += "，账号已封禁"
    elif penalty == "xp":
        amount = abs(int((body or {}).get("amount") or 100))
        author.xp_bonus = (author.xp_bonus or 0) - amount
        penalty_detail = f"扣除 {amount} 经验"
        note += f"，扣除 {amount} 经验"

    r.status = "rejected"
    r.penalty = penalty
    r.penalty_detail = penalty_detail or reason
    r.handled_at = models.now()
    r.handled_by = admin.id
    db.commit()
    serializers.log_admin_action(db, admin.id, "sensitive_reject", r.target_type, r.target_id, f"敏感词审核拒绝（{penalty_detail or '仅隐藏'}）：{info['title']}")
    serializers.notify_admin_action(db, info["author_id"], admin.id, note, r.target_type, r.target_id)
    return {"ok": True, "penalty": penalty, "penalty_detail": penalty_detail}


@router.get("/sensitive-words/stats")
def sensitive_word_stats(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """敏感词命中统计：按审核队列中的命中词计数 + 各词审核结果。"""
    from collections import Counter

    reviews = db.query(models.ContentReview).all()
    counter: Counter = Counter()
    by_status: Counter = Counter()
    for r in reviews:
        by_status[r.status or "pending"] += 1
        for w in (r.sensitive_words or "").split(","):
            if w:
                counter[w] += 1
    total_words = db.query(models.SensitiveWord).count()
    return {
        "total_words": total_words,
        "queue_counts": {"pending": by_status.get("pending", 0), "approved": by_status.get("approved", 0), "rejected": by_status.get("rejected", 0)},
        "top_hits": [{"word": w, "count": c} for w, c in counter.most_common(20)],
    }


# ==================== 账号存储扩容申请（原「Scratch 容量」，站长 2026-09-27 改为账号总存储） ====================
# 规则见 app/storage_quota.py：默认 500MB（.sb3 源文件 + 图片 + 语音 + 附件全都算），
# 剩余不足 50MB 才能申请，管理员通过时填新配额。
@router.get("/scratch-quota/requests")
def list_scratch_quota_requests(
    status: str = "pending",
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """扩容申请列表。status=pending/approved/rejected/all。"""
    q = db.query(models.ScratchQuotaRequest)
    if status and status != "all":
        q = q.filter(models.ScratchQuotaRequest.status == status)
    rows = q.order_by(models.ScratchQuotaRequest.id.desc()).limit(200).all()
    out = []
    for r in rows:
        u = db.get(models.User, r.user_id)
        item = storage_quota.serialize_request(r, (u.nickname if u else "") or "")
        item["uid"] = (u.uid if u else "") or ""
        item["avatar_url"] = (u.avatar_url if u else "") or ""
        # 管理员看到的是**此刻**的用量（申请人提交后可能又传了东西），并给出分类明细
        if u is not None:
            bd = storage_quota.breakdown(db, u)
            item["used_now_mb"] = int(math.ceil(bd["total_bytes"] / 1048576))
            item["quota_now_mb"] = storage_quota.quota_mb(u)
            item["files_now"] = bd["files"]
            item["scratch_now_mb"] = round(bd["scratch_bytes"] / 1048576, 1)
            item["image_now_mb"] = round(bd["image_bytes"] / 1048576, 1)
        else:
            item["used_now_mb"] = 0
            item["quota_now_mb"] = 0
            item["files_now"] = 0
            item["scratch_now_mb"] = 0
            item["image_now_mb"] = 0
        item["works_now"] = (
            db.query(models.Work)
            .filter(models.Work.user_id == r.user_id, models.Work.sb3_sha256.isnot(None))
            .count()
        )
        out.append(item)
    return {
        "requests": out,
        "pending": db.query(models.ScratchQuotaRequest).filter(models.ScratchQuotaRequest.status == "pending").count(),
        "default_mb": storage_quota.default_mb(),
        "apply_threshold_mb": storage_quota.apply_threshold_mb(),
        "max_mb": storage_quota.max_mb(),
    }


@router.post("/scratch-quota/requests/{request_id}/review")
def review_scratch_quota_request(
    request_id: int,
    body: schemas.ScratchQuotaReview,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审批扩容申请：通过（带新配额 MB）或驳回（可写理由）。申请人会收到通知。"""
    try:
        r = storage_quota.review(db, admin, request_id, body.decision, body.grant_mb, body.note)
    except storage_quota.QuotaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    serializers.log_admin_action(
        db, admin.id,
        "scratch_quota_approve" if body.decision == "approve" else "scratch_quota_reject",
        "user", r["user_id"],
        f"{'批准' if body.decision == 'approve' else '驳回'}存储扩容申请 #{request_id}"
        + (f"，新空间 {r['grant_mb']}MB" if body.decision == "approve" else "")
        + (f"（{body.note}）" if body.note else ""),
    )
    return {"ok": True, "request": r}


@router.post("/users/{uid}/scratch-quota")
def admin_set_scratch_quota(
    uid: str,
    body: schemas.ScratchQuotaSet,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """直接设置某个用户的账号存储配额（MB）。管理员手动调整用。"""
    user = db.query(models.User).filter(models.User.uid == str(uid)).first()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    try:
        mb = storage_quota.set_quota(db, user, body.quota_mb)
    except storage_quota.QuotaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    serializers.log_admin_action(db, admin.id, "scratch_quota_set", "user", user.id, f"设置账号存储配额为 {mb}MB")
    return {
        "ok": True,
        "uid": user.uid,
        "nickname": user.nickname,
        "quota_mb": mb,
        "used_mb": storage_quota.used_mb(db, user),
    }


# ==================== 社区风纪委员会（站长 2026-10-01） ====================
#   · 申请：LV3 起可申请，管理员在这里审批；
#   · 巡逻：风纪委员在 /committee 页面「先隐藏、再送审」，进的是**同一个**
#     content_reviews 队列（source='committee'），下面 /committee/reviews 只筛出来；
#     裁决复用既有的 /sensitive-reviews/{id}/approve|reject（通过＝恢复展示、驳回＝维持隐藏）。
#   · 治理：误判（被管理员判「内容没问题」）会计在委员名下，可停职。
@router.get("/committee/overview")
def committee_overview(admin: models.User = Depends(get_current_admin), db: Session = Depends(get_db)):
    """后台「风纪委员会」页签要的一屏数据：待审申请、成员、送审队列、统计。"""
    applications = (
        db.query(models.User)
        .filter(models.User.committee_status == "pending")
        .order_by(models.User.committee_at.desc())
        .limit(100)
        .all()
    )
    members = (
        db.query(models.User)
        .filter(models.User.committee_status.in_(("active", "suspended")))
        .order_by(models.User.committee_at.desc())
        .limit(200)
        .all()
    )

    def _row(u: models.User) -> dict:
        return {
            **serializers.user_brief(u),
            "status": (u.committee_status or "none"),
            "reason": u.committee_reason or "",
            "at": u.committee_at.isoformat() if u.committee_at else None,
            "stats": committee.stats_of(db, u),
        }

    pending_reviews = (
        db.query(models.ContentReview)
        .filter(models.ContentReview.source == "committee", models.ContentReview.status == "pending")
        .count()
    )
    return {
        "applications": [_row(u) for u in applications],
        "members": [_row(u) for u in members],
        "pending_reviews": pending_reviews,
        "total_reviews": db.query(models.ContentReview).filter(models.ContentReview.source == "committee").count(),
        "min_level": committee.MIN_LEVEL,
        "daily_limit": committee.DAILY_HIDE_LIMIT,
    }


@router.post("/committee/applications/{uid}/review")
def review_committee_application(
    uid: str,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审批风纪委员申请：decision = approve / reject（可带 note）。"""
    target = db.query(models.User).filter(models.User.uid == str(uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    decision = str((body or {}).get("decision") or "")
    note = str((body or {}).get("note") or "").strip()[:200]
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision 只能是 approve / reject")
    target.committee_status = "active" if decision == "approve" else "rejected"
    target.committee_at = models.now()
    db.commit()
    serializers.log_admin_action(
        db, admin.id, f"committee_{decision}", "user", target.id,
        f"{'批准' if decision == 'approve' else '驳回'}风纪委员申请" + (f"（{note}）" if note else ""),
    )
    serializers.notify_admin_action(
        db, target.id, admin.id,
        "你已通过风纪委员会审批，成为风纪委员，可前往「风纪委员会」页面参与内容巡逻"
        if decision == "approve" else
        "你的风纪委员申请未通过" + (f"（{note}）" if note else ""),
    )
    return {"ok": True, "status": target.committee_status}


@router.post("/committee/members/{uid}/suspend")
def suspend_committee_member(
    uid: str,
    body: dict,
    admin: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """停职 / 恢复某个风纪委员（body.suspended = true / false，可带 note）。"""
    target = db.query(models.User).filter(models.User.uid == str(uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if (target.committee_status or "") not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="该用户不是风纪委员")
    suspended = bool((body or {}).get("suspended"))
    note = str((body or {}).get("note") or "").strip()[:200]
    target.committee_status = "suspended" if suspended else "active"
    target.committee_at = models.now()
    db.commit()
    serializers.log_admin_action(
        db, admin.id, "committee_suspend" if suspended else "committee_resume", "user", target.id,
        ("停职" if suspended else "恢复") + "风纪委员" + (f"（{note}）" if note else ""),
    )
    serializers.notify_admin_action(
        db, target.id, admin.id,
        ("你已被停职，暂时不能使用风纪委员会功能" if suspended else "你的风纪委员身份已恢复") + (f"（{note}）" if note else ""),
    )
    return {"ok": True, "status": target.committee_status}
