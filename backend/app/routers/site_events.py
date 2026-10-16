"""限时活动对外接口：给「活动页」读活动内容、状态，以及当前用户领没领。

活动**定义**在 `app/events.py`（发放逻辑）里，这里只是把它按用户视角呈现出来：
  · status：upcoming（还没到）/ today（就是今天，登录即得）/ ended（已经过去）
    —— 一律按**北京时间**算，和发放逻辑同一套口径（数据库的 now() 是 UTC，直接用会差 8 小时）
  · claimed：当前登录用户的领取记录（未登录恒为 false）
活动文案不在这里拼（页面按 key 取 i18n 词条），这样加中英/改文案不用动后端。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import events as event_defs
from .. import models
from ..deps import get_db, get_optional_user

router = APIRouter(prefix="/events", tags=["events"])


@router.get("")
def list_events(db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    today = event_defs.beijing_today()
    out = []
    for ev in event_defs.EVENTS:
        if today < ev["date"]:
            status = "upcoming"
        elif today == ev["date"]:
            status = "today"
        else:
            status = "ended"
        claimed = False
        if current is not None:
            claimed = (
                db.query(models.EventClaim.id)
                .filter(models.EventClaim.user_id == current.id, models.EventClaim.event_key == ev["key"])
                .first()
                is not None
            )
        out.append({
            "key": ev["key"],
            "date": ev["date"],
            "xp": ev["xp"],
            "fish": ev["fish"],
            "status": status,
            "claimed": bool(claimed),
            "logged_in": current is not None,
        })
    return {"today": today, "events": out}


@router.get("/{key}")
def get_event(key: str, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    """单个活动（活动页 /event/<key> 用）。找不到就 404 —— 页面据此显示「活动不存在」。"""
    from fastapi import HTTPException

    data = list_events(db=db, current=current)
    for ev in data["events"]:
        if ev["key"] == key:
            return {"today": data["today"], **ev}
    raise HTTPException(status_code=404, detail="活动不存在或已下线")
