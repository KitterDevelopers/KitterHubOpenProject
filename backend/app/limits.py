"""内容发布限制：每人每日稿件/帖子/评论数量上限，防止刷屏。"""
import threading
import time as _time

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import config, models, switches


def count_today(db: Session, model, user_id: int) -> int:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.query(model).filter(model.user_id == user_id, model.created_at >= today).count()


def ensure_under_limit(db: Session, model, user_id: int, limit: int, name: str) -> None:
    """超过每日上限则抛 429（开关关闭时不限制）。"""
    if not switches.enabled("daily_limit"):
        return
    if count_today(db, model, user_id) >= limit:
        raise HTTPException(status_code=429, detail=f"今日{name}数量已达上限（{limit}），请明天再来")


# ---- 短时高频发布防护（内存滑动窗口，防脚本连发灌水）----
_flood_lock = threading.Lock()
_flood_times: dict[str, list[float]] = {}
_FLOOD_MAX = 8  # 同一动作窗口内最多次数
_FLOOD_WINDOW = 60  # 秒


def check_frequency(key: str, max_n: int = _FLOOD_MAX, window: int = _FLOOD_WINDOW) -> None:
    """同一 key（如 user:12:post）在窗口内超过 max_n 次则 429（开关关闭时不限制）。"""
    if not switches.enabled("freq_limit"):
        return
    now = _time.time()
    with _flood_lock:
        arr = _flood_times.setdefault(key, [])
        arr[:] = [t for t in arr if now - t < window]
        if len(arr) >= max_n:
            raise HTTPException(status_code=429, detail="操作太快了，请稍后再试")
        arr.append(now)
