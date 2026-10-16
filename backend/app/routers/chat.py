"""聊天 REST 接口（全新实现，基于统一会话模型 ChatThread/ChatMember/ChatMessage）。

要点：
- 全部需要登录；每个接口都用 chat_core 校验成员身份与管理权限（服务端判定，不信任前端）。
- **写接口用 get_active_user**（被封禁/注销的账号不能发消息、建群、改资料、踢人、拉黑）；
  读接口仍用 get_current_user。原来这里清一色 get_current_user，而它只解 token、不查封禁，
  于是「被封禁的用户浏览器不刷新就能继续发消息」——socket 那边是拒的（socket.py connect），
  前端一旦发现 socket 连不上就走 REST 兜底，正好绕过封禁。
- 消息既可通过 REST 发送，也可通过 Socket 发送，两者共用 chat_core，行为完全一致。
- 不做任何限流。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import chat_core, config, imageurl, models, serializers, switches
from ..deps import get_active_user, get_current_user, get_db


def _require_chat_enabled() -> None:
    # 运行时开关（后台「系统设置 → 站点开关」可改），默认值仍取环境变量
    if not switches.enabled("chat"):
        raise HTTPException(status_code=503, detail="聊天功能维护中")


router = APIRouter(prefix="/chat", tags=["chat"], dependencies=[Depends(_require_chat_enabled)])


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------
def _member_json(db: Session, m: models.ChatMember, thread: models.ChatThread) -> dict:
    return {
        "uid": m.user.uid if m.user else None,
        "user_id": m.user_id,
        "name": m.user.display_name if m.user else "",
        "avatar_url": m.user.avatar_url if m.user else None,
        "role": m.role,
        "muted": bool(m.muted),
        "is_owner": bool(thread.owner_id == m.user_id),
        "joined_at": m.joined_at.isoformat() if m.joined_at else None,
    }


def _thread_detail(db: Session, thread: models.ChatThread, me: models.User) -> dict:
    data = chat_core.thread_card(db, thread, me.id)
    if thread.kind == "group":
        rows = (
            db.query(models.ChatMember)
            .filter_by(thread_id=thread.id)
            .order_by(models.ChatMember.role.asc(), models.ChatMember.id.asc())
            .all()
        )
        data["members"] = [_member_json(db, m, thread) for m in rows]
        data["announcement"] = thread.announcement or ""
        data["can_manage"] = chat_core.is_manager(db, thread, me.id)
        data["is_owner"] = bool(thread.owner_id == me.id)
        data["studio_id"] = thread.studio_id
    return data


# ---------------------------------------------------------------------------
# 未读 / 会话列表
# ---------------------------------------------------------------------------
@router.get("/unread")
def unread(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """总未读（导航角标用）。"""
    return chat_core.unread_summary(db, user.id)


@router.get("/threads")
def list_threads(
    kind: str = "all",
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """我参与的会话列表（kind=all|dm|group）。"""
    q = (
        db.query(models.ChatThread)
        .join(models.ChatMember, models.ChatMember.thread_id == models.ChatThread.id)
        .filter(models.ChatMember.user_id == user.id)
    )
    if kind in ("dm", "group"):
        q = q.filter(models.ChatThread.kind == kind)
    threads = q.all()
    cards = [chat_core.thread_card(db, t, user.id) for t in threads]
    # 排序：先按最后消息时间倒序（稳定排序），再按「置顶优先、有消息优先」分组
    cards.sort(key=lambda c: c["last_message_at"] or "", reverse=True)
    cards.sort(key=lambda c: (0 if c["pinned"] else 1, 0 if c["last_message_at"] else 1))
    return cards


@router.get("/threads/{thread_id}")
def thread_detail(
    thread_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_member(db, thread, user.id)
    return _thread_detail(db, thread, user)


# ---------------------------------------------------------------------------
# 打开私聊 / 创建群
# ---------------------------------------------------------------------------
@router.post("/threads/dm", status_code=201)
def open_dm(
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """按对方 uid 打开（或创建）私聊。"""
    uid = body.get("uid")
    if not uid:
        raise HTTPException(status_code=400, detail="缺少对方 uid")
    thread = chat_core.open_dm(db, user.id, uid)
    return _thread_detail(db, thread, user)


@router.post("/threads/group", status_code=201)
def create_group(
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.create_group(db, user, body.get("title") or body.get("name") or "", body.get("announcement") or "")
    return _thread_detail(db, thread, user)


# ---------------------------------------------------------------------------
# 消息
# ---------------------------------------------------------------------------
@router.get("/threads/{thread_id}/messages")
def list_messages(
    thread_id: int,
    before_id: int | None = None,
    limit: int = chat_core.PAGE_SIZE,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """分页拉消息（返回按时间正序；更早的消息用 before_id=本页第一条 id）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_member(db, thread, user.id)
    rows, has_more = chat_core.page_messages(db, thread.id, before_id=before_id, limit=limit)
    return {
        "messages": [chat_core.message_json(db, m, reader_id=user.id, kind=thread.kind) for m in rows],
        "has_more": has_more,
        "oldest_id": rows[0].id if rows else None,
    }


@router.post("/threads/{thread_id}/messages", status_code=201)
def send_message_rest(
    thread_id: int,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """REST 发送消息（Socket 未连接时的兜底通道）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.can_send(db, thread, user.id)
    msg = chat_core.send_message(
        db,
        thread,
        user,
        content=body.get("content") or "",
        image_url=body.get("image_url"),
        voice_url=body.get("voice_url"),
        voice_duration=body.get("voice_duration"),
        reply_to_id=body.get("reply_to"),
    )
    payload = chat_core.message_json(db, msg, reader_id=user.id, kind=thread.kind)
    try:
        from ..socket import emit_users

        emit_users("chat:new", {"thread_id": thread.id, "message": payload, "kind": thread.kind}, chat_core.member_ids(db, thread.id))
    except Exception:
        pass
    return payload


@router.post("/threads/{thread_id}/read")
def mark_read(
    thread_id: int,
    body: dict | None = None,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_member(db, thread, user.id)
    last = chat_core.mark_read(db, thread.id, user.id, (body or {}).get("last_message_id"))
    try:
        from ..socket import emit_users

        others = [x for x in chat_core.member_ids(db, thread.id) if x != user.id]
        emit_users("chat:read", {"thread_id": thread.id, "user_id": user.id, "last_message_id": last}, others)
    except Exception:
        pass
    return {"ok": True, "last_message_id": last}


@router.post("/messages/{message_id}/recall")
def recall(
    message_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    msg = db.get(models.ChatMessage, message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="消息不存在")
    thread = chat_core.get_thread_or_404(db, msg.thread_id)
    chat_core.require_member(db, thread, user.id)
    if not chat_core.can_recall(msg, user.id):
        raise HTTPException(status_code=403, detail=f"只能撤回自己 {chat_core.RECALL_MINUTES} 分钟内发送且未撤回的消息")
    msg.recalled = True
    msg.content = ""
    msg.image_url = None
    msg.voice_url = None
    db.commit()
    try:
        from ..socket import emit_users

        emit_users(
            "chat:recalled",
            {"thread_id": thread.id, "message_id": msg.id, "by": user.id},
            chat_core.member_ids(db, thread.id),
        )
    except Exception:
        pass
    return {"ok": True}


@router.delete("/messages/{message_id}", status_code=204)
def delete_message(
    message_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """删除消息：本人；群内管理员可删他人消息（留痕为「已删除」）。"""
    msg = db.get(models.ChatMessage, message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="消息不存在")
    thread = chat_core.get_thread_or_404(db, msg.thread_id)
    chat_core.require_member(db, thread, user.id)
    mine = msg.sender_id == user.id
    if not mine and not (thread.kind == "group" and chat_core.is_manager(db, thread, user.id)):
        raise HTTPException(status_code=403, detail="只能删除自己的消息")
    msg.deleted = True
    msg.content = ""
    msg.image_url = None
    msg.voice_url = None
    db.commit()
    try:
        from ..socket import emit_users

        emit_users(
            "chat:deleted",
            {"thread_id": thread.id, "message_id": msg.id, "by": user.id},
            chat_core.member_ids(db, thread.id),
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 加入 / 退出 / 设置
# ---------------------------------------------------------------------------
@router.post("/threads/{thread_id}/join")
def join_group(
    thread_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.get_thread_or_404(db, thread_id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="只有群聊才能加入")
    if thread.studio_id:
        raise HTTPException(status_code=400, detail="工作室讨论区请通过加入工作室进入")
    if chat_core.membership(db, thread.id, user.id) is not None:
        return _thread_detail(db, thread, user)
    # 新成员水位 = 当前最大消息 id：否则一进群就是「未读 = 全部历史消息」（99+），
    # 这对有几千条记录的工作室讨论群尤其离谱。
    db.add(models.ChatMember(
        thread_id=thread.id, user_id=user.id, role="member",
        last_read_message_id=chat_core.current_max_message_id(db, thread.id),
    ))
    db.add(models.ChatMessage(thread_id=thread.id, sender_id=user.id, content=f"{user.display_name} 加入了群聊"))
    thread.last_message_at = chat_core.utcnow()
    try:
        db.commit()
    except IntegrityError:
        # 并发重复加入（双击「加入」/ 多端同时点）会撞 uq_chat_member 唯一约束：
        # 以前这里直接 500，其实只要回滚后按「已经是成员」处理即可。
        db.rollback()
        if chat_core.membership(db, thread.id, user.id) is None:
            raise
        return _thread_detail(db, thread, user)
    try:
        from ..socket import emit_users

        emit_users(
            "chat:new",
            {"thread_id": thread.id, "message": {"id": 0, "thread_id": thread.id, "system": True, "content": f"{user.display_name} 加入了群聊", "created_at": chat_core.utcnow().isoformat()}},
            chat_core.member_ids(db, thread.id),
        )
    except Exception:
        pass
    return _thread_detail(db, thread, user)


@router.post("/threads/{thread_id}/leave")
def leave_group(
    thread_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.get_thread_or_404(db, thread_id)
    m = chat_core.require_member(db, thread, user.id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="私聊无需退出")
    if thread.studio_id:
        raise HTTPException(status_code=400, detail="工作室讨论区请通过退出工作室离开")
    if thread.owner_id == user.id:
        raise HTTPException(status_code=400, detail="群主不能退出，请改用「解散群聊」")
    db.delete(m)
    db.add(models.ChatMessage(thread_id=thread.id, sender_id=user.id, content=f"{user.display_name} 退出了群聊"))
    db.commit()
    return {"ok": True}


@router.patch("/threads/{thread_id}")
def update_thread(
    thread_id: int,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """改群资料（群主/管理员）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="私聊没有群资料")
    chat_core.require_manager(db, thread, user.id)
    if "title" in body:
        title = (body.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="群名称不能为空")
        if len(title) > 40:
            raise HTTPException(status_code=400, detail="群名称最多 40 字")
        thread.title = title
    if "announcement" in body:
        thread.announcement = (body.get("announcement") or "").strip()[:500]
    if "avatar_url" in body:
        thread.avatar_url = imageurl.check_uploaded_image(body.get("avatar_url"), "群头像")
    db.commit()
    return _thread_detail(db, thread, user)


@router.delete("/threads/{thread_id}", status_code=204)
def dissolve_group(
    thread_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    thread = chat_core.get_thread_or_404(db, thread_id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="私聊不能解散")
    if thread.studio_id:
        raise HTTPException(status_code=400, detail="工作室讨论区不能单独解散")
    chat_core.require_owner(thread, user.id)
    members = chat_core.member_ids(db, thread.id)
    db.query(models.ChatMessage).filter_by(thread_id=thread.id).delete()
    db.query(models.ChatMember).filter_by(thread_id=thread.id).delete()
    db.delete(thread)
    db.commit()
    try:
        from ..socket import emit_users

        emit_users("chat:thread_gone", {"thread_id": thread_id}, members)
    except Exception:
        pass


@router.patch("/threads/{thread_id}/me")
def update_my_settings(
    thread_id: int,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """我的会话设置：置顶 / 免打扰。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    m = chat_core.require_member(db, thread, user.id)
    if "pinned" in body:
        m.pinned = bool(body.get("pinned"))
    if "notify_off" in body:
        m.notify_off = bool(body.get("notify_off"))
    db.commit()
    return {"ok": True, "pinned": bool(m.pinned), "notify_off": bool(m.notify_off)}


# ---------------------------------------------------------------------------
# 群管理
# ---------------------------------------------------------------------------
@router.post("/threads/{thread_id}/mute-all")
def mute_all(
    thread_id: int,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """全员禁言（群主）。minutes<=0 表示解除。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_owner(thread, user.id)
    try:
        minutes = int(body.get("minutes") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="minutes 必须是数字")
    if minutes <= 0:
        thread.mute_all_until = None
    else:
        from datetime import timedelta

        thread.mute_all_until = chat_core.utcnow() + timedelta(minutes=minutes)
    db.commit()
    return {"mute_all_until": thread.mute_all_until.isoformat() if thread.mute_all_until else None}


@router.patch("/threads/{thread_id}/members/{member_uid}")
def update_member(
    thread_id: int,
    member_uid: str,
    body: dict,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """设置成员禁言 / 管理员（群主或管理员）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="私聊没有成员管理")
    chat_core.require_manager(db, thread, user.id)
    target = db.query(models.User).filter(models.User.uid == str(member_uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="成员不存在")
    m = chat_core.membership(db, thread.id, target.id)
    if m is None:
        raise HTTPException(status_code=404, detail="该用户不在群里")
    i_am_owner = thread.owner_id == user.id
    if "muted" in body:
        if not i_am_owner and m.role in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="管理员不能禁言管理员或群主")
        if target.id == thread.owner_id:
            raise HTTPException(status_code=400, detail="不能禁言群主")
        m.muted = bool(body.get("muted"))
    if "role" in body:
        if not i_am_owner:
            raise HTTPException(status_code=403, detail="只有群主能设置管理员")
        role = (body.get("role") or "").strip()
        if role not in ("admin", "member"):
            raise HTTPException(status_code=400, detail="role 只能是 admin 或 member")
        if target.id == thread.owner_id:
            raise HTTPException(status_code=400, detail="群主身份不能修改")
        m.role = role
    db.commit()
    return _member_json(db, m, thread)


@router.delete("/threads/{thread_id}/members/{member_uid}", status_code=204)
def kick_member(
    thread_id: int,
    member_uid: str,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """移出成员（群主可移出任何人；管理员只能移出普通成员）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    if thread.kind != "group":
        raise HTTPException(status_code=400, detail="私聊没有成员管理")
    chat_core.require_manager(db, thread, user.id)
    target = db.query(models.User).filter(models.User.uid == str(member_uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="成员不存在")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="不能移出自己")
    if target.id == thread.owner_id:
        raise HTTPException(status_code=400, detail="不能移出群主")
    m = chat_core.membership(db, thread.id, target.id)
    if m is None:
        raise HTTPException(status_code=404, detail="该用户不在群里")
    if thread.owner_id != user.id and m.role in ("admin",):
        raise HTTPException(status_code=403, detail="管理员不能移出管理员")
    db.delete(m)
    db.add(models.ChatMessage(thread_id=thread.id, sender_id=user.id, content=f"{target.display_name} 被移出了群聊"))
    db.commit()
    try:
        from ..socket import emit_users

        emit_users("chat:thread_gone", {"thread_id": thread.id, "kicked": target.id}, [target.id])
    except Exception:
        pass


@router.get("/threads/{thread_id}/search")
def search_messages(
    thread_id: int,
    q: str = "",
    limit: int = 30,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """会话内消息搜索（转义 % 与 _，最多 50 条）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_member(db, thread, user.id)
    text = (q or "").strip()
    if not text:
        return {"messages": [], "total": 0}
    esc = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    limit = max(1, min(int(limit or 30), 50))
    base = db.query(models.ChatMessage).filter(
        models.ChatMessage.thread_id == thread.id,
        models.ChatMessage.deleted.is_(False),
        models.ChatMessage.content.like(f"%{esc}%", escape="\\"),
    )
    total = base.count()
    rows = base.order_by(models.ChatMessage.id.desc()).limit(limit).all()
    return {
        "messages": [chat_core.message_json(db, m, reader_id=user.id, kind=thread.kind) for m in rows],
        "total": total,
    }


@router.get("/threads/{thread_id}/media")
def thread_media(
    thread_id: int,
    limit: int = 60,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """会话内的图片/语音（图片墙）。"""
    thread = chat_core.get_thread_or_404(db, thread_id)
    chat_core.require_member(db, thread, user.id)
    limit = max(1, min(int(limit or 60), 200))
    rows = (
        db.query(models.ChatMessage)
        .filter(
            models.ChatMessage.thread_id == thread.id,
            models.ChatMessage.deleted.is_(False),
            models.ChatMessage.recalled.is_(False),
            or_(models.ChatMessage.image_url.isnot(None), models.ChatMessage.voice_url.isnot(None)),
        )
        .order_by(models.ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": m.id,
            "image_url": m.image_url,
            "voice_url": m.voice_url,
            "voice_duration": m.voice_duration,
            "sender_id": m.sender_id,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]


# ---------------------------------------------------------------------------
# 发现群 / 找人 / 拉黑
# ---------------------------------------------------------------------------
@router.get("/discover")
def discover_groups(
    q: str = "",
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """可加入的群（不含工作室讨论区）。"""
    my_ids = [r[0] for r in db.query(models.ChatMember.thread_id).filter_by(user_id=user.id).all()]
    query = db.query(models.ChatThread).filter(
        models.ChatThread.kind == "group",
        models.ChatThread.studio_id.is_(None),
    )
    if my_ids:
        query = query.filter(models.ChatThread.id.notin_(my_ids))
    if q.strip():
        query = query.filter(models.ChatThread.title.like(f"%{q.strip()}%"))
    rows = query.order_by(models.ChatThread.id.desc()).limit(50).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "announcement": t.announcement or "",
            "avatar_url": t.avatar_url,
            "owner_id": t.owner_id,
            "member_count": db.query(models.ChatMember).filter_by(thread_id=t.id).count(),
        }
        for t in rows
    ]


@router.get("/users")
def search_users(
    q: str = "",
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """按昵称/账号/编号找人（用于发起私聊）。"""
    text = (q or "").strip()
    if not text:
        return []
    rows = (
        db.query(models.User)
        .filter(
            models.User.id != user.id,
            models.User.is_deactivated.isnot(True),
            or_(
                models.User.nickname.like(f"%{text}%"),
                models.User.username.like(f"%{text}%"),
                models.User.uid.like(f"%{text}%"),
            ),
        )
        .limit(20)
        .all()
    )
    out = []
    for u in rows:
        brief = serializers.user_brief(u)
        blocked = chat_core.blocked_between(db, user.id, u.id)
        brief["blocked"] = blocked
        out.append(brief)
    return out


@router.get("/blocks")
def list_blocks(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.ChatBlock).filter_by(blocker_id=user.id).all()
    out = []
    for b in rows:
        u = db.get(models.User, b.blocked_id)
        if u is not None:
            out.append(serializers.user_brief(u))
    return out


@router.post("/blocks/{member_uid}", status_code=201)
def add_block(
    member_uid: str,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    target = db.query(models.User).filter(models.User.uid == str(member_uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="不能拉黑自己")
    if db.query(models.ChatBlock).filter_by(blocker_id=user.id, blocked_id=target.id).first() is None:
        db.add(models.ChatBlock(blocker_id=user.id, blocked_id=target.id))
        db.commit()
    return {"ok": True}


@router.delete("/blocks/{member_uid}", status_code=204)
def remove_block(
    member_uid: str,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    target = db.query(models.User).filter(models.User.uid == str(member_uid)).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.query(models.ChatBlock).filter_by(blocker_id=user.id, blocked_id=target.id).delete()
    db.commit()
