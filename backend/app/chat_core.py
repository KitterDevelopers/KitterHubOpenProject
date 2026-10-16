"""聊天核心业务层（全新实现，REST 与 Socket.IO 共用同一套规则）。

模型：ChatThread（dm/group 统一）/ ChatMember / ChatMessage / ChatDmIndex / ChatBlock

设计原则：
1. 权限判定只在这里实现一次，REST 与 Socket 都调用它，两端行为不可能不一致。
2. 已读用「成员已读水位」(ChatMember.last_read_message_id) 统一表达：
   - 未读数 = 该会话中 id > 水位 且 非本人发送 且 未撤回 的消息数
   - 私聊「对方已读」= 对方水位 >= 我的消息 id
3. 投递范围由服务端决定：调用方拿到 recipients（成员 id 列表）后逐个发 user:{id}，
   客户端不需要、也不允许自己"加入房间"来决定能收到什么。
4. 不做任何限流（站长要求）。
"""
from datetime import timedelta
import re

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import imageurl, models, serializers

MAX_TEXT = 2000          # 单条文本上限
PAGE_SIZE = 30           # 默认每页消息数
MAX_PAGE = 100
RECALL_MINUTES = 2       # 撤回时限


def utcnow():
    """无时区 UTC 时间。

    数据库里存的是无时区 UTC（SQLite 读回后 tzinfo 为 None），
    所以凡是「拿当前时间和读回来的时间做减法/比较」都必须用这个，
    否则会出现 naive 与 aware 不能相减的 TypeError。
    """
    return models.now().replace(tzinfo=None)


def naive(dt):
    """把可能带时区的时间统一成无时区 UTC。"""
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


# ---------------------------------------------------------------------------
# 会话（thread）
# ---------------------------------------------------------------------------
def get_thread_or_404(db: Session, thread_id: int) -> models.ChatThread:
    t = db.get(models.ChatThread, thread_id)
    if t is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return t


def membership(db: Session, thread_id: int, uid: int) -> models.ChatMember | None:
    return db.query(models.ChatMember).filter_by(thread_id=thread_id, user_id=uid).first()


def require_member(db: Session, thread: models.ChatThread, uid: int) -> models.ChatMember:
    m = membership(db, thread.id, uid)
    if m is None:
        raise HTTPException(status_code=403, detail="你不在这个会话里")
    return m


def member_ids(db: Session, thread_id: int) -> list[int]:
    rows = db.query(models.ChatMember.user_id).filter_by(thread_id=thread_id).all()
    return [r[0] for r in rows if r[0]]


def is_manager(db: Session, thread: models.ChatThread, uid: int) -> bool:
    if thread.owner_id and thread.owner_id == uid:
        return True
    m = membership(db, thread.id, uid)
    return bool(m and m.role in ("owner", "admin"))


def require_manager(db: Session, thread: models.ChatThread, uid: int) -> None:
    if not is_manager(db, thread, uid):
        raise HTTPException(status_code=403, detail="需要群主或管理员权限")


def require_owner(thread: models.ChatThread, uid: int) -> None:
    if thread.owner_id != uid:
        raise HTTPException(status_code=403, detail="需要群主权限")


def mute_all_on(thread: models.ChatThread) -> bool:
    until = naive(thread.mute_all_until)
    return bool(until and until > utcnow())


def open_dm(db: Session, me_id: int, other_uid: str | int) -> models.ChatThread:
    """按用户 uid（对外编号）打开/创建私聊会话。"""
    other = db.query(models.User).filter(models.User.uid == str(other_uid)).first()
    if other is None:
        raise HTTPException(status_code=404, detail="对方不存在")
    if other.id == me_id:
        raise HTTPException(status_code=400, detail="不能和自己私聊")
    a, b = sorted([me_id, other.id])
    idx = db.query(models.ChatDmIndex).filter_by(user_a=a, user_b=b).first()
    if idx is not None:
        thread = db.get(models.ChatThread, idx.thread_id)
        if thread is not None:
            return thread
        db.delete(idx)
        db.commit()
    thread = models.ChatThread(kind="dm")
    db.add(thread)
    db.flush()
    db.add_all([
        models.ChatMember(thread_id=thread.id, user_id=a, role="member"),
        models.ChatMember(thread_id=thread.id, user_id=b, role="member"),
        models.ChatDmIndex(thread_id=thread.id, user_a=a, user_b=b),
    ])
    try:
        db.commit()
    except IntegrityError:
        # 两个人同时点开对方（或同一个按钮被双击）会撞 uq_chat_dm 唯一约束：
        # 以前这里直接 500，并且可能留下一个「有会话行、没有索引」的孤儿私聊。
        # 现在回滚后按「已经存在」返回同一个会话。
        db.rollback()
        idx = db.query(models.ChatDmIndex).filter_by(user_a=a, user_b=b).first()
        if idx is None:
            raise
        thread = db.get(models.ChatThread, idx.thread_id)
        if thread is None:
            raise
        return thread
    db.refresh(thread)
    return thread


def create_group(db: Session, owner: models.User, title: str, announcement: str = "") -> models.ChatThread:
    name = (title or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写群名称")
    if len(name) > 40:
        raise HTTPException(status_code=400, detail="群名称最多 40 字")
    thread = models.ChatThread(
        kind="group",
        title=name,
        announcement=(announcement or "").strip()[:500],
        owner_id=owner.id,
    )
    db.add(thread)
    db.flush()
    db.add(models.ChatMember(thread_id=thread.id, user_id=owner.id, role="owner"))
    db.add(models.ChatMessage(thread_id=thread.id, sender_id=owner.id,
                              content=f"群「{name}」创建成功，欢迎大家加入！"))
    db.commit()
    db.refresh(thread)
    return thread


def studio_thread(db: Session, studio_id: int) -> models.ChatThread | None:
    return db.query(models.ChatThread).filter_by(studio_id=studio_id, kind="group").first()


def create_studio_thread(
    db: Session,
    studio,
    owner_id: int,
    *,
    title: str | None = None,
    announcement: str | None = None,
) -> models.ChatThread:
    """创建工作室群（一个工作室一个群），群主 = 室长。"""
    thread = models.ChatThread(
        kind="group",
        title=(title or f"{studio.name} · 讨论区")[:100],
        announcement=(announcement if announcement is not None else f"{studio.name} 的成员交流群")[:500],
        owner_id=owner_id,
        studio_id=studio.id,
    )
    db.add(thread)
    db.flush()
    db.add(models.ChatMember(thread_id=thread.id, user_id=owner_id, role="owner"))
    db.add(models.ChatMessage(
        thread_id=thread.id, sender_id=owner_id,
        content=f"群「{thread.title}」创建成功，欢迎大家加入！",
    ))
    db.commit()
    db.refresh(thread)
    return thread


def ensure_studio_thread(db: Session, studio, owner_id: int) -> models.ChatThread:
    """工作室群：一个工作室一个（studio_id 唯一），成员与工作室成员同步。"""
    thread = studio_thread(db, studio.id)
    if thread is None:
        thread = create_studio_thread(db, studio, owner_id)
    return thread


def delete_thread(db: Session, thread: models.ChatThread) -> None:
    """彻底删除会话及其消息、成员。"""
    db.query(models.ChatMessage).filter_by(thread_id=thread.id).delete()
    db.query(models.ChatMember).filter_by(thread_id=thread.id).delete()
    db.query(models.ChatDmIndex).filter_by(thread_id=thread.id).delete()
    db.delete(thread)
    db.commit()


def sync_studio_member(db: Session, studio_id: int, user_id: int, *, join: bool, role: str = "member") -> None:
    """工作室成员变动时同步到该工作室群。

    - join=True：确保在群里，并把群内角色同步为工作室角色（owner/admin/member）
    - join=False：退出或被移出时，同时移出群（群主除外）
    - 群不存在时按需自愈创建（老工作室没有讨论群也能正常工作）
    """
    thread = db.query(models.ChatThread).filter_by(studio_id=studio_id, kind="group").first()
    if thread is None:
        if not join:
            return
        studio = db.get(models.Studio, studio_id)
        if studio is None:
            return
        thread = create_studio_thread(db, studio, studio.owner_id)
    m = membership(db, thread.id, user_id)
    chat_role = role if role in ("owner", "admin", "member") else "member"
    if join:
        if m is None:
            # 新成员的水位设成「当前最大消息 id」：否则一进群就是未读 = 全部历史
            # （工作室讨论群尤其明显：几千条老消息直接变成 99+）。
            db.add(models.ChatMember(
                thread_id=thread.id, user_id=user_id, role=chat_role,
                last_read_message_id=current_max_message_id(db, thread.id),
            ))
        elif m.role != chat_role and thread.owner_id != user_id:
            m.role = chat_role
        db.commit()
    else:
        if m is not None and thread.owner_id != user_id:
            db.delete(m)
            db.commit()


def dissolve_studio_thread(db: Session, studio_id: int) -> None:
    """删除工作室时一并删除其讨论群及消息。"""
    threads = db.query(models.ChatThread).filter_by(studio_id=studio_id, kind="group").all()
    for t in threads:
        db.query(models.ChatMessage).filter_by(thread_id=t.id).delete()
        db.query(models.ChatMember).filter_by(thread_id=t.id).delete()
        db.delete(t)
    db.commit()


def current_max_message_id(db: Session, thread_id: int) -> int:
    """会话里当前最大的消息 id（新成员入群的已读水位用它，避免一进群就 99+）。"""
    return int(db.query(func.max(models.ChatMessage.id)).filter(models.ChatMessage.thread_id == thread_id).scalar() or 0)


def system_message(db: Session, thread: models.ChatThread, text: str, actor_id: int) -> models.ChatMessage:
    """写入一条系统提示消息（发送者记为触发者，便于展示与撤回限制）。"""
    msg = models.ChatMessage(thread_id=thread.id, sender_id=actor_id, content=text[:MAX_TEXT])
    db.add(msg)
    thread.last_message_at = utcnow()
    db.commit()
    db.refresh(msg)
    return msg


# ---------------------------------------------------------------------------
# 拉黑
# ---------------------------------------------------------------------------
def blocked_between(db: Session, a: int, b: int) -> bool:
    """两人之间是否存在拉黑（任一方向）。

    ⚠️ 站内有**两张**拉黑表，历史上只在聊天里拉黑才生效：
      · `user_blocks` —— 个人主页「更多 → 拉黑」写的（Profile.jsx → /users/{uid}/block）
      · `chat_blocks` —— 聊天里那个拉黑开关写的（GroupInfoDialog → /chat/blocks/{uid}）
    结果是「在主页拉黑了对方，对方照样能私聊你」。这里两张一起查，两边口径就一致了。
    """
    for model in (models.ChatBlock, models.UserBlock):
        hit = (
            db.query(model)
            .filter(
                or_(
                    (model.blocker_id == a) & (model.blocked_id == b),
                    (model.blocker_id == b) & (model.blocked_id == a),
                )
            )
            .first()
        )
        if hit is not None:
            return True
    return False


# ---------------------------------------------------------------------------
# 消息
# ---------------------------------------------------------------------------
def _check_payload(content: str, image_url: str | None, voice_url: str | None):
    text = (content or "").strip()
    if len(text) > MAX_TEXT:
        raise HTTPException(status_code=400, detail=f"消息最多 {MAX_TEXT} 字")
    img = (image_url or "").strip() or None
    if img:
        img = imageurl.check_uploaded_image(img, "图片")
    voice = (voice_url or "").strip() or None
    if voice and not voice.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="语音地址不合法")
    if not text and not img and not voice:
        raise HTTPException(status_code=400, detail="不能发送空消息")
    return text, img, voice


def can_send(db: Session, thread: models.ChatThread, uid: int) -> models.ChatMember:
    """发送前校验（成员/禁言/拉黑），错误信息明确。"""
    m = require_member(db, thread, uid)
    if thread.kind == "group":
        if mute_all_on(thread) and not is_manager(db, thread, uid):
            raise HTTPException(status_code=403, detail="全员禁言中，暂时不能发言")
        if m.muted and not is_manager(db, thread, uid):
            raise HTTPException(status_code=403, detail="你已被禁言，暂时不能发言")
    else:
        other = next((x for x in member_ids(db, thread.id) if x != uid), None)
        if other and blocked_between(db, uid, other):
            raise HTTPException(status_code=403, detail="你们之间已拉黑，无法发送消息")
    return m


def send_message(
    db: Session,
    thread: models.ChatThread,
    sender: models.User,
    *,
    content: str = "",
    image_url: str | None = None,
    voice_url: str | None = None,
    voice_duration: int | None = None,
    reply_to_id: int | None = None,
) -> models.ChatMessage:
    """落库一条消息（调用方负责先跑 can_send）。"""
    text, img, voice = _check_payload(content, image_url, voice_url)
    reply_id = None
    if reply_to_id:
        ref = db.get(models.ChatMessage, int(reply_to_id))
        if ref is None or ref.thread_id != thread.id or ref.deleted:
            raise HTTPException(status_code=400, detail="引用的消息无效")
        reply_id = ref.id
    msg = models.ChatMessage(
        thread_id=thread.id,
        sender_id=sender.id,
        content=text,
        image_url=img,
        voice_url=voice,
        voice_duration=int(voice_duration) if (voice and voice_duration) else None,
        reply_to_id=reply_id,
    )
    db.add(msg)
    thread.last_message_at = utcnow()
    db.flush()
    # 发送者自己的水位跟进到最新
    m = membership(db, thread.id, sender.id)
    if m is not None and (m.last_read_message_id or 0) < msg.id:
        m.last_read_message_id = msg.id
    db.commit()
    db.refresh(msg)
    notify_mentions(db, thread, msg, sender)
    notify_dm(db, thread, msg, sender)
    return msg


# ---------------------------------------------------------------------------
# 私聊消息通知（「聊天消息」通知偏好里的私聊那一半）
# ---------------------------------------------------------------------------
DM_NOTIFY_WINDOW = timedelta(minutes=10)   # 同一个会话这么久的连发只留一条通知，避免刷屏


def notify_dm(db: Session, thread: models.ChatThread, msg: models.ChatMessage, sender: models.User) -> None:
    """私聊新消息给对面留一条站内通知（可在账号设置里关掉「聊天消息 · 私聊」）。

    为什么做成「合并」而不是每条都发：私聊一连串十几条消息就刷屏十几条通知，
    通知中心会被聊天记录淹掉。同一个会话 10 分钟内只维护一条（更新内容与时间、重新标未读）。
    """
    if thread.kind != "dm" or msg.recalled or msg.deleted:
        return
    members = db.query(models.ChatMember).filter_by(thread_id=thread.id).all()
    preview = (msg.content or "").strip()
    if not preview:
        preview = "[图片]" if msg.image_url else "[语音]" if msg.voice_url else ""
    preview = preview[:40] + ("…" if len(preview) > 40 else "")
    for m in members:
        if m.user_id == sender.id or m.notify_off:   # 会话级免打扰优先
            continue
        recipient = m.user
        if recipient is None or recipient.notify_prefs_dict.get("chat_dm", True) is False:
            continue
        content = f"{sender.display_name} 给你发了新消息：{preview}"
        now = utcnow()
        recent = (
            db.query(models.Notification)
            .filter(
                models.Notification.user_id == recipient.id,
                models.Notification.type == "chat_dm",
                models.Notification.target_type == "room",
                models.Notification.target_id == thread.id,
            )
            .order_by(models.Notification.id.desc())
            .first()
        )
        if recent is not None and recent.created_at is not None and now - naive(recent.created_at) <= DM_NOTIFY_WINDOW:
            recent.content = content
            recent.actor_id = sender.id
            recent.is_read = False
            recent.created_at = now
            db.commit()
            continue
        db.add(models.Notification(
            user_id=recipient.id, actor_id=sender.id, type="chat_dm",
            target_type="room", target_id=thread.id, content=content,
        ))
        db.commit()


# ---------------------------------------------------------------------------
# @提及通知（群聊）
# ---------------------------------------------------------------------------
MENTION_RE = re.compile(r"@([^\s@#]{1,20})")
MENTION_ALL = {"所有人", "全体", "全体成员", "all", "ALL", "everyone"}


def notify_mentions(db: Session, thread: models.ChatThread, msg: models.ChatMessage, sender: models.User) -> None:
    """群里被 @ 到的成员收到站内通知（target_type 固定为 room，深链到本会话）。"""
    if thread.kind != "group" or msg.recalled or not (msg.content or "").strip():
        return
    names = set(MENTION_RE.findall(msg.content))
    if not names:
        return
    members = db.query(models.ChatMember).filter_by(thread_id=thread.id).all()
    everyone = bool(names & MENTION_ALL)
    targets: list[int] = []
    for m in members:
        if m.user_id == sender.id or m.notify_off:
            continue
        # 「聊天消息 · 群聊」关掉后，群里 @ 我不再发通知（消息本身、未读数都不受影响）
        if m.user is not None and m.user.notify_prefs_dict.get("chat_group", True) is False:
            continue
        if everyone:
            targets.append(m.user_id)
            continue
        u = m.user
        if u is None:
            continue
        cands = {u.username, u.nickname, u.display_name, u.uid}
        if names & {c for c in cands if c}:
            targets.append(m.user_id)
    if not targets:
        return
    text = (msg.content or "").strip()
    preview = text[:40] + ("…" if len(text) > 40 else "")
    tip = "提到了所有人" if everyone else "@ 了你"
    content = f"{sender.display_name} 在群「{thread.title}」里{tip}：{preview}"
    for uid in targets:
        serializers.notify_user(db, uid, sender.id, "mention", "room", thread.id, content)


def can_recall(msg: models.ChatMessage, uid: int) -> bool:
    if msg.sender_id != uid or msg.recalled or msg.deleted or msg.created_at is None:
        return False
    return utcnow() - naive(msg.created_at) <= timedelta(minutes=RECALL_MINUTES)


def message_json(db: Session, msg: models.ChatMessage, *, reader_id: int | None = None, kind: str | None = None) -> dict:
    """消息序列化；私聊附「对方是否已读」。"""
    reply = None
    if msg.reply_to_id:
        ref = db.get(models.ChatMessage, msg.reply_to_id)
        if ref is not None:
            reply = {
                "id": ref.id,
                "sender_id": ref.sender_id,
                "sender_name": ref.sender.display_name if ref.sender else "",
                "preview": "（已撤回）" if ref.recalled else (("[图片]" if ref.image_url else "") or (ref.content or "")[:60]),
            }
    data = {
        "id": msg.id,
        "thread_id": msg.thread_id,
        "sender_id": msg.sender_id,
        "sender": serializers.user_brief(msg.sender),
        "content": "" if msg.recalled else (msg.content or ""),
        "image_url": None if msg.recalled else msg.image_url,
        "voice_url": None if msg.recalled else msg.voice_url,
        "voice_duration": msg.voice_duration,
        "reply_to": reply,
        "recalled": bool(msg.recalled),
        "deleted": bool(msg.deleted),
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }
    # 私聊：对方读到哪了（用于 ✓✓）；群聊不做逐条已读回执
    if kind == "dm" and reader_id is not None and msg.sender_id == reader_id:
        row = (
            db.query(models.ChatMember.last_read_message_id)
            .filter(models.ChatMember.thread_id == msg.thread_id, models.ChatMember.user_id != reader_id)
            .first()
        )
        data["read"] = bool(row and (row[0] or 0) >= msg.id)
    return data


def page_messages(db: Session, thread_id: int, before_id: int | None = None, limit: int = PAGE_SIZE):
    """按 id 倒序取 limit 条后翻正序；额外多取一条判断是否还有更早的消息。

    **已删除的消息不返回**。删除是软删（行还在、内容清空），但对外一律不出现：
    以前这里不过滤，于是「删掉的消息刷新后又回来，而且是个空气泡」，跟客户端的
    socket `chat:deleted`（收到就从列表里删掉）也不一致。撤回 vs 删除的区别就在这里：
    撤回留痕（显示「XX 撤回了一条消息」），删除就是消失。
    """
    limit = max(1, min(int(limit or PAGE_SIZE), MAX_PAGE))
    q = (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.thread_id == thread_id, models.ChatMessage.deleted.is_(False))
    )
    if before_id:
        q = q.filter(models.ChatMessage.id < int(before_id))
    rows = q.order_by(models.ChatMessage.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    return rows, has_more


def latest_message(db: Session, thread_id: int) -> models.ChatMessage | None:
    return (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.thread_id == thread_id, models.ChatMessage.deleted.is_(False))
        .order_by(models.ChatMessage.id.desc())
        .first()
    )


def preview_of(msg: models.ChatMessage | None) -> str:
    if msg is None:
        return ""
    if msg.recalled:
        return "（已撤回）"
    if msg.image_url:
        return "[图片]"
    if msg.voice_url:
        return "[语音]"
    return (msg.content or "")[:60]


# ---------------------------------------------------------------------------
# 已读 / 未读
# ---------------------------------------------------------------------------
def mark_read(db: Session, thread_id: int, uid: int, last_message_id: int | None = None) -> int:
    """推进已读水位。水位会被夹到该会话真实的最大消息 id，防止客户端写一个超大值把未读永久清零。"""
    m = db.query(models.ChatMember).filter_by(thread_id=thread_id, user_id=uid).first()
    if m is None:
        return 0
    max_id = int(
        db.query(func.max(models.ChatMessage.id)).filter(models.ChatMessage.thread_id == thread_id).scalar() or 0
    )
    if last_message_id is None:
        last_message_id = max_id
    last_message_id = max(0, min(int(last_message_id or 0), max_id))
    if last_message_id > (m.last_read_message_id or 0):
        m.last_read_message_id = last_message_id
        db.commit()
    return last_message_id


def unread_count(db: Session, thread_id: int, uid: int) -> int:
    m = db.query(models.ChatMember).filter_by(thread_id=thread_id, user_id=uid).first()
    watermark = (m.last_read_message_id or 0) if m else 0
    return (
        db.query(models.ChatMessage)
        .filter(
            models.ChatMessage.thread_id == thread_id,
            models.ChatMessage.id > watermark,
            models.ChatMessage.sender_id != uid,
            models.ChatMessage.recalled.is_(False),
            models.ChatMessage.deleted.is_(False),   # 删掉的消息不该再让人「有未读」
        )
        .count()
    )


def unread_summary(db: Session, uid: int) -> dict:
    rows = (
        db.query(models.ChatThread.kind, models.ChatMember.last_read_message_id, models.ChatThread.id)
        .join(models.ChatMember, models.ChatMember.thread_id == models.ChatThread.id)
        .filter(models.ChatMember.user_id == uid)
        .all()
    )
    dm = group = 0
    for kind, watermark, tid in rows:
        n = (
            db.query(models.ChatMessage)
            .filter(
                models.ChatMessage.thread_id == tid,
                models.ChatMessage.id > (watermark or 0),
                models.ChatMessage.sender_id != uid,
                models.ChatMessage.recalled.is_(False),
                models.ChatMessage.deleted.is_(False),
            )
            .count()
        )
        if kind == "dm":
            dm += n
        else:
            group += n
    return {"dm": dm, "group": group, "total": dm + group}


# ---------------------------------------------------------------------------
# 会话列表（前端主页用）
# ---------------------------------------------------------------------------
def thread_card(db: Session, thread: models.ChatThread, uid: int) -> dict:
    m = membership(db, thread.id, uid)
    last = latest_message(db, thread.id)
    data = {
        "id": thread.id,
        "kind": thread.kind,
        "title": thread.title,
        "avatar_url": thread.avatar_url,
        "studio_id": thread.studio_id,
        "owner_id": thread.owner_id,
        "member_count": db.query(models.ChatMember).filter_by(thread_id=thread.id).count(),
        "unread": unread_count(db, thread.id, uid),
        "pinned": bool(m.pinned) if m else False,
        "notify_off": bool(m.notify_off) if m else False,
        "role": m.role if m else None,
        "muted": bool(m.muted) if m else False,
        "mute_all": mute_all_on(thread),
        "last_message": preview_of(last),
        "last_message_at": (last.created_at.isoformat() if last and last.created_at else None),
        "last_sender_id": last.sender_id if last else None,
    }
    if thread.kind == "dm":
        other_id = next((x for x in member_ids(db, thread.id) if x != uid), None)
        other = db.get(models.User, other_id) if other_id else None
        data["peer"] = serializers.user_brief(other) if other else None
        data["title"] = other.display_name if other else "（对方已不在）"
        data["avatar_url"] = other.avatar_url if other else None
        data["blocked"] = blocked_between(db, uid, other.id) if other else False
    return data
