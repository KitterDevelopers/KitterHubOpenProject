"""Scratch .sb3 上传地址校验：只允许本站刚上传的作品文件（/uploads/games/xxx.sb3）。

和 imageurl.py 一个思路：前端先调上传接口拿到 url，再投稿时带上；
这里在后端兜底，防止有人直接把外部网址塞进来当作品文件。
"""
import os

from fastapi import HTTPException

from . import config


def _filename(value: str) -> str | None:
    """从 /uploads/games/xxx.sb3 里取出文件名，顺手挡掉目录穿越。"""
    from urllib.parse import urlparse

    v = str(value).strip()
    p = urlparse(v)
    path = p.path if p.scheme in ("http", "https") else v
    prefix = f"/uploads/{config.SCRATCH_DIR_NAME}/"
    if not path.startswith(prefix):
        return None
    name = path[len(prefix):]
    if not name or "/" in name or "\\" in name or ".." in name or not name.endswith(".sb3"):
        return None
    return name


def check_uploaded_sb3(value, field="作品文件") -> str | None:
    """校验作品文件必须是本站上传的 .sb3；空值返回 None；其它一律抛 400。"""
    if value is None:
        return None
    if not str(value).strip():
        return None
    name = _filename(value)
    if name is None:
        raise HTTPException(status_code=400, detail=f"{field}只支持本站上传的 .sb3 文件，请使用上传按钮")
    full = os.path.join(config.scratch_dir(), name)
    if not os.path.exists(full):
        raise HTTPException(status_code=400, detail=f"{field}不存在，请重新上传")
    return f"/uploads/{config.SCRATCH_DIR_NAME}/{name}"


def sb3_size(value) -> int:
    """取文件大小；文件不在就返回 0（不抛错，展示用）。"""
    name = _filename(value or "")
    if name is None:
        return 0
    try:
        return os.path.getsize(os.path.join(config.scratch_dir(), name))
    except OSError:
        return 0


def sb3_sha256(value) -> str | None:
    """算文件的完整 sha256（投稿落库用，用于同一个人判重）。

    ⚠️ 文件名里只有 sha 的前 16 位，不够当唯一键，所以判重时按内容重算一次。
    """
    import hashlib

    name = _filename(value or "")
    if name is None:
        return None
    path = os.path.join(config.scratch_dir(), name)
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
