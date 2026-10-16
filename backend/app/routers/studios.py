"""工作室系统 v2。

相对旧版的改动：
- 角色权限统一走 studio_core（原来 20 多个接口各抄一遍判断）
- 列表/详情批量取计数，不再每个工作室跑 8~10 条 SQL
- 列表与作品墙支持分页（原来一律 query.all() 全量返回）
- 修 bug：改工作室名不查敏感词、等级判断漏 xp_bonus 与条约、成员参数名叫 member_id 实际是 user_id
- 稿件驳回改为标记 rejected（原来直接删记录，作者看不到任何痕迹、也无法重新投稿）
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import chat_core, imageurl, models, schemas, serializers, studio_core as core
from ..deps import get_active_user, get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/studios", tags=["studios"])

STUDIO_CATEGORIES = core.STUDIO_CATEGORIES
MAX_STUDIOS = core.MAX_STUDIOS
PIN_LIMIT = core.PIN_LIMIT
SORTS = ("new", "hot", "members")


def _gen_invite_code() -> str:
    import secrets
    return secrets.token_hex(3).upper()


def _recommended_limit(db: Session, user: models.User) -> int:
    return core.member_limit_for_level(core.user_level(db, user))


# ==========================================================================
# 列表 / 详情
# ==========================================================================
@router.get("")
def list_studios(
    q: str | None = None,
    category: str | None = None,
    sort: str = "new",
    mine: int = 0,
    skip: int = 0,
    limit: int = 24,
    with_total: int = 0,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """工作室列表。sort: new 最新 / hot 最热（按总播放）/ members 成员最多。

    mine=1 时只返回我加入（含待审核）的工作室。
    """
    query = db.query(models.Studio).filter(models.Studio.status == "active")
    if q:
        query = query.filter(models.Studio.name.contains(q.strip()))
    if category and category not in ("全部", ""):
        query = query.filter(models.Studio.category == category)
    if mine and current:
        ids = [
            r[0] for r in db.query(models.StudioMember.studio_id)
            .filter(models.StudioMember.user_id == current.id).all()
        ]
        query = query.filter(models.Studio.id.in_(ids or [0]))
    query = query.order_by(models.Studio.created_at.desc(), models.Studio.id.desc())

    studios = query.all()
    items = core.studios_out(db, studios, current.id if current else None)

    sort = sort if sort in SORTS else "new"
    if sort == "hot":
        items.sort(key=lambda s: s["total_views"], reverse=True)
    elif sort == "members":
        items.sort(key=lambda s: s["member_count"], reverse=True)

    total = len(items)
    skip = max(0, skip)
    limit = max(1, min(60, limit))
    page = items[skip:skip + limit]
    if with_total:
        return {"items": page, "total": total, "skip": skip, "limit": limit}
    return page


@router.get("/followed")
def followed_studios(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    rows = (
        db.query(models.StudioFollow)
        .filter_by(user_id=user.id)
        .order_by(models.StudioFollow.id.desc())
        .all()
    )
    ids = [r.studio_id for r in rows]
    if not ids:
        return []
    studios = [s for s in db.query(models.Studio).filter(models.Studio.id.in_(ids)).all()]
    by_id = {s.id: s for s in studios}
    ordered = [by_id[i] for i in ids if i in by_id]
    return core.studios_out(db, ordered, user.id)


@router.get("/{studio_id}")
def get_studio(
    studio_id: int,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    studio = core.get_studio_or_404(db, studio_id, current)
    me = core.membership(db, studio_id, current.id if current else None)
    data = core.studio_out(db, studio, current.id if current else None, me=me)
    can_manage = bool(me and me.status == core.STATUS_ACTIVE and me.role in core.MANAGER_ROLES)

    # 成员：管理可见全部（含待审核），其他人只看 active
    mq = db.query(models.StudioMember).filter_by(studio_id=studio_id)
    if not can_manage:
        mq = mq.filter(models.StudioMember.status == core.STATUS_ACTIVE)
    members = mq.order_by(models.StudioMember.id.asc()).all()
    data["members"] = [
        {
            "id": m.user_id,  # 前端一直用的用户 id，明确一下字段名
            "user": serializers.user_brief(m.user) if m.user else None,
            "role": m.role,
            "status": m.status,
            "muted": bool(m.muted),
            "apply_note": m.apply_note or "",
            "joined_at": m.joined_at,
            "reviewed_at": m.reviewed_at,
        }
        for m in members
    ]
    data["member_preview"] = [
        serializers.user_brief(m.user) for m in members[:12]
        if m.status == core.STATUS_ACTIVE and m.user is not None
    ]

    # 作品墙：置顶优先，其次新到旧
    wall = (
        db.query(models.StudioWork)
        .join(models.Work, models.Work.id == models.StudioWork.work_id)
        .filter(
            models.StudioWork.studio_id == studio_id,
            models.StudioWork.status == core.STATUS_ACTIVE,
            models.Work.status == "published",
        )
        .order_by(models.StudioWork.pinned.desc(), models.StudioWork.id.desc())
        .limit(12)
        .all()
    )
    data["works_preview"] = [serializers.work_out(w.work, db, current.id if current else None) for w in wall]

    # 动态流：上墙 + 新成员
    activity = []
    sw_rows = (
        db.query(models.StudioWork)
        .filter_by(studio_id=studio_id)
        .order_by(models.StudioWork.id.desc())
        .limit(30)
        .all()
    )
    for s in sw_rows:
        if s.work is not None and s.work.status == "published":
            activity.append({
                "kind": "work",
                "text": f"把稿件《{s.work.title}》加入了工作室",
                "work": serializers.work_out(s.work, db, current.id if current else None),
                "member": serializers.user_brief(s.work.author) if s.work.author else None,
                "time": s.added_at,
            })
    joined = (
        db.query(models.StudioMember)
        .filter_by(studio_id=studio_id, status=core.STATUS_ACTIVE)
        .order_by(models.StudioMember.joined_at.desc())
        .limit(12)
        .all()
    )
    for m in joined:
        if m.user is not None and m.joined_at is not None:
            activity.append({
                "kind": "join",
                "text": "加入了工作室",
                "member": serializers.user_brief(m.user),
                "time": m.joined_at,
            })
    # 时间统一成 UTC 再排序：数据库里读出来的是无时区的，models.now() 是带时区的，
    # 直接混着比会 TypeError（曾经导致工作室详情页 500）
    activity.sort(key=lambda x: serializers.as_utc(x["time"]) or models.now(), reverse=True)
    data["activity"] = activity[:24]

    if can_manage:
        bans = db.query(models.StudioBan).filter_by(studio_id=studio_id).all()
        data["blacklist"] = [serializers.user_brief(b.user) for b in bans if b.user is not None]
    return data


# ==========================================================================
# 创建 / 加入 / 退出
# ==========================================================================
@router.post("", status_code=201)
def create_studio(
    body: schemas.StudioCreate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    serializers.check_level(db, user, 4, "创建工作室")
    core.check_text(db, body.name, "工作室名称")
    if body.description:
        core.check_text(db, body.description, "工作室简介")
    if body.announcement:
        core.check_text(db, body.announcement, "工作室公告")
    # 创建者自己也是一个成员名额，和「最多加入 N 个工作室」保持一致
    if core.joined_studio_count(db, user.id) >= MAX_STUDIOS:
        core.fail(400, f"你最多同时属于 {MAX_STUDIOS} 个工作室（含自己创建的），请先退出一个")

    join_mode = body.join_mode if body.join_mode in ("open", "approval") else "open"
    studio = models.Studio(
        name=body.name.strip(),
        description=body.description or "",
        announcement=body.announcement or "",
        avatar_url=imageurl.check_uploaded_image(body.avatar_url, "工作室头像"),
        cover_url=imageurl.check_uploaded_image(body.cover_url, "工作室封面"),
        category=body.category if body.category in STUDIO_CATEGORIES else "综合",
        owner_id=user.id,
        join_mode=join_mode,
        # 加入条件创建时即可设定；「必须填申请留言」只在审核制下有意义
        min_level=max(0, min(99, int(body.min_level or 0))),
        multi_studio_only=bool(body.multi_studio_only),
        apply_required=bool(body.apply_required) and join_mode == "approval",
        invite_code=_gen_invite_code(),
        member_limit=_recommended_limit(db, user),
    )
    db.add(studio)
    db.commit()
    db.refresh(studio)
    db.add(models.StudioMember(studio_id=studio.id, user_id=user.id,
                               role=core.ROLE_OWNER, status=core.STATUS_ACTIVE))
    db.commit()
    chat_core.ensure_studio_thread(db, studio, user.id)
    return core.studio_out(db, studio, user.id, include_rooms=True)


@router.post("/{studio_id}/join")
def join_studio(
    studio_id: int,
    body: dict | None = None,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    studio = core.get_studio_or_404(db, studio_id, user)
    if studio.status != "active":
        core.fail(403, "工作室当前不可加入")
    if db.query(models.StudioBan.id).filter_by(studio_id=studio_id, user_id=user.id).first():
        core.fail(403, "你已被移出该工作室，无法再次加入")

    existing = core.membership(db, studio_id, user.id)
    if existing is not None and existing.status == core.STATUS_ACTIVE:
        return {"joined": True, "status": core.STATUS_ACTIVE, "already": True}
    if existing is not None and existing.status == core.STATUS_PENDING:
        return {"joined": False, "status": core.STATUS_PENDING, "already": True,
                "detail": "申请已提交，等待管理员审核"}

    if core.counts_for(db, [studio_id])[studio_id]["member_count"] >= (studio.member_limit or 50):
        core.fail(403, f"工作室成员已满（上限 {studio.member_limit or 50} 人）")
    if core.joined_studio_count(db, user.id) >= MAX_STUDIOS:
        core.fail(403, f"你最多同时加入 {MAX_STUDIOS} 个工作室，请先退出一个")
    block = core.multi_studio_block(db, studio, user)
    if block:
        core.fail(403, block)
    if studio.min_level and core.user_level(db, user) < studio.min_level:
        core.fail(403, f"该工作室要求 Lv.{studio.min_level} 以上才能加入")

    payload = body if isinstance(body, dict) else {}
    code = (payload.get("invite_code") or "").strip().upper()
    apply_note = (payload.get("apply_note") or "").strip()
    if code and studio.invite_code and code == studio.invite_code.upper():
        status_ = core.STATUS_ACTIVE
    else:
        status_ = core.STATUS_ACTIVE if studio.join_mode == "open" else core.STATUS_PENDING
    if status_ == core.STATUS_PENDING and studio.apply_required and not apply_note:
        core.fail(400, "该工作室要求填写申请留言")
    if apply_note:
        core.check_text(db, apply_note, "申请留言")

    if existing is not None:  # 之前被驳回后残留的记录，复用
        existing.status = status_
        existing.apply_note = apply_note
        existing.reviewed_at = None
        existing.reviewed_by = None
    else:
        db.add(models.StudioMember(studio_id=studio_id, user_id=user.id, role=core.ROLE_MEMBER,
                                   status=status_, apply_note=apply_note))
    db.commit()

    if status_ == core.STATUS_ACTIVE:
        core.sync_discussion(db, studio_id, user.id, join=True, role=core.ROLE_MEMBER)
        serializers.notify_user(db, studio.owner_id, user.id, "studio", "studio", studio_id,
                                f"加入了你的工作室《{studio.name}》")
        core.notify_followers(db, studio, f"《{studio.name}》来了新成员 {user.display_name}", user.id)
    else:
        note = f"新成员 {user.display_name} 申请加入《{studio.name}》"
        if apply_note:
            note += f"：{apply_note[:50]}"
        core.notify_admins(db, studio, note, user.id, "studio", studio_id)
    db.commit()
    return {"joined": status_ == core.STATUS_ACTIVE, "status": status_}


@router.post("/{studio_id}/leave")
def leave_studio(
    studio_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    m = core.membership(db, studio_id, user.id)
    if m is None:
        return {"joined": False, "already": True}
    if m.role == core.ROLE_OWNER:
        core.fail(400, "创建者不能退出自己的工作室，请先转让或解散")
    studio = db.get(models.Studio, studio_id)
    was_active = m.status == core.STATUS_ACTIVE
    core.sync_discussion(db, studio_id, user.id, join=False)
    db.delete(m)
    db.commit()
    if was_active and studio is not None:
        core.notify_admins(db, studio, f"成员 {user.display_name} 退出了工作室", user.id, "studio", studio_id)
        db.commit()
    return {"joined": False}


# ==========================================================================
# 作品墙
# ==========================================================================
@router.get("/{studio_id}/works")
def studio_works(
    studio_id: int,
    status: str | None = None,
    skip: int = 0,
    limit: int = 24,
    with_total: int = 0,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """作品墙。成员/管理员传 status=pending 看自己家的待审稿。"""
    core.get_studio_or_404(db, studio_id, current)
    me = core.membership(db, studio_id, current.id if current else None)
    can_manage = bool(me and me.status == core.STATUS_ACTIVE and me.role in core.MANAGER_ROLES)
    want_pending = status == "pending" and can_manage

    q = (
        db.query(models.StudioWork)
        .join(models.Work, models.Work.id == models.StudioWork.work_id)
        .filter(models.StudioWork.studio_id == studio_id)
    )
    if want_pending:
        q = q.filter(models.StudioWork.status == core.STATUS_PENDING)
    else:
        q = q.filter(models.StudioWork.status == core.STATUS_ACTIVE, models.Work.status == "published")

    if want_pending:
        q = q.order_by(models.StudioWork.id.asc())  # 先申请的先审
    else:
        q = q.order_by(models.StudioWork.pinned.desc(), models.StudioWork.id.desc())

    total = q.count()
    skip = max(0, skip)
    limit = max(1, min(60, limit))
    rows = q.offset(skip).limit(limit).all()
    items = [serializers.work_out(r.work, db, current.id if current else None) for r in rows if r.work]
    if with_total:
        return {"items": items, "total": total, "skip": skip, "limit": limit}
    return items


@router.post("/{studio_id}/works", status_code=201)
def add_work_to_studio(
    studio_id: int,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    studio = core.get_studio_or_404(db, studio_id, user)
    if studio.status != "active":
        core.fail(403, "工作室已冻结，暂不能投稿")
    me = core.require_active_member(db, studio_id, user.id)
    work_id = body.get("work_id")
    work = db.get(models.Work, work_id) if isinstance(work_id, int) else None
    if work is None:
        core.fail(404, "稿件不存在")
    # 只能上墙自己的稿件；管理员可以代为上墙本工作室成员的稿件
    if work.user_id != user.id:
        other = core.membership(db, studio_id, work.user_id)
        can_curate = me.role in core.MANAGER_ROLES and other is not None and other.status == core.STATUS_ACTIVE
        if not can_curate:
            core.fail(403, "只能把投稿自己的稿件；管理员的代为上墙仅限本工作室成员的作品")

    existing = db.query(models.StudioWork).filter_by(studio_id=studio_id, work_id=work.id).first()
    if existing is not None and existing.status in (core.STATUS_ACTIVE, core.STATUS_PENDING):
        return {"added": True, "status": existing.status, "already": True}

    sw_status = core.STATUS_ACTIVE if me.role in core.MANAGER_ROLES else core.STATUS_PENDING
    if existing is not None:  # 之前被驳回，重新投稿
        existing.status = sw_status
        existing.reject_reason = ""
        existing.reviewed_at = None
        existing.reviewed_by = None
    else:
        db.add(models.StudioWork(studio_id=studio_id, work_id=work.id, status=sw_status))
    db.commit()

    if sw_status == core.STATUS_ACTIVE:
        serializers.notify_user(db, work.user_id, user.id, "studio_work", "work", work.id,
                                f"你的稿件《{work.title}》已上架工作室《{studio.name}》")
        core.notify_followers(db, studio, f"工作室《{studio.name}》上新稿件《{work.title}》", user.id)
    else:
        core.notify_admins(db, studio, f"成员 {user.display_name} 投稿《{work.title}》，等待审核",
                           user.id, "work", work.id)
    db.commit()
    return {"added": True, "status": sw_status}


def _sw_row(db: Session, studio_id: int, work_id: int) -> models.StudioWork:
    row = db.query(models.StudioWork).filter_by(studio_id=studio_id, work_id=work_id).first()
    if row is None:
        core.fail(404, "稿件不在该工作室")
    return row


@router.post("/{studio_id}/works/{work_id}/pin")
def pin_studio_work(studio_id: int, work_id: int, user: models.User = Depends(get_active_user),
                    db: Session = Depends(get_db)):
    """置顶/取消置顶作品墙稿件（最多 3 个）。"""
    core.require_manager(db, studio_id, user.id)
    row = _sw_row(db, studio_id, work_id)
    if row.status != core.STATUS_ACTIVE:
        core.fail(400, "只有已上墙的稿件可以置顶")
    if not row.pinned:
        pinned = db.query(func.count(models.StudioWork.id)).filter_by(studio_id=studio_id, pinned=True).scalar() or 0
        if pinned >= PIN_LIMIT:
            core.fail(400, f"最多置顶 {PIN_LIMIT} 个稿件")
        row.pinned = True
    else:
        row.pinned = False
    db.commit()
    return {"pinned": bool(row.pinned)}


@router.post("/{studio_id}/works/{work_id}/approve")
def approve_work(studio_id: int, work_id: int, user: models.User = Depends(get_active_user),
                 db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    row = _sw_row(db, studio_id, work_id)
    row.status = core.STATUS_ACTIVE
    row.reject_reason = ""
    row.reviewed_at = models.now()
    row.reviewed_by = user.id
    db.commit()
    studio = db.get(models.Studio, studio_id)
    work = db.get(models.Work, work_id)
    if studio and work:
        serializers.notify_user(db, work.user_id, user.id, "studio_work", "work", work_id,
                                f"你的稿件《{work.title}》已通过审核，上架《{studio.name}》")
        core.notify_followers(db, studio, f"工作室《{studio.name}》上新稿件《{work.title}》", user.id)
        db.commit()
    return {"ok": True, "status": core.STATUS_ACTIVE}


@router.post("/{studio_id}/works/{work_id}/reject")
def reject_work(studio_id: int, work_id: int, body: dict | None = None,
                user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """驳回投稿：保留记录并记下原因，作者可修改后重新投稿（旧版是直接删记录）。"""
    core.require_manager(db, studio_id, user.id)
    row = _sw_row(db, studio_id, work_id)
    reason = ((body or {}).get("reason") or "").strip()[:200]
    row.status = core.STATUS_REJECTED
    row.pinned = False
    row.reject_reason = reason
    row.reviewed_at = models.now()
    row.reviewed_by = user.id
    db.commit()
    work = db.get(models.Work, work_id)
    if work:
        extra = f"：{reason}" if reason else ""
        serializers.notify_user(db, work.user_id, user.id, "studio_work", "work", work_id,
                                f"你的稿件《{work.title}》未通过工作室审核{extra}")
        db.commit()
    return {"ok": True, "status": core.STATUS_REJECTED}


@router.delete("/{studio_id}/works/{work_id}", status_code=204)
def remove_work_from_studio(studio_id: int, work_id: int,
                            user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    db.query(models.StudioWork).filter_by(studio_id=studio_id, work_id=work_id).delete()
    db.commit()


# ==========================================================================
# 讨论群（一个工作室固定一个，成员与工作室成员自动同步）
# ==========================================================================
def _discussion_thread(db: Session, studio_id: int) -> models.ChatThread:
    thread = core.discussion_thread(db, studio_id)
    if thread is None:
        core.fail(404, "该工作室还没有讨论群")
    return thread


@router.post("/{studio_id}/rooms", status_code=201)
def create_room(studio_id: int, body: schemas.ChatRoomCreate,
                user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """保留接口以兼容旧前端：现在一个工作室只有一个讨论群，成员自动同步。"""
    core.require_manager(db, studio_id, user.id)
    thread = core.discussion_thread(db, studio_id)
    if thread is not None:
        core.fail(400, "一个工作室只能有一个讨论群，成员会自动同步进去；如需改名请在群设置里操作")
    studio = core.get_studio_or_404(db, studio_id, user)
    thread = chat_core.create_studio_thread(db, studio, user.id, title=f"{studio.name} · {body.name.strip()}",
                                            announcement=body.description)
    return {"id": thread.id, "name": thread.title}


@router.delete("/{studio_id}/rooms/{room_id}", status_code=204)
def delete_room(studio_id: int, room_id: int, user: models.User = Depends(get_active_user),
                db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    core.fail(400, "工作室讨论群不能单独删除，解散工作室时会一并处理")


@router.post("/{studio_id}/rooms/{room_id}/join")
def join_room(studio_id: int, room_id: int, user: models.User = Depends(get_active_user),
              db: Session = Depends(get_db)):
    core.require_active_member(db, studio_id, user.id)
    thread = _discussion_thread(db, studio_id)
    if thread.id != room_id:
        core.fail(404, "讨论群不存在")
    core.sync_discussion(db, studio_id, user.id, join=True, role=core.membership(db, studio_id, user.id).role)
    return {"joined": True}


@router.post("/{studio_id}/rooms/{room_id}/leave")
def leave_room(studio_id: int, room_id: int, user: models.User = Depends(get_active_user),
               db: Session = Depends(get_db)):
    """退出讨论群但保留工作室成员身份；下次进入工作室会自动重新加入。"""
    thread = _discussion_thread(db, studio_id)
    if thread.id != room_id:
        core.fail(404, "讨论群不存在")
    if thread.owner_id == user.id:
        core.fail(400, "群主不能退出，请先转让室长")
    core.sync_discussion(db, studio_id, user.id, join=False)
    return {"joined": False}


@router.post("/{studio_id}/rooms/{room_id}/mute_all")
def mute_all_room(studio_id: int, room_id: int, user: models.User = Depends(get_active_user),
                  db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    thread = _discussion_thread(db, studio_id)
    thread.mute_all_until = chat_core.utcnow() + timedelta(days=3650)
    db.commit()
    return {"ok": True, "muted_all": True}


@router.post("/{studio_id}/rooms/{room_id}/unmute_all")
def unmute_all_room(studio_id: int, room_id: int, user: models.User = Depends(get_active_user),
                    db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    thread = _discussion_thread(db, studio_id)
    thread.mute_all_until = None
    db.commit()
    return {"ok": True, "muted_all": False}


# ==========================================================================
# 邀请码 / 转让 / 解散 / 黑名单 / 关注
# ==========================================================================
@router.post("/{studio_id}/invite")
def regenerate_invite(studio_id: int, user: models.User = Depends(get_active_user),
                      db: Session = Depends(get_db)):
    core.require_owner(db, studio_id, user.id)
    studio = core.get_studio_or_404(db, studio_id, user)
    studio.invite_code = _gen_invite_code()
    db.commit()
    return {"invite_code": studio.invite_code}


@router.post("/{studio_id}/transfer")
def transfer_owner(studio_id: int, body: dict, user: models.User = Depends(get_active_user),
                   db: Session = Depends(get_db)):
    core.require_owner(db, studio_id, user.id)
    target_uid = body.get("member_id")
    target = core.membership(db, studio_id, target_uid) if isinstance(target_uid, int) else None
    if target is None or target.status != core.STATUS_ACTIVE or target.role not in (core.ROLE_ADMIN, core.ROLE_MEMBER):
        core.fail(400, "转让对象必须是本工作室的正式成员")
    studio = core.get_studio_or_404(db, studio_id, user)
    studio.pending_owner_id = target.user_id
    db.commit()
    serializers.notify_user(db, target.user_id, user.id, "studio", "studio", studio_id,
                            f"{user.display_name} 邀请你接管工作室《{studio.name}》，请前往工作室确认")
    db.commit()
    return {"ok": True, "pending": True}


@router.post("/{studio_id}/accept_transfer")
def accept_transfer(studio_id: int, user: models.User = Depends(get_active_user),
                    db: Session = Depends(get_db)):
    studio = core.get_studio_or_404(db, studio_id, user)
    if studio.pending_owner_id != user.id:
        core.fail(403, "没有待确认的转让")
    me = core.require_active_member(db, studio_id, user.id)
    old_owner = core.membership(db, studio_id, studio.owner_id)
    if old_owner is not None:
        old_owner.role = core.ROLE_ADMIN
    me.role = core.ROLE_OWNER
    studio.owner_id = user.id
    studio.pending_owner_id = None
    thread = core.discussion_thread(db, studio_id)
    if thread is not None:
        thread.owner_id = user.id
    db.commit()
    core.sync_discussion(db, studio_id, user.id, join=True, role=core.ROLE_OWNER)
    if old_owner is not None:
        core.sync_discussion(db, studio_id, old_owner.user_id, join=True, role=core.ROLE_ADMIN)
    serializers.notify_user(db, user.id, user.id, "studio", "studio", studio_id,
                            f"你已成为工作室《{studio.name}》的室长！")
    db.commit()
    return {"ok": True}


@router.post("/{studio_id}/disband")
def disband_studio(studio_id: int, user: models.User = Depends(get_active_user),
                   db: Session = Depends(get_db)):
    core.require_owner(db, studio_id, user.id)
    studio = core.get_studio_or_404(db, studio_id, user)
    member_ids = [r[0] for r in db.query(models.StudioMember.user_id).filter_by(studio_id=studio_id).all()]
    name = studio.name
    chat_core.dissolve_studio_thread(db, studio_id)
    db.query(models.StudioMember).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioWork).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioBan).filter_by(studio_id=studio_id).delete()
    db.query(models.StudioFollow).filter_by(studio_id=studio_id).delete()
    db.delete(studio)
    db.commit()
    for uid in member_ids:
        serializers.notify_user(db, uid, user.id, "studio", "studio", studio_id,
                                f"你所在的工作室《{name}》已被解散")
    db.commit()
    return {"ok": True}


@router.post("/{studio_id}/blacklist")
def add_blacklist(studio_id: int, body: dict, user: models.User = Depends(get_active_user),
                  db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    target_uid = body.get("user_id")
    if not isinstance(target_uid, int):
        core.fail(400, "无效的用户")
    target = core.membership(db, studio_id, target_uid)
    if target is not None and target.role == core.ROLE_OWNER:
        core.fail(400, "不能拉黑室长")
    if db.query(models.StudioBan.id).filter_by(studio_id=studio_id, user_id=target_uid).first() is None:
        db.add(models.StudioBan(studio_id=studio_id, user_id=target_uid))
    if target is not None:
        core.sync_discussion(db, studio_id, target_uid, join=False)
        db.delete(target)
    db.commit()
    return {"ok": True}


@router.get("/{studio_id}/blacklist")
def get_blacklist(studio_id: int, user: models.User = Depends(get_active_user),
                  db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    bans = db.query(models.StudioBan).filter_by(studio_id=studio_id).all()
    return [serializers.user_brief(b.user) for b in bans if b.user is not None]


@router.delete("/{studio_id}/blacklist/{user_id}", status_code=204)
def remove_blacklist(studio_id: int, user_id: int, user: models.User = Depends(get_active_user),
                     db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    db.query(models.StudioBan).filter_by(studio_id=studio_id, user_id=user_id).delete()
    db.commit()


@router.post("/{studio_id}/follow")
def follow_studio(studio_id: int, user: models.User = Depends(get_active_user),
                  db: Session = Depends(get_db)):
    core.get_studio_or_404(db, studio_id, user)
    if db.query(models.StudioFollow.id).filter_by(user_id=user.id, studio_id=studio_id).first() is None:
        db.add(models.StudioFollow(user_id=user.id, studio_id=studio_id))
        db.commit()
    return {"followed": True}


@router.delete("/{studio_id}/follow")
def unfollow_studio(studio_id: int, user: models.User = Depends(get_active_user),
                    db: Session = Depends(get_db)):
    db.query(models.StudioFollow).filter_by(user_id=user.id, studio_id=studio_id).delete()
    db.commit()
    return {"followed": False}


# ==========================================================================
# 设置与成员管理
# ==========================================================================
@router.patch("/{studio_id}")
def update_studio(studio_id: int, body: schemas.StudioUpdate,
                  user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    studio = core.get_studio_or_404(db, studio_id, user)

    if body.name is not None and body.name.strip() and body.name.strip() != studio.name:
        core.check_text(db, body.name, "工作室名称")   # 旧版改名不查敏感词
        studio.name = body.name.strip()[:100]
    if body.description is not None and body.description != studio.description:
        if body.description:
            core.check_text(db, body.description, "工作室简介")
        studio.description = body.description
    if body.announcement is not None and body.announcement != studio.announcement:
        studio.announcement = body.announcement
        core.notify_followers(db, studio, f"工作室《{studio.name}》发布了新公告", user.id)
    if body.avatar_url is not None:
        studio.avatar_url = imageurl.check_uploaded_image(body.avatar_url, "工作室头像")
    if body.cover_url is not None:
        studio.cover_url = imageurl.check_uploaded_image(body.cover_url, "工作室封面")
    if body.category is not None and body.category in STUDIO_CATEGORIES:
        studio.category = body.category
    if body.join_mode is not None and body.join_mode in ("open", "approval"):
        studio.join_mode = body.join_mode
    if body.entry_rules is not None and isinstance(body.entry_rules, dict):
        rules = body.entry_rules
        if "min_level" in rules:
            studio.min_level = max(0, min(99, int(rules["min_level"] or 0)))
        if "multi_studio_only" in rules:
            studio.multi_studio_only = bool(rules["multi_studio_only"])
        if "apply_required" in rules:
            studio.apply_required = bool(rules["apply_required"])
        if studio.apply_required and studio.join_mode != "approval":
            core.fail(400, "只有「需审核加入」的工作室才能要求填写申请留言")
    db.commit()
    db.refresh(studio)
    return core.studio_out(db, studio, user.id, me=core.membership(db, studio_id, user.id))


@router.post("/{studio_id}/members/{member_id}/role")
def set_member_role(studio_id: int, member_id: int, body: dict,
                    user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """注意：路径里的 member_id 实际是用户 id（保持与旧前端一致）。"""
    core.require_owner(db, studio_id, user.id)
    target = core.membership(db, studio_id, member_id)
    if target is None or target.status != core.STATUS_ACTIVE:
        core.fail(404, "该用户不是工作室正式成员")
    role = body.get("role")
    if role not in (core.ROLE_ADMIN, core.ROLE_MEMBER):
        core.fail(400, "无效的角色")
    target.role = role
    db.commit()
    core.sync_discussion(db, studio_id, member_id, join=True, role=role)
    serializers.notify_user(db, member_id, user.id, "studio", "studio", studio_id,
                            "你在工作室里的角色被调整为" + ("管理员" if role == core.ROLE_ADMIN else "普通成员"))
    db.commit()
    return {"ok": True, "role": role}


@router.delete("/{studio_id}/members/{member_id}", status_code=204)
def kick_member(studio_id: int, member_id: int, user: models.User = Depends(get_active_user),
                db: Session = Depends(get_db)):
    me = core.require_manager(db, studio_id, user.id)
    target = core.membership(db, studio_id, member_id)
    if target is None:
        core.fail(404, "该用户不是工作室成员")
    if target.role == core.ROLE_OWNER:
        core.fail(400, "不能移除室长")
    if me.role == core.ROLE_ADMIN and target.role == core.ROLE_ADMIN:
        core.fail(403, "管理员不能移除其他管理员")
    core.sync_discussion(db, studio_id, member_id, join=False)
    db.delete(target)
    db.commit()
    serializers.notify_user(db, member_id, user.id, "studio", "studio", studio_id,
                            "你已被移出工作室")
    db.commit()


@router.post("/{studio_id}/members/{member_id}/approve")
def approve_member(studio_id: int, member_id: int, user: models.User = Depends(get_active_user),
                   db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    target = core.membership(db, studio_id, member_id)
    if target is None or target.status != core.STATUS_PENDING:
        core.fail(404, "该申请不存在")
    target.status = core.STATUS_ACTIVE
    target.reviewed_at = models.now()
    target.reviewed_by = user.id
    db.commit()
    core.sync_discussion(db, studio_id, target.user_id, join=True, role=target.role or core.ROLE_MEMBER)
    serializers.notify_user(db, target.user_id, user.id, "studio_approve", "studio", studio_id,
                            "你的工作室加入申请已通过")
    db.commit()
    return {"ok": True, "status": core.STATUS_ACTIVE}


@router.post("/{studio_id}/members/{member_id}/reject", status_code=204)
def reject_member(studio_id: int, member_id: int, user: models.User = Depends(get_active_user),
                  db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    target = core.membership(db, studio_id, member_id)
    if target is not None and target.status == core.STATUS_PENDING:
        db.delete(target)
        db.commit()
        serializers.notify_user(db, member_id, user.id, "studio", "studio", studio_id,
                                "你的工作室加入申请未通过")
        db.commit()


@router.post("/{studio_id}/members/{member_id}/mute")
def mute_member(studio_id: int, member_id: int, body: dict,
                user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    core.require_manager(db, studio_id, user.id)
    target = core.membership(db, studio_id, member_id)
    if target is None or target.role == core.ROLE_OWNER:
        core.fail(404, "成员不存在")
    target.muted = bool(body.get("muted", True))
    db.commit()
    return {"ok": True, "muted": bool(target.muted)}
