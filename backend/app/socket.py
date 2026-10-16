"""Socket.IO 实时层：登录鉴权 + 聊天实时推送 + 站内通知推送。

投递原则（与旧实现完全不同）：
- 客户端连接后只进入自己的 user:{id} 房间。
- 任何消息由**服务端**按"该会话当前成员列表"逐个投递；客户端无法通过 join_room 之类的
  操作扩大自己的收信范围 → 从结构上杜绝"退群/被踢后仍收到消息"这类越权。
- 所有校验复用 chat_core，与 REST 完全一致。
"""
import asyncio

import socketio
from fastapi import HTTPException

from . import chat_core, config, models, security, switches
from .database import SessionLocal

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

_event_loop = None


def _set_event_loop(loop) -> None:
    global _event_loop
    _event_loop = loop


# ---------------------------------------------------------------------------
# 线程安全的对外投递（供 REST / 通知使用）
# ---------------------------------------------------------------------------
def _run(coro) -> None:
    if _event_loop is None or _event_loop.is_closed():
        return
    try:
        fut = asyncio.run_coroutine_threadsafe(coro, _event_loop)

        def _consume(f):
            try:
                f.result()
            except Exception:
                pass

        fut.add_done_callback(_consume)
    except Exception:
        pass


async def _emit_users(event: str, payload: dict, user_ids) -> None:
    for uid in {int(u) for u in (user_ids or []) if u}:
        await sio.emit(event, payload, to=f"user:{uid}")


def emit_users(event: str, payload: dict, user_ids) -> None:
    """向指定用户集合投递事件（线程安全，失败静默）。

    先判一次循环再构造协程：没有事件循环时（启动/关闭窗口、独立脚本、命令行工具）
    直接返回，否则会造出一个永远不会被 await 的协程，只能等 GC 报
    "coroutine was never awaited" 的警告。
    """
    if _event_loop is None or _event_loop.is_closed():
        return
    _run(_emit_users(event, payload, user_ids))


def emit_notification(user_id: int, payload: dict) -> None:
    """站内通知推送（serializers.notify_user 调用）。"""
    emit_users("notification", payload, [user_id])


# ---------------------------------------------------------------------------
# 连接
# ---------------------------------------------------------------------------
@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token") if isinstance(auth, dict) else None
    payload = security.decode_token(token) if token else None
    if payload is None or payload.get("sub") is None:
        return False
    db = SessionLocal()
    try:
        user = db.get(models.User, int(payload["sub"]))
    finally:
        db.close()
    if user is None or user.is_deactivated or user.effective_banned:
        return False
    if int(payload.get("ver") or 0) != int(getattr(user, "token_version", 0) or 0):
        return False
    _set_event_loop(asyncio.get_running_loop())
    await sio.save_session(sid, {"user_id": user.id})
    await sio.enter_room(sid, f"user:{user.id}")
    return True


@sio.event
async def disconnect(sid):
    return


# ---------------------------------------------------------------------------
# 聊天事件
# ---------------------------------------------------------------------------
async def _sender(sid):
    session = await sio.get_session(sid)
    return session.get("user_id")


async def _fail(sid, reason: str) -> None:
    uid = await _sender(sid)
    if uid:
        await sio.emit("chat:error", {"reason": reason}, to=f"user:{uid}")


@sio.on("chat:send")
async def chat_send(sid, data):
    """发送消息。

    **返回 {ok: ...} 作为 ack**：前端 `emit('chat:send', payload, cb)` 能拿到发送结果，
    失败时就不会把用户刚打的字清掉（以前无脑 return true，被禁言/被拉黑时消息发不出去、
    草稿却已经被清空，用户白打一段字）。`chat:error` 仍然照发，兼容还没更新的旧前端。
    """
    uid = await _sender(sid)
    if not uid or not switches.enabled("chat"):
        return {"ok": False, "reason": "聊天功能维护中" if not switches.enabled("chat") else "登录状态异常"}
    data = data or {}
    thread_id = data.get("thread_id")
    if not thread_id:
        await _fail(sid, "缺少会话 id")
        return {"ok": False, "reason": "缺少会话 id"}
    db = SessionLocal()
    try:
        try:
            thread = chat_core.get_thread_or_404(db, int(thread_id))
        except HTTPException as e:
            await _fail(sid, str(e.detail))
            return {"ok": False, "reason": str(e.detail)}
        user = db.get(models.User, uid)
        if user is None:
            await _fail(sid, "登录状态异常，请重新登录")
            return {"ok": False, "reason": "登录状态异常，请重新登录"}
        # 封禁/注销：socket 连接时已经挡过一次，这里再挡一次 —— token 没过期就能连上的窗口期里
        # （比如刚被封禁）不该还能发言。
        if user.is_deactivated or user.effective_banned:
            await _fail(sid, "账号已被限制，无法发言")
            return {"ok": False, "reason": "账号已被限制，无法发言"}
        try:
            chat_core.can_send(db, thread, uid)
            msg = chat_core.send_message(
                db,
                thread,
                user,
                content=data.get("content") or "",
                image_url=data.get("image_url"),
                voice_url=data.get("voice_url"),
                voice_duration=data.get("voice_duration"),
                reply_to_id=data.get("reply_to"),
            )
        except HTTPException as e:
            await _fail(sid, str(e.detail))
            return {"ok": False, "reason": str(e.detail)}
        payload = chat_core.message_json(db, msg, reader_id=uid, kind=thread.kind)
        recipients = chat_core.member_ids(db, thread.id)
        msg_id = msg.id
        kind = thread.kind
    except HTTPException as e:
        await _fail(sid, str(e.detail))
        return {"ok": False, "reason": str(e.detail)}
    finally:
        db.close()
    # kind 一起发出去：前端要据此判断「私聊/群聊」该不该响提示音、该不该通知
    await _emit_users("chat:new", {"thread_id": int(thread_id), "message": payload, "kind": kind}, recipients)
    return {"ok": True, "id": msg_id}


@sio.on("chat:typing")
async def chat_typing(sid, data):
    uid = await _sender(sid)
    if not uid or not switches.enabled("chat"):
        return
    thread_id = (data or {}).get("thread_id")
    if not thread_id:
        return
    db = SessionLocal()
    try:
        thread = chat_core.get_thread_or_404(db, int(thread_id))
        try:
            chat_core.require_member(db, thread, uid)
        except HTTPException:
            return
        user = db.get(models.User, uid)
        others = [x for x in chat_core.member_ids(db, thread.id) if x != uid]
        payload = {"thread_id": thread.id, "user_id": uid, "name": user.display_name if user else ""}
    finally:
        db.close()
    await _emit_users("chat:typing", payload, others)


@sio.on("chat:read")
async def chat_read(sid, data):
    uid = await _sender(sid)
    if not uid or not switches.enabled("chat"):
        return
    data = data or {}
    thread_id = data.get("thread_id")
    if not thread_id:
        return
    db = SessionLocal()
    try:
        thread = chat_core.get_thread_or_404(db, int(thread_id))
        try:
            chat_core.require_member(db, thread, uid)
        except HTTPException:
            return
        last = chat_core.mark_read(db, thread.id, uid, data.get("last_message_id"))
        others = [x for x in chat_core.member_ids(db, thread.id) if x != uid]
    finally:
        db.close()
    await _emit_users("chat:read", {"thread_id": int(thread_id), "user_id": uid, "last_message_id": last}, others)
