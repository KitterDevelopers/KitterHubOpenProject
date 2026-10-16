"""新账号的激活（实名 / 绑定编程猫）流程。

★ 安全要点（这是本文件存在的理由）：
  护照图片存到 config.PRIVATE_DIR，**这个目录 nginx 完全没有挂载，公网访问不到**。
  只有本文件的 `GET /admin/verify-docs/{uid}` 能读，且必须 role == admin。
  绝对不能放进 config.UPLOAD_DIR —— 那个目录由 nginx 以 /uploads/ 直接静态服务，
  任何人拿到 URL 就能看，护照放进去等于公开。

状态机（users.verify_state）：
  ok                老用户 / 编程猫用户，不受限制
  awaiting_passport 注册后还没激活（邮箱注册、GitHub 注册都落在这里）
  pending_review    已传护照，等待管理员审核
  rejected          审核不通过，可重新上传

激活有**两条**路，二者其一即可（2026-09-24 站长定的规则）：
  ① 绑定编程猫账号 —— 立即激活，见 routers/users.py 的 `POST /me/bind-codemao`
  ② 上传护照个人信息页 → 管理员在后台通过 → 置 ok
所以 `awaiting_passport` 这个名字现在更准确的含义是「待激活」，前端 /verify 页
把两条路并排给出（原来只给护照那一条）。
"""
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import config, models, serializers
from ..deps import get_current_admin, get_current_user, get_db

router = APIRouter(tags=["verify"])

STATE_OK = "ok"
STATE_AWAIT = "awaiting_passport"
STATE_PENDING = "pending_review"
STATE_REJECTED = "rejected"
LOCKED_STATES = (STATE_AWAIT, STATE_PENDING, STATE_REJECTED)

# 只接受这三种位图；不用 GIF（可能动图/多帧，证件照没必要）
_MAGIC = {
    "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
    "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
    "image/webp": (b"RIFF", ".webp"),
}
_MIME_BY_EXT = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _magic_ok(content_type: str, data: bytes) -> bool:
    heads = _MAGIC.get(content_type)
    if not heads or not data:
        return False
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return data.startswith(heads[0])


def _safe_remove(path: str | None) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass


def _doc_path(user: models.User) -> str | None:
    if not user.passport_file:
        return None
    # 只取 basename，杜绝 passport_file 里混进 ../ 造成目录穿越
    return os.path.join(config.PRIVATE_DIR, os.path.basename(user.passport_file))


@router.get("/verify/status")
def my_status(user: models.User = Depends(get_current_user)):
    """我自己的激活状态（锁定时前端靠它决定显示哪一页 / 哪几条路）。"""
    state = user.verify_state or STATE_OK
    return {
        "state": state,
        "locked": state in LOCKED_STATES,
        "note": user.verify_note or "",
        "has_passport": bool(user.passport_file),
        "uploaded_at": user.passport_at,
        "reviewed_at": user.verify_reviewed_at,
        # 激活方式：绑定编程猫是立即生效的另一条路，前端据此决定要不要显示绑定表单
        "codemao_bound": bool(user.codemao_uid),
        "can_bind_codemao": not user.codemao_uid,
    }


@router.post("/verify/passport")
async def upload_passport(
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """上传护照个人信息页。只有「待上传 / 被驳回」两种状态可以传。"""
    state = user.verify_state or STATE_OK
    if state == STATE_OK:
        raise HTTPException(status_code=403, detail="你的账号已通过审核，无需重复上传")
    if state == STATE_PENDING:
        raise HTTPException(status_code=400, detail="护照已提交，正在等待管理员审核")

    ext = (_MAGIC.get(file.content_type or "") or (None, None))[1]
    if ext is None:
        raise HTTPException(status_code=400, detail="仅支持 JPG / PNG / WebP 图片")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > config.PASSPORT_MAX_SIZE:
        mb = config.PASSPORT_MAX_SIZE // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"图片大小不能超过 {mb}MB")
    if not _magic_ok(file.content_type, data):
        raise HTTPException(status_code=400, detail="文件内容与声明格式不符，请重新上传")

    os.makedirs(config.PRIVATE_DIR, exist_ok=True)
    # 文件名不含 uid / 用户名，避免从文件名反推是谁
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(config.PRIVATE_DIR, filename)
    with open(path, "wb") as f:
        f.write(data)

    old = _doc_path(user)
    user.passport_file = filename
    user.passport_at = models.now()
    user.verify_state = STATE_PENDING
    user.verify_note = ""
    user.verify_reviewed_at = None
    user.verify_reviewed_by = None
    db.commit()
    if old and os.path.basename(old) != filename:
        _safe_remove(old)

    return {"ok": True, "state": STATE_PENDING}


# ==========================================================================
# 管理员审核
# ==========================================================================
def _queue_item(user: models.User) -> dict:
    return {
        "uid": user.uid,
        "user": serializers.user_brief(user),
        "state": user.verify_state or STATE_OK,
        "note": user.verify_note or "",
        "email": user.email,
        "reg_lang": user.reg_lang or "",
        "has_passport": bool(user.passport_file),
        "uploaded_at": user.passport_at,
        "created_at": user.created_at,
    }


@router.get("/admin/verify-queue")
def verify_queue(db: Session = Depends(get_db), admin: models.User = Depends(get_current_admin)):
    """待处理的实名审核。awaiting_passport 排前面（还没交材料，可发提醒）。"""
    rows = (
        db.query(models.User)
        .filter(models.User.verify_state.in_(LOCKED_STATES))
        .order_by(models.User.verify_state.desc(), models.User.passport_at.desc().nullslast(), models.User.id.desc())
        .limit(200)
        .all()
    )
    return [_queue_item(u) for u in rows]


@router.get("/admin/verify-docs/{uid}")
def verify_doc(
    uid: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """读取护照图片。私有目录不经 nginx，只能从这里流出去，且限管理员。"""
    target = db.query(models.User).filter(models.User.uid == uid).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    path = _doc_path(target)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="该用户还没有上传护照")
    ext = os.path.splitext(path)[1].lower()
    # 不设 filename，避免浏览器直接下载；inline 展示方便审核
    return FileResponse(path, media_type=_MIME_BY_EXT.get(ext, "application/octet-stream"))


def _notice(db, user: models.User, text_zh: str, text_en: str) -> None:
    """给用户发一条审核结果通知：按注册时使用的语言挑文案。"""
    body = text_en if (user.reg_lang or "").strip().lower() == "en" else text_zh
    serializers.notify_user(db, user.id, None, "admin", "user", user.id, body)
    db.commit()


@router.post("/admin/verify-docs/{uid}/approve")
def approve_doc(
    uid: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    target = db.query(models.User).filter(models.User.uid == uid).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not target.passport_file:
        raise HTTPException(status_code=400, detail="该用户还没有上传护照")
    target.verify_state = STATE_OK
    target.verify_note = ""
    target.verify_reviewed_at = models.now()
    target.verify_reviewed_by = admin.id
    db.commit()
    _notice(
        db,
        target,
        "你的实名验证已通过，账号现在可以正常使用了。",
        "Your identity verification has been approved. You can now use all features.",
    )
    return {"ok": True, "state": STATE_OK}


@router.post("/admin/verify-docs/{uid}/reject")
def reject_doc(
    uid: str,
    body: dict | None = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """驳回：保留护照文件（便于复核），状态置 rejected，用户可重新上传。"""
    target = db.query(models.User).filter(models.User.uid == uid).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    reason = ((body or {}).get("reason") or "").strip()[:200]
    target.verify_state = STATE_REJECTED
    target.verify_note = reason
    target.verify_reviewed_at = models.now()
    target.verify_reviewed_by = admin.id
    db.commit()
    extra = f"：{reason}" if reason else ""
    extra_en = f": {reason}" if reason else "."
    _notice(
        db,
        target,
        f"你的实名验证未通过{extra}。请重新上传更清晰的护照个人信息页照片。",
        f"Your identity verification was not approved{extra_en} Please upload a clearer photo of your passport information page.",
    )
    return {"ok": True, "state": STATE_REJECTED}


@router.post("/admin/verify-docs/{uid}/reset")
def reset_doc(
    uid: str,
    db: Session = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """把用户退回「待上传」并删除已存护照（例如材料传错、要彻底清掉时用）。"""
    target = db.query(models.User).filter(models.User.uid == uid).first()
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    old = _doc_path(target)
    target.passport_file = None
    target.passport_at = None
    target.verify_state = STATE_AWAIT
    target.verify_note = ""
    target.verify_reviewed_at = models.now()
    target.verify_reviewed_by = admin.id
    db.commit()
    _safe_remove(old)
    return {"ok": True, "state": STATE_AWAIT}
