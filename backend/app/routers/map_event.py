"""「锦绣山河·点亮中国」对外接口（页面 /contest/lit-china 用）。

口径全在 `app/map_event.py`，这里只做「读页面数据 / 领祝福 / 开奖」这几件事：
  GET  /map-event                  活动元信息 + 已点亮省 + 每省榜 + 我的领取与参赛情况
  GET  /map-event/province/{省}     某个省的完整榜单（页面上点开某省时用）
  POST /map-event/claim            领一个省的国庆祝福（+2 小鱼干，幂等）
  POST /map-event/claim-all        一键领掉所有还没领的已点亮省
  GET  /admin/map-event/preview    开奖预览（每个省现在会发给谁）
  POST /admin/map-event/award      开奖（每省第一名 50 小鱼干，幂等）
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import map_event, models
from ..deps import get_current_admin, get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/map-event", tags=["map-event"])
admin_router = APIRouter(prefix="/admin/map-event", tags=["map-event-admin"])


@router.get("")
def get_map_event(db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    return map_event.meta(db, current)


@router.get("/province/{region}")
def get_province(region: str, db: Session = Depends(get_db)):
    """某个省的完整榜单（含未点亮但有作品的省，页面自己判断怎么显示）。"""
    ranked = map_event.ranked_by_province(db)
    items = ranked.get(region)
    if items is None:
        return {"region": region, "count": 0, "likes": 0, "works": [], "lit": region in map_event.lit_regions(db)}
    return {
        "region": region,
        "count": len(items),
        "likes": sum(i["likes"] for i in items),
        "lit": region in map_event.lit_regions(db),
        "works": map_event.serialize_ranked(items),
    }


@router.post("/claim")
def claim_blessing(body: dict, db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    try:
        return map_event.claim(db, current, (body or {}).get("region") or "")
    except map_event.MapEventError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/claim-all")
def claim_all(db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    try:
        return map_event.claim_all(db, current)
    except map_event.MapEventError as e:
        raise HTTPException(status_code=400, detail=str(e))


@admin_router.get("/preview")
def admin_preview(db: Session = Depends(get_db), admin: models.User = Depends(get_current_admin)):
    return {"preview": map_event.preview(db), "prize": map_event.EVENT["province_prize"]}


@admin_router.post("/award")
def admin_award(db: Session = Depends(get_db), admin: models.User = Depends(get_current_admin)):
    return map_event.do_award(db, admin.id)
