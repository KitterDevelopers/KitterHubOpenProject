"""把 ORM 对象序列化成前端友好的 dict（附带点赞数、是否已点赞等）。"""
import re
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import cloudvars, config, events, iplocate, models


def as_utc(dt):
    """把 SQLite 读出来的「无时区」时间补成 UTC，才能和 models.now()（带时区）比较或排序。

    ★ 踩过的坑：studios 详情页把「稿件加入时间」和「成员加入时间」放一起 sort，
      其中一条 added_at 是 NULL、走了 models.now() 兜底（带时区），
      和另一条无时区的时间一比就 TypeError → 工作室页 500。
    """
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_dt_utc(value: str):
    """解析前端传来的 ISO 时间字符串，统一成「带时区的 UTC」。

    ★ 前端如果用 <input type="datetime-local"> 取值，字符串里**没有时区**，
      直接和 models.now() 比也会 TypeError（定时发布、公告定时、投票截止都踩得到）。
      约定：没带时区的按 UTC 解释（和库里的存法一致）。格式不对抛 ValueError。
    """
    dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def count_likes(db: Session, target_type: str, target_id: int) -> int:
    return (
        db.query(models.Like)
        .filter(models.Like.target_type == target_type, models.Like.target_id == target_id)
        .count()
    )


def is_liked(db: Session, user_id: int | None, target_type: str, target_id: int) -> bool:
    if user_id is None:
        return False
    return (
        db.query(models.Like)
        .filter(
            models.Like.user_id == user_id,
            models.Like.target_type == target_type,
            models.Like.target_id == target_id,
        )
        .first()
        is not None
    )


# 等级体系：LV0 注册 / LV1 签订友好条约 / LV2-7 按经验阈值（**含**，即 >= 就升级）
_LEVEL_THRESHOLDS = [200, 700, 1500, 5000, 10000, 50000]  # 对应 LV2..LV7
LEVEL_META = {
    0: ("LV0", "gray"),
    1: ("LV1", "blue"),
    2: ("LV2", "green"),
    3: ("LV3", "teal"),
    4: ("LV4", "purple"),
    5: ("LV5", "orange"),
    6: ("LV6", "gold"),
    7: ("LV7", "redgold"),
}

# ---- 经验与小鱼干规则（改这里就等于改规则，前后端都读它） ----
SIGNIN_XP = 10            # 每日签到
FEED_GIVE_XP = 10         # 投喂他人：每投出 1 个小鱼干
FEED_GIVE_DAILY_XP = 50   # 投喂他人：每日最多拿这么多经验
FEED_RECEIVE_XP = 1       # 被投喂：每收到 1 个小鱼干（无上限）
INVITE_XP = 500           # 成功邀请 1 人注册（只给邀请人）
# 每日可领小鱼干（LV0 没签条约，0 个）
DAILY_FISH_BY_LEVEL = {0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 5}

# ---- 编程猫作者等级奖励（站长 2026-09-19 定的规则，改这里就等于改规则）----
# 规则：编程猫 N 级 → 本站保底 LV(N+1)。只有 3/4/5 级有奖励，2 级（潜力新星）只在经验中心展示徽章。
# 领取是**一次性**的：领完写进 users.codemao_xp_bonus，解绑编程猫号也不回收；
# 以后编程猫等级升上去可以再领一次，补差额到新的保底等级（不会重复给满）。
CODEMAO_BADGE_MIN = 2                      # 有徽章的最低等级
CODEMAO_BADGE_MAX = 5                      # 有徽章的最高等级
CODEMAO_REWARD_FROM = 3                    # 从这个等级起才给经验奖励（2 级只展示）
CODEMAO_BADGE_NAMES = {2: "潜力新星", 3: "进阶高手", 4: "编程大佬", 5: "源码传说"}


def codemao_badge_url(level: int) -> str | None:
    """编程猫作者等级 -> 本站托管好的徽章图（4/5 级用官方动图）。"""
    lv = int(level or 0)
    if lv < CODEMAO_BADGE_MIN or lv > CODEMAO_BADGE_MAX:
        return None
    ext = "gif" if lv >= 4 else "png"
    return f"/badge/codemao-lv{lv}.{ext}"


def codemao_target_level(level: int) -> int | None:
    """编程猫作者等级 -> 本站保底等级；没有奖励的等级返回 None。"""
    lv = int(level or 0)
    if lv < CODEMAO_REWARD_FROM or lv > CODEMAO_BADGE_MAX:
        return None
    return lv + 1


def codemao_target_xp(level: int) -> int | None:
    """编程猫作者等级 -> 该保底等级需要的最低总经验；没有奖励的等级返回 None。"""
    target = codemao_target_level(level)
    if target is None:
        return None
    return _LEVEL_THRESHOLDS[target - 2]


# ---- 绑定奖励（站长 2026-09-22 定的规则：绑一项领一次，每项只能领一次）----
# key -> (经验, 领取时间字段, 是否已绑定的判定)
# 「已绑定」用各绑定关系本身来判断，不另存标记：
#   编程猫看 users.codemao_uid，GitHub 看 users.github_id，邮箱看 email 是不是真实地址。
BIND_REWARDS = {
    "codemao": {"xp": 100, "column": "bind_xp_codemao_at"},
    "github": {"xp": 20, "column": "bind_xp_github_at"},
    "email": {"xp": 50, "column": "bind_xp_email_at"},
}


def is_email_bound(user: models.User) -> bool:
    """邮箱算不算「已绑定」：编程猫/GitHub 注册会写占位地址，那些不算。"""
    email = (user.email or "").strip().lower()
    if not email or "." not in email:
        return False
    if email.endswith("@codemao.bind") or email.endswith("@nomail.invalid"):
        return False
    if email.startswith("unbound-") or email.endswith(".invalid") or email.endswith(".bind"):
        return False
    return True


def bind_bound(user: models.User, key: str) -> bool:
    """这一项现在绑没绑。"""
    if key == "codemao":
        return bool(user.codemao_uid)
    if key == "github":
        return bool(user.github_id)
    if key == "email":
        return is_email_bound(user)
    return False


def bind_claimed_at(user: models.User, key: str):
    """这一项什么时候领的；没领过返回 None。"""
    meta = BIND_REWARDS.get(key)
    return getattr(user, meta["column"], None) if meta else None


def bind_xp_total(user: models.User) -> int:
    """已领取的绑定奖励经验合计（从领取时间算出来，不另设累加器）。"""
    return sum(m["xp"] for k, m in BIND_REWARDS.items() if bind_claimed_at(user, k) is not None)


def compute_level(xp: int, treaty: bool = False) -> int:
    """经验值 + 是否签订条约 -> 等级 0-7（阈值含等号）。"""
    if not treaty:
        return 0
    lv = 1
    for thr in _LEVEL_THRESHOLDS:
        if xp >= thr:
            lv += 1
    return min(7, lv)


def daily_fish_for(level: int) -> int:
    """该等级每天能领几个小鱼干。"""
    return DAILY_FISH_BY_LEVEL.get(max(0, min(7, level)), 0)


def level_progress(xp: int, level: int) -> dict:
    """距离下一级还差多少经验（满级 remain=0；LV0 的下一级门槛是签条约，不是经验）。"""
    if level >= 7:
        return {"next_level": 7, "next_xp": None, "cur_xp": _LEVEL_THRESHOLDS[-1], "remain": 0, "pct": 100, "need_treaty": False}
    if level <= 0:
        return {"next_level": 1, "next_xp": None, "cur_xp": 0, "remain": 0, "pct": 0, "need_treaty": True}
    cur = 0 if level == 1 else _LEVEL_THRESHOLDS[level - 2]
    nxt = _LEVEL_THRESHOLDS[level - 1]
    span = max(1, nxt - cur)
    pct = min(100, max(0, int((xp - cur) * 100 / span)))
    return {"next_level": level + 1, "next_xp": nxt, "cur_xp": cur, "remain": max(0, nxt - xp), "pct": pct, "need_treaty": False}


def xp_breakdown(db: Session, user: models.User) -> dict:
    """经验构成（当前规则只有这六种来源）。

    只有「其他」和「编程猫等级奖励」是累加字段（管理员调整、历史奖励、一次性领取）；
    签到/邀请/被投喂都是**按事实算出来的**，所以历史数据一改规则就自动按新规则重算，
    不需要额外维护计数器。
    """
    received_fish = (
        db.query(func.coalesce(func.sum(models.Work.feed_count), 0)).filter(models.Work.user_id == user.id).scalar() or 0
    ) + (
        db.query(func.coalesce(func.sum(models.Post.feed_count), 0)).filter(models.Post.user_id == user.id).scalar() or 0
    )
    invite_count = db.query(models.User).filter(models.User.invited_by == user.id).count()
    signin_days = user.signin_days or 0
    event_count, event_xp = events.claimed_total(db, user)
    return {
        "signin_days": signin_days,
        "signin": signin_days * SIGNIN_XP,
        "feed_given": user.xp_feed_given or 0,
        "feed_received_fish": int(received_fish),
        "feed_received": int(received_fish) * FEED_RECEIVE_XP,
        "invite_count": invite_count,
        "invite": invite_count * INVITE_XP,
        # 活动奖励：直接从 event_claims 求和，不另设累加器（发过多少就是多少）
        "event_count": event_count,
        "event": event_xp,
        "other": user.xp_bonus or 0,
        "codemao": user.codemao_xp_bonus or 0,
        "bind": bind_xp_total(user),
    }


def user_xp(db: Session, user: models.User) -> int:
    """总经验 = 签到 + 投喂他人 + 被投喂 + 邀请 + 活动奖励 + 其他奖励 + 编程猫等级奖励 + 绑定奖励。"""
    b = xp_breakdown(db, user)
    return (
        b["signin"] + b["feed_given"] + b["feed_received"] + b["invite"] + b["event"]
        + b["other"] + b["codemao"] + b["bind"]
    )


def grant_feed_xp(db: Session, user: models.User, count: int) -> int:
    """投喂者经验：每投 1 个小鱼干 +10，每日上限 50。返回本次实际拿到多少。"""
    today = models.now().strftime("%Y-%m-%d")
    if user.feed_xp_date != today:
        user.feed_xp_date = today
        user.feed_xp_today = 0
    room = max(0, FEED_GIVE_DAILY_XP - (user.feed_xp_today or 0))
    gained = min(count * FEED_GIVE_XP, room)
    user.feed_xp_today = (user.feed_xp_today or 0) + gained
    user.xp_feed_given = (user.xp_feed_given or 0) + gained
    return gained


def feed_xp_today(db: Session, user: models.User) -> int:
    """今天靠投喂已经拿了多少经验（跨天自动归零）。"""
    if user.feed_xp_date != models.now().strftime("%Y-%m-%d"):
        return 0
    return user.feed_xp_today or 0



def level_info(db: Session, user: models.User) -> dict:
    xp = user_xp(db, user)
    treaty = bool(user.treaty_signed_at)
    lv = compute_level(xp, treaty)
    name, color = LEVEL_META[lv]
    return {"level": lv, "level_name": name, "level_color": color, "xp": xp, "treaty": treaty}


# ---------------------------------------------------------------------------
# 徽章展示口径（站长 2026-09-30）
#   两个徽章**只能选一个**展示：编程猫作者等级徽章 / 本站等级徽章 / 都不展示；
#   **默认展示编程猫的**（users.badge_choice 为 NULL 就是它）。
#   前端所有展示位（个人主页昵称旁、稿件详情作者行…）都读同一个字段 badge_choice，
#   由 components/UserBadge.jsx 统一渲染，避免「有的地方显示、有的地方不显示」。
# ---------------------------------------------------------------------------
BADGE_CHOICES = ("codemao", "site", "none")
DEFAULT_BADGE_CHOICE = "codemao"


def badge_choice(user: models.User | None) -> str:
    if user is None:
        return DEFAULT_BADGE_CHOICE
    v = (getattr(user, "badge_choice", None) or "").strip()
    return v if v in BADGE_CHOICES else DEFAULT_BADGE_CHOICE


def codemao_badge_of(user: models.User | None) -> dict | None:
    """这个人的编程猫徽章（没绑定 / 等级不在 2~5 就是 None）。不读第三方接口，只用缓存。"""
    if user is None:
        return None
    lv = int(getattr(user, "codemao_author_level", 0) or 0)
    url = codemao_badge_url(lv)
    if not url:
        return None
    return {"level": lv, "name": CODEMAO_BADGE_NAMES.get(lv, ""), "url": url}


def check_level(db: Session, user: models.User, min_lv: int, action: str = "进行此操作") -> None:
    """等级特权校验（管理员豁免）。不满足抛 403。"""
    if user.role == "admin":
        return
    lv = level_info(db, user)["level"]
    if lv < min_lv:
        hint = "签订友好条约可升至 Lv.1，多创作、多互动积累经验可升级"
        raise HTTPException(status_code=403, detail=f"需要 Lv.{min_lv} 才能{action}（{hint}）")


def _shown_ip_region(user) -> str:
    """对外展示的属地：开关 → 固定属地 → 按 IP 识别的属地。"""
    if user is None or getattr(user, "show_ip_region", True) is False:
        return ""
    return iplocate.fixed_region(user) or (user.ip_region or "")


def pickcat_of(user: models.User) -> dict:
    """PickCat 绑定信息（绑定状态、UID、昵称、头像）。密码相关信息一律不在这里。"""
    return {
        "bound": bool(getattr(user, "pickcat_uid", None)),
        "uid": getattr(user, "pickcat_uid", None),
        "nickname": getattr(user, "pickcat_nickname", "") or "",
        "avatar": getattr(user, "pickcat_avatar", None),
        "at": getattr(user, "pickcat_at", None),
    }


def user_brief(user: models.User) -> dict:
    return {
        "id": user.id,
        "uid": user.uid,
        "username": user.username,
        "nickname": user.nickname or "",
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "cover_url": user.cover_url,
        "show_cover": user.show_cover,
        "show_level_badge": bool(user.show_level_badge),  # 【旧】已被 badge_choice 取代，保留给旧前端
        "show_codemao_badge": bool(user.show_codemao_badge),  # 【旧】同上
        # 展示哪一个徽章：codemao（默认）/ site / none —— 前端统一读这个
        "badge_choice": badge_choice(user),
        # 实名审核状态：ok / awaiting_passport / pending_review / rejected
        # 前端据此把未审核用户挡在「上传护照」页
        "verify_state": user.verify_state or "ok",
        "bio": user.bio or "",
        "role": user.role,
        "is_banned": user.effective_banned,  # 实际封禁状态（含临时封禁）
        "is_permanently_banned": user.is_banned,
        "is_deactivated": user.is_deactivated,
        "verification_title": user.verification_title or "",
        "verification_type": user.verification_type,
        # 社区风纪委员（站长 2026-10-01）：在职的会在个人主页显示一个「风纪委员」标识。
        # 只对外的身份标记，申请/停职等状态由 /api/committee/me 给本人看。
        "committee": (getattr(user, "committee_status", None) or "") == "active",
        "interests": [t.strip() for t in (user.interests or "").split(",") if t.strip()],
        "treaty_signed": bool(user.treaty_signed_at),
        "codemao_uid": user.codemao_uid,
        "codemao_nickname": user.codemao_nickname or "",
        "codemao_avatar": user.codemao_avatar,
        # GitHub OAuth（登录 / 绑定）：前端「账号设置」据此显示已绑定状态
        "github_id": user.github_id,
        "github_login": user.github_login or "",
        "github_avatar": user.github_avatar,
        "gender": user.gender if user.show_personal else None,  # 按用户开关决定是否公开
        # IP 属地（辽宁省 / 香港特别行政区 / 美国 …）。三层规则，顺序不能反：
        #   1. 用户关掉开关 → 直接给空串（生效在**接口层**，不是只把前端的字藏起来，否则抓包照样能看到）；
        #   2. 管理员账号 → 固定值（不按 IP 判定，见 iplocate.fixed_region）；
        #   3. 其余按最近一次识别到的属地。
        "ip_region": _shown_ip_region(user),
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def extract_topics(text: str) -> list[str]:
    """从文本中提取 #话题#（最多 5 个）。"""
    found = re.findall(r"#([^#\s]{1,20})#", text or "")
    seen, out = set(), []
    for t in found:
        if t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= 5:
            break
    return out


def _likes_received(db: Session, user_id: int) -> int:
    work_ids = [r[0] for r in db.query(models.Work.id).filter(models.Work.user_id == user_id).all()]
    post_ids = [r[0] for r in db.query(models.Post.id).filter(models.Post.user_id == user_id).all()]
    total = 0
    if work_ids:
        total += db.query(models.Like).filter(
            models.Like.target_type == "work", models.Like.target_id.in_(work_ids)
        ).count()
    if post_ids:
        total += db.query(models.Like).filter(
            models.Like.target_type == "post", models.Like.target_id.in_(post_ids)
        ).count()
    return total


def user_public(user: models.User, db: Session, current_user_id: int | None = None) -> dict:
    data = user_brief(user)
    data["created_at"] = user.created_at
    data["email"] = user.email if current_user_id == user.id else None
    works_count = db.query(models.Work).filter(models.Work.user_id == user.id).count()
    posts_count = db.query(models.Post).filter(models.Post.user_id == user.id).count()
    data["followers_count"] = db.query(models.Follow).filter(models.Follow.following_id == user.id).count()
    data["following_count"] = db.query(models.Follow).filter(models.Follow.follower_id == user.id).count()
    data["works_count"] = works_count
    data["posts_count"] = posts_count
    data["is_following"] = (
        db.query(models.Follow)
        .filter(models.Follow.follower_id == current_user_id, models.Follow.following_id == user.id)
        .first()
        is not None
        if current_user_id
        else False
    )
    data["followed_me"] = (
        db.query(models.Follow)
        .filter(models.Follow.follower_id == user.id, models.Follow.following_id == current_user_id)
        .first()
        is not None
        if current_user_id
        else False
    )
    # 我是否拉黑了 TA（个人主页「更多」菜单用）
    data["i_blocked"] = (
        db.query(models.UserBlock)
        .filter(models.UserBlock.blocker_id == current_user_id, models.UserBlock.blocked_id == user.id)
        .first()
        is not None
        if current_user_id and current_user_id != user.id
        else False
    )
    likes_received = _likes_received(db, user.id)
    info = level_info(db, user)
    data["xp"] = info["xp"]
    data["level"] = info["level"]
    data["level_name"] = info["level_name"]
    data["level_color"] = info["level_color"]
    data["treaty"] = info["treaty"]
    data["likes_received"] = likes_received
    # 被浏览总数（作品播放量之和，对外公开汇总）
    data["views_received"] = (
        db.query(func.coalesce(func.sum(models.Work.views), 0)).filter(models.Work.user_id == user.id).scalar() or 0
    )
    data["show_personal"] = bool(user.show_personal)
    # 编程猫作者等级徽章（潜力新星 / 进阶高手 / 编程大佬 / 源码传说）：
    # 只有「本人选的就是编程猫徽章」且缓存里确实有徽章（Lv2 起）时才给出。
    # ⚠️ 这里**不读第三方接口**，只用 users.codemao_author_level 这份缓存 —— 个人主页不能被
    # 编程猫接口的延迟/故障拖住；等级在经验中心（或打开开关时）已经读并缓存好了。
    data["codemao_badge"] = codemao_badge_of(user) if badge_choice(user) == "codemao" else None
    if current_user_id == user.id:
        # 仅自己可见：小鱼干数量、性别（即使未公开也可见）、封禁详情、密码设置状态
        data["fish_count"] = user.fish_count or 0
        data["gender"] = user.gender
        data["pending_email"] = user.pending_email
        data["ban_reason"] = user.ban_reason or ""
        data["ban_until"] = user.ban_until.isoformat() if user.ban_until else None
        data["local_pwd_set"] = bool(getattr(user, "local_pwd_set", 0))
        # 仅自己可见：IP 属地开关本身（属地值在 user_brief 里，关掉后为空串）
        data["show_ip_region"] = getattr(user, "show_ip_region", True) is not False
    # 个人主页精选稿件（保持设置顺序；仅展示已上架的稿件，避免泄露待审/被驳回/定时稿件）
    fids = user.featured_list
    featured = []
    if fids:
        by_id = {w.id: w for w in db.query(models.Work).filter(
            models.Work.id.in_(fids), models.Work.user_id == user.id, models.Work.status == "published"
        ).all()}
        featured = [work_out(by_id[fid], db, current_user_id) for fid in fids if fid in by_id]
    data["featured_works"] = featured
    return data


def poll_out(post: models.Post, db: Session, current_user_id: int | None = None) -> dict | None:
    """投票视图：选项/票数/总数/我的选择/匿名参与者头像。"""
    data = post.poll_data
    if not data:
        return None
    options = data.get("options") or []
    total = sum(o.get("votes", 0) for o in options)
    my_vote = None
    voted = data.get("voted_user_ids") or []
    if current_user_id and current_user_id in voted:
        for o in options:
            if current_user_id in (o.get("voter_ids") or []):
                my_vote = o.get("id")
    # 匿名头像墙：参与者头像（不显示身份），最多 12 个
    voter_avatars = []
    if voted:
        users = db.query(models.User).filter(models.User.id.in_(voted[:40])).all()
        by_id = {u.id: u for u in users}
        for uid_ in voted[:12]:
            u = by_id.get(uid_)
            if u and u.avatar_url:
                voter_avatars.append(u.avatar_url)
    # 截止判断：按真实时间比，不用字符串比（字符串比在同时区/跨时区时会算错）
    ended = False
    if data.get("deadline"):
        try:
            ended = parse_dt_utc(data["deadline"]) <= models.now()
        except ValueError:
            ended = False
    return {
        "question": data.get("question", ""),
        "options": [{"id": o.get("id"), "text": o.get("text", ""), "votes": o.get("votes", 0)} for o in options],
        "total_votes": total,
        "my_vote": my_vote,
        "voted": bool(my_vote) or (current_user_id in voted),
        "voter_avatars": voter_avatars,
        "deadline": data.get("deadline"),
        "ended": ended,
    }


def _safe_brief(user) -> dict | None:
    """作者可能因账号注销/删除而悬空，统一容错。"""
    return user_brief(user) if user is not None else None


def post_out(post: models.Post, db: Session, current_user_id: int | None = None) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "content": post.content,
        "summary": (post.content or "")[:120],
        "category": post.category,
        "topics": [t.strip() for t in (post.topics or "").split(",") if t.strip()],
        "views": post.views,
        "is_pinned": post.is_pinned,
        "is_featured": post.is_featured,
        "owner_pinned": post.owner_pinned,
        "poll": poll_out(post, db, current_user_id),
        "image_url": post.image_url,
        "feed_count": post.feed_count or 0,
        "created_at": post.created_at,
        "updated_at": post.updated_at,
        "edited_at": post.edited_at,
        # 作者属地用**发布时快照**（post.ip_region），不是作者的实时属地
        "author": _brief_with_region(post.author, post.ip_region),
        "comment_count": db.query(models.PostComment).filter(models.PostComment.post_id == post.id, models.PostComment.status == "active").count(),
        "like_count": count_likes(db, "post", post.id),
        "liked": is_liked(db, current_user_id, "post", post.id),
        "favorite_count": db.query(models.Favorite).filter(models.Favorite.target_type == "post", models.Favorite.target_id == post.id).count(),
        "favorited": (
            db.query(models.Favorite)
            .filter(models.Favorite.user_id == current_user_id, models.Favorite.target_type == "post", models.Favorite.target_id == post.id)
            .first()
            is not None
            if current_user_id
            else False
        ),
    }


def _brief_with_region(user, region: str | None) -> dict | None:
    """「内容」里用的作者简报：ip_region 换成**发布时快照**。

    站长定的语义：个人主页显示**实时**属地，帖子/稿件/评论显示**发布时**的属地。
    所以内容侧不能直接用 user_brief 里那个实时值，必须用它自己那一列（post.ip_region 等）。
    作者关掉「展示 IP 属地」开关时，内容侧同样不展示（开关是全局的，不只管主页）。
    """
    if user is None:
        return None
    brief = user_brief(user)
    brief["ip_region"] = (region or "") if getattr(user, "show_ip_region", True) is not False else ""
    return brief


def _brief_with_level(db: Session, user, region: str | None = None) -> dict | None:
    """作者简报 + 等级信息（卡片/列表展示用）。传了 region 就用**发布时快照**替换实时属地。

    同时带上「这个作者展示哪个徽章」——个人主页、稿件详情作者行等所有展示位都读它，
    这样就不会出现「主页显示了、稿件页没显示」这种不一致（站长 2026-09-30）。
    """
    b = _safe_brief(user)
    if b is None:
        return None
    if region is not None:
        b["ip_region"] = (region or "") if getattr(user, "show_ip_region", True) is not False else ""
    info = level_info(db, user)
    b["level"] = info["level"]
    b["level_name"] = info["level_name"]
    b["badge_choice"] = badge_choice(user)
    b["codemao_badge"] = codemao_badge_of(user) if b["badge_choice"] == "codemao" else None
    return b


def attach_is_following(db: Session, brief: dict | None, author_id: int | None, current_user_id: int | None) -> dict | None:
    """给作者简报补一个 is_following（看的人有没有关注这个作者）。

    为什么必须补：稿件详情页的「一键三连」要判断「作者是不是已经关注过了」——
    原来 payload 里没有这个字段，前端读到 undefined，于是**每次三连都会再发一次关注**，
    而且永远进不了「三项都已支持」的分支（2026-09-27 修）。
    未登录、看自己、作者为空时一律 false。
    """
    if brief is None:
        return None
    followed = False
    if current_user_id and author_id and author_id != current_user_id:
        followed = (
            db.query(models.Follow.id)
            .filter(models.Follow.follower_id == current_user_id, models.Follow.following_id == author_id)
            .first()
            is not None
        )
    brief["is_following"] = followed
    return brief


def work_out(work: models.Work, db: Session, current_user_id: int | None = None, with_follow: bool = False) -> dict:
    # Scratch 作品的播放地址要挂上**我们自建的云变量服务器**（票据按观看者签发，见 cloudvars.py）。
    # 只影响返回给前端的 play_url，不动库里存的字段。
    play_url = work.play_url
    if work.work_type == "scratch" and play_url and cloudvars.enabled():
        viewer = db.get(models.User, current_user_id) if current_user_id else None
        play_url = cloudvars.decorate_play_url(play_url, work.id, viewer)
    return {
        "id": work.id,
        "title": work.title,
        "description": work.description,
        "work_type": work.work_type,
        "source_url": work.source_url,
        "editor_code": work.editor_code,
        "editor_work_id": work.editor_work_id,
        "sb3_url": work.sb3_url,          # Scratch 作品文件直链（/uploads/games/xxx.sb3）
        "sb3_size": work.sb3_size or 0,
        "is_scratch": work.work_type == "scratch",
        "cover_url": work.cover_url,
        "category": work.category,
        "tags": work.tag_list,
        "views": work.views,
        "is_pinned": work.is_pinned,
        "is_featured": work.is_featured,
        "status": work.status,
        "scheduled_at": work.scheduled_at.isoformat() if work.scheduled_at else None,
        "appeal": work.appeal if hasattr(work, "appeal") else None,
        "feed_count": work.feed_count or 0,
        "is_codemao": work.editor_code in config.EDITOR_CODEMAO_CODES if work.editor_code else False,
        "derived_from": work.derived_from,
        "is_repost": work.is_repost,
        "original_url": work.original_url or "",
        "play_url": play_url,
        "created_at": work.created_at,
        "edited_at": work.edited_at,
        # 作者属地用**投稿时快照**（work.ip_region）。
        # is_following 只在稿件**详情页**需要（「一键三连」要判断作者关注没关注过）；
        # 列表接口一次返回几十件，逐件查关注关系就是 N+1，所以用 with_follow 显式开关。
        "author": (
            attach_is_following(
                db, _brief_with_level(db, work.author, work.ip_region),
                getattr(work.author, "id", None), current_user_id,
            ) if with_follow else _brief_with_level(db, work.author, work.ip_region)
        ),
        "like_count": count_likes(db, "work", work.id),
        "comment_count": db.query(models.WorkComment).filter(models.WorkComment.work_id == work.id, models.WorkComment.status == "active").count(),
        "favorite_count": db.query(models.Favorite).filter(models.Favorite.target_type == "work", models.Favorite.target_id == work.id).count(),
        "liked": is_liked(db, current_user_id, "work", work.id),
        "favorited": (
            db.query(models.Favorite)
            .filter(models.Favorite.user_id == current_user_id, models.Favorite.target_type == "work", models.Favorite.target_id == work.id)
            .first()
            is not None
            if current_user_id
            else False
        ),
    }


def comment_out(comment, db: Session | None = None, current_user_id: int | None = None) -> dict:
    """评论序列化，支持楼中楼（parent_id / reply_to / reply_count）+ 点赞。"""
    data = {
        "id": comment.id,
        "content": comment.content,
        "image_url": getattr(comment, "image_url", None),
        "pinned": bool(getattr(comment, "pinned", False)),
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
        # 评论作者属地用**发表时快照**（comment.ip_region）
        "user": _brief_with_region(comment.user, comment.ip_region),
        "parent_id": comment.parent_id,
        "reply_to": None,
        "reply_count": 0,
        "like_count": 0,
        "liked": False,
    }
    if comment.parent_id and comment.parent is not None and comment.parent.user is not None:
        # 被引用那条评论的作者：同样用它自己那一条的属地快照
        data["reply_to"] = _brief_with_region(comment.parent.user, comment.parent.ip_region)
    if db is not None:
        if isinstance(comment, models.WorkComment):
            data["reply_count"] = (
                db.query(models.WorkComment).filter(models.WorkComment.parent_id == comment.id).count()
            )
            data["like_count"] = count_likes(db, "work_comment", comment.id)
            data["liked"] = is_liked(db, current_user_id, "work_comment", comment.id)
        elif isinstance(comment, models.PostComment):
            data["reply_count"] = (
                db.query(models.PostComment).filter(models.PostComment.parent_id == comment.id).count()
            )
            data["like_count"] = count_likes(db, "post_comment", comment.id)
            data["liked"] = is_liked(db, current_user_id, "post_comment", comment.id)
    return data


# 聊天的消息序列化由 app/chat_core.py 提供（统一会话模型），此处不再保留旧实现。


def quiet_hours_active(user) -> bool:
    """免打扰时段判断（按 UTC+8 站点时间，支持跨天；如 22:00-08:00）。"""
    try:
        import json as _json

        prefs = _json.loads(user.notify_prefs or "{}")
    except Exception:
        return False
    q = prefs.get("quiet") or {}
    if not q.get("on"):
        return False
    try:
        start = int(q.get("start") or 0) % 24
        end = int(q.get("end") or 0) % 24
    except Exception:
        return False
    if start == end:
        return False
    from datetime import datetime, timezone as _tz

    hour = (datetime.now(_tz.utc).hour + 8) % 24  # UTC -> 北京时间
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def notification_out(n: models.Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "target_type": n.target_type,
        "target_id": n.target_id,
        "content": n.content,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "actor": user_brief(n.actor) if n.actor else None,
    }


_NOTIFY_PREF_KEY = {
    "like": "like",
    "comment": "comment",
    "reply": "reply",
    "follow": "follow",
    "mention": "mention",
    "chat_dm": "chat_dm",       # 聊天消息 · 私聊
    "chat_group": "chat_group",  # 聊天消息 · 群聊
    "studio": "studio",
    "studio_work": "studio",
    "studio_approve": "studio",
    "follow_work": "follow",
    "follow_post": "follow",
    "admin": "admin",
}


def notify_user(
    db: Session,
    recipient_id: int | None,
    actor_id: int | None,
    type_: str,
    target_type: str | None = None,
    target_id: int | None = None,
    content: str = "",
) -> models.Notification | None:
    """创建一条站内通知（不给自己发通知，尊重接收者通知偏好；admin 类强制发送）。会提交当前事务。"""
    if recipient_id is None or recipient_id == actor_id:
        return None
    recipient = db.get(models.User, recipient_id)
    if recipient is None:
        return None
    pref_key = _NOTIFY_PREF_KEY.get(type_)
    if type_ != "admin" and pref_key and recipient.notify_prefs_dict.get(pref_key, True) is False:
        return None
    # 夜间免打扰：设置页的承诺是「免打扰时段内不推送聊群 @ 通知（按北京时间）」。
    # quiet_hours_active() 之前**全仓库没有任何调用点**，等于这个开关是个摆设 —— 现在接上。
    # 只挡 mention（群里 @ 我），管理员通知（type=admin）永远照发，跟文案一致。
    if type_ == "mention" and quiet_hours_active(recipient):
        return None
    n = models.Notification(
        user_id=recipient_id,
        actor_id=actor_id,
        type=type_,
        target_type=target_type,
        target_id=target_id,
        content=content,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    # 实时推送（懒导入避免循环依赖；未建立 socket 连接时静默降级为轮询）
    try:
        from .socket import emit_notification

        emit_notification(recipient_id, notification_out(n))
    except Exception:
        pass
    return n


def notify_followers(
    db: Session,
    actor_id: int,
    type_: str,
    target_type: str,
    target_id: int,
    content: str,
) -> None:
    """通知某用户的所有粉丝（如关注的人发了新稿件/帖子）。"""
    followers = (
        db.query(models.Follow.follower_id)
        .filter(models.Follow.following_id == actor_id)
        .all()
    )
    for (fid,) in followers:
        notify_user(db, fid, actor_id, type_, target_type, target_id, content)


def notify_mentions(
    db: Session,
    actor_id: int,
    actor_name: str,
    content: str,
    target_type: str,
    target_id: int,
    scope: str = "评论",
) -> None:
    """解析文本中的 @用户名 并通知被提及的用户。"""
    for name in set(re.findall(r"@(\w{1,20})", content or "")):
        if not name or name == actor_name:
            continue
        target = db.query(models.User).filter(models.User.username == name).first()
        if target and target.id != actor_id:
            notify_user(db, target.id, actor_id, "mention", target_type, target_id, f"{actor_name} 在{scope}里 @了你")


# ---- 扩展序列化 ----
def folder_out(folder: models.FavoriteFolder, db: Session) -> dict:
    return {
        "id": folder.id,
        "name": folder.name,
        "count": db.query(models.Favorite).filter(models.Favorite.user_id == folder.user_id, models.Favorite.folder_id == folder.id).count(),
        "created_at": folder.created_at.isoformat() if folder.created_at else None,
    }


def history_out(ph: models.PlayHistory, db: Session) -> dict:
    work = db.get(models.Work, ph.work_id)
    return {
        "work": work_out(work, db) if work else None,
        "viewed_at": ph.viewed_at.isoformat() if ph.viewed_at else None,
    }


def banner_out(banner: models.Banner, db: Session) -> dict:
    return {
        "id": banner.id,
        "title": banner.title,
        "image_url": banner.image_url or "",
        "color": getattr(banner, "color", "") or "",
        "target_type": banner.target_type,
        "target_id": banner.target_id,
        "target_url": banner.target_url,
        "sort_order": banner.sort_order,
        "enabled": banner.enabled,
    }


def admin_log_out(log: models.AdminLog) -> dict:
    return {
        "id": log.id,
        "admin": user_brief(log.admin) if log.admin else None,
        "action": log.action,
        "target_type": log.target_type,
        "target_id": log.target_id,
        "detail": log.detail or "",
        "created_at": log.created_at.isoformat() if log.created_at else None,
    }


def log_admin_action(
    db: Session,
    admin_id: int,
    action: str,
    target_type: str | None = None,
    target_id: int | None = None,
    detail: str = "",
) -> None:
    """记录一条管理员操作日志。"""
    db.add(models.AdminLog(admin_id=admin_id, action=action, target_type=target_type, target_id=target_id, detail=detail))
    db.commit()


def notify_admin_action(db: Session, recipient_id: int | None, admin_id: int, content: str, target_type: str | None = None, target_id: int | None = None) -> None:
    """管理员操作 -> 通知被操作用户（type=admin）。"""
    notify_user(db, recipient_id, admin_id, "admin", target_type, target_id, content)


def queue_sensitive_review(db: Session, target_type: str, target_id: int, hits: list[str], user_id: int, title: str = "") -> None:
    """内容命中敏感词：写入审核队列并通知作者（内容已由调用方标记为待审状态）。"""
    db.add(
        models.ContentReview(
            target_type=target_type,
            target_id=target_id,
            sensitive_words=",".join(hits[:10]),
            status="pending",
        )
    )
    notify_user(
        db,
        user_id,
        None,
        "admin",
        target_type,
        target_id,
        f"你的内容《{title or '—'}》因包含敏感词（{'、'.join(hits[:5])}）已被隐藏，等待管理员审核",
    )
