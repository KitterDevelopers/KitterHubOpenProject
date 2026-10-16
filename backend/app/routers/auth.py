"""账号系统：注册、登录、当前用户、找回密码。"""
import hashlib
import logging
import re
import secrets
import time as _time
import urllib.parse
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import codemao, config, emailcheck, emailcode, github, mailer, models, schemas, security, sensitive, serializers, switches
from ..deps import get_current_user, get_db, get_optional_user

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger("nimao.auth")

# 占位/不可达邮箱的判断收口在 config（@codemao.bind 与解绑后的 @nomail.invalid）
def _is_real_email(email: str | None) -> bool:
    return config.is_real_email(email)


def _find_account(db: Session, account: str) -> models.User | None:
    """按「用户名 或 邮箱」找账号。"""
    a = (account or "").strip()
    if not a:
        return None
    user = db.query(models.User).filter(models.User.username == a).first()
    if user is None:
        user = db.query(models.User).filter(models.User.email == a.lower()).first()
    return user


def _send_code(email: str, purpose: str, lang: str = "zh") -> dict:
    """生成并发送验证码；返回值里**不含验证码**（除非站长显式打开了联调开关）。

    lang：界面语言，决定邮件模板用中文还是英文（英文模式的用户不该收到中文邮件）。
    """
    # 固定码模式（邮件服务还没接通时）：注册这一步不发信、不占冷却与配额，
    # 用户直接用约定好的固定码完成注册。找回密码不走这条分支。
    if purpose == "register" and getattr(config, "EMAIL_FIXED_CODE", ""):
        return {"ok": True, "email": email, "ttl": emailcode.CODE_TTL, "cooldown": 0}

    try:
        emailcode.precheck(purpose, email)
    except emailcode.CodeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    code = emailcode.put(purpose, email)
    out = {
        "ok": True,
        "email": email,
        "ttl": emailcode.CODE_TTL,
        "cooldown": emailcode.RESEND_COOLDOWN,
    }
    if config.EMAIL_CODE_ECHO:
        # 联调模式：不真的发信，直接把验证码返回给前端
        out["dev_code"] = code
        out["dev_mode"] = True
        return out

    subject, html, text, images = mailer.verify_code_email(
        code, purpose=purpose, ttl_minutes=emailcode.CODE_TTL // 60, lang=lang
    )
    try:
        mailer.send_email(to=email, subject=subject, html=html, text=text, images=images)
    except mailer.MailError as e:
        emailcode.drop(purpose, email)  # 发送失败就别占着冷却和配额
        raise HTTPException(status_code=503, detail=str(e))
    return out

# ---- 登录/凭据校验防爆破（按账号 15 分钟窗口内最多 6 次失败）----
_LOGIN_FAIL_WINDOW = 900
_LOGIN_FAIL_MAX = 6
_login_fails: dict[str, list[float]] = {}


def _login_failures(key: str) -> int:
    now = _time.time()
    arr = [t for t in _login_fails.get(key, []) if now - t < _LOGIN_FAIL_WINDOW]
    _login_fails[key] = arr
    return len(arr)


def _check_login_blocked(key: str) -> bool:
    return False if not switches.enabled("login_lock") else _login_failures(key) >= _LOGIN_FAIL_MAX


def _note_login_fail(key: str) -> None:
    arr = _login_fails.setdefault(key, [])
    now = _time.time()
    arr[:] = [t for t in arr if now - t < _LOGIN_FAIL_WINDOW]
    arr.append(now)
    if len(arr) > _LOGIN_FAIL_MAX * 2:
        del arr[: len(arr) - _LOGIN_FAIL_MAX * 2]


def _clear_login_fails(key: str) -> None:
    _login_fails.pop(key, None)


# ---- 自动注册限流：全站 30 分钟窗口内最多新建 N 个账号，防马甲批量注册 ----
_REG_WINDOW = 1800
_REG_MAX = 15
_reg_times: list[float] = []


def _check_registration_budget() -> None:
    if not switches.enabled("reg_cap"):
        return
    now = _time.time()
    _reg_times[:] = [t for t in _reg_times if now - t < _REG_WINDOW]
    if len(_reg_times) >= _REG_MAX:
        raise HTTPException(status_code=429, detail="当前新用户注册过于频繁，请稍后再试")
    _reg_times.append(now)


def _gen_uid(db: Session) -> str:
    """生成随机用户编号（8 位数字，保证唯一）。"""
    import random

    while True:
        candidate = str(random.randint(10000000, 99999999))
        if db.query(models.User).filter(models.User.uid == candidate).first() is None:
            return candidate


def _claim_daily_fish(db: Session, user: models.User) -> int:
    """已废弃：小鱼干改成在「经验中心」手动签到领取（见 routers/users.py 的 /me/signin）。

    保留这个空壳是为了不惊动老调用点——登录不再自动发小鱼干，也绝不会偷偷发。
    """
    return 0


@router.post("/email/send-code")
def send_email_code(body: schemas.EmailCodeIn, db: Session = Depends(get_db)):
    """给邮箱发验证码。purpose=register 用于邮箱注册，purpose=reset 用于找回密码。"""
    purpose = "reset" if body.purpose == "reset" else "register"
    email = str(body.email).strip().lower()

    if purpose == "register":
        if not config.EMAIL_REGISTER:
            raise HTTPException(status_code=400, detail="邮箱注册通道暂未开放，请用编程猫账号登录")
        if db.query(models.User).filter(models.User.email == email).first() is not None:
            raise HTTPException(status_code=400, detail="这个邮箱已经注册过了，直接登录就好")
        # 邮箱预检：格式 / 一次性邮箱 / MX 记录。第三方接口不可用时自动放行（见 emailcheck.py）
        reason = emailcheck.check(email)
        if reason:
            raise HTTPException(status_code=400, detail=emailcheck.message(reason))
    else:
        user = _find_account(db, email)
        if user is None:
            raise HTTPException(status_code=404, detail="没有找到这个邮箱对应的账号")
        if not _is_real_email(user.email):
            raise HTTPException(
                status_code=400,
                detail="该账号还没有绑定可用的邮箱，无法用邮箱找回密码；请先登录后在「账号设置」里绑定邮箱",
            )

    # 邮件模板跟随界面语言（英文模式收到英文邮件）
    lang = (getattr(body, "lang", None) or "").strip().lower()[:8]
    return _send_code(email, purpose, lang)


@router.post("/register", status_code=201)
def register(body: schemas.RegisterIn, request: Request, db: Session = Depends(get_db)):
    # 未勾选同意条款不予注册（服务端强制，防止绕过前端；站长 2026-10-02）
    if not getattr(body, "agree_terms", False):
        raise HTTPException(status_code=400, detail="请先阅读并勾选同意《用户协议》《隐私政策》与《社区发言守则》")
    """邮箱注册：必须先通过 /auth/email/send-code 拿到验证码。"""
    if not config.EMAIL_REGISTER:
        raise HTTPException(status_code=400, detail="邮箱注册通道暂未开放，请用编程猫账号登录")

    username = body.username.strip()
    email = body.email.lower().strip()

    if sensitive.contains_sensitive(username, db):
        hits = sensitive.find_sensitive(username, db)
        raise HTTPException(status_code=400, detail=f"用户名包含敏感词：{'、'.join(hits[:5])}，请更换")

    if db.query(models.User).filter(or_(models.User.username == username, models.User.email == email)).first():
        raise HTTPException(status_code=400, detail="用户名或邮箱已被注册")

    # 校验邮箱验证码（放在基础校验之后，避免白白消耗一次验证码尝试）
    try:
        emailcode.check("register", email, body.email_code)
    except emailcode.CodeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    invited_by = None
    if body.invite_code:
        inviter = db.query(models.User).filter(models.User.username == body.invite_code.strip()).first()
        if inviter is None:
            raise HTTPException(status_code=400, detail="邀请码无效")
        invited_by = inviter.id

    _check_registration_budget()
    # reg_lang：注册时界面用的语言（前端在 body 里带 lang）。
    # 目前两种注册来源都进「待实名」：英文邮箱注册必须传护照并等管理员审核。
    reg_lang = (getattr(body, "lang", None) or "").strip().lower()[:8] or None
    user = models.User(
        username=username,
        nickname=(body.nickname or "").strip() or username,
        email=email,
        hashed_password=security.hash_password(body.password),
        invited_by=invited_by,
        uid=_gen_uid(db),
        local_pwd_set=1,  # 自己设了密码，可以直接用「账号 + 密码」登录
        treaty_signed_at=None,
        # 注册后处于「待激活」：不能发评论、改资料、发作品，
        # 需要绑定编程猫账号或通过护照审核（见 verify.py 顶部状态机说明）
        verify_state="awaiting_passport",
        reg_lang=reg_lang,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    emailcode.consume("register", email)

    if invited_by:
        # 邀请奖励：只给邀请人 +500 经验（被邀请人从 0 开始）
        inviter = db.get(models.User, invited_by)
        if inviter:
            db.commit()
            serializers.notify_user(db, inviter.id, user.id, "admin", None, None, f"你邀请的 {user.display_name} 注册成功，获得 {serializers.INVITE_XP} 经验奖励！")

    fish_gained = _claim_daily_fish(db, user)  # 注册即领取当日小鱼干
    # 注册即登录（紧接着就发 token），记一次活跃时间。
    # 与 register_codemao 同一个道理：漏了它，这个账号的 last_login_at 会一直是 NULL。
    user.last_login_at = models.now()
    db.commit()

    token = security.create_access_token({"sub": str(user.id), "ver": user.token_version or 0})
    data = serializers.user_public(user, db, user.id)
    data["daily_fish_gained"] = fish_gained
    return {"access_token": token, "token_type": "bearer", "user": data}


@router.post("/login")
def login(body: schemas.LoginIn, request: Request, db: Session = Depends(get_db)):
    account = body.account.strip()
    gkey = f"login:{account.lower()}"
    if _check_login_blocked(gkey):
        raise HTTPException(status_code=429, detail="该账号尝试登录失败次数过多，请 15 分钟后再试")
    user = (
        db.query(models.User)
        .filter(or_(models.User.username == account, models.User.email == account.lower()))
        .first()
    )
    if user is None:
        _note_login_fail(gkey)
        raise HTTPException(status_code=400, detail="账号或密码错误")
    # 安全规则：编程猫注册的账号在「账号设置」设置本站密码前，禁止用账号密码登录
    if not getattr(user, "local_pwd_set", 0):
        _note_login_fail(gkey)
        raise HTTPException(
            status_code=400,
            detail="该账号为编程猫注册，尚未设置本站密码：请用「编程猫登录」，并在「账号设置」中设置密码后，才能用账号密码登录",
        )
    if not security.verify_password(body.password, user.hashed_password):
        _note_login_fail(gkey)
        raise HTTPException(status_code=400, detail="账号或密码错误")
    if user.is_banned:
        _note_login_fail(gkey)
        raise HTTPException(status_code=403, detail="该账号已被封禁，无法登录")
    if user.is_deactivated:
        _note_login_fail(gkey)
        raise HTTPException(status_code=403, detail="该账号已注销，无法登录")

    # 2026-09-24：原来这里有一道「未激活的账号只允许在英文界面登录」的闸，站长要求
    # 中文版也支持邮箱注册，这道闸必须拆掉 —— 否则中文注册完根本登不进来，
    # 也就走不到 /verify 去激活。账号在激活前依旧不能发内容（CreationGate + verify_state），
    # 所以拆掉它不影响安全边界，只是少了一层语言上的引导。
    _clear_login_fails(gkey)
    user.last_login_at = models.now()
    fish_gained = _claim_daily_fish(db, user)
    db.commit()
    token = security.create_access_token({"sub": str(user.id), "ver": user.token_version or 0})
    data = serializers.user_public(user, db, user.id)
    data["daily_fish_gained"] = fish_gained
    return {"access_token": token, "token_type": "bearer", "user": data}


# ---- 编程猫（Codemao）注册 / 快捷登录 ----
def _codemao_checked(db: Session, identity: str, password: str) -> dict:
    gkey = f"cm:{str(identity or '').strip().lower()}"
    if _check_login_blocked(gkey):
        raise HTTPException(status_code=429, detail="该账号尝试次数过多，请 15 分钟后再试")
    try:
        return codemao.codemao_login(identity, password)
    except codemao.CodemaoError as e:
        _note_login_fail(gkey)
        raise HTTPException(status_code=400, detail=str(e))


def _find_by_codemao_uid(db: Session, cm_uid: str) -> models.User | None:
    return db.query(models.User).filter(models.User.codemao_uid == cm_uid).first()


def _release_deactivated_binding(db: Session, user: models.User) -> None:
    """注销(=删除)的旧账号让出编程猫绑定：解除绑定并把 cm{uid} 用户名/邮箱让给将来的新账号，旧记录保留存档（不删数据）。"""
    cm_uid = user.codemao_uid or ""
    if cm_uid and user.username == f"cm{cm_uid}":
        user.username = f"cm{cm_uid}.del{user.id}"
    if cm_uid:
        user.email = (user.email or "").replace(f"cm{cm_uid}@codemao.bind", f"cm{cm_uid}.del{user.id}@codemao.bind")
    user.codemao_uid = None
    user.codemao_nickname = None
    user.codemao_avatar = None
    db.commit()


@router.post("/register-codemao", status_code=201)
def register_codemao(body: dict, request: Request, db: Session = Depends(get_db)):
    """用编程猫账号注册本站：验证编程猫账号 -> 创建本站账号并绑定，同步昵称/头像。"""
    info = _codemao_checked(db, body.get("identity") or "", body.get("password") or "")
    existing = _find_by_codemao_uid(db, info["uid"])
    if existing is not None:
        if existing.is_banned:
            raise HTTPException(status_code=400, detail="该编程猫账号已被封禁")
        if existing.is_deactivated:
            # 注销=删除：旧号让位，重新注册新号
            _release_deactivated_binding(db, existing)
        else:
            raise HTTPException(status_code=400, detail="该编程猫账号已绑定其他用户，请直接登录")
    # 本站账号：用户名 cm+uid，邮箱用占位域名（不接收真实邮件）
    username = f"cm{info['uid']}"
    email = f"cm{info['uid']}@codemao.bind"
    if db.query(models.User).filter(or_(models.User.username == username, models.User.email == email)).first():
        raise HTTPException(status_code=400, detail="该编程猫账号已注册，请直接登录")
    import random as _r
    import string as _s

    temp_password = "".join(_r.choices(_s.ascii_letters + _s.digits, k=16))  # 随机本站密码（不落库明文）
    invited_by = None
    if body.get("invite_code"):
        inviter = db.query(models.User).filter(models.User.username == body["invite_code"].strip()).first()
        if inviter is None:
            raise HTTPException(status_code=400, detail="邀请码无效")
        invited_by = inviter.id
    user = models.User(
        username=username,
        nickname=info["nickname"] or f"编程猫用户{info['uid'][-4:]}",
        email=email,
        hashed_password=security.hash_password(temp_password),
        avatar_url=info["avatar"],
        uid=_gen_uid(db),
        codemao_uid=info["uid"],
        codemao_nickname=info["nickname"],
        codemao_avatar=info["avatar"],
        invited_by=invited_by,
    )
    _check_registration_budget()
    db.add(user)
    db.commit()
    db.refresh(user)
    # 头像下载到本站（转本地地址，避免外链失效）
    local_avatar = codemao.save_avatar_locally(info["avatar"], user.id)
    if local_avatar and local_avatar != info["avatar"]:
        user.avatar_url = local_avatar
        db.commit()
    if invited_by:
        # 邀请奖励：只给邀请人 +500 经验（被邀请人从 0 开始）
        inviter = db.get(models.User, invited_by)
        if inviter:
            db.commit()
            serializers.notify_user(db, inviter.id, user.id, "admin", None, None, f"你邀请的 {user.display_name} 注册成功，获得 {serializers.INVITE_XP} 经验奖励！")
    # 注册完紧接着就发 token（等于已经登录），所以这里也要记一次活跃时间。
    # 漏了这一行的话，用注册页注册的账号 last_login_at 一直是 NULL，
    # 个人主页会一直显示「很久以前活跃」，直到他下一次登录。
    user.last_login_at = models.now()
    db.commit()
    token = security.create_access_token({"sub": str(user.id), "ver": user.token_version or 0})
    return {"access_token": token, "token_type": "bearer", "user": serializers.user_public(user, db, user.id)}


def _login_or_register_by_codemao(db: Session, info: dict) -> dict:
    """编程猫身份**已核实**之后的统一入口：有账号就登录，没账号就自动注册。

    密码登录（login_codemao）与免密码验证登录（codemao_verify）共用这一份，
    确保两种入口行为完全一致（封禁拦截、注销让位、注册预算、发 token 都一样）。

    「该编程猫号已绑定别的本站账号」不当作冲突：能改那个编程猫号签名/密码的人就是号主本人，
    直接登录那个账号即可 —— 这正是站长定的规则。
    """
    user = _find_by_codemao_uid(db, info["uid"])
    registered = False
    if user is not None and user.is_banned:
        raise HTTPException(status_code=403, detail="该账号已被封禁，无法登录")
    if user is not None and user.is_deactivated:
        if user.is_banned:
            raise HTTPException(status_code=403, detail="该账号已被封禁，无法登录")
        # 注销=删除账号：旧号让出编程猫绑定（旧记录保留存档），按新账号自动注册
        _release_deactivated_binding(db, user)
        user = None
    if user is None:
        # 自动注册：与 register-codemao 相同规则建号（随机本站密码、占位邮箱、绑定编程猫）
        import random as _r
        import string as _s

        base = f"cm{info['uid']}"
        username = base
        email = f"{base}@codemao.bind"
        suffix = 2
        while db.query(models.User).filter(or_(models.User.username == username, models.User.email == email)).first() is not None:
            username = f"{base}_{suffix}"
            email = f"{username}@codemao.bind"
            suffix += 1
        temp_password = "".join(_r.choices(_s.ascii_letters + _s.digits, k=16))
        user = models.User(
            username=username,
            nickname=info["nickname"] or f"编程猫用户{info['uid'][-4:]}",
            email=email,
            hashed_password=security.hash_password(temp_password),
            avatar_url=info["avatar"],
            uid=_gen_uid(db),
            codemao_uid=info["uid"],
            codemao_nickname=info["nickname"],
            codemao_avatar=info["avatar"],
        )
        _check_registration_budget()
        db.add(user)
        db.commit()
        db.refresh(user)
        registered = True
        local_avatar = codemao.save_avatar_locally(info["avatar"], user.id)
        if local_avatar and local_avatar != info["avatar"]:
            user.avatar_url = local_avatar
            db.commit()
    user.last_login_at = models.now()
    db.commit()
    token = security.create_access_token({"sub": str(user.id), "ver": user.token_version or 0})
    data = serializers.user_public(user, db, user.id)
    data["registered"] = registered
    return {"access_token": token, "token_type": "bearer", "user": data}


@router.post("/login-codemao")
def login_codemao(body: dict, request: Request, db: Session = Depends(get_db)):
    """编程猫快捷登录：验证编程猫账号 -> 已绑定则登录；未绑定则自动注册并绑定（一站式注册）。已注销的旧绑定视同删除，自动开新账号。"""
    info = _codemao_checked(db, body.get("identity") or "", body.get("password") or "")
    return _login_or_register_by_codemao(db, info)


# ==========================================================================
# 编程猫「免密码验证」登录
# ==========================================================================
# 起因：很多用户不敢在本站输入编程猫密码。改法 —— 让他把一次性校验码写进
# 编程猫个人主页的「我正在做什么」（公开字段），我们读回来比对，
# 以此证明他控制那个编程猫号，全程不需要密码。
#
# ⚠️ 那个字段是**公开可见**的，所以这个码在有效期内谁都能在他主页看到。
# 安全性完全靠这三点，缺一不可：
#   1. 有效期只有 120 秒（短到没人来得及撞上）
#   2. 一次性（兑换成功即作废该 uid 的所有未用码）
#   3. session_hash 绑定（只有发起发码的那个浏览器会话能兑换 → 光偷到码没用）
CODEMAO_CODE_LEN = 15
CODEMAO_CODE_TTL = 120          # 秒
CODEMAO_CODE_MAX_ATTEMPTS = 5   # 单个码最多试 5 次
CODEMAO_CODE_MIN_INTERVAL = 30  # 同一 uid 两次发码最小间隔（秒）
CODEMAO_CODE_IP_HOURLY = 10     # 同一 IP 每小时最多发码次数
CODEMAO_PROFILE_URL = "https://shequ.codemao.cn/user/{}"
# 去掉易混的 0 O 1 I L U，剩 30 个字符：15 位 ≈ 2^73，不可能猜
CODEMAO_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
_CODE_KEEP = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

# 校验码要写进编程猫个人主页的「我正在做什么」——**那是个公开字段**。
# 随机拼出脏话的拼音首字母（TM / SB / NM …）会被编程猫判成不当内容，
# 严重的话直接处罚账号（站长明确提过这个风险）。所以生成后过一遍黑名单，命中就重生成。
#
# 只列**当前字母表真能拼出来**的组合：字母表里没有 I / L / O / U，
# 所以 NMSL、CAO、DIAO、FUCK、SHIT、BITCH、PORN、SLUT、ANAL、TITS 这些根本不可能出现，不列。
CODEMAO_CODE_BANNED = (
    # 中文网络脏话 / 侮辱的拼音首字母
    "SB", "TM", "NM", "JB", "GB", "WC", "NC", "BZ", "ZZ", "BS",
    "SBB", "SBS", "DSB", "TMD", "NMD", "RNM", "CNM", "NMB", "TMSB", "MDZZ", "WDNMD",
    # 数字谐音（字母表里有 2、没有 0，所以只有 2B 这一族有意义）
    "2B", "2SB",
    # 英文脏话里**拼得出来的**那几个（其余含 I/L/O/U，本就出不来）
    "ASS", "SEX", "XXX", "FAG", "RAPE", "VAG", "DAMN", "CRAP", "ARSE",
)
CODEMAO_CODE_GEN_TRIES = 50


def _code_is_clean(code: str) -> bool:
    """码里不能出现任何黑名单片段（子串匹配，不分位置）。"""
    return not any(bad in code for bad in CODEMAO_CODE_BANNED)


def _gen_codemao_code() -> str:
    """生成一个不会在编程猫公开字段里惹麻烦的校验码。

    拒绝采样：命中黑名单就重生成。按 30 字符表算，单个 2 字母组合约 1.6% 概率出现，
    黑名单里十来个组合加起来约 15% 会被拒 —— 平均 1.2 次就能拿到干净的码。
    万一黑名单以后被加得太激进，兜底退回**纯数字**（数字拼不出字母脏话，必然干净），
    保证这个函数一定返回，不会把登录功能卡死。
    """
    for _ in range(CODEMAO_CODE_GEN_TRIES):
        code = "".join(secrets.choice(CODEMAO_CODE_ALPHABET) for _ in range(CODEMAO_CODE_LEN))
        if _code_is_clean(code):
            return code
    digits = "23456789"
    return "".join(secrets.choice(digits) for _ in range(CODEMAO_CODE_LEN))


def _hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _norm_code(value: str) -> str:
    """归一化：转大写 + 只保留字母数字。

    用户可能把码粘在原有签名中间、或者带空格/连字符，所以核验时两边都归一化后做子串匹配。
    """
    return "".join(ch for ch in str(value or "").upper() if ch in _CODE_KEEP)


def _cm_ip(request: Request) -> str:
    return (request.client.host if request.client else "") or ""


_last_hijack_alert = [0.0]


def _alert_code_ip_mismatch(cm_uid: str, issue_ip: str, redeem_ip: str) -> None:
    """兑换 IP 与发码 IP 不一致 —— 可能是码在公开字段里被别人偷了。记日志，并且最多每小时发一封告警邮件。"""
    log.warning("免密码验证：兑换 IP 与发码 IP 不一致 uid=%s 发码=%s 兑换=%s", cm_uid, issue_ip, redeem_ip)
    now = _time.time()
    if now - _last_hijack_alert[0] < 3600:
        return
    to = (getattr(config, "MAIL_ALERT_TO", "") or getattr(config, "SMTP_USER", "") or "").strip()
    if not to:
        return
    try:
        if not mailer.is_configured():
            return
        _last_hijack_alert[0] = now
        body_txt = (
            f"编程猫免密码验证：兑换时的 IP 与发码时的 IP 不一致，可能有人在公开的「我正在做什么」里偷到了校验码。\n\n"
            f"训练师编号：{cm_uid}\n发码 IP：{issue_ip}\n兑换 IP：{redeem_ip}\n"
        )
        mailer.send_email(
            to=to,
            subject="[KitterHub] 免密码验证：兑换 IP 与发码 IP 不一致",
            html=f"<pre style='font-family:ui-monospace,Consolas,monospace'>{body_txt}</pre>",
            text=body_txt,
        )
    except Exception as e:  # noqa: BLE001 告警失败不能影响登录
        log.warning("免密码验证告警邮件发送失败：%s", e)


@router.post("/codemao/code")
def codemao_code(body: dict, request: Request, db: Session = Depends(get_db)):
    """免密码验证 · 第一步：给训练师编号发一个一次性校验码（同时把他的原签名带回去展示）。"""
    payload = body or {}
    # 只保留 ASCII 数字（\D 会放过 Unicode 数字，这里更严格）
    cm_uid = re.sub(r"[^0-9]", "", str(payload.get("codemao_uid") or ""))
    if not cm_uid or len(cm_uid) > 20:
        raise HTTPException(status_code=400, detail="请填写训练师编号（一串数字）")
    ip = _cm_ip(request)

    # 同一 uid 发码最小间隔
    latest = (
        db.query(models.CodemaoCode)
        .filter(models.CodemaoCode.codemao_uid == cm_uid)
        .order_by(models.CodemaoCode.id.desc())
        .first()
    )
    if latest is not None and latest.created_at is not None:
        age = (models.now() - serializers.as_utc(latest.created_at)).total_seconds()
        if age < CODEMAO_CODE_MIN_INTERVAL:
            wait = int(CODEMAO_CODE_MIN_INTERVAL - age) + 1
            raise HTTPException(status_code=429, detail=f"请求太频繁了，请 {wait} 秒后再试")

    # 同一 IP 每小时发码上限（在 Python 里比时间，避免 SQLite 里 naive/aware 混比出问题）
    recent = (
        db.query(models.CodemaoCode)
        .filter(models.CodemaoCode.request_ip == ip)
        .order_by(models.CodemaoCode.id.desc())
        .limit(60)
        .all()
    )
    hourly = sum(
        1 for r in recent
        if r.created_at is not None and (models.now() - serializers.as_utc(r.created_at)).total_seconds() < 3600
    )
    if hourly >= CODEMAO_CODE_IP_HOURLY:
        raise HTTPException(status_code=429, detail="同一网络发码次数过多了，请过一会儿再试")

    # 查编程猫公开资料：确认编号存在，顺便拿到昵称/头像/他当前的签名
    try:
        info = codemao.codemao_honor(cm_uid)
    except codemao.CodemaoUserNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except codemao.CodemaoBadUid as e:
        raise HTTPException(status_code=400, detail=str(e))
    except codemao.CodemaoError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # 一次只允许一个有效码：作废该 uid 之前所有未用码
    db.query(models.CodemaoCode).filter(
        models.CodemaoCode.codemao_uid == cm_uid,
        models.CodemaoCode.used_at.is_(None),
    ).update({"used_at": models.now()}, synchronize_session=False)

    # 注意：必须走 _gen_codemao_code()，它会避开会惹上编程猫审核的脏话组合
    code = _gen_codemao_code()
    session_token = secrets.token_urlsafe(32)
    db.add(
        models.CodemaoCode(
            codemao_uid=cm_uid,
            code=code,
            session_hash=_hash_token(session_token),
            prev_doing=info["doing"],
            expires_at=models.now() + timedelta(seconds=CODEMAO_CODE_TTL),
            request_ip=ip,
        )
    )

    # 顺手清理 1 小时前的旧行，避免表无限增长（按 id 取最早 200 行在 Python 里比时间）
    cutoff = models.now() - timedelta(hours=1)
    for old in db.query(models.CodemaoCode).order_by(models.CodemaoCode.id.asc()).limit(200).all():
        if old.created_at is not None and serializers.as_utc(old.created_at) < cutoff:
            db.delete(old)

    db.commit()
    return {
        "code": code,
        "session_token": session_token,
        "expires_in": CODEMAO_CODE_TTL,
        "uid": cm_uid,
        "nickname": info["nickname"],
        "avatar": info["avatar"],
        "current_doing": info["doing"],
        "profile_url": CODEMAO_PROFILE_URL.format(cm_uid),
    }


@router.post("/codemao/verify")
def codemao_verify(body: dict, request: Request, db: Session = Depends(get_db)):
    """免密码验证 · 第二步：读回「我正在做什么」比对校验码，通过则直接登录/注册。"""
    payload = body or {}
    # 只保留 ASCII 数字（\D 会放过 Unicode 数字，这里更严格）
    cm_uid = re.sub(r"[^0-9]", "", str(payload.get("codemao_uid") or ""))
    session_token = str(payload.get("session_token") or "")
    if not cm_uid or not session_token:
        raise HTTPException(status_code=400, detail="缺少参数，请重新发起验证")

    row = (
        db.query(models.CodemaoCode)
        .filter(
            models.CodemaoCode.codemao_uid == cm_uid,
            models.CodemaoCode.session_hash == _hash_token(session_token),
        )
        .order_by(models.CodemaoCode.id.desc())
        .first()
    )
    if row is None:
        raise HTTPException(status_code=400, detail="验证信息已失效，请重新发起")
    if row.used_at is not None:
        raise HTTPException(status_code=400, detail="这个校验码已经用过了，请重新发起")
    if row.expires_at is not None and serializers.as_utc(row.expires_at) < models.now():
        raise HTTPException(status_code=400, detail="校验码已过期，请重新发起")
    if (row.attempts or 0) >= CODEMAO_CODE_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="尝试次数太多了，请重新发起验证")

    row.attempts = (row.attempts or 0) + 1
    db.commit()

    # 核验必须读最新值（绕过缓存），否则会读到他改签名之前的旧数据
    try:
        info = codemao.codemao_honor(cm_uid, use_cache=False)
    except codemao.CodemaoUserNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except codemao.CodemaoBadUid as e:
        raise HTTPException(status_code=400, detail=str(e))
    except codemao.CodemaoError as e:
        raise HTTPException(status_code=503, detail=str(e))

    if _norm_code(row.code) not in _norm_code(info["doing"]):
        left = max(CODEMAO_CODE_MAX_ATTEMPTS - (row.attempts or 0), 0)
        raise HTTPException(
            status_code=400,
            detail=f"在他的主页「我正在做什么」里没找到校验码，保存成功了再试（还可尝试 {left} 次）",
        )

    # 命中：作废该 uid 的所有未用码（一次性）
    row.used_at = models.now()
    db.query(models.CodemaoCode).filter(
        models.CodemaoCode.codemao_uid == cm_uid,
        models.CodemaoCode.used_at.is_(None),
    ).update({"used_at": models.now()}, synchronize_session=False)
    db.commit()

    if row.request_ip and row.request_ip != _cm_ip(request):
        _alert_code_ip_mismatch(cm_uid, row.request_ip, _cm_ip(request))

    resp = _login_or_register_by_codemao(db, info)
    # 交给前端提示他「把签名改回去」，并给出他原来的内容
    resp["prev_doing"] = row.prev_doing or ""
    return resp


@router.get("/me")
def me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serializers.user_public(user, db, user.id)


# ==========================================================================
# GitHub OAuth 登录 / 绑定
# ==========================================================================
# state —— 服务端生成、一次性消费、10 分钟过期。
# 没有它就有 CSRF：攻击者把带自己 code 的链接骗受害者点开，
# 受害者浏览器就会把**攻击者的 GitHub** 绑到他自己的账号上。
_GITHUB_STATES: dict[str, dict] = {}
_GITHUB_STATE_TTL = 600


def _gc_states() -> None:
    now = _time.time()
    for k, v in list(_GITHUB_STATES.items()):
        if now - v["ts"] > _GITHUB_STATE_TTL:
            _GITHUB_STATES.pop(k, None)


def _unique_username(db: Session, base: str) -> str:
    name = base
    suffix = 2
    while db.query(models.User).filter(models.User.username == name).first() is not None:
        name = f"{base}_{suffix}"
        suffix += 1
    return name


def _release_github_binding(db: Session, user: models.User) -> None:
    """注销(=删除)的旧账号让出 GitHub 绑定（旧记录保留存档，不删数据）。"""
    gh = user.github_id or ""
    if gh and user.username == f"gh{gh}":
        user.username = f"gh{gh}.del{user.id}"
    if gh:
        user.email = (user.email or "").replace(f"gh{gh}@github.bind", f"gh{gh}.del{user.id}@github.bind")
    user.github_id = None
    user.github_login = ""
    user.github_avatar = None
    db.commit()


# 回调失败时回传给前端的**短码**（前端有对应中英文案；不要把中文塞进 URL）
_GH_ERROR_TEXT = {
    "state": "这次 GitHub 登录已失效或重复使用，请重新点击登录",
    "taken": "这个 GitHub 账号已经绑定了其他 KitterHub 账号",
    "banned": "该账号已被封禁，无法登录",
    "notconf": "GitHub 登录暂未开放",
    "fail": "GitHub 授权失败，请重试",
    "denied": "你取消了 GitHub 授权",
    "expired": "登录状态已失效，请重新登录后再绑定",
    # 2026-09-24：中文模式已开放 GitHub 登录，need_en 不再会被发出；
    # 这一条和前端 auth.ghErrNeedEn 一起留着只是为了兼容老书签/老缓存，不删。
    "need_en": "GitHub 登录仅支持英文模式，请先切换到 English 再登录",
    "gh_down": "GitHub 服务暂时不可用，请稍后重试",
}

# 一次性票据：回调处理完 → 302 回前端带票据 → 前端用票据换登录态。
# 这样 JWT 不会出现在地址栏 / 浏览器历史 / Referer 里。
_GITHUB_TICKETS: dict[str, dict] = {}
_GITHUB_TICKET_TTL = 300


def _gc_tickets() -> None:
    now = _time.time()
    for k, v in list(_GITHUB_TICKETS.items()):
        if now - v["ts"] > _GITHUB_TICKET_TTL:
            _GITHUB_TICKETS.pop(k, None)


def _github_apply(db: Session, rec: dict, info: dict, current_user: models.User | None = None) -> tuple[bool, str, dict]:
    """把 GitHub 身份落到本站账号上。返回 (是否成功, 错误短码, 结果)。

    绑定场景靠 state 里记的 uid 认人（回调是浏览器裸 GET，带不了 Authorization 头）；
    state 是服务端生成的随机串、一次性、10 分钟过期，所以不会被别人冒用。
    """
    # ---- 绑定到已有账号 ----
    if rec["intent"] == "bind":
        uid = rec.get("uid")
        if not uid:
            return False, "expired", {}
        if current_user is not None and current_user.id != uid:
            return False, "expired", {}
        target = db.get(models.User, uid)
        if target is None:
            return False, "expired", {}
        taken = db.query(models.User).filter(models.User.github_id == info["id"], models.User.id != target.id).first()
        if taken is not None:
            return False, "taken", {}
        target.github_id = info["id"]
        target.github_login = info["login"]
        # 头像存本地（GitHub 的 CDN 国内经常连不上）；本地化失败就留外链
        local_avatar = github.save_avatar_locally(info["avatar"], target.id)
        target.github_avatar = local_avatar or info["avatar"]
        if not (target.avatar_url or "").strip():
            target.avatar_url = target.github_avatar
        db.commit()
        return True, "", {"intent": "bind", "uid": target.id}

    # ---- 登录 / 自动注册 ----
    existing = db.query(models.User).filter(models.User.github_id == info["id"]).first()
    if existing is not None and existing.is_banned:
        return False, "banned", {}
    # 2026-09-24 起中文模式也开放 GitHub 登录（原来这里有一道「仅英文模式」的闸，
    # 站长要求取消）。新注册的账号照样是「待激活」，激活方式见下面注册分支的注释。
    if existing is not None and existing.is_deactivated:
        _release_github_binding(db, existing)  # 注销=删除：旧号让位，按新号注册
        existing = None

    registered = False
    if existing is None:
        # 邮箱优先用 GitHub 上已验证的那个；被占用或没有就退回占位地址（可在账号设置里改绑）
        email = info["email"]
        if not email or db.query(models.User).filter(models.User.email == email).first() is not None:
            email = f"gh{info['id']}@github.bind"
            if db.query(models.User).filter(models.User.email == email).first() is not None:
                email = f"gh{info['id']}.{int(_time.time())}@github.bind"
        import random as _r
        import string as _s

        temp_password = "".join(_r.choices(_s.ascii_letters + _s.digits, k=16))  # 随机本站密码（不落库明文）
        user = models.User(
            username=_unique_username(db, f"gh{info['id']}"),
            nickname=info["name"] or info["login"] or f"GitHub用户{info['id'][-4:]}",
            email=email,
            hashed_password=security.hash_password(temp_password),
            avatar_url=info["avatar"],
            uid=_gen_uid(db),
            github_id=info["id"],
            github_login=info["login"],
            github_avatar=info["avatar"],
            # ★ GitHub 注册的新账号一律「待激活」：二选一
            #   ① 绑定编程猫账号（立即激活，见 users.bind_codemao）
            #   ② 上传护照个人信息页 → 管理员审核通过
            # 页面对应的就是 /verify，两条路都摆在那一页上。
            verify_state="awaiting_passport",
            reg_lang=(rec.get("lang") or "zh").strip().lower()[:8] or "zh",
        )
        _check_registration_budget()
        db.add(user)
        db.commit()
        db.refresh(user)
        # 头像落到本地：GitHub 的 avatars.githubusercontent.com 国内经常连不上，
        # 不本地化的话前端 onError 会把 <img> 隐藏掉，只剩字母头像。
        local_avatar = github.save_avatar_locally(info["avatar"], user.id)
        if local_avatar:
            user.avatar_url = local_avatar
            user.github_avatar = local_avatar
            db.commit()
        registered = True
    else:
        user = existing
        # 同步一下 GitHub 用户名，头像不动（用户可能在本站换过头像）
        if info["login"] and (user.github_login or "") != info["login"]:
            user.github_login = info["login"]
            db.commit()

    return True, "", {"intent": "login", "uid": user.id, "registered": registered}


@router.post("/github/authorize-url")
def github_authorize_url(body: dict, user: models.User | None = Depends(get_optional_user)):
    """拿 GitHub 授权地址。

    intent=login  登录 / 自动注册；不需要登录；**中英文都可以**（2026-09-24 起取消了英文限制）
    intent=bind   绑定到已有账号；需要登录
    """
    intent = "bind" if (body or {}).get("intent") == "bind" else "login"
    lang = ((body or {}).get("lang") or "").strip().lower()[:8]
    if not github.enabled():
        raise HTTPException(
            status_code=400,
            detail="GitHub 登录暂未开放（站长还没在服务器上配置 GitHub OAuth 的 Client ID / Secret）",
        )
    if intent == "bind":
        if user is None:
            raise HTTPException(status_code=401, detail="请先登录再绑定 GitHub")
        if user.github_id:
            raise HTTPException(status_code=400, detail="你的账号已经绑定过 GitHub 了，请先解绑")

    _gc_states()
    state = secrets.token_urlsafe(24)
    _GITHUB_STATES[state] = {
        "intent": intent,
        "uid": user.id if (intent == "bind" and user) else None,
        "lang": lang or "zh",
        "ts": _time.time(),
    }
    return {"url": github.authorize_url(state), "state": state}


def _github_session_payload(db: Session, uid: int, registered: bool) -> dict:
    """给一个已经确认身份的账号签发登录态（/exchange 与 /claim 共用）。"""
    user = db.get(models.User, uid)
    if user is None:
        raise HTTPException(status_code=400, detail="账号不存在，请重新登录")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="该账号已被封禁，无法登录")
    user.last_login_at = models.now()
    fish_gained = _claim_daily_fish(db, user)
    db.commit()
    token = security.create_access_token({"sub": str(user.id), "ver": user.token_version or 0})
    data = serializers.user_public(user, db, user.id)
    data["daily_fish_gained"] = fish_gained
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": data,
        "registered": registered,
        "intent": "login",
    }


@router.post("/github/exchange")
def github_exchange(body: dict, user: models.User | None = Depends(get_optional_user), db: Session = Depends(get_db)):
    """用 GitHub 回跳带来的 code 完成登录或绑定（前端直接回调时用）。

    现在 GitHub 那边的回调地址是后端的 `/auth/github/callback`，线上走的是
    「callback → 一次性票据 → /claim」；这个接口保留给「回调打到前端」的部署方式，
    两条路复用同一套 _github_apply 逻辑。
    """
    if not github.enabled():
        raise HTTPException(status_code=400, detail="GitHub 登录暂未开放")

    code = ((body or {}).get("code") or "").strip()
    state = ((body or {}).get("state") or "").strip()
    if not code or not state:
        raise HTTPException(status_code=400, detail="GitHub 回调参数不完整，请重新点击登录")
    _gc_states()
    rec = _GITHUB_STATES.pop(state, None)  # 一次性：用过就作废
    if rec is None:
        raise HTTPException(status_code=400, detail="这次 GitHub 登录已失效或重复使用，请重新点击登录")

    try:
        info = github.fetch_user(github.exchange_code(code))
    except github.GitHubError as e:
        log.warning("GitHub exchange 失败（transient=%s）：%s", getattr(e, "transient", False), e)
        raise HTTPException(status_code=400, detail=str(e))

    ok, code_word, payload = _github_apply(db, rec, info, current_user=user)
    if not ok:
        raise HTTPException(status_code=400, detail=_GH_ERROR_TEXT.get(code_word, "GitHub 登录失败，请重试"))

    # ★ 这里必须返回**登录态**，不能直接把 _github_apply 的内部结果丢出去
    #   （第一版就是这样，导致前端拿不到 token/user）
    if payload["intent"] == "bind":
        target = db.get(models.User, payload["uid"])
        return {"ok": True, "intent": "bind", "user": serializers.user_public(target, db, target.id)}
    return _github_session_payload(db, payload["uid"], bool(payload.get("registered")))


def _frontend_url(path: str, **params) -> str:
    base = (config.GITHUB_FRONTEND_BASE or "").rstrip("/")
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    return f"{base}{path}" + (f"?{q}" if q else "")


@router.get("/github/callback")
def github_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """GitHub 授权后浏览器回到这里（注册在 GitHub 上的 Redirect URI 就是这个）。

    这里**不发 token**，只把结果换成一个一次性票据（5 分钟、用掉即废），
    然后 302 回前端；前端拿票据换登录态。这样 JWT 永远不会出现在地址栏 / 历史记录 / Referer 里。
    """
    back = "/login"
    if error:
        return RedirectResponse(_frontend_url(back, gh_error="denied"), status_code=302)
    if not github.enabled():
        return RedirectResponse(_frontend_url(back, gh_error="notconf"), status_code=302)
    if not code or not state:
        return RedirectResponse(_frontend_url(back, gh_error="state"), status_code=302)

    _gc_states()
    rec = _GITHUB_STATES.pop(state, None)
    if rec is None:
        return RedirectResponse(_frontend_url(back, gh_error="state"), status_code=302)

    try:
        info = github.fetch_user(github.exchange_code(code))
    except github.GitHubError as e:
        # 记进服务日志（journalctl -u nimao 能看到），否则线上出问题只剩一句「授权失败」，无从查起
        log.warning("GitHub 回调换取用户信息失败（transient=%s）：%s", getattr(e, "transient", False), e)
        return RedirectResponse(
            _frontend_url(back, gh_error=("gh_down" if getattr(e, "transient", False) else "fail")),
            status_code=302,
        )

    ok, code_word, payload = _github_apply(db, rec, info)
    if not ok:
        return RedirectResponse(_frontend_url(back, gh_error=code_word), status_code=302)

    _gc_tickets()
    ticket = secrets.token_urlsafe(24)
    _GITHUB_TICKETS[ticket] = {
        "intent": rec["intent"],
        "uid": payload["uid"],
        "registered": payload.get("registered", False),
        "ts": _time.time(),
    }
    if rec["intent"] == "bind":
        return RedirectResponse(_frontend_url("/settings", gh=ticket), status_code=302)
    return RedirectResponse(_frontend_url("/login", gh=ticket), status_code=302)


@router.post("/github/claim")
def github_claim(body: dict, db: Session = Depends(get_db)):
    """用回调给的一次性票据换登录态（或确认绑定完成）。"""
    ticket = ((body or {}).get("ticket") or "").strip()
    _gc_tickets()
    rec = _GITHUB_TICKETS.pop(ticket, None)  # 一次性
    if rec is None:
        raise HTTPException(status_code=400, detail="这次 GitHub 登录已失效，请重新点击登录")

    user = db.get(models.User, rec["uid"])
    if user is None:
        raise HTTPException(status_code=400, detail="账号不存在，请重新登录")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="该账号已被封禁，无法登录")

    if rec["intent"] == "bind":
        return {"ok": True, "intent": "bind", "user": serializers.user_public(user, db, user.id)}

    return _github_session_payload(db, rec["uid"], bool(rec.get("registered")))


# ---- 找回密码（邮箱验证码自助重置）----
@router.post("/forgot")
def forgot(body: schemas.ForgotIn, db: Session = Depends(get_db)):
    """按账号绑定的邮箱发送重置验证码。"""
    user = _find_account(db, body.account)
    if user is None:
        raise HTTPException(status_code=404, detail="没有找到这个账号，请检查用户名 / 邮箱")
    if not _is_real_email(user.email):
        raise HTTPException(
            status_code=400,
            detail="该账号还没有绑定可用的邮箱，没法用邮箱找回密码；请先登录后在「账号设置」里绑定邮箱",
        )
    # 邮件语言：优先用当前界面语言，其次用注册时记录的语言
    lang = (getattr(body, "lang", None) or "").strip().lower()[:8] or (user.reg_lang or "").strip().lower()[:8]
    return _send_code(user.email.strip().lower(), "reset", lang)


@router.post("/reset_password")
def reset_password(body: schemas.ResetPasswordIn, db: Session = Depends(get_db)):
    """校验邮箱验证码并设置新密码。"""
    user = _find_account(db, body.account)
    if user is None:
        raise HTTPException(status_code=404, detail="没有找到这个账号")
    email = (user.email or "").strip().lower()

    try:
        emailcode.check("reset", email, body.code)
    except emailcode.CodeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail)

    user.hashed_password = security.hash_password(body.password)
    user.local_pwd_set = 1  # 设置过本站密码后即可用「账号 + 密码」登录
    user.token_version = (user.token_version or 0) + 1  # 旧登录态全部失效
    db.commit()
    emailcode.consume("reset", email)
    return {"ok": True}
