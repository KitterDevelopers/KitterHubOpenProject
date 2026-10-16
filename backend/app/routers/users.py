"""用户模块：资料、更新、关注、收藏夹、历史、账号安全。"""
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import codemao, config, emailcheck, emailcode, imageurl, mailer, models, schemas, security, serializers, sensitive, storage_quota
from ..deps import get_active_user, get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/users", tags=["users"])

# 注册后还能补填邀请码的时限（站长 2026-10-01）
INVITE_FILL_HOURS = 24


def _naive_utc(dt: datetime | None) -> datetime:
    """统一成「无时区 UTC」。

    ⚠️ 踩过：`models.now()` 返回的是**带时区**的 datetime，而库里的 created_at 读出来是 **naive**，
    两者直接相减会抛 TypeError（接口 500）。比较时间一律先过这个函数。
    """
    if dt is None:
        return models.now().replace(tzinfo=None)
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def _inviter_by_code(db: Session, code: str) -> models.User | None:
    """把用户填的「邀请码」解析成邀请人。

    注册接口（auth.register / register-codemao）里一直只认 **username**，
    这里保持一致，并额外允许填 **UID**（个人主页上显示的就是 UID，大家更容易分享它）。
    """
    code = (code or "").strip().lstrip("@")
    if not code:
        return None
    u = db.query(models.User).filter(models.User.username == code).first()
    if u is None and code.isdigit():
        u = db.query(models.User).filter(models.User.uid == code).first()
    return u


@router.get("/me/invite-code")
def my_invite_state(db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    """我还能不能补填邀请码 / 已经填的是谁（账号设置与经验中心那块卡片用）。"""
    inviter = db.get(models.User, current.invited_by) if current.invited_by else None
    created = _naive_utc(current.created_at)
    deadline = created + timedelta(hours=INVITE_FILL_HOURS)
    left = deadline - _naive_utc(models.now())
    return {
        "filled": bool(current.invited_by),
        "inviter": serializers.user_brief(inviter) if inviter else None,
        "can_fill": bool(current.invited_by is None and left.total_seconds() > 0),
        "deadline": deadline.isoformat(),
        "hours_left": max(0, int(left.total_seconds() // 3600)),
        "window_hours": INVITE_FILL_HOURS,
        "invite_xp": serializers.INVITE_XP,
    }


@router.post("/me/invite-code")
def fill_invite_code(body: dict, db: Session = Depends(get_db), current: models.User = Depends(get_active_user)):
    """补填邀请码（注册后 24 小时内，且没填过）。

    站长 2026-10-01：「用编程猫账号注册没办法填写邀请码 —— 注册之后 24 小时内可以补填」。
    编程猫注册（含扫码/免密登录时自动建号）那条路没有填码的界面，所以在注册后留一个补填窗口。

    奖励不用另发：邀请经验是**按 `users.invited_by` 的条数算出来的**（见 serializers.xp_breakdown），
    所以这里把 invited_by 写上去，邀请人立刻 +INVITE_XP，而且天然幂等、不会重复发。
    """
    if current.invited_by:
        raise HTTPException(status_code=400, detail="你已经填过邀请码了")
    created = _naive_utc(current.created_at)
    if _naive_utc(models.now()) - created > timedelta(hours=INVITE_FILL_HOURS):
        raise HTTPException(status_code=400, detail=f"注册已超过 {INVITE_FILL_HOURS} 小时，不能再补填邀请码")

    code = (body or {}).get("invite_code") or ""
    if not (code or "").strip():
        raise HTTPException(status_code=400, detail="请填写邀请码")
    inviter = _inviter_by_code(db, code)
    if inviter is None:
        raise HTTPException(status_code=400, detail="邀请码无效")
    if inviter.id == current.id:
        raise HTTPException(status_code=400, detail="不能填写自己的邀请码")
    if inviter.effective_banned:
        raise HTTPException(status_code=400, detail="该邀请码不可用")

    current.invited_by = inviter.id
    db.commit()
    # 通知邀请人（与注册时同样的一句）；XP 是按条数实时算的，不需要另外发放
    try:
        serializers.notify_user(
            db, inviter.id, current.id, "admin", None, None,
            f"你邀请的 {current.display_name} 填了你的邀请码，获得 {serializers.INVITE_XP} 经验奖励！",
        )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "inviter": serializers.user_brief(inviter), "gained_xp": serializers.INVITE_XP}


# ==================== 账号存储空间（账号设置里查询/申请） ====================
# 规则在 app/storage_quota.py：默认 500MB，算的是这个账号上传的**全部**文件
# （.sb3 源文件、头像/背景、封面、帖子与评论配图、聊天图片与语音、反馈附件…），
# 剩余不足 50MB 才能申请扩容，管理员在后台审批。旧的「只算 sb3 的 200MB」机制已作废。
@router.get("/me/storage")
def my_storage(db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    """我的存储用量（含分类明细）/ 配额 / 能不能申请 / 待审与历史。"""
    return storage_quota.serialize(db, current)


@router.post("/me/storage/apply")
def apply_storage(
    body: dict | None = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    """提交扩容申请（剩余空间不足 50MB 才有资格）。"""
    try:
        r = storage_quota.apply_for_more(db, current, (body or {}).get("message") or "")
    except storage_quota.QuotaError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "request": storage_quota.serialize_request(r, current.nickname or "")}


# 旧路径保留为别名（老前端/缓存里的页面仍能打开；口径已经是新的存储空间）
@router.get("/me/scratch-quota")
def my_scratch_quota_alias(db: Session = Depends(get_db), current: models.User = Depends(get_current_user)):
    return storage_quota.serialize(db, current)


@router.post("/me/scratch-quota/apply")
def apply_scratch_quota_alias(
    body: dict | None = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    return apply_storage(body, db, current)


def _user_by_uid(db: Session, uid: str) -> models.User | None:
    """按对外用户ID（uid）查找用户。"""
    return db.query(models.User).filter(models.User.uid == uid).first()


@router.get("")
def list_users(
    q: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    query = db.query(models.User)
    if q:
        query = query.filter(models.User.username.contains(q) | models.User.nickname.contains(q))
    users = query.order_by(models.User.id.desc()).offset(skip).limit(min(limit, 100)).all()
    return [serializers.user_brief(u) for u in users]


@router.get("/me/xp_detail")
@router.get("/me/xp_center")
def xp_center(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """经验中心：等级 / 进度 / 经验来源明细 / 小鱼干与签到状态 / 等级说明表。

    「经验明细」和「等级说明弹窗」原本是两处，现在都从这里出。
    """
    info = serializers.level_info(db, user)
    xp = info["xp"]
    lv = info["level"]
    b = serializers.xp_breakdown(db, user)
    today = models.now().strftime("%Y-%m-%d")
    detail = [
        {"key": "signin", "label": "每日签到", "count": b["signin_days"], "each": serializers.SIGNIN_XP, "total": b["signin"]},
        {"key": "feed_given", "label": "投喂他人", "count": (b["feed_given"] // serializers.FEED_GIVE_XP), "each": serializers.FEED_GIVE_XP, "total": b["feed_given"]},
        {"key": "feed_received", "label": "被投喂", "count": b["feed_received_fish"], "each": serializers.FEED_RECEIVE_XP, "total": b["feed_received"]},
        {"key": "invite", "label": "邀请好友", "count": b["invite_count"], "each": serializers.INVITE_XP, "total": b["invite"]},
        {"key": "event", "label": "活动奖励", "count": b["event_count"], "each": None, "total": b["event"]},
        {"key": "codemao", "label": "编程猫等级奖励", "count": user.codemao_xp_level or 0, "each": None, "total": b["codemao"]},
        {"key": "bind", "label": "绑定奖励", "count": sum(
            1 for k in serializers.BIND_REWARDS if serializers.bind_claimed_at(user, k) is not None
        ), "each": None, "total": b["bind"]},
        {"key": "other", "label": "其他奖励", "count": 1, "each": b["other"], "total": b["other"]},
    ]
    return {
        "level": lv,
        "level_name": info["level_name"],
        "level_color": info["level_color"],
        "xp": xp,
        "total": xp,  # 老字段，兼容旧客户端
        "detail": detail,
        "treaty": bool(user.treaty_signed_at),
        "progress": serializers.level_progress(xp, lv),
        "fish_count": user.fish_count or 0,
        "daily_fish": serializers.daily_fish_for(lv),
        "signed_today": user.last_fish_date == today,
        "signin_days": b["signin_days"],
        "feed_today_xp": serializers.feed_xp_today(db, user),
        "feed_daily_cap": serializers.FEED_GIVE_DAILY_XP,
        # 等级说明表：文案由前端按 key 翻译
        "levels": [
            {
                "level": n,
                "threshold": None if n < 2 else serializers._LEVEL_THRESHOLDS[n - 2],
                "daily_fish": serializers.daily_fish_for(n),
            }
            for n in range(8)
        ],
    }


@router.post("/me/signin")
def signin(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """每日签到：+10 经验，并按等级发小鱼干（LV0 是 0 个）。一天只能签一次。"""
    today = models.now().strftime("%Y-%m-%d")
    if user.last_fish_date == today:
        raise HTTPException(status_code=400, detail="今天已经签到过了，明天再来")
    level = serializers.level_info(db, user)["level"]
    fish = serializers.daily_fish_for(level)
    user.fish_count = (user.fish_count or 0) + fish
    user.signin_days = (user.signin_days or 0) + 1
    user.last_fish_date = today
    db.commit()
    return {
        "fish_gained": fish,
        "xp_gained": serializers.SIGNIN_XP,
        "signin_days": user.signin_days,
        "fish_count": user.fish_count,
        "level": level,
    }


# ---- 编程猫作者等级奖励（经验中心的「一键加满」）----
# 规则见 serializers 顶部的 CODEMAO_* ：编程猫 N 级 -> 本站保底 LV(N+1)，3/4/5 级有奖励。
# 一次性领取写进 users.codemao_xp_bonus，解绑编程猫号也不回收；编程猫等级升上去可以再领一次补差额。
def _codemao_level_state(user: models.User, db: Session, level: int) -> dict:
    """把「编程猫等级 + 我方已领状态」拼成前端要的一份数据。"""
    target_level = serializers.codemao_target_level(level)
    target_xp = serializers.codemao_target_xp(level)
    current_xp = serializers.user_xp(db, user)
    claimed = user.codemao_xp_level or 0
    # 只有「这个编程猫等级还没领过」且「确实有奖励」才可领
    claimable = target_level is not None and level > claimed
    need = max(0, (target_xp or 0) - current_xp) if claimable else 0
    return {
        "author_level": level,
        "badge_url": serializers.codemao_badge_url(level),
        "badge_name": serializers.CODEMAO_BADGE_NAMES.get(level),
        "reward_target_level": target_level,
        "reward_target_xp": target_xp,
        "claimed_level": claimed,
        "claimable": claimable,
        "claim_need_xp": need,
        "bonus": user.codemao_xp_bonus or 0,
        "current_xp": current_xp,
    }


@router.get("/me/codemao_level")
def my_codemao_level(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """读当前绑定的编程猫账号的作者等级 + 徽章 + 可领取状态。

    ⚠️ 读的是编程猫非公开接口，随时可能失效。所以这里**永不抛错**：
    拿不到就回 `error` 字段，前端显示「暂时读不到」并禁用按钮，不影响经验中心其它内容。
    """
    out = {
        "bound": bool(user.codemao_uid),
        "uid": user.codemao_uid,
        "nickname": user.codemao_nickname or "",
        "author_level": 0,
        "badge_url": None,
        "badge_name": None,
        "reward_target_level": None,
        "reward_target_xp": None,
        "claimed_level": user.codemao_xp_level or 0,
        "claimable": False,
        "claim_need_xp": 0,
        "bonus": user.codemao_xp_bonus or 0,
        "current_xp": serializers.user_xp(db, user),
        "error": None,
    }
    if not user.codemao_uid:
        out["error"] = "not_bound"
        return out
    try:
        info = codemao.codemao_honor(user.codemao_uid)
    except codemao.CodemaoError:
        out["error"] = "unavailable"
        return out
    out.update(_codemao_level_state(user, db, int(info.get("author_level") or 0)))
    out["nickname"] = info.get("nickname") or out["nickname"]
    # 顺手把等级缓存到用户行：个人主页展示徽章时只读这份缓存，不再去调编程猫接口
    user.codemao_author_level = int(info.get("author_level") or 0)
    user.codemao_level_at = models.now()
    db.commit()
    return out


@router.post("/me/codemao_level/claim")
def claim_codemao_level(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """一键把经验加满到编程猫等级对应的本站保底等级。

    等级一律**现读编程猫接口**，不信前端传来的数字；`use_cache=False` 保证拿到的是最新值。
    """
    if not user.codemao_uid:
        raise HTTPException(status_code=400, detail="还没有绑定编程猫账号，先绑定再来")

    try:
        info = codemao.codemao_honor(user.codemao_uid, use_cache=False)
    except codemao.CodemaoError as e:
        raise HTTPException(status_code=503, detail=f"暂时读不到你的编程猫等级，稍后再试（{e}）")

    level = int(info.get("author_level") or 0)
    state = _codemao_level_state(user, db, level)
    claimed = state["claimed_level"]

    if state["reward_target_level"] is None:
        if level < serializers.CODEMAO_BADGE_MIN or level > serializers.CODEMAO_BADGE_MAX:
            raise HTTPException(status_code=400, detail="还没读到你的编程猫作者等级，过一会儿再试")
        raise HTTPException(status_code=400, detail=f"编程猫「{state['badge_name']}」还没有对应的等级奖励，先在编程猫创作得更厉害吧")

    if level <= claimed:
        target = level + 1
        raise HTTPException(status_code=400, detail=f"编程猫 Lv{level} 的奖励你已经领过了；等你升到更高级再来（当前保底 LV{target}）")

    need = state["claim_need_xp"]
    user.codemao_xp_bonus = (user.codemao_xp_bonus or 0) + need
    # 即使 need == 0（自己攒的经验已经超过保底线）也要记下来，避免反复点
    user.codemao_xp_level = level
    db.commit()

    new_xp = serializers.user_xp(db, user)
    new_info = serializers.level_info(db, user)
    return {
        "gained": need,
        "xp_before": state["current_xp"],
        "total_xp": new_xp,
        "level": new_info["level"],
        "level_name": new_info["level_name"],
        "bonus": user.codemao_xp_bonus or 0,
        "claimed_level": user.codemao_xp_level or 0,
        "target_level": state["reward_target_level"],
        "already_above": need == 0,
    }


# ---- 绑定奖励（经验中心：绑一项领一次，每项只能领一次）----
# 规则见 serializers.BIND_REWARDS：编程猫 100 / GitHub 20 / 邮箱 50。
# 「已绑定」看绑定关系本身，「已领取」看领取时间列 —— 两者独立，所以解绑之后仍然算领过。
def _bind_reward_state(user: models.User, db: Session) -> list[dict]:
    current_xp = serializers.user_xp(db, user)
    out = []
    for key, meta in serializers.BIND_REWARDS.items():
        bound = serializers.bind_bound(user, key)
        claimed_at = serializers.bind_claimed_at(user, key)
        out.append({
            "key": key,
            "xp": meta["xp"],
            "bound": bound,
            "claimed": claimed_at is not None,
            "claimed_at": claimed_at.isoformat() if claimed_at else None,
            # 绑定 + 没领过 = 可领；没绑定就先引导去绑定，领过的就不再显示按钮
            "claimable": bool(bound and claimed_at is None),
        })
    return {"items": out, "total": serializers.bind_xp_total(user), "current_xp": current_xp}


@router.get("/me/bind_rewards")
def my_bind_rewards(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """经验中心的「绑定奖励」：三项各自的绑定/领取状态与能领多少。"""
    return _bind_reward_state(user, db)


@router.post("/me/bind_rewards/claim")
def claim_bind_reward(body: schemas.BindClaimIn, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """领取某一项绑定奖励。已领过 / 没绑定都会被拒。"""
    key = (body.key or "").strip()
    meta = serializers.BIND_REWARDS.get(key)
    if meta is None:
        raise HTTPException(status_code=400, detail="没有这个绑定奖励")

    if serializers.bind_claimed_at(user, key) is not None:
        raise HTTPException(status_code=400, detail="这一项奖励已经领过了")
    if not serializers.bind_bound(user, key):
        raise HTTPException(status_code=400, detail="还没有绑定，先绑定再来领取")

    # 用服务器时间记一笔，经验由 bind_xp_total() 从这一列算出来
    setattr(user, meta["column"], models.now())
    db.commit()
    db.refresh(user)

    info = serializers.level_info(db, user)
    return {
        "key": key,
        "gained": meta["xp"],
        "total_xp": info["xp"],
        "level": info["level"],
        "level_name": info["level_name"],
        "bind_total": serializers.bind_xp_total(user),
    }


@router.get("/me/recommend")
def recommend_users(limit: int = 10, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """推荐关注：同领域标签 / 同工作室成员（排除已关注）。"""
    followed = {r[0] for r in db.query(models.Follow.following_id).filter(models.Follow.follower_id == user.id).all()}
    followed.add(user.id)
    score: dict[int, int] = {}
    # 同工作室成员
    my_studio_ids = [r[0] for r in db.query(models.StudioMember.studio_id).filter(models.StudioMember.user_id == user.id, models.StudioMember.status == "active").all()]
    if my_studio_ids:
        rows = db.query(models.StudioMember.user_id).filter(models.StudioMember.studio_id.in_(my_studio_ids), models.StudioMember.status == "active").all()
        for (uid,) in rows:
            if uid not in followed:
                score[uid] = score.get(uid, 0) + 3
    # 同领域标签
    my_interest = {t for t in (user.interests or "").split(",") if t.strip()}
    if my_interest:
        candidates = db.query(models.User).filter(models.User.interests != "").all()
        for u in candidates:
            if u.id in followed:
                continue
            inter = {t for t in (u.interests or "").split(",") if t.strip()}
            overlap = len(inter & my_interest)
            if overlap:
                score[u.id] = score.get(u.id, 0) + overlap
    ranked = sorted(score.items(), key=lambda x: -x[1])[:limit]
    result = []
    for uid, sc in ranked:
        u = db.get(models.User, uid)
        if u:
            result.append({**serializers.user_brief(u), "reason": f"相关度 {sc}"})
    return result


@router.get("/blocks")
def my_blocks(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """我的拉黑列表（须在 /{uid} 前注册避免被捕获）。"""
    rows = db.query(models.UserBlock).filter_by(blocker_id=user.id).all()
    return [serializers.user_brief(db.get(models.User, r.blocked_id)) for r in rows if db.get(models.User, r.blocked_id) is not None]


@router.get("/{uid}")
def get_user(
    uid: str,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    user = _user_by_uid(db, uid)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 被对方拉黑：只返回基础信息，标记 blocked
    if current and db.query(models.UserBlock).filter_by(blocker_id=user.id, blocked_id=current.id).first():
        data = serializers.user_brief(user)
        data["blocked"] = True
        return data
    return serializers.user_public(user, db, current.id if current else None)


@router.patch("/me")
def update_me(
    body: schemas.UserUpdate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    if body.nickname is not None:
        new_nick = body.nickname.strip()
        if sensitive.contains_sensitive(new_nick, db):
            hits = sensitive.find_sensitive(new_nick, db)
            raise HTTPException(status_code=400, detail=f"昵称包含敏感词：{'、'.join(hits[:5])}，请更换")
        user.nickname = new_nick
    if body.avatar_url is not None:
        av = (body.avatar_url or "").strip()
        # 编程猫头像（外链）：与已绑定账号一致时放行，其余头像必须是本站上传
        if av and user.codemao_avatar and av == user.codemao_avatar:
            user.avatar_url = av
        else:
            user.avatar_url = imageurl.check_uploaded_image(av, "头像")
    if body.cover_url is not None:
        user.cover_url = imageurl.check_uploaded_image(body.cover_url, "背景图")
    if body.show_cover is not None:
        user.show_cover = body.show_cover
    # ---- 徽章展示（站长 2026-09-30：两个徽章只能选一个，默认编程猫）----
    # 新字段 badge_choice 为准；旧的两个布尔仍接受（映射到 badge_choice），
    # 这样还在跑旧前端缓存的用户点开关也不会失灵。
    if body.badge_choice is not None:
        if body.badge_choice not in serializers.BADGE_CHOICES:
            raise HTTPException(status_code=400, detail="徽章只能选：编程猫 / 本站 / 不展示")
        user.badge_choice = body.badge_choice
        user.show_level_badge = body.badge_choice == "site"
        user.show_codemao_badge = body.badge_choice == "codemao"
    if body.show_level_badge is not None and body.badge_choice is None:
        user.badge_choice = "site" if body.show_level_badge else "none"
        user.show_level_badge = body.show_level_badge
        user.show_codemao_badge = False
    if body.show_codemao_badge is not None and body.badge_choice is None:
        user.badge_choice = "codemao" if body.show_codemao_badge else "none"
        user.show_codemao_badge = body.show_codemao_badge
        user.show_level_badge = False
    if serializers.badge_choice(user) == "codemao" and user.codemao_uid and (
        body.badge_choice is not None or body.show_codemao_badge is not None
    ):
        # 选中编程猫徽章时顺手读一次编程猫等级并缓存下来。
        # 为什么在这里读而不是渲染主页时读：个人主页是高频只读页面，
        # 不能为了一个徽章去等第三方接口（最长要 15 秒），读不到就先只存选择，
        # 等用户在经验中心读到等级后徽章自然出现。
        try:
            info = codemao.codemao_honor(user.codemao_uid)
            user.codemao_author_level = int(info.get("author_level") or 0)
            user.codemao_level_at = models.now()
        except codemao.CodemaoError:
            pass
    if body.bio is not None:
        user.bio = body.bio
    if body.gender is not None:
        user.gender = body.gender if body.gender in ("male", "female", "secret") else None
    if body.show_personal is not None:
        user.show_personal = body.show_personal
    if body.show_ip_region is not None:
        # 关掉只是不再对外展示；已识别的属地值保留，重新打开立刻就有，不用等下次访问。
        user.show_ip_region = body.show_ip_region
    db.commit()
    db.refresh(user)
    return serializers.user_public(user, db, user.id)


# ---- 编程猫账号绑定 / 解绑 ----
@router.get("/me/codemao-works")
def my_codemao_works(response: Response, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """拉取当前用户绑定编程猫账号的作品列表，并**标出哪些已经在本站投过稿**。

    为什么要在后端标：本站 `works.editor_work_id` 存的就是编程猫作品 id，
    只有后端能一次把「自己投过的 / 别人投过的」都查出来；前端逐条比对既慢又可能漏。

    ⚠️ 2026-09-23 修：这里原来写死 `limit=20` 且只请求一页，作品超过 20 个的人
    第 21 个之后**永远导入不了**。现在翻页取全，并回 `X-Total-Count`（编程猫报的总数）
    与 `X-Truncated`（是否被我们自己的上限截断）。

    返回每一项额外带：
        imported            bool  自己已经投过稿
        imported_work_id    int   那条稿件的 id（前端可直接跳过去看）
        imported_status     str   published / pending / rejected，用来决定文案
                                   （rejected 表示上次没过审，应该允许重新投）
        imported_by_others  bool  别人投过同一个编程猫作品（只作提示，不拦）
    """
    if not user.codemao_uid:
        raise HTTPException(status_code=400, detail="请先绑定编程猫账号")
    data = codemao.codemao_work_list_all(user.codemao_uid)
    works = data["items"]
    response.headers["X-Total-Count"] = str(data["total"])
    response.headers["X-Loaded-Count"] = str(len(works))
    response.headers["X-Truncated"] = "1" if data["truncated"] else "0"
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count, X-Loaded-Count, X-Truncated"
    if not works:
        raise HTTPException(status_code=404, detail="未能获取编程猫作品，可能账号未发布作品或接口暂时不可用")

    ids = [str(w["id"]) for w in works if w.get("id") is not None]
    mine: dict[str, tuple[int, str]] = {}
    for wid, pid, status in db.query(
        models.Work.editor_work_id, models.Work.id, models.Work.status
    ).filter(
        models.Work.user_id == user.id, models.Work.editor_work_id.in_(ids)
    ).all():
        # 同一个编号只可能有一条，保险起见留最早那条
        key = str(wid)
        if key not in mine:
            mine[key] = (pid, status or "published")

    others = {
        str(r[0])
        for r in db.query(models.Work.editor_work_id)
        .filter(models.Work.user_id != user.id, models.Work.editor_work_id.in_(ids))
        .all()
    }

    for w in works:
        key = str(w.get("id"))
        hit = mine.get(key)
        w["imported"] = hit is not None
        w["imported_work_id"] = hit[0] if hit else None
        w["imported_status"] = hit[1] if hit else None
        w["imported_by_others"] = key in others
    return works


@router.get("/me/codemao-works/{work_id}")
def my_codemao_work_detail(work_id: str, user: models.User = Depends(get_current_user)):
    """拉单个编程猫作品的详情，用来「选中即自动填好编辑器 + 播放地址」。

    ⚠️ 为什么要单独一个接口：列表接口只给数字 type，**分不出 Kitten3 / Kitten4**（都是 1）。
    实测只有详情接口返回字符串 type（NEKO / KITTEN4 / KITTEN3 / NEMO）和权威 player_url。
    也只有拉到详情，导入时才不会把编辑器选错（这正是以前导入经常填错的根因）。
    """
    if not user.codemao_uid:
        raise HTTPException(status_code=400, detail="请先绑定编程猫账号")
    try:
        detail = codemao.codemao_work_detail(work_id)
    except codemao.CodemaoError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # supported=False 表示编程猫这个编辑器本站还没有对应项（例如三维的 NEMO），
    # 前端要给出明确提示而不是硬填一个错的编辑器。
    detail["supported"] = detail["editor_code"] is not None
    return detail



@router.post("/me/bind-codemao")
def bind_codemao(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """绑定编程猫账号：验证账号 -> 绑定 uid 并同步昵称/头像。密码即用即弃。

    ★ 绑定成功即**激活账号**：待激活状态（awaiting_passport / pending_review / rejected）
    一律置回 ok —— 站长定的规则是「GitHub 注册的新号，绑定编程猫账号**或**过护照审核，
    二者其一即可」。会读编程猫密码并验证，等于证明了本人持有该编程猫账号。
    这也是与 verify.py 里「护照审核通过」并列的另一条激活路径，状态机常量保持一致。
    """
    try:
        info = codemao.codemao_login(body.get("identity") or "", body.get("password") or "")
    except codemao.CodemaoError as e:
        raise HTTPException(status_code=400, detail=str(e))
    other = db.query(models.User).filter(models.User.codemao_uid == info["uid"], models.User.id != user.id).first()
    if other:
        raise HTTPException(status_code=400, detail="该编程猫账号已绑定其他用户")
    was_locked = (user.verify_state or "ok") != "ok"
    user.codemao_uid = info["uid"]
    user.codemao_nickname = info["nickname"]
    user.codemao_avatar = info["avatar"]
    # 同步编程猫昵称/头像（头像下载到本站，避免外链失效）
    if info["nickname"]:
        user.nickname = info["nickname"]
    local_avatar = codemao.save_avatar_locally(info["avatar"], user.id)
    if info["avatar"]:
        user.avatar_url = local_avatar or info["avatar"]
    if was_locked:
        # 激活：与 verify.py 的 STATE_OK 同值（"ok"）
        user.verify_state = "ok"
        user.verify_note = ""
        user.verify_reviewed_at = models.now()
        user.verify_reviewed_by = None  # 自助激活，不是管理员审的
    db.commit()
    db.refresh(user)
    if was_locked:
        serializers.notify_user(
            db, user.id, None, "admin", "user", user.id,
            "你已经绑定编程猫账号，账号激活完成，现在可以正常发内容了。",
        )
        db.commit()
    return serializers.user_public(user, db, user.id)


@router.post("/me/unbind-codemao")
def unbind_codemao(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """解绑编程猫账号（保留本站资料）。"""
    user.codemao_uid = None
    user.codemao_nickname = ""
    user.codemao_avatar = None
    db.commit()
    db.refresh(user)
    return serializers.user_public(user, db, user.id)


# ---- 绑定 / 换绑 / 解绑邮箱 ----
# 流程：给「要绑定的新邮箱」发一封验证码 → 带验证码提交 → 生效。
# 为什么要验证码而不是直接改：邮箱是找回密码的唯一凭据，
# 只验「当前登录态」不够——会话被偷的人可以绑自己的邮箱，再用找回密码把号整走。
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_password_if_set(user: models.User, password: str | None) -> None:
    """账号设过本站密码就必须验一次当前密码；编程猫自动建号（没设过密码）跳过。"""
    if user.local_pwd_set and not security.verify_password(password or "", user.hashed_password):
        raise HTTPException(status_code=400, detail="当前密码不正确")


@router.post("/me/email/send-code")
def send_bind_code(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """给「准备绑定的新邮箱」发验证码。需要登录。"""
    email = (body.get("email") or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="邮箱地址格式不正确，请检查后重试")
    if config.is_real_email(user.email) and email == (user.email or "").strip().lower():
        raise HTTPException(status_code=400, detail="这就是你当前绑定的邮箱，无需重复绑定")

    taken = db.query(models.User).filter(models.User.email == email, models.User.id != user.id).first()
    if taken is not None:
        raise HTTPException(status_code=400, detail="这个邮箱已经被其他账号绑定了，请换一个")

    # 邮箱预检（格式 / 一次性邮箱 / MX）：第三方接口不可用时自动放行
    reason = emailcheck.check(email)
    if reason:
        raise HTTPException(status_code=400, detail=emailcheck.message(reason))

    try:
        emailcode.precheck("bind", email)
    except emailcode.CodeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    lang = (body.get("lang") or "").strip().lower()[:8] or (user.reg_lang or "").strip().lower()[:8]
    code = emailcode.put("bind", email)
    subject, html, text, images = mailer.verify_code_email(
        code, purpose="bind", ttl_minutes=emailcode.CODE_TTL // 60, lang=lang
    )
    try:
        mailer.send_email(to=email, subject=subject, html=html, text=text, images=images)
    except mailer.MailError as e:
        emailcode.drop("bind", email)  # 没发出去就别占着冷却与每日额度
        raise HTTPException(status_code=503, detail=str(e))

    return {"ok": True, "email": email, "ttl": emailcode.CODE_TTL, "cooldown": emailcode.RESEND_COOLDOWN}


@router.post("/me/email")
def change_email(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """绑定 / 换绑邮箱：校验发到新邮箱的验证码（+ 设过密码的账号还要验当前密码）。"""
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="邮箱地址格式不正确，请检查后重试")
    if config.is_real_email(user.email) and email == (user.email or "").strip().lower():
        raise HTTPException(status_code=400, detail="这就是你当前绑定的邮箱，无需重复绑定")

    taken = db.query(models.User).filter(models.User.email == email, models.User.id != user.id).first()
    if taken is not None:
        raise HTTPException(status_code=400, detail="这个邮箱已经被其他账号绑定了，请换一个")

    # 先验密码再验验证码：密码打错不该白扣一次验证码的试错次数
    _check_password_if_set(user, body.get("password"))

    try:
        emailcode.check("bind", email, code)
    except emailcode.CodeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    user.email = email
    db.commit()
    db.refresh(user)
    emailcode.consume("bind", email)
    return serializers.user_public(user, db, user.id)


@router.post("/me/email/unbind")
def unbind_email(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """解绑邮箱：写回不可达的占位地址。

    不会把人锁在外面 —— 登录支持「用户名 + 密码」，编程猫账号也还能用编程猫登录；
    但**会失去邮箱找回密码的能力**，前端要明确提示。
    """
    if not config.is_real_email(user.email):
        raise HTTPException(status_code=400, detail="当前没有绑定邮箱")
    _check_password_if_set(user, (body or {}).get("password"))
    user.email = config.unbound_placeholder(user.id)
    db.commit()
    db.refresh(user)
    return serializers.user_public(user, db, user.id)


@router.post("/me/github/unbind")
def unbind_github(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """解绑 GitHub。

    注意：解绑前必须保证账号还有别的登录方式，否则等于把用户锁在门外。
    危险组合 = 没有真实邮箱 + 没设过本站密码 + 也没绑编程猫 + 这次解绑的是唯一的第三方登录。
    """
    if not user.github_id:
        raise HTTPException(status_code=400, detail="当前没有绑定 GitHub")
    has_real_email = config.is_real_email(user.email)
    has_pwd = bool(user.local_pwd_set)
    has_codemao = bool(user.codemao_uid)
    if not has_real_email and not has_pwd and not has_codemao:
        raise HTTPException(
            status_code=400,
            detail="解绑后你将无法登录：请先在「账号设置」里绑定邮箱或设置本站密码，再来解绑 GitHub",
        )
    user.github_id = None
    user.github_login = ""
    user.github_avatar = None
    db.commit()
    db.refresh(user)
    return serializers.user_public(user, db, user.id)


@router.post("/me/logout_all")
def logout_all(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """退出所有设备：token 版本 +1，旧 token 全部失效。"""
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    return {"ok": True}


@router.post("/me/deactivate")
def deactivate_account(body: dict, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """注销账号（软注销）：校验密码后隐藏账号与内容。"""
    password = body.get("password") or ""
    if not security.verify_password(password, user.hashed_password):
        raise HTTPException(status_code=400, detail="密码不正确")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="管理员账号不能注销")
    user.is_deactivated = True
    user.deactivated_at = models.now()
    user.nickname = ""
    user.avatar_url = None
    user.cover_url = None
    user.bio = ""
    user.email = f"deleted{user.id}@deleted.local"
    user.featured_work_ids = ""
    user.token_version = (user.token_version or 0) + 1  # 注销即吊销所有已签发 token
    db.commit()
    return {"ok": True}


@router.get("/me/notify_prefs")
def get_notify_prefs(user: models.User = Depends(get_current_user)):
    return user.notify_prefs_dict


@router.put("/me/notify_prefs")
def set_notify_prefs(body: dict, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    import json

    # chat_dm / chat_group / chat_sound = 聊天消息通知（私聊 / 群聊）与新消息提示音，默认开启
    allowed = {"like", "comment", "reply", "follow", "mention", "studio", "chat_dm", "chat_group", "chat_sound"}
    prefs = user.notify_prefs_dict
    for k, v in body.items():
        if k in allowed:
            prefs[k] = bool(v)
    # 免打扰时段是嵌套字典，原来没有单独处理 —— 前端一直在提交 quiet，但这里被 allowed 过滤掉了，
    # 等于「免打扰时段」这个设置**从来没存进过库**（quiet_hours_active 永远读到空）。
    if isinstance(body.get("quiet"), dict):
        q = body["quiet"]
        try:
            start = int(q.get("start", (prefs.get("quiet") or {}).get("start", 22))) % 24
            end = int(q.get("end", (prefs.get("quiet") or {}).get("end", 8))) % 24
        except (TypeError, ValueError):
            start, end = 22, 8
        prefs["quiet"] = {"on": bool(q.get("on")), "start": start, "end": end}
    prefs["admin"] = True  # 管理员通知不可关闭
    user.notify_prefs = json.dumps(prefs)
    db.commit()
    return user.notify_prefs_dict


@router.post("/{uid}/block")
def block_user(uid: str, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """拉黑用户：对方的内容全站不可见。"""
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="不能拉黑自己")
    if db.query(models.UserBlock).filter_by(blocker_id=user.id, blocked_id=target.id).first() is None:
        db.add(models.UserBlock(blocker_id=user.id, blocked_id=target.id))
        db.commit()
    return {"blocked": True}


@router.delete("/{uid}/block", status_code=204)
def unblock_user(uid: str, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    target = _user_by_uid(db, uid)
    if target:
        db.query(models.UserBlock).filter_by(blocker_id=user.id, blocked_id=target.id).delete()
        db.commit()


@router.post("/{uid}/follow")
def follow_user(
    uid: str,
    body: dict | None = None,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="不能关注自己")
    serializers.check_level(db, user, 1, "关注他人")
    if serializers.level_info(db, target)["level"] < 1:
        raise HTTPException(status_code=400, detail="该用户暂未开放关注（LV0 纯浏览权限）")
    silent = bool((body or {}).get("silent"))
    grp = (body or {}).get("group") or ""
    if grp not in ("", "好友", "大神", "同事"):
        grp = ""
    exists = db.query(models.Follow).filter_by(follower_id=user.id, following_id=target.id).first()
    if exists is None:
        db.add(models.Follow(follower_id=user.id, following_id=target.id, silent=silent, grp=grp))
        db.commit()
        if not silent:
            serializers.notify_user(db, target.id, user.id, "follow", "user", target.id, "关注了你")
        # 互关提醒：对方已经关注了你
        mutual = db.query(models.Follow).filter_by(follower_id=target.id, following_id=user.id).first()
        if mutual:
            serializers.notify_user(db, user.id, target.id, "follow", "user", user.id, f"{target.display_name} 也关注了你，你们互相关注了！")
            serializers.notify_user(db, target.id, user.id, "follow", "user", target.id, f"{user.display_name} 也关注了你，你们互相关注了！")
    else:
        if body:
            exists.silent = silent
            exists.grp = grp
            db.commit()
    return {"following": True}


@router.delete("/{uid}/follow")
def unfollow_user(
    uid: str,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.query(models.Follow).filter_by(follower_id=user.id, following_id=target.id).delete()
    db.commit()
    return {"following": False}


def _follow_rows_out(db: Session, user_ids: list[int], current: models.User | None) -> list[dict]:
    """把用户 id 列表转成简要资料，并补上「我是否已关注 TA」。"""
    if not user_ids:
        return []
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all()}
    following: set[int] = set()
    if current is not None:
        following = {
            r[0]
            for r in db.query(models.Follow.following_id)
            .filter(models.Follow.follower_id == current.id, models.Follow.following_id.in_(user_ids))
            .all()
        }
    out = []
    for uid_ in user_ids:  # 保持传入顺序（按关注时间倒序）
        u = users.get(uid_)
        if u is None:
            continue
        brief = serializers.user_brief(u)
        brief["is_following"] = u.id in following
        out.append(brief)
    return out


@router.get("/{uid}/followers")
def followers(
    uid: str,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    ids = [
        r[0]
        for r in db.query(models.Follow.follower_id)
        .filter(models.Follow.following_id == target.id)
        .order_by(models.Follow.id.desc())
        .all()
    ]
    return _follow_rows_out(db, ids, current)


@router.get("/{uid}/following")
def following(
    uid: str,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    target = _user_by_uid(db, uid)
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    ids = [
        r[0]
        for r in db.query(models.Follow.following_id)
        .filter(models.Follow.follower_id == target.id)
        .order_by(models.Follow.id.desc())
        .all()
    ]
    return _follow_rows_out(db, ids, current)


# ---- 我的点赞 / 评论 / 收藏 ----
@router.get("/me/likes")
def my_likes(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    likes = (
        db.query(models.Like)
        .filter(models.Like.user_id == user.id, models.Like.target_type.in_(["work", "post"]))
        .order_by(models.Like.id.desc())
        .limit(100)
        .all()
    )
    result = []
    for l in likes:
        if l.target_type == "work":
            w = db.get(models.Work, l.target_id)
            if w:
                item = serializers.work_out(w, db, user.id)
                item["liked_at"] = l.created_at.isoformat() if l.created_at else None
                result.append({"kind": "work", "data": item})
        else:
            p = db.get(models.Post, l.target_id)
            if p:
                item = serializers.post_out(p, db, user.id)
                item["liked_at"] = l.created_at.isoformat() if l.created_at else None
                result.append({"kind": "post", "data": item})
    return result


@router.get("/me/comments")
def my_comments(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    pc = (
        db.query(models.PostComment)
        .filter(models.PostComment.user_id == user.id)
        .order_by(models.PostComment.id.desc())
        .limit(100)
        .all()
    )
    wc = (
        db.query(models.WorkComment)
        .filter(models.WorkComment.user_id == user.id)
        .order_by(models.WorkComment.id.desc())
        .limit(100)
        .all()
    )
    result = []
    for c in pc:
        item = serializers.comment_out(c, db, user.id)
        item["target_type"] = "post"
        item["target_id"] = c.post_id
        post = db.get(models.Post, c.post_id)
        item["target_title"] = post.title if post else None
        result.append(item)
    for c in wc:
        item = serializers.comment_out(c, db, user.id)
        item["target_type"] = "work"
        item["target_id"] = c.work_id
        work = db.get(models.Work, c.work_id)
        item["target_title"] = work.title if work else None
        result.append(item)
    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result[:100]


@router.get("/me/favorites")
def my_favorites(
    folder_id: int | None = None,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Favorite).filter(models.Favorite.user_id == user.id)
    if folder_id is not None:
        query = query.filter(models.Favorite.folder_id == folder_id)
    favs = query.order_by(models.Favorite.id.desc()).limit(200).all()
    result = []
    for f in favs:
        if f.target_type == "work":
            w = db.get(models.Work, f.target_id)
            if w:
                result.append({"kind": "work", "data": serializers.work_out(w, db, user.id), "folder_id": f.folder_id})
        elif f.target_type == "post":
            p = db.get(models.Post, f.target_id)
            if p:
                result.append({"kind": "post", "data": serializers.post_out(p, db, user.id), "folder_id": f.folder_id})
    return result


# ---- 收藏夹 ----
@router.get("/me/folders")
def my_folders(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    folders = (
        db.query(models.FavoriteFolder)
        .filter(models.FavoriteFolder.user_id == user.id)
        .order_by(models.FavoriteFolder.id.desc())
        .all()
    )
    return [serializers.folder_out(f, db) for f in folders]


@router.post("/me/folders", status_code=201)
def create_folder(body: schemas.FolderCreate, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    name = body.name.strip()
    if sensitive.contains_sensitive(name, db):
        raise HTTPException(status_code=400, detail="收藏夹名称包含敏感词")
    if db.query(models.FavoriteFolder).filter_by(user_id=user.id, name=name).first():
        raise HTTPException(status_code=400, detail="已存在同名收藏夹")
    folder = models.FavoriteFolder(user_id=user.id, name=name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return serializers.folder_out(folder, db)


@router.patch("/me/folders/{folder_id}")
def update_folder(folder_id: int, body: schemas.FolderUpdate, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    folder = db.query(models.FavoriteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if folder is None:
        raise HTTPException(status_code=404, detail="收藏夹不存在")
    folder.name = body.name.strip()
    db.commit()
    db.refresh(folder)
    return serializers.folder_out(folder, db)


@router.delete("/me/folders/{folder_id}")
def delete_folder(folder_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    folder = db.query(models.FavoriteFolder).filter_by(id=folder_id, user_id=user.id).first()
    if folder is None:
        raise HTTPException(status_code=404, detail="收藏夹不存在")
    db.query(models.Favorite).filter_by(user_id=user.id, folder_id=folder_id).update({"folder_id": None})
    db.delete(folder)
    db.commit()
    return {"ok": True}


# ---- 浏览历史（最近玩过） ----
@router.get("/me/history")
def my_history(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(models.PlayHistory)
        .filter(models.PlayHistory.user_id == user.id)
        .order_by(models.PlayHistory.viewed_at.desc())
        .limit(50)
        .all()
    )
    return [serializers.history_out(h, db) for h in rows if db.get(models.Work, h.work_id) is not None]


@router.delete("/me/history/{work_id}", status_code=204)
def delete_history_item(work_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """删除单条浏览记录。"""
    db.query(models.PlayHistory).filter_by(user_id=user.id, work_id=work_id).delete()
    db.commit()


@router.delete("/me/history", status_code=204)
def clear_history(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """清空浏览记录。"""
    db.query(models.PlayHistory).filter_by(user_id=user.id).delete()
    db.commit()


# ---- 个人主页精选稿件 ----
@router.put("/me/featured")
def set_featured(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """设置个人主页精选稿件（最多 3 个，按传入顺序）。

    ⚠️ 返回的 `featured_works` 必须和 `GET /users/{uid}` 里那个**同形**（都是完整的稿件对象）。
    以前这里返回的是 id 列表，同一个字段名在两个接口里是两种东西，属于埋雷。
    另外只能精选**自己已上架**的稿件，且只保留已上架的（和列表接口的过滤保持一致）。
    """
    ids = [int(x) for x in (body.get("work_ids") or []) if str(x).isdigit()][:3]
    own = {w.id for w in db.query(models.Work.id).filter(models.Work.user_id == user.id).all()}
    valid = [i for i in ids if i in own]
    user.featured_work_ids = ",".join(str(i) for i in valid)
    db.commit()
    db.refresh(user)

    by_id = {w.id: w for w in db.query(models.Work).filter(
        models.Work.id.in_(valid), models.Work.user_id == user.id, models.Work.status == "published"
    ).all()}
    return {
        "featured_work_ids": user.featured_work_ids,
        "featured_works": [serializers.work_out(by_id[i], db, user.id) for i in valid if i in by_id],
    }


# ---- 修改密码 ----
@router.post("/me/password")
def change_password(body: schemas.PasswordChange, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    # 编程猫注册用户首次设置密码：无需旧密码（设置成功后开放账号密码登录）
    if getattr(user, "local_pwd_set", 1):
        if not security.verify_password(body.old_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="旧密码不正确")
    user.hashed_password = security.hash_password(body.new_password)
    user.local_pwd_set = 1
    user.token_version = (user.token_version or 0) + 1  # 旧 token 全部失效（强制下线其他设备）
    db.commit()
    return {"ok": True, "local_pwd_set": True}


# ---- 友好条约（LV1） ----
@router.post("/me/treaty")
def sign_treaty(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    if user.treaty_signed_at is None:
        user.treaty_signed_at = models.now()
        db.commit()
    return {"ok": True, "treaty": True}


# ---- 领域标签 ----
@router.get("/me/interests")
def get_interests(user: models.User = Depends(get_current_user)):
    return {"interests": [t.strip() for t in (user.interests or "").split(",") if t.strip()]}


@router.put("/me/interests")
def set_interests(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    allowed = {"游戏", "动画", "音乐", "绘画", "故事", "数学", "科学"}
    picked = [x for x in (body.get("interests") or []) if x in allowed][:3]
    user.interests = ",".join(picked)
    db.commit()
    return {"interests": picked}


# ---- 公开精选集（创建/我的列表在 /users/me，查看/编辑在 /collections） ----
@router.get("/me/collections")
def my_collections(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.Collection).filter_by(user_id=user.id).order_by(models.Collection.id.desc()).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description or "",
            "item_count": db.query(models.CollectionItem).filter_by(collection_id=c.id).count(),
            "created_at": c.created_at,
        }
        for c in rows
    ]


@router.post("/me/collections", status_code=201)
def create_collection(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入精选集名称")
    c = models.Collection(user_id=user.id, name=name[:50], description=(body.get("description") or "")[:300])
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "name": c.name}


@router.delete("/me/collections/{collection_id}", status_code=204)
def delete_collection(collection_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    c = db.get(models.Collection, collection_id)
    if c is None or c.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的精选集")
    db.query(models.CollectionItem).filter_by(collection_id=collection_id).delete()
    db.delete(c)
    db.commit()


# ---- 话题订阅 ----
def _my_topics(user: models.User) -> list[str]:
    return [t for t in (user.subscribed_topics or "").split(",") if t.strip()]


def _set_topics(user: models.User, topics: list[str]) -> None:
    user.subscribed_topics = ",".join(dict.fromkeys(topics))


@router.get("/me/topic_subscriptions")
def get_topic_subscriptions(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    return {"topics": _my_topics(user)}


@router.post("/me/topic_subscriptions")
def toggle_topic_subscription(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """订阅/取消订阅话题：{topic, subscribe: bool}。"""
    topic = (body.get("topic") or "").strip().lstrip("#").rstrip("#")
    if not topic:
        raise HTTPException(status_code=400, detail="话题不能为空")
    topics = _my_topics(user)
    subscribe = bool(body.get("subscribe"))
    if subscribe and topic not in topics:
        if len(topics) >= 20:
            raise HTTPException(status_code=400, detail="最多订阅 20 个话题")
        topics.append(topic)
    elif not subscribe:
        topics = [t for t in topics if t != topic]
    _set_topics(user, topics)
    db.commit()
    return {"topics": _my_topics(user)}


# ---- 粉丝周报（近 7 天数据汇总） ----
@router.get("/me/weekly_report")
def weekly_report(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta

    since = models.now() - timedelta(days=7)
    my_work_ids = [w.id for w in db.query(models.Work.id).filter(models.Work.user_id == user.id).all()]
    my_post_ids = [p.id for p in db.query(models.Post.id).filter(models.Post.user_id == user.id).all()]
    new_followers = db.query(models.Follow).filter(models.Follow.following_id == user.id, models.Follow.created_at >= since).count()
    likes_received = db.query(models.Like).filter(
        models.Like.target_type == "work", models.Like.target_id.in_(my_work_ids), models.Like.created_at >= since
    ).count() if my_work_ids else 0
    likes_received += db.query(models.Like).filter(
        models.Like.target_type == "post", models.Like.target_id.in_(my_post_ids), models.Like.created_at >= since
    ).count() if my_post_ids else 0
    comments_received = db.query(models.WorkComment).filter(
        models.WorkComment.work_id.in_(my_work_ids), models.WorkComment.created_at >= since
    ).count() if my_work_ids else 0
    comments_received += db.query(models.PostComment).filter(
        models.PostComment.post_id.in_(my_post_ids), models.PostComment.created_at >= since
    ).count() if my_post_ids else 0
    works_published = db.query(models.Work).filter(models.Work.user_id == user.id, models.Work.created_at >= since).count()
    posts_published = db.query(models.Post).filter(models.Post.user_id == user.id, models.Post.created_at >= since).count()
    viewers = db.query(models.PlayHistory).filter(
        models.PlayHistory.work_id.in_(my_work_ids), models.PlayHistory.viewed_at >= since
    ).count() if my_work_ids else 0
    return {
        "since": since.isoformat(),
        "new_followers": new_followers,
        "likes_received": likes_received,
        "comments_received": comments_received,
        "works_published": works_published,
        "posts_published": posts_published,
        "viewers": viewers,
    }


# ---- 互动管理：谁赞了我的作品/帖子 ----
@router.get("/me/liked_by")
def my_liked_by(user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """谁赞了我的内容（作品/帖子）：返回赞我的人 + 被赞内容。"""
    my_work_ids = [w.id for w in db.query(models.Work.id).filter(models.Work.user_id == user.id).all()]
    my_post_ids = [p.id for p in db.query(models.Post.id).filter(models.Post.user_id == user.id).all()]
    result = []
    if my_work_ids:
        rows = (
            db.query(models.Like)
            .filter(models.Like.target_type == "work", models.Like.target_id.in_(my_work_ids))
            .order_by(models.Like.id.desc())
            .limit(100)
            .all()
        )
        for l in rows:
            if l.user_id == user.id:
                continue
            w = db.get(models.Work, l.target_id)
            if not w:
                continue
            result.append({
                "kind": "work",
                "target_id": w.id,
                "target_title": w.title,
                "target_cover": w.cover_url,
                "liker": serializers.user_brief(db.get(models.User, l.user_id)) if db.get(models.User, l.user_id) else None,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            })
    if my_post_ids:
        rows = (
            db.query(models.Like)
            .filter(models.Like.target_type == "post", models.Like.target_id.in_(my_post_ids))
            .order_by(models.Like.id.desc())
            .limit(100)
            .all()
        )
        for l in rows:
            if l.user_id == user.id:
                continue
            p = db.get(models.Post, l.target_id)
            if not p:
                continue
            result.append({
                "kind": "post",
                "target_id": p.id,
                "target_title": p.title,
                "target_cover": None,
                "liker": serializers.user_brief(db.get(models.User, l.user_id)) if db.get(models.User, l.user_id) else None,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            })
    # 新赞在前
    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result
