"""限流与防爆破：全局限流中间件。登录限流已按产品要求移除。"""
import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from . import config, switches


def client_ip(request: Request) -> str:
    """取客户端真实 IP。

    信任 uvicorn 的 proxy_headers（forwarded_allow_ips 仅 127.0.0.1，即只信本机 nginx），
    此时 request.client.host 已由 uvicorn 依据 nginx 写入的 X-Forwarded-For 解析为真实客户端；
    不再直接信任客户端可伪造的 XFF 首值（堵限流绕过）。
    """
    if request.client:
        return request.client.host
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        return parts[-1] if parts else "unknown"
    return "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """全局限流：每个 IP 在固定时间窗口内最多 N 次请求（只对 /api/* 生效）。"""

    def __init__(self, app, limit: int | None = None, window: int = 60):
        super().__init__(app)
        self.limit = limit or config.RATE_LIMIT_PER_MINUTE
        self.window = window
        self._buckets: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if not switches.enabled("rate_limit"):
            return await call_next(request)
        if request.url.path.startswith("/api"):
            ip = client_ip(request)
            now = time.time()
            bucket = self._buckets[ip]
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后再试"})
            bucket.append(now)
        return await call_next(request)
