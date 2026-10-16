"""图片地址校验：只允许本站上传的图片（/uploads/ 开头），禁止外部图片链接。

上传接口返回形如 http://host/uploads/xxx.png（或相对路径 /uploads/xxx.png）。
前端一律改用上传按钮，这里在后端兜底，防止通过直接调用接口绕过。
"""
from urllib.parse import urlparse

from fastapi import HTTPException

from . import config


def _resolve_path(v: str):
    """从 URL 中取出文件名并校验路径安全。"""
    filename = v.split("/uploads/")[-1]
    if "/" in filename or "\\" in filename or ".." in filename:
        return None
    return filename


def check_uploaded_image(value, field="图片"):
    """校验图片地址必须是本站上传的；空值返回 None；外部链接抛 400。"""
    if value is None:
        return None
    v = str(value).strip()
    if not v:
        return None
    if v.startswith("/uploads/"):
        filename = _resolve_path(v)
    else:
        p = urlparse(v)
        if not (p.scheme in ("http", "https") and p.path.startswith("/uploads/")):
            raise HTTPException(status_code=400, detail=f"{field}只支持本站上传的图片，请使用上传按钮")
        filename = _resolve_path(p.path)
    if filename is None:
        raise HTTPException(status_code=400, detail=f"{field}地址不合法")
    import os

    if not os.path.exists(os.path.join(config.UPLOAD_DIR, filename)):
        raise HTTPException(status_code=400, detail=f"{field}不存在，请重新上传")
    return v


# 编程猫官方 CDN 域名（封面图等允许使用其外链）
CODEMAO_CDN_DOMAINS = ("bcmcdn.com", "codemao.cn", "codemao.com", "codemao.net")


def _cdm_host_ok(host: str) -> bool:
    """域名必须精确等于白名单或为其子域（禁止 codemao.cn.evil.com 之类子串绕过）。"""
    host = (host or "").lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in CODEMAO_CDN_DOMAINS)


def check_cover_image(value, field="封面图"):
    """封面校验：允许本站上传，也允许编程猫 CDN 外链（导入编程猫作品时使用），其余外链拒绝。"""
    if value is None:
        return None
    v = str(value).strip()
    if not v:
        return None
    if v.startswith("/uploads/"):
        return check_uploaded_image(v, field)
    p = urlparse(v)
    if p.scheme in ("http", "https") and _cdm_host_ok(p.hostname or ""):
        return v  # 编程猫 CDN 封面放行
    return check_uploaded_image(v, field)
