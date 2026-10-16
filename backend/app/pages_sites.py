"""KitterHub Pages —— 用户静态项目托管（pages.example.com/<slug>/）。

用户上传纯静态项目包（zip），托管在本服务上，占用计入账号存储空间；
对外 URL 由环境变量 NIMAO_PAGES_DOMAIN 决定（默认占位符 pages.example.com）。

安全要点（与主站跨源隔离，且解压必须防三类攻击）：
  · Zip Slip      —— 逐个 entry 校验解析后的绝对路径必须落在目标目录内；
  · Zip Bomb      —— 限制单包大小 / 解压总量 / 文件数 / 压缩比；
  · symlink 等    —— 只接受普通文件（按 zip 里的 unix mode 判断），目录之外一律拒收；
  · 只吃静态      —— 拒绝 php/py/sh/exe 等可执行后缀（nginx 侧也再挡一层）；
  · 原子发布      —— 解压到 tmp/<uuid> → 校验 → rename 切换，失败保留旧版本。

配额：解压后的**实际字节**计入账号存储（models.PageSite.bytes，storage_quota 一并统计）。
"""
from __future__ import annotations

import os
import re
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from . import config, models, storage_quota
from .deps import get_active_user, get_db

router = APIRouter(prefix="/pages", tags=["pages"])

# 用户静态项目（KitterHub Pages）的落盘根目录。
# 开源版：默认值改为通用占位路径，部署者用 NIMAO_PAGES_ROOT 指定自己的路径。
PAGES_ROOT = Path(
    os.getenv("NIMAO_PAGES_ROOT", "") or getattr(config, "PAGES_ROOT", "") or "/srv/kitterhub/pages"
)
MAX_ZIP_BYTES = 20 * 1024 * 1024      # 单包 20MB
MAX_FILES = 2000                       # 文件数上限
MAX_RATIO = 200                        # 解压比上限（zip bomb）
MAX_UNPACK_BYTES = 200 * 1024 * 1024   # 解压总量硬上限 200MB
VERSIONS_KEEP = 3                       # 每个项目最多保留 3 个历史版本（回滚用）
VERS_ROOT = PAGES_ROOT / ".versions"    # 隐藏目录；nginx 已 deny 所有点开头路径

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")
# 保留字：防止占用我们自己的路径，尤其防 login./admin. 这类钓鱼式命名
RESERVED = {
    "www", "api", "assets", "static", "cdn", "admin", "login", "logout", "mail", "smtp",
    "ns", "dns", "test", "dev", "staging", "status", "hub", "pickcat", "xjmj", "jxmn",
    "404", "500", "favicon", "robots", "sitemap", "pages", "kitterhub", "support",
}
# 只禁"在服务器上可能被执行"的后缀；.htaccess/.conf/.ini/.env 等交给我们 nginx 的
# dotfile 拦截与静态规则处理，不再因此拒收（站长 2026-10-03 要求放宽）
BANNED_EXT = {
    ".php", ".phtml", ".php3", ".php4", ".php5", ".phar", ".py", ".pyc", ".pl", ".cgi",
    ".sh", ".bash", ".zsh", ".exe", ".dll", ".so", ".dylib", ".bat", ".cmd", ".ps1",
    ".jsp", ".asp", ".aspx",
}
IGNORE_PREFIX = ("__MACOSX/", ".DS_Store", ".git/", ".svn/", "Thumbs.db")


def _now():
    return datetime.now(timezone.utc)


def _slug_ok(slug: str) -> str:
    slug = (slug or "").strip().lower()
    if not SLUG_RE.match(slug) or slug in RESERVED:
        raise HTTPException(status_code=400, detail="项目地址只能用 2-32 位小写字母、数字与连字符，且不能使用保留名")
    return slug


def _site_of(db: Session, user, site_id: int) -> models.PageSite:
    site = db.query(models.PageSite).filter(models.PageSite.id == site_id).first()
    if site is None or site.owner_id != user.id:
        raise HTTPException(status_code=404, detail="项目不存在")
    return site


def _heal_bytes(db, site) -> None:
    """按磁盘真实情况校正占用（历史脏数据/异常中断都能自愈）。"""
    try:
        files = 0
        cur = 0
        target = PAGES_ROOT / site.slug
        if target.exists():
            cur, files = _dir_size(target)
        total = cur + _versions_size(site.slug)
        if int(site.bytes or 0) != total or int(site.files or 0) != files:
            site.bytes = total
            site.files = files
            db.commit()
    except Exception:  # noqa: BLE001
        pass


def _versions_dir(slug: str) -> Path:
    return VERS_ROOT / slug


def _versions_size(slug: str) -> int:
    """历史版本占用的空间也要算进账号存储。"""
    d = _versions_dir(slug)
    if not d.exists():
        return 0
    total = 0
    for sub in d.iterdir():
        if sub.is_dir():
            total += _dir_size(sub)[0]
    return total


def _archive_current(slug: str) -> None:
    """把当前发布目录挪进历史版本，并只保留最近 VERSIONS_KEEP 个。"""
    target = PAGES_ROOT / slug
    if not target.exists():
        return
    d = _versions_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    dest = d / stamp
    if dest.exists():                     # 同一秒内连续部署：补一个序号，避免 rename 撞名
        dest = d / f"{stamp}-{uuid.uuid4().hex[:6]}"
    os.rename(target, dest)
    subs = sorted([x for x in d.iterdir() if x.is_dir()], key=lambda x: x.name)
    for old in subs[:-VERSIONS_KEEP]:
        shutil.rmtree(old, ignore_errors=True)


def _dir_size(path: Path) -> tuple[int, int]:
    total = files = 0
    for root, _dirs, names in os.walk(path):
        for n in names:
            try:
                total += (Path(root) / n).stat().st_size
                files += 1
            except OSError:
                pass
    return total, files


@router.get("/sites")
def list_sites(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    rows = (db.query(models.PageSite).filter(models.PageSite.owner_id == user.id)
              .order_by(models.PageSite.id.desc()).all())
    for r in rows:
        _heal_bytes(db, r)                 # 列表时顺手自愈，避免显示旧脏数据
    used = sum(int(r.bytes or 0) for r in rows)
    return {
        "used_bytes": used,
        "sites": [{
            "id": r.id, "slug": r.slug, "name": r.name, "status": r.status,
            "bytes": int(r.bytes or 0), "files": int(r.files or 0),
            "url": f"https://{config.PAGES_DOMAIN}/{r.slug}/",
            "created_at": r.created_at, "deployed_at": r.deployed_at,
        } for r in rows],
    }


@router.post("/sites", status_code=201)
def create_site(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    slug = _slug_ok(str(body.get("slug") or ""))
    name = str(body.get("name") or "").strip()[:60] or slug
    if db.query(models.PageSite).filter(models.PageSite.slug == slug).first() is not None:
        raise HTTPException(status_code=400, detail="这个项目地址已经被占用了，换一个")
    site = models.PageSite(owner_id=user.id, slug=slug, name=name, status="published",
                           bytes=0, files=0, created_at=_now())
    db.add(site)
    db.commit()
    db.refresh(site)
    (PAGES_ROOT / slug).mkdir(parents=True, exist_ok=True)
    return {"id": site.id, "slug": site.slug, "name": site.name, "url": f"https://{config.PAGES_DOMAIN}/{slug}/"}


@router.post("/sites/{site_id}/deploy")
async def deploy_site(site_id: int, file: UploadFile = File(...),
                      user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """"上传 zip 部署。整个过程不改动已发布的目录，成功才原子切换。"""
    site = _site_of(db, user, site_id)

    raw = await file.read(MAX_ZIP_BYTES + 1)
    if len(raw) > MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail="压缩包超过 20MB 上限")
    if not raw:
        raise HTTPException(status_code=400, detail="空文件")
    if not zipfile.is_zipfile(__import__("io").BytesIO(raw)):
        raise HTTPException(status_code=400, detail="请上传 zip 压缩包")

    ok, why = storage_quota.check_room(db, user, len(raw))   # 先按压缩包粗筛
    if not ok:
        raise HTTPException(status_code=413, detail=why or "存储空间不足")

    tmp = PAGES_ROOT / f".tmp-{uuid.uuid4().hex}"
    tmp.mkdir(parents=True, exist_ok=True)
    total = files = 0
    try:
        with zipfile.ZipFile(__import__("io").BytesIO(raw)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_FILES:
                raise HTTPException(status_code=400, detail=f"文件数超过 {MAX_FILES} 个上限")
            declared = sum(i.file_size for i in infos)
            if declared > MAX_UNPACK_BYTES:
                raise HTTPException(status_code=413, detail="解压后体积过大")
            if len(raw) > 0 and declared / max(len(raw), 1) > MAX_RATIO:
                raise HTTPException(status_code=413, detail="压缩比异常，已拒绝（疑似 zip bomb）")
            for info in infos:
                name = info.filename
                if name.startswith(IGNORE_PREFIX) or "__MACOSX" in name:
                    continue
                if info.is_dir() or name.endswith("/"):
                    continue                      # 目录：正常内容，先跳过
                mode = (info.external_attr >> 16) & 0o170000
                # 只拦真正危险的类型：符号链接 / 设备 / FIFO / socket。
                # 其它一律放行（Windows 打的包该字段常为 0，之前把整目录误判成"特殊文件"了）
                if mode in (0o120000, 0o010000, 0o020000, 0o060000, 0o140000):
                    raise HTTPException(status_code=400, detail="压缩包内含符号链接或设备文件，已拒绝")
                dest = (tmp / name).resolve()
                if not str(dest).startswith(str(tmp.resolve()) + os.sep):
                    raise HTTPException(status_code=400, detail="压缩包内含越界路径，已拒绝")
                if Path(name).suffix.lower() in BANNED_EXT:
                    raise HTTPException(status_code=400, detail=f"不允许的文件类型：{Path(name).suffix}")
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out, 1024 * 256)
                total += dest.stat().st_size
                files += 1
    except HTTPException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"压缩包无法解析：{type(e).__name__}")

    if files == 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(status_code=400, detail="压缩包里没有文件（请把 index.html 放在压缩包根目录）")
    if not (tmp / "index.html").exists():
        # 常见情况：用户把整个文件夹打成了 zip（里面是 mysite/index.html）。
        # 只有一个顶层目录、且它下面有 index.html 时，自动把它"提"上来一层。
        top = list(tmp.iterdir())
        if len(top) == 1 and top[0].is_dir() and (top[0] / "index.html").exists():
            inner = top[0]
            for item in list(inner.iterdir()):
                os.rename(item, tmp / item.name)
            inner.rmdir()
    if not (tmp / "index.html").exists():
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(status_code=400, detail="压缩包根目录缺少 index.html（把整个文件夹打包也没关系，会自动提一层）")

    # 配额校验：按"替换后"的净增量算 —— 本次上传会顶掉旧版本占用的 site.bytes
    delta = total - int(site.bytes or 0)
    ok, why = storage_quota.check_room(db, user, max(delta, 0))
    if not ok:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(status_code=413, detail=why or "存储空间不足")

    for root, _dirs, names in os.walk(tmp):
        os.chmod(root, 0o755)
        for n in names:
            os.chmod(Path(root) / n, 0o644)

    try:
        _archive_current(site.slug)
    except Exception:  # noqa: BLE001  归档失败不影响发布（宁可不回滚，也不能发不上去）
        pass
    target = PAGES_ROOT / site.slug
    trash = PAGES_ROOT / f".trash-{uuid.uuid4().hex}"
    if target.exists():
        os.rename(target, trash)
    os.rename(tmp, target)
    shutil.rmtree(trash, ignore_errors=True)

    site.bytes = total + _versions_size(site.slug)   # 历史版本一并计入
    site.files = files
    site.status = "published"
    site.deployed_at = _now()
    db.add(models.PageSiteVersion(site_id=site.id, bytes=total, files=files, created_at=_now()))
    db.commit()
    return {"ok": True, "url": f"https://{config.PAGES_DOMAIN}/{site.slug}/", "bytes": total, "files": files}


@router.get("/sites/{site_id}/versions")
def list_versions(site_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """部署日志 + 可回滚的历史版本（每个项目最多留 3 个）。"""
    site = _site_of(db, user, site_id)
    rows = (db.query(models.PageSiteVersion).filter(models.PageSiteVersion.site_id == site.id)
              .order_by(models.PageSiteVersion.id.desc()).limit(20).all())
    d = _versions_dir(site.slug)
    snaps = sorted([x.name for x in d.iterdir() if x.is_dir()], reverse=True) if d.exists() else []
    return {
        "deploys": [{"id": r.id, "bytes": int(r.bytes or 0), "files": int(r.files or 0), "at": r.created_at} for r in rows],
        "snapshots": snaps,
        "can_rollback": len(snaps) > 0,
    }


@router.post("/sites/{site_id}/rollback")
def rollback_site(site_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """回滚到上一个版本（把最近的历史快照换回发布目录）。"""
    site = _site_of(db, user, site_id)
    d = _versions_dir(site.slug)
    snaps = sorted([x for x in d.iterdir() if x.is_dir()], key=lambda x: x.name) if d.exists() else []
    if not snaps:
        raise HTTPException(status_code=400, detail="没有可回滚的历史版本")
    latest = snaps[-1]
    target = PAGES_ROOT / site.slug
    keep = PAGES_ROOT / f".rollback-keep-{uuid.uuid4().hex}"
    if target.exists():
        os.rename(target, keep)          # 当前版本先留着，回滚失败可还原
    try:
        os.rename(latest, target)
    except OSError:
        if keep.exists():
            os.rename(keep, target)
        raise HTTPException(status_code=500, detail="回滚失败，请稍后再试")
    shutil.rmtree(keep, ignore_errors=True)
    total, files = _dir_size(target)
    site.bytes = total + _versions_size(site.slug)
    site.files = files
    site.deployed_at = _now()
    db.commit()
    return {"ok": True, "url": f"https://{config.PAGES_DOMAIN}/{site.slug}/", "bytes": total, "files": files}


@router.patch("/sites/{site_id}")
def rename_site(site_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    site = _site_of(db, user, site_id)
    name = str(body.get("name") or "").strip()[:60]
    if name:
        site.name = name
        db.commit()
    return {"ok": True, "name": site.name}


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    site = _site_of(db, user, site_id)
    shutil.rmtree(PAGES_ROOT / site.slug, ignore_errors=True)
    db.delete(site)
    db.commit()
    return {"ok": True}
