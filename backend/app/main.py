"""FastAPI 应用入口，挂载 Socket.IO。"""
import asyncio
import os
import threading

import socketio
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from sqlalchemy.orm import Session

from . import config, audit as audit_mod, map_event, studio_core
from .database import init_db
from .deps import get_db
from .ratelimit import RateLimitMiddleware, client_ip
from . import committee
from .routers import auth, admin, chat, collections, contests, discover, drafts, feedback, kh_feed, map_event as map_event_router, notifications, posts, public, reactions, reports, search, site_events, studios, uploads, users, verify, works
from . import pickcat as pickcat_router
from .socket import sio

init_db()

# 生产默认不暴露接口文档/OpenAPI（避免路由面泄露）；开发调试设 NIMAO_DOCS=1 可开启
_show_docs = os.getenv("NIMAO_DOCS", "") == "1"
app = FastAPI(
    title="KitterHub 社区 API",
    version="1.0.0",
    docs_url="/docs" if _show_docs else None,
    redoc_url="/redoc" if _show_docs else None,
    openapi_url="/openapi.json" if _show_docs else None,
)

# 工作室领域异常 -> HTTP 响应（studio_core.fail 抛的就是它）
@app.exception_handler(studio_core.StudioError)
async def studio_error_handler(request, exc: studio_core.StudioError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# 安全审计：自动记录后台写操作与登录/改密等敏感请求
@app.middleware("http")
async def audit_middleware(request, call_next):
    response = await call_next(request)
    try:
        await audit_mod.record_request(request, response.status_code)
    except Exception:
        pass
    return response


# 「锦绣山河·点亮中国」：活动期间**有该省的人访问过站点**就点亮那个省。
# 带登录态的请求由 deps.touch_ip_region 负责点亮（那里能记下「是谁点亮的」），
# 这里只补访客，且带 Authorization 的请求跳过 —— 否则中间件会抢先把点亮者记成空。
# 点亮是活动效果，任何异常都不能影响正常请求，所以整段吞掉。
@app.middleware("http")
async def map_light_middleware(request, call_next):
    response = await call_next(request)
    try:
        if (
            request.method == "GET"
            and request.url.path.startswith("/api/")
            and not request.headers.get("authorization")
        ):
            map_event.note_guest(client_ip(request))
    except Exception:
        pass
    return response

# 防刷爆：全局限流（/api/* 每个 IP 每分钟限次）
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 对外开放接口（/api/public/*）：允许任意站点跨域读取。
# 这些接口不需要登录、返回的都是本来就公开的数据，所以不套 CORS_ORIGINS 白名单——
# 否则第三方页面在浏览器里直接 fetch 会被拦，接口等于只能用在后端。
# 注意：这个中间件必须在 CORSMiddleware 之后注册（注册越晚越靠外），这样才拿得到最终响应。
@app.middleware("http")
async def public_api_cors(request, call_next):
    if not request.url.path.startswith("/api/public/"):
        return await call_next(request)
    if request.method == "OPTIONS":  # 预检：带自定义头的调用方会先发这个
        return Response(
            status_code=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*"),
                "Access-Control-Max-Age": "86400",
            },
        )
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

# 上传的图片作为静态文件对外提供
os.makedirs(config.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")

for r in (
    auth.router,
    users.router,
    posts.router,
    works.router,
    discover.router,
    chat.router,
    studios.router,
    notifications.router,
    uploads.router,
    reports.router,
    search.router,
    drafts.router,
    admin.router,
    reactions.router,
    collections.router,
    feedback.router,
    kh_feed.router,
    verify.router,
    public.router,
    site_events.router,
    contests.router,
    contests.admin_router,
    map_event_router.router,
    map_event_router.admin_router,
    committee.router,
):
    app.include_router(pickcat_router.router, prefix="/api")

    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "KitterHub"}


@app.get("/api/editors")
def editors():
    return config.EDITORS


@app.get("/api/site/announcement")
def site_announcement(db: Session = Depends(get_db)):
    """全站公告（公开，前端首页展示）。"""
    from . import models

    s = db.get(models.SiteSetting, "announcement")
    return {"announcement": s.value if s else ""}


# Socket.IO 挂在同一个 ASGI 应用上，路径为 /socket.io
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


@app.on_event("startup")
async def _bind_socket_loop():
    """记录事件循环，使 REST 侧也能主动向 socket 推送（通知 / 聊天广播）。"""
    from .socket import _set_event_loop

    _set_event_loop(asyncio.get_running_loop())



def _start_scheduler():
    """后台线程：定时发布稿件 + 定时发布全站公告。"""

    def loop():
        import json
        import time
        from datetime import datetime, timezone

        from . import models
        from .database import SessionLocal

        while True:
            try:
                db = SessionLocal()
                try:
                    due = (
                        db.query(models.Work)
                        .filter(
                            models.Work.status == "scheduled",
                            models.Work.scheduled_at.isnot(None),
                            models.Work.scheduled_at <= models.now(),
                        )
                        .all()
                    )
                    for w in due:
                        w.status = "published"
                    if due:
                        db.commit()
                    # 定时公告：到点把定时公告提升为正式公告
                    ss = db.get(models.SiteSetting, "announcement_scheduled")
                    if ss and ss.value:
                        try:
                            data = json.loads(ss.value)
                            at = datetime.fromisoformat((data.get("at") or "").replace("Z", "+00:00"))
                            if at <= datetime.now(timezone.utc):
                                s = db.get(models.SiteSetting, "announcement")
                                if s is None:
                                    s = models.SiteSetting(key="announcement", value=data.get("text") or "")
                                    db.add(s)
                                else:
                                    s.value = data.get("text") or ""
                                db.delete(ss)
                                db.commit()
                        except Exception:
                            pass
                finally:
                    db.close()
            except Exception:
                pass
            time.sleep(30)

    t = threading.Thread(target=loop, daemon=True)
    t.start()


_start_scheduler()
