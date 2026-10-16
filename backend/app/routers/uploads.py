"""文件上传：图片（头像、封面、帖子配图…）、视频（意见反馈附件）与 Scratch 作品（.sb3）。

本地存储 + 校验真实文件头（不信任客户端 Content-Type）+ 大小上限。
视频与 .sb3 走流式写入，避免把几十 MB 一次性读进内存。
"""
import hashlib
import os
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import config, models, storage_quota
from ..deps import get_active_user, get_db

router = APIRouter(prefix="/upload", tags=["upload"])

# 图片「真实文件头」
_MAGIC = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}

CHUNK = 1024 * 1024  # 1MB


def _magic_ok(content_type: str, data: bytes) -> bool:
    heads = _MAGIC.get(content_type)
    if not heads or not data:
        return False
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return any(data.startswith(h) for h in heads)


def _video_magic_ok(content_type: str, head: bytes) -> bool:
    """MP4/MOV 是 ISO BMFF（第 5~8 字节为 'ftyp'），WebM 是 EBML 头。"""
    if content_type in ("video/mp4", "video/quicktime"):
        return len(head) >= 12 and head[4:8] == b"ftyp"
    if content_type == "video/webm":
        return head[:4] == b"\x1a\x45\xdf\xa3"
    return False


def _safe_remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


@router.post("")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    ext = config.ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if ext is None:
        allowed = " / ".join(k.split("/")[-1].upper() for k in config.ALLOWED_IMAGE_TYPES)
        raise HTTPException(status_code=400, detail=f"仅支持 {allowed} 图片")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > config.MAX_UPLOAD_SIZE:
        mb = config.MAX_UPLOAD_SIZE // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"图片大小不能超过 {mb}MB")
    if not _magic_ok(file.content_type, data):
        raise HTTPException(status_code=400, detail="文件内容与声明格式不符，请重新上传")

    # 账号存储空间（默认 500MB）：图片也算在里面（站长 2026-09-27）
    ok, why = storage_quota.check_room(db, user, len(data))
    if not ok:
        raise HTTPException(status_code=400, detail=why)

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    filename = f"{user.id}_{uuid.uuid4().hex[:16]}{ext}"
    with open(os.path.join(config.UPLOAD_DIR, filename), "wb") as f:
        f.write(data)

    # 返回相对路径：前端 <img src> 自动带上当前域名和端口，避免代理后丢端口
    return {"url": f"/uploads/{filename}", "type": "image", "size": len(data)}


@router.post("/video")
async def upload_video(
    request: Request,
    file: UploadFile = File(...),
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    ext = config.ALLOWED_VIDEO_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status_code=400, detail="仅支持 MP4 / WebM / MOV 视频")

    # 视频也占账号存储空间：先按「单文件上限」预检一次，避免边收边写最后才报错
    ok, why = storage_quota.check_room(db, user, config.MAX_VIDEO_SIZE)
    if not ok:
        raise HTTPException(status_code=400, detail=why)

    os.makedirs(config.UPLOAD_DIR, exist_ok=True)
    filename = f"{user.id}_{uuid.uuid4().hex[:16]}{ext}"
    path = os.path.join(config.UPLOAD_DIR, filename)
    mb = config.MAX_VIDEO_SIZE // (1024 * 1024)
    total = 0
    head = b""
    try:
        with open(path, "wb") as f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                if not head:
                    head = chunk[:16]
                    if not _video_magic_ok(file.content_type, head):
                        raise HTTPException(status_code=400, detail="文件内容不像视频（格式不符），请重新上传")
                total += len(chunk)
                if total > config.MAX_VIDEO_SIZE:
                    raise HTTPException(status_code=400, detail=f"视频大小不能超过 {mb}MB")
                f.write(chunk)
    except HTTPException:
        _safe_remove(path)
        raise
    except Exception:
        _safe_remove(path)
        raise HTTPException(status_code=500, detail="视频保存失败，请重试")

    if total == 0:
        _safe_remove(path)
        raise HTTPException(status_code=400, detail="文件为空")

    return {"url": f"/uploads/{filename}", "type": "video", "size": total}


# ---------------------------------------------------------------------------
# Scratch 作品文件（.sb3）
# ---------------------------------------------------------------------------
def _sb3_project_ok(path: str) -> tuple[bool, str]:
    """校验它真的是 Scratch 项目包：zip 里必须有 project.json，且不能是解压炸弹。

    只看 namelist + project.json 的**压缩前大小**，绝不整包解压 ——
    否则一个几十 KB 的 zip 炸弹就能把磁盘撑爆。
    """
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            if "project.json" not in names:
                return False, "这个文件里没有 project.json，不像 Scratch 作品（.sb3）"
            info = z.getinfo("project.json")
            if info.file_size > 20 * 1024 * 1024:
                return False, "作品数据异常（project.json 过大），请重新导出后再上传"
            # 压缩前总大小也兜一下：正常 sb3 最多几百 MB，超过 1GB 一律当异常
            if sum(i.file_size for i in z.infolist()) > 1024 * 1024 * 1024:
                return False, "作品文件解压后过大，请精简后再上传"
    except zipfile.BadZipFile:
        return False, "这个文件不是有效的 .sb3（打不开），请用 Scratch 导出 .sb3 后重试"
    return True, ""


@router.post("/scratch")
async def upload_scratch(
    request: Request,
    file: UploadFile = File(...),
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    """上传 Scratch 作品文件（.sb3），返回直链 /uploads/games/xxx.sb3。

    文件名用**内容 sha256 前 16 位**：同一份文件重复上传天然去重，也给 nginx 配
    `immutable` 长缓存提供了依据（内容变 → 文件名变）。
    """
    mb = config.SCRATCH_MAX_SIZE // (1024 * 1024)
    os.makedirs(config.scratch_dir(), exist_ok=True)
    tmp = os.path.join(config.scratch_dir(), f"tmp_{user.id}_{uuid.uuid4().hex[:12]}")
    digest = hashlib.sha256()
    total = 0
    head = b""
    try:
        with open(tmp, "wb") as f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                if not head:
                    head = chunk[:4]
                    # zip 的魔数：PK\x03\x04（空 zip 是 PK\x05\x06，作品包不可能）
                    if head != b"PK\x03\x04":
                        raise HTTPException(status_code=400, detail="这个文件不是 .sb3（Scratch 作品包），请重新导出")
                total += len(chunk)
                if total > config.SCRATCH_MAX_SIZE:
                    raise HTTPException(status_code=400, detail=f"作品文件不能超过 {mb}MB")
                digest.update(chunk)
                f.write(chunk)
    except HTTPException:
        _safe_remove(tmp)
        raise
    except Exception:
        _safe_remove(tmp)
        raise HTTPException(status_code=500, detail="作品上传失败，请重试")

    if total == 0:
        _safe_remove(tmp)
        raise HTTPException(status_code=400, detail="文件为空")

    ok, msg = _sb3_project_ok(tmp)
    if not ok:
        _safe_remove(tmp)
        raise HTTPException(status_code=400, detail=msg)

    sha = digest.hexdigest()
    filename = f"{sha[:16]}.sb3"
    final = os.path.join(config.scratch_dir(), filename)
    size_mb = total / (1024 * 1024)

    # 账号存储空间（默认 500MB，作品源文件 + 图片 + 语音…全部算在一起，见 app/storage_quota.py）。
    # 同一份文件重复传不会重复计数（按**磁盘上引用到的文件**去重统计）；用户级配额（管理员批过扩容的）优先。
    ok, why = storage_quota.check_room(db, user, total)
    if not ok:
        _safe_remove(tmp)
        raise HTTPException(status_code=400, detail=why)

    os.replace(tmp, final)   # 同内容已存在时直接覆盖，等于去重
    return {
        "url": f"/uploads/{config.SCRATCH_DIR_NAME}/{filename}",
        "type": "scratch",
        "size": total,
        "size_mb": round(size_mb, 2),
        "sha256": sha,
    }
