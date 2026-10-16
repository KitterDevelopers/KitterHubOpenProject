"""对外开放接口：给站外页面 / 第三方开发者读取首页作品（无需登录、无需签名）。

改这个文件前先读这里的约定：
- 只返回 status == "published" 的稿件；审核中、被驳回、定时未到的一律不出现。
- 图片与链接一律返回**绝对地址**（前缀取 config.PUBLIC_BASE_URL，未配置时按请求 Host 推断），
  调用方可以直接塞进 <img src> / <a href>，不需要自己拼域名。
- 只给「卡片」需要的字段：封面 / 作品名 / 作品介绍 / 作品链接 / 作者名 / 作者头像 / 作者 UID。
  不要往这里加评论数、点赞数之类需要额外查询的字段。
- 跨域：main.py 里的 public_api_cors 中间件给 /api/public/* 发 CORS 头，任意站点可读。
- 文档：docs/public-api.md（改字段必须同步改它）。
"""
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session, joinedload

from .. import config, models
from ..deps import get_db

router = APIRouter(prefix="/public", tags=["public"])

DEFAULT_LIMIT = 12
MAX_LIMIT = 50
CACHE_SECONDS = 60  # 公开数据，允许调用方/中间层缓存一分钟，省得被轮询打爆


def base_url(request: Request) -> str:
    """站点根地址（不带尾斜杠），用于把站内相对路径拼成绝对地址。"""
    if config.PUBLIC_BASE_URL:
        return config.PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


def absolute(request: Request, url: str | None) -> str | None:
    """站内相对图片（/uploads/xxx）补全为绝对地址；外链（编程猫 CDN 等）原样返回。"""
    if not url:
        return None
    if url.startswith(("http://", "https://")):
        return url
    return base_url(request) + (url if url.startswith("/") else "/" + url)


def work_card(request: Request, work: models.Work) -> dict:
    """一件作品的对外卡片。字段名是公开契约，改名=破坏兼容。"""
    author = work.author
    return {
        "id": work.id,
        "title": work.title,
        "description": work.description or "",
        "cover": absolute(request, work.cover_url),
        "url": f"{base_url(request)}/works/{work.id}",
        "play_url": work.play_url,
        "author": {
            "uid": author.uid if author else None,
            "name": author.display_name if author else "",
            "avatar": absolute(request, author.avatar_url) if author else None,
        },
    }


@router.get("/works")
def home_works(
    request: Request,
    response: Response,
    section: Literal["newest", "featured"] = "newest",
    limit: int = DEFAULT_LIMIT,
    db: Session = Depends(get_db),
):
    """首页作品列表。

    section=featured → 官方精选（与首页「官方精选」同一批稿件）
    section=newest   → 最新投稿（与首页「最新投稿」同一批稿件）
    """
    limit = max(1, min(limit, MAX_LIMIT))
    query = (
        db.query(models.Work)
        .options(joinedload(models.Work.author))  # 一次查完作者，避免逐条查库
        .filter(models.Work.status == "published")
    )
    if section == "featured":
        query = query.filter(models.Work.is_featured.is_(True))
    works = query.order_by(models.Work.created_at.desc()).limit(limit).all()
    items = [work_card(request, w) for w in works]
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    return {"section": section, "count": len(items), "items": items}


# ---------------------------------------------------------------------------
# sitemap.xml：给搜索引擎的资源清单
# ---------------------------------------------------------------------------
# 为什么要后端生成而不是写一个静态文件：稿件/帖子/工作室每天都在变，
# 静态文件得靠定时任务重算，容易过期。这里每次请求现算，缓存 10 分钟。
#
# 站点是单页应用、内容靠 JS 渲染：Google / 百度 的渲染型蜘蛛（Baiduspider-render）
# 能执行 JS 拿到内容，但**前提是它得先知道有哪些 URL** —— 这个清单就是干这个的。
SITEMAP_MAX = 5000          # 单份 sitemap 上限（百度允许 5 万，这里留足余量）
SITEMAP_CACHE = 600         # 秒


def _u(date) -> str:
    """日期 → W3C datetime；没有就省略 lastmod（不要瞎写今天，会误导蜘蛛）。"""
    return date.strftime("%Y-%m-%dT%H:%M:%S+00:00") if date else ""


@router.get("/sitemap.xml")
def sitemap(request: Request, response: Response, db: Session = Depends(get_db)):
    base = base_url(request)

    # 固定页面：只列**公开可看**的。私有页（/settings /admin …）在 robots.txt 里挡住。
    entries: list[tuple[str, str]] = [
        (f"{base}/", ""),
        (f"{base}/discover", ""),
        (f"{base}/forum", ""),
        (f"{base}/studios", ""),
        (f"{base}/help", ""),
        (f"{base}/help.html", ""),
    ]

    # 已发布稿件（待审 / 被驳回 / 定时未到的一律不出现，与 public API 同一口径）
    works = (
        db.query(models.Work.id, models.Work.edited_at, models.Work.created_at)
        .filter(models.Work.status == "published")
        .order_by(models.Work.id.desc())
        .limit(SITEMAP_MAX)
        .all()
    )
    entries += [(f"{base}/works/{w.id}", _u(w.edited_at or w.created_at)) for w in works]

    posts = (
        db.query(models.Post.id, models.Post.edited_at, models.Post.created_at)
        .filter(models.Post.status == "published")
        .order_by(models.Post.id.desc())
        .limit(SITEMAP_MAX)
        .all()
    )
    entries += [(f"{base}/posts/{p.id}", _u(p.edited_at or p.created_at)) for p in posts]

    # 工作室：封禁的不列
    studios = (
        db.query(models.Studio.id, models.Studio.created_at)
        .filter(models.Studio.status != "banned")
        .order_by(models.Studio.id.desc())
        .limit(SITEMAP_MAX)
        .all()
    )
    entries += [(f"{base}/studios/{s.id}", _u(s.created_at)) for s in studios]

    # 用户主页：跳过封禁/注销的
    users = (
        db.query(models.User.uid)
        .filter(models.User.is_banned.is_(False), models.User.is_deactivated.is_(False))
        .order_by(models.User.id.desc())
        .limit(SITEMAP_MAX)
        .all()
    )
    entries += [(f"{base}/users/{u.uid}", "") for u in users]

    entries = entries[:SITEMAP_MAX]
    body = "\n".join(
        f"  <url><loc>{loc}</loc>" + (f"<lastmod>{lm}</lastmod>" if lm else "") + "</url>"
        for loc, lm in entries
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )
    response.headers["Content-Type"] = "application/xml; charset=utf-8"
    response.headers["Cache-Control"] = f"public, max-age={SITEMAP_CACHE}"
    return Response(content=xml, media_type="application/xml")


# ---------------------------------------------------------------------------
# 站点公告（首页顶部那条）
# ---------------------------------------------------------------------------
@router.get("/announcement")
def public_announcement(response: Response, db: Session = Depends(get_db)):
    """当前生效的站点公告。**无需登录** —— 首页对所有人展示它。

    ⚠️ 这里补的是个真 bug：前端首页一直在调 `/api/site/announcement`，但这个路径后端**根本不存在**
    （只有要管理员权限的 `/api/admin/announcement`），请求 404 又被首页的 `.catch(() => {})` 吞掉，
    所以「后台设了公告、首页永远不显示」，而且不报错、没人会发现。
    定时公告（announcement_scheduled）是后台的排期概念，不对外暴露，这里只返回当前生效的文本。
    """
    s = db.get(models.SiteSetting, "announcement")
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SECONDS}"
    return {"announcement": (s.value if s else "") or ""}
