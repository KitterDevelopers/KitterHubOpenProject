"""活动（比赛制）对外接口 + 开奖。

与 `site_events.py`（登录领奖那种）分开：这里是**排行榜赛制**，页面要读榜单、要能看开奖结果。
  · `GET  /api/contests`                  活动列表（含状态）
  · `GET  /api/contests/{key}`            单个活动：规则 + 状态 + 榜单 + 统计（活动页用）
  · `GET  /api/contests/{key}/my`         我参加的作品（我自己的稿件在榜上的情况）
  · `GET  /admin/contests/{key}/preview`  开奖预览（管理员看最终名次与应发奖）
  · `POST /admin/contests/{key}/award`    开奖发奖（幂等，可重复点）
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import contests as contest_defs
from .. import models
from ..deps import get_current_admin, get_db, get_optional_user

router = APIRouter(prefix="/contests", tags=["contests"])
admin_router = APIRouter(prefix="/admin/contests", tags=["contests-admin"])


def _stats(db: Session, contest: dict) -> dict:
    items = contest_defs.eligible_works(db, contest)
    uids = {it["work"].user_id for it in items}
    return {
        "works": len(items),
        "authors": len(uids),
        "likes": sum(it["likes"] for it in items),
    }


@router.get("")
def list_contests(db: Session = Depends(get_db)):
    return {"items": [contest_defs.contest_meta(c, db) for c in contest_defs.CONTESTS]}


@router.get("/{key}")
def get_contest(
    key: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    contest = contest_defs.get_contest(key)
    if contest is None:
        raise HTTPException(status_code=404, detail="活动不存在或已下线")
    meta = contest_defs.contest_meta(contest, db)
    ranked = contest_defs.serialize_ranked(db, contest, limit=limit)
    mine = []
    if current is not None:
        mine = [r for r in contest_defs.serialize_ranked(db, contest) if (r.get("author") or {}).get("id") == current.id]
    return {
        **meta,
        "stats": _stats(db, contest),
        "ranking": ranked,
        "mine": mine,
        "logged_in": current is not None,
    }


@router.get("/{key}/my")
def my_works(key: str, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    contest = contest_defs.get_contest(key)
    if contest is None:
        raise HTTPException(status_code=404, detail="活动不存在或已下线")
    if current is None:
        return {"items": [], "logged_in": False}
    items = [r for r in contest_defs.serialize_ranked(db, contest) if (r.get("author") or {}).get("id") == current.id]
    return {"items": items, "logged_in": True}


@admin_router.get("/{key}/preview")
def preview_award(key: str, db: Session = Depends(get_db), admin: models.User = Depends(get_current_admin)):
    """开奖预览：最终名次 + 每个名次应发多少（不改任何数据）。"""
    contest = contest_defs.get_contest(key)
    if contest is None:
        raise HTTPException(status_code=404, detail="活动不存在或已下线")
    items = contest_defs.eligible_works(db, contest)
    return {
        **contest_defs.contest_meta(contest, db),
        "status": contest_defs.contest_status(contest),
        "preview": [
            {
                "rank": it["rank"],
                "work_id": it["work"].id,
                "title": it["work"].title,
                "likes": it["likes"],
                "prize": it["prize"],
                "uid": it["work"].author.uid if it["work"].author else "",
                "nickname": (it["work"].author.nickname or it["work"].author.username) if it["work"].author else "",
            }
            for it in items[: contest["max_prize_rank"]]
        ],
    }


@admin_router.post("/{key}/award")
def do_award(key: str, db: Session = Depends(get_db), admin: models.User = Depends(get_current_admin)):
    """开奖发奖。幂等：每个获奖作品只发一次（靠 event_claims 的唯一约束兜底）。"""
    contest = contest_defs.get_contest(key)
    if contest is None:
        raise HTTPException(status_code=404, detail="活动不存在或已下线")
    from .. import serializers

    result = contest_defs.do_award(db, contest, admin.id)
    serializers.log_admin_action(
        db, admin.id, "contest_award", "site", None,
        f"国庆创作活动开奖：{len([w for w in result['winners'] if not w.get('skipped')])} 件作品获奖，共发 {result['fish_total']} 小鱼干",
    )
    return result
