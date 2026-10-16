"""账号存储空间配额：用量统计 + 申请扩容 + 管理员审批。

站长 2026-09-27：「给每个账号默认 500MB 的存储空间，这个空间包括其投稿的 Scratch 作品源文件，
上传的图片等等……功能整合进账号设置，依旧可申请扩容，**原先的机制就不用了**」。

口径（这个文件是唯一口径：上传校验、账号设置页、后台审核都调它）：
  · **默认每人 500MB**（`config.STORAGE_PER_USER_MB`，可被环境变量覆盖）；
  · 用量 = 这个账号**引用到的全部上传文件**（按文件路径去重后 stat 实际大小）：
      .sb3 作品源文件、头像 / 个人主页背景、作品封面、帖子与评论配图、
      聊天图片与语音、工作室头像与封面、系列封面、反馈附件；
  · 用户级配额在 `users.storage_quota_mb`（NULL = 用默认值）——旧的 `scratch_quota_mb` 已作废不再读；
  · **剩余不足 50MB**（`config.STORAGE_QUOTA_APPLY_REMAINING_MB`）才有资格申请；
  · 同一个人同时只能有一条待审申请；管理员通过时填「新配额(MB)」，驳回可写理由。

为什么按「引用到的文件」算而不是新建一张上传登记表：
  站内已有十几处上传落点（上面那一串），逐处埋点既容易漏、又得为历史数据做回填；
  直接扫「谁引用了哪些 /uploads 文件」再 stat，历史数据天然算得准，
  用户把作品/帖子删掉后用量也会立刻降下来（文件还留在磁盘上没关系，这里算的是「占用额度」）。
"""
from __future__ import annotations

import json
import math
import os

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import config, models

UPLOAD_PREFIX = "/uploads/"


class QuotaError(ValueError):
    """业务错误（没资格申请 / 重复申请 / 配额数字不合法），路由层转 400。"""


# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
def default_mb() -> int:
    return int(config.STORAGE_PER_USER_MB)


def apply_threshold_mb() -> int:
    """剩余多少 MB 以内才有资格申请。"""
    return int(config.STORAGE_QUOTA_APPLY_REMAINING_MB)


def max_mb() -> int:
    """管理员能批的上限（防手滑）。"""
    return int(config.STORAGE_QUOTA_MAX_MB)


# ---------------------------------------------------------------------------
# 用量统计
# ---------------------------------------------------------------------------
def _path_of(url: str | None) -> str | None:
    """把 /uploads/xxx 或 /uploads/games/xxx 换成服务器上的绝对路径；不是本站上传的一律忽略。"""
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if not u.startswith(UPLOAD_PREFIX):
        return None
    rel = u[len(UPLOAD_PREFIX):].split("?")[0].split("#")[0]
    rel = rel.replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        return None
    return os.path.join(config.UPLOAD_DIR, *rel.split("/"))


def user_assets(db: Session, user) -> list[tuple[str, str]]:
    """这个人引用到的全部上传文件：[(路径, 分类)]。分类用于账号设置页的分类展示。"""
    uid = user.id
    out: list[tuple[str, str]] = []

    def add(url, kind):
        p = _path_of(url)
        if p:
            out.append((p, kind))

    u = db.get(models.User, uid)
    if u is not None:
        add(u.avatar_url, "image")
        add(u.cover_url, "image")

    for (sb3, cover) in db.query(models.Work.sb3_url, models.Work.cover_url).filter(models.Work.user_id == uid):
        add(sb3, "scratch")
        add(cover, "image")

    for (img,) in db.query(models.Post.image_url).filter(models.Post.user_id == uid):
        add(img, "image")

    for (img,) in db.query(models.WorkComment.image_url).filter(models.WorkComment.user_id == uid):
        add(img, "image")
    for (img,) in db.query(models.PostComment.image_url).filter(models.PostComment.user_id == uid):
        add(img, "image")

    for (img, voice) in db.query(models.ChatMessage.image_url, models.ChatMessage.voice_url).filter(
        models.ChatMessage.sender_id == uid
    ):
        add(img, "image")
        add(voice, "voice")

    for (avatar, cover) in db.query(models.Studio.avatar_url, models.Studio.cover_url).filter(
        models.Studio.owner_id == uid
    ):
        add(avatar, "image")
        add(cover, "image")

    for (cover,) in db.query(models.Series.cover_url).filter(models.Series.user_id == uid):
        add(cover, "image")

    for (media,) in db.query(models.Feedback.media).filter(models.Feedback.user_id == uid):
        if not media:
            continue
        try:
            items = json.loads(media)
        except (ValueError, TypeError):
            continue
        for it in items if isinstance(items, list) else []:
            if isinstance(it, dict):
                add(it.get("url"), "video" if it.get("type") == "video" else "image")

    return out


def used_bytes(db: Session, user) -> int:
    """已用字节：同一路径只算一次（同一份 .sb3 被多件稿件引用不会重复计）。"""
    return breakdown(db, user)["total_bytes"]


def used_mb(db: Session, user) -> int:
    """已用量（MB，向上取整 —— 显示 0.4MB 却算 0 会让人以为没占用）。"""
    return int(math.ceil(used_bytes(db, user) / 1048576))


def breakdown(db: Session, user) -> dict:
    """分类用量：作品源文件 / 图片 / 语音 / 视频 / 其它，只统计磁盘上真实存在的文件。"""
    seen: dict[str, str] = {}
    for path, kind in user_assets(db, user):
        if path not in seen:
            seen[path] = kind
    buckets = {"scratch": 0, "image": 0, "voice": 0, "video": 0, "other": 0}
    files = 0
    for path, kind in seen.items():
        try:
            size = os.path.getsize(path)
        except OSError:
            continue          # 文件已经不在了就不算占用
        files += 1
        buckets[kind if kind in buckets else "other"] += size
    total = sum(buckets.values())
    return {
        "total_bytes": total,
        "files": files,
        "scratch_bytes": buckets["scratch"],
        "image_bytes": buckets["image"],
        "voice_bytes": buckets["voice"],
        "video_bytes": buckets["video"],
        "other_bytes": buckets["other"],
    }


# ---------------------------------------------------------------------------
# 配额
# ---------------------------------------------------------------------------
def quota_mb(user) -> int:
    val = getattr(user, "storage_quota_mb", None)
    if val:
        return int(val)
    return default_mb()


def remaining_mb(db: Session, user) -> int:
    return quota_mb(user) - used_mb(db, user)


def is_custom(user) -> bool:
    return bool(getattr(user, "storage_quota_mb", None))


def pending_request(db: Session, user):
    if user is None or getattr(user, "id", None) is None:
        return None
    return (
        db.query(models.ScratchQuotaRequest)
        .filter(models.ScratchQuotaRequest.user_id == user.id, models.ScratchQuotaRequest.status == "pending")
        .order_by(models.ScratchQuotaRequest.id.desc())
        .first()
    )


def can_apply(db: Session, user) -> tuple[bool, str]:
    """能不能申请扩容：(能否, 不能的原因)。前端拿这个显示按钮状态。"""
    if remaining_mb(db, user) > apply_threshold_mb():
        return False, f"剩余空间还有 {remaining_mb(db, user)}MB，用到剩余不足 {apply_threshold_mb()}MB 时才能申请"
    if pending_request(db, user) is not None:
        return False, "你已经有一条待审核的扩容申请，请等管理员处理"
    return True, ""


def check_room(db: Session, user, incoming_bytes: int) -> tuple[bool, str]:
    """上传前检查空间够不够（三个上传接口共用）。返回 (够不够, 不够时的说明)。"""
    used = used_bytes(db, user)
    quota = quota_mb(user)
    if used + max(0, int(incoming_bytes)) <= quota * 1048576:
        return True, ""
    over = (used + int(incoming_bytes) - quota * 1048576) / 1048576
    return False, (
        f"你的账号存储空间不足（已用 {used / 1048576:.0f}MB / 共 {quota}MB，"
        f"这次还差 {over:.1f}MB）。可以在「账号设置 → 账号存储空间」里申请扩容，"
        "管理员审核通过后即可继续上传；也可以先删掉一些旧作品或不再用的图片。"
    )


# ---------------------------------------------------------------------------
# 申请 / 审批
# ---------------------------------------------------------------------------
def serialize_request(r: models.ScratchQuotaRequest, nickname: str = "") -> dict:
    return {
        "id": r.id,
        "user_id": r.user_id,
        "nickname": nickname,
        "used_mb": r.used_mb,
        "quota_mb": r.quota_mb,
        "message": r.message or "",
        "status": r.status,
        "created_at": r.created_at,
        "reviewed_at": r.reviewed_at,
        "grant_mb": r.grant_mb,
        "admin_note": r.admin_note or "",
    }


def serialize(db: Session, user, history_limit: int = 5) -> dict:
    """账号设置页要的全部信息（含分类用量）。"""
    pending = pending_request(db, user)
    history = (
        db.query(models.ScratchQuotaRequest)
        .filter(models.ScratchQuotaRequest.user_id == user.id, models.ScratchQuotaRequest.status != "pending")
        .order_by(models.ScratchQuotaRequest.id.desc())
        .limit(history_limit)
        .all()
    )
    ok, why = can_apply(db, user)
    bd = breakdown(db, user)
    used, quota = int(math.ceil(bd["total_bytes"] / 1048576)), quota_mb(user)
    return {
        "used_mb": used,
        "quota_mb": quota,
        "remaining_mb": quota - used,
        "default_mb": default_mb(),
        "apply_threshold_mb": apply_threshold_mb(),
        "max_mb": max_mb(),
        "is_custom": is_custom(user),
        "can_apply": ok,
        "reason": why,
        "pending": serialize_request(pending) if pending else None,
        "history": [serialize_request(r) for r in history],
        # 分类明细（账号设置页照这个显示「作品源文件 / 图片 / 其它」）
        "files": bd["files"],
        "scratch_mb": round(bd["scratch_bytes"] / 1048576, 1),
        "image_mb": round(bd["image_bytes"] / 1048576, 1),
        "voice_mb": round(bd["voice_bytes"] / 1048576, 1),
        "video_mb": round(bd["video_bytes"] / 1048576, 1),
        "other_mb": round(bd["other_bytes"] / 1048576, 1),
    }


def apply_for_more(db: Session, user, message: str = "") -> models.ScratchQuotaRequest:
    """提交扩容申请。不符合条件就抛 QuotaError（路由层转 400）。"""
    if user is None or getattr(user, "id", None) is None:
        raise QuotaError("请先登录")
    ok, why = can_apply(db, user)
    if not ok:
        raise QuotaError(why)
    r = models.ScratchQuotaRequest(
        user_id=user.id,
        used_mb=used_mb(db, user),
        quota_mb=quota_mb(user),
        message=(message or "").strip()[:500],
        status="pending",
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def set_quota(db: Session, user, mb: int) -> int:
    """直接设置某人的配额（管理员用）。"""
    mb = int(mb)
    if mb < used_mb(db, user):
        raise QuotaError(f"新配额不能小于已用量（{used_mb(db, user)}MB）")
    if mb > max_mb():
        raise QuotaError(f"新配额不能超过 {max_mb()}MB")
    user.storage_quota_mb = mb
    db.commit()
    return mb


def review(db: Session, admin, request_id: int, decision: str, grant_mb: int | None = None, note: str = "") -> dict:
    """管理员审批：approve（要带新配额）/ reject。"""
    r = db.get(models.ScratchQuotaRequest, int(request_id))
    if r is None:
        raise QuotaError("申请不存在")
    if r.status != "pending":
        raise QuotaError("这条申请已经处理过了")
    applicant = db.get(models.User, r.user_id)
    if decision == "approve":
        if applicant is None:
            raise QuotaError("申请人账号已不存在")
        if not grant_mb:
            raise QuotaError("通过时必须填写新配额(MB)")
        mb = set_quota(db, applicant, int(grant_mb))
        r.grant_mb = mb
        r.status = "approved"
    elif decision == "reject":
        r.status = "rejected"
    else:
        raise QuotaError("decision 只能是 approve / reject")
    r.reviewed_at = models.now()
    r.reviewed_by = getattr(admin, "id", None)
    r.admin_note = (note or "").strip()[:500]
    db.commit()
    # 通知申请人（失败不影响审批结果）
    try:
        from . import serializers

        if decision == "approve":
            msg = f"你的账号存储扩容申请已通过，新空间 {r.grant_mb}MB" + (f"（管理员备注：{r.admin_note}）" if r.admin_note else "")
        else:
            msg = "你的账号存储扩容申请未通过" + (f"（理由：{r.admin_note}）" if r.admin_note else "")
        serializers.notify_user(db, r.user_id, None, "admin", None, None, msg)
    except Exception:  # noqa: BLE001
        pass
    return serialize_request(r, applicant.nickname if applicant else "")


def total_used_bytes(db: Session) -> int:
    """全站上传占用（后台概览用）：把所有用户引用的文件去重后求和。"""
    seen: set[str] = set()
    total = 0
    for (uid,) in db.query(models.User.id):
        u = db.get(models.User, uid)
        for path, _kind in user_assets(db, u):
            if path in seen:
                continue
            seen.add(path)
            try:
                total += os.path.getsize(path)
            except OSError:
                continue
    return total


def users_used_mb(db: Session, limit: int = 10) -> list[dict]:
    """用量排行（后台概览用）。"""
    rows = []
    for (uid, nickname) in db.query(models.User.id, models.User.nickname):
        u = db.get(models.User, uid)
        used = used_bytes(db, u)
        if used <= 0:
            continue
        rows.append({"user_id": uid, "nickname": nickname or "", "used_mb": int(math.ceil(used / 1048576)), "quota_mb": quota_mb(u)})
    rows.sort(key=lambda x: -x["used_mb"])
    return rows[:limit]


__all__ = [
    "QuotaError", "default_mb", "apply_threshold_mb", "max_mb",
    "user_assets", "used_bytes", "used_mb", "breakdown",
    "quota_mb", "remaining_mb", "is_custom", "pending_request", "can_apply", "check_room",
    "serialize", "serialize_request", "apply_for_more", "set_quota", "review",
    "total_used_bytes", "users_used_mb",
]
