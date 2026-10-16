"""SQLAlchemy 数据模型。"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    uid = Column(String(16), unique=True, index=True, nullable=True)  # 用户编号（随机，不暴露注册顺序）
    username = Column(String(50), unique=True, index=True, nullable=False)  # 登录账号（唯一、不可改）
    nickname = Column(String(50), default="")  # 昵称（显示名，可改）
    email = Column(String(120), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    avatar_url = Column(String(500), nullable=True)
    cover_url = Column(String(500), nullable=True)  # 个人主页背景图
    show_cover = Column(Boolean, default=False)  # 是否展示背景图（默认不展示）
    show_level_badge = Column(Boolean, default=False)  # 【旧】是否展示本站等级徽章（已被 badge_choice 取代，仅留作迁移依据）
    show_codemao_badge = Column(Boolean, default=False)  # 【旧】是否展示编程猫等级徽章（同上）
    # 展示哪一个徽章（站长 2026-09-30：两个徽章**只能选一个**，默认展示编程猫的）：
    #   'codemao' = 编程猫作者等级徽章（默认）
    #   'site'    = 本站等级徽章（六边形）
    #   'none'    = 都不展示
    # NULL 视为 'codemao'（新注册用户与历史数据都走这个默认）。见 serializers.badge_choice()。
    badge_choice = Column(String(10), nullable=True)
    # ---- 编程猫作者等级徽章（个人主页可选展示，默认不展示）----
    # 等级本身缓存在用户行上：个人主页渲染时只读缓存，**不去调编程猫接口**，
    # 免得第三方接口的延迟/故障被带进主页（等级在经验中心读到后刷新，见 routers/users.py）。
    show_codemao_badge = Column(Boolean, default=False)  # 是否在个人主页展示（默认不展示）
    codemao_author_level = Column(Integer, default=0)  # 最近一次读到的编程猫作者等级（0=未知/无徽章）
    codemao_level_at = Column(DateTime, nullable=True)  # 上面这个等级是什么时候读到的
    bio = Column(Text, default="")
    role = Column(String(20), default="user")  # user / admin
    is_banned = Column(Boolean, default=False)  # 永久封禁
    ban_until = Column(DateTime, nullable=True)  # 临时封禁到期时间（到期自动解封）
    featured_work_ids = Column(String(100), default="")  # 个人主页精选稿件（逗号分隔，最多3个）
    is_deactivated = Column(Boolean, default=False)  # 账号已注销（软注销）
    deactivated_at = Column(DateTime, nullable=True)
    notify_prefs = Column(Text, default="{}")  # JSON 通知偏好
    treaty_signed_at = Column(DateTime, nullable=True)  # 友好条约签订时间（LV1 门槛）
    verification_title = Column(String(100), default="")  # 官方认证头衔
    verification_type = Column(String(10), nullable=True)  # blue 蓝标 / gold 黄标
    interests = Column(String(100), default="")  # 领域标签（逗号分隔，最多3个）
    xp_bonus = Column(Integer, default=0)  # 额外经验（管理员调整、历史奖励；签到/投喂/邀请是算出来的，不放这里）
    invited_by = Column(Integer, nullable=True)  # 邀请人 user_id
    last_login_at = Column(DateTime, nullable=True)
    codemao_uid = Column(String(32), unique=True, index=True, nullable=True)  # 绑定的编程猫 uid
    codemao_nickname = Column(String(50), default="")  # 编程猫昵称（绑定时同步）
    codemao_avatar = Column(String(500), nullable=True)  # 编程猫头像（绑定时同步）
    # PickCat 社区绑定（只存 UID/昵称/头像，密码不落库）
    pickcat_uid = Column(String(64), nullable=True, index=True)
    pickcat_nickname = Column(String(64), default='')
    pickcat_avatar = Column(String(300), nullable=True)
    pickcat_at = Column(DateTime, nullable=True)
    # ---- 编程猫作者等级奖励（经验中心「一键加满」；见 serializers.CODEMOA_*）----
    codemao_xp_bonus = Column(Integer, default=0)  # 编程猫等级奖励的经验（一次性领取后累加，解绑也不回收）
    codemao_xp_level = Column(Integer, default=0)  # 已领取到的编程猫等级（0=从未领取；等级升上去后还能再领一次）
    # ---- 绑定奖励（经验中心「绑定领经验」，一项只能领一次）----
    # 存「什么时候领的」而不是布尔量：明细里能显示领取时间，也不会出现「标记了但没给经验」的错位。
    # ⚠️ 解绑**不清空**这三列 —— 站长定的规则是「每个只能领取一次」，领过就是领过。
    bind_xp_codemao_at = Column(DateTime, nullable=True)  # 绑定编程猫账号奖励领取时间
    bind_xp_github_at = Column(DateTime, nullable=True)   # 绑定 GitHub 奖励领取时间
    bind_xp_email_at = Column(DateTime, nullable=True)    # 绑定邮箱奖励领取时间
    # ---- GitHub OAuth 登录 / 绑定（与编程猫同一套思路）----
    github_id = Column(String(32), unique=True, index=True, nullable=True)  # GitHub 数字 id（字符串存）
    github_login = Column(String(64), default="")  # GitHub 用户名（绑定时同步）
    github_avatar = Column(String(500), nullable=True)  # GitHub 头像（绑定时同步）
    local_pwd_set = Column(Integer, default=0)  # 是否已设置本站登录密码（编程猫注册用户默认0，设过密码后为1）
    # ---- 英文模式邮箱注册的实名审核（护照）----
    # ok              老用户与编程猫用户，不受任何限制
    # awaiting_passport 邮箱注册后还没传护照
    # pending_review    已传护照，等管理员审核
    # rejected          审核不通过，可重新上传
    verify_state = Column(String(20), default="ok", index=True)
    passport_file = Column(String(200), nullable=True)  # 私有目录里的文件名（nginx 不挂载，仅管理员可读）
    passport_at = Column(DateTime, nullable=True)  # 上传时间
    verify_reviewed_at = Column(DateTime, nullable=True)
    verify_reviewed_by = Column(Integer, nullable=True)  # 审核人 user id
    verify_note = Column(Text, default="")  # 审核备注 / 驳回原因
    reg_lang = Column(String(8), nullable=True)  # 注册时的界面语言 zh / en
    gender = Column(String(10), nullable=True)  # 性别：male / female / secret
    show_personal = Column(Boolean, default=True)  # 是否在主页公开性别
    # ---- IP 属地（个人主页 / 评论上显示「IP属地」）----
    # 只存**归属地**，不存历史轨迹：ip_region 是最近一次识别的结果，
    # 每次访问用 last_ip 重新判定并按 ip_region_at 节流刷新（见 iplocate.py）。
    ip_region = Column(String(50), default="")  # 最近识别的属地（辽宁省 / 香港特别行政区 / 美国 …）
    last_ip = Column(String(64), nullable=True)  # 最近一次访问 IP（内部判定用，不对外展示）
    show_ip_region = Column(Boolean, default=True)  # 是否展示（默认展示，账号设置里可关）
    # 豁免违禁词审核（站长 2026-09-27 加）：开了之后**他发的内容**不检测敏感词、不进审核队列；
    # 注册名/改昵称/工作室名等仍然照常检测（见 sensitive.hits()）。
    sensitive_exempt = Column(Boolean, default=False, server_default="0")
    # Scratch 作品容量配额（MB）。**已作废**（站长 2026-09-27 换成下面的账号总存储配额），
    # 列先留着不删（SQLite 删列麻烦），迁移时把已有数字搬到 storage_quota_mb。
    scratch_quota_mb = Column(Integer, nullable=True)
    # 账号存储空间配额（MB）＝这个账号上传的**全部**文件（.sb3 源文件、头像/背景/封面、
    # 帖子与评论配图、聊天图片与语音、工作室与系列封面、反馈附件…）。
    # NULL = 用站点默认值（config.STORAGE_PER_USER_MB，默认 500MB）；管理员批了扩容就写这里。
    # 见 app/storage_quota.py。
    storage_quota_mb = Column(Integer, nullable=True)
    ip_region_at = Column(DateTime, nullable=True)  # 属地更新时间（节流：默认 1 小时）
    pending_email = Column(String(120), nullable=True)  # 待确认的新邮箱（二次确认后生效）
    pending_email_at = Column(DateTime, nullable=True)  # 申请换绑时间（24 小时内确认）
    ban_reason = Column(String(200), default="")  # 封禁原因（展示给被封用户）
    # ---- 社区风纪委员（站长 2026-10-01）----
    #   NULL / 空 = 普通用户；pending = 已申请待审；active = 在职风纪委员；
    #   rejected = 申请未通过；suspended = 被停职（保留记录，可恢复）
    # 加入条件：LV3 及以上可申请（见 app/committee.py 的 MIN_LEVEL），管理员审批后上任。
    committee_status = Column(String(16), nullable=True)
    committee_reason = Column(Text, default="")     # 申请理由快照（管理员审批时看）
    committee_at = Column(DateTime, nullable=True)  # 状态变更时间（通过 / 停职等）
    token_version = Column(Integer, default=0)  # 修改密码后 +1，旧 token 失效
    fish_count = Column(Integer, default=0)  # 小鱼干数量（投喂/每日领取）
    last_fish_date = Column(String(10), nullable=True)  # 最近签到日期 YYYY-MM-DD（签到才发小鱼干+经验）
    signin_days = Column(Integer, default=0)  # 累计签到天数（签到经验 = 天数 × 10）
    xp_feed_given = Column(Integer, default=0)  # 投喂他人累计获得的经验（每日上限只在发放时卡）
    feed_xp_date = Column(String(10), nullable=True)  # 投喂经验当日日期（用于每日上限）
    feed_xp_today = Column(Integer, default=0)  # 当日已获得的投喂经验
    subscribed_topics = Column(Text, default="")  # 订阅的话题（逗号分隔），有新帖时通知
    created_at = Column(DateTime, default=now)

    posts = relationship("Post", back_populates="author", cascade="all, delete-orphan")
    works = relationship("Work", back_populates="author", cascade="all, delete-orphan")

    @property
    def featured_list(self) -> list[int]:
        return [int(x) for x in (self.featured_work_ids or "").split(",") if x.strip().isdigit()]

    @property
    def display_name(self) -> str:
        """显示名：有昵称用昵称，否则用用户名。"""
        return self.nickname or self.username

    @property
    def effective_banned(self) -> bool:
        """实际封禁状态：永久封禁 或 临时封禁未到期。"""
        if self.is_banned:
            return True
        if self.ban_until:
            bu = self.ban_until
            if bu.tzinfo is None:  # SQLite 读出的时间无时区，按 UTC 处理
                bu = bu.replace(tzinfo=timezone.utc)
            if bu > now():
                return True
        return False

    @property
    def notify_prefs_dict(self) -> dict:
        import json

        try:
            prefs = json.loads(self.notify_prefs or "{}")
        except Exception:
            prefs = {}
        # chat_dm / chat_group：聊天消息通知（私聊 / 群聊），**默认开启**，在账号设置里分开关。
        # 与 mention 的关系：群里 @ 我属于群聊消息通知，需要 mention 和 chat_group 都为真。
        # chat_sound：新消息提示音（默认开启，纯前端行为，存这里只是为了跟账号走）。
        defaults = {
            "like": True, "comment": True, "reply": True, "follow": True, "mention": True,
            "studio": True, "admin": True, "chat_dm": True, "chat_group": True, "chat_sound": True,
        }
        defaults.update(prefs)
        return defaults


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    status = Column(String(20), default="published")  # published / pending（敏感词待审） / rejected
    # ---- IP 属地快照（**发布时**的属地，个人主页用的是实时属地，二者语义不同）----
    # 内容一经发布就固定下来：作者之后搬去别处，旧帖子/旧评论上显示的仍是发布时那一处。
    ip_region = Column(String(50), default="")
    category = Column(String(50), default="讨论")
    topics = Column(String(200), default="")  # 逗号分隔的话题 #话题#
    views = Column(Integer, default=0)
    is_pinned = Column(Boolean, default=False)  # 管理员置顶
    is_featured = Column(Boolean, default=False)  # 管理员加精
    owner_pinned = Column(Boolean, default=False)  # 作者自己置顶（最多 1 个）
    poll = Column(Text, default="")  # JSON 投票 {question, options:[{id,text,votes}], voted_user_ids:[], deadline: ISO}
    image_url = Column(String(500), nullable=True)  # 帖子配图（本站上传）
    feed_count = Column(Integer, default=0)  # 收到的小鱼干总数
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now, onupdate=now)
    edited_at = Column(DateTime, nullable=True)  # 最近编辑时间（留痕）

    author = relationship("User", back_populates="posts")
    comments = relationship("PostComment", back_populates="post", cascade="all, delete-orphan")

    @property
    def poll_data(self):
        import json

        if not self.poll:
            return None
        try:
            return json.loads(self.poll)
        except Exception:
            return None


class Work(Base):
    __tablename__ = "works"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    # ---- IP 属地快照（**发布时**的属地，个人主页用的是实时属地，二者语义不同）----
    # 内容一经发布就固定下来：作者之后搬去别处，旧帖子/旧评论上显示的仍是发布时那一处。
    ip_region = Column(String(50), default="")
    # work_type: "url" 直接内嵌网址；"editor" 通过编辑器+编号拼接；"scratch" 本地上传的 .sb3
    work_type = Column(String(20), default="url")
    source_url = Column(String(500), nullable=True)      # url 类型的原始网址
    editor_code = Column(String(20), nullable=True)      # 编辑器 code，如 kitten4 / KN
    editor_work_id = Column(String(100), nullable=True)  # 稿件编号
    # ---- Scratch 作品（.sb3 上传）----
    # sb3_url 是本站自己的直链（/uploads/games/<sha256前16>.sb3），播放时交给 TurboWarp；
    # sha256 用来判重（同一个人不能把同一份文件投两次），size 用来展示与配额。
    sb3_url = Column(String(500), nullable=True)
    sb3_sha256 = Column(String(64), nullable=True)
    sb3_size = Column(Integer, default=0)
    cover_url = Column(String(500), nullable=True)
    category = Column(String(50), default="其他")
    tags = Column(String(200), default="")  # 逗号分隔的标签
    views = Column(Integer, default=0)
    is_pinned = Column(Boolean, default=False)  # 全站置顶
    is_featured = Column(Boolean, default=False)  # 官方精选（首页展示）
    status = Column(String(20), default="published")  # published / pending / rejected / scheduled（审核流）
    derived_from = Column(Integer, nullable=True)  # 二创：改编自的稿件 id
    is_repost = Column(Boolean, default=False)  # 转载作品（非本人原作）
    original_url = Column(String(500), default="")  # 转载作品的原作链接
    edited_at = Column(DateTime, nullable=True)  # 最近编辑时间（留痕）
    scheduled_at = Column(DateTime, nullable=True)  # 定时发布时间（到时自动上架）
    appeal = Column(Text, nullable=True)  # 被下架/驳回后的申诉理由
    feed_count = Column(Integer, default=0)  # 收到的小鱼干总数
    created_at = Column(DateTime, default=now)

    author = relationship("User", back_populates="works")
    comments = relationship("WorkComment", back_populates="work", cascade="all, delete-orphan")

    @property
    def play_url(self) -> str | None:
        """计算最终可内嵌的播放地址。仅放行 http/https，其余协议一律不返回（防 javascript: 等注入）。"""
        from . import config

        if self.work_type == "url":
            u = (self.source_url or "").strip()
            return u if u.startswith(("http://", "https://")) else None
        if self.work_type == "scratch":
            # 交给 TurboWarp 播放器；PUBLIC_BASE_URL 没配时返回 None（前端自己拼）
            return config.build_scratch_play_url(self.sb3_url)
        return config.build_play_url(self.editor_code, self.editor_work_id)

    @property
    def tag_list(self) -> list[str]:
        return [t.strip() for t in (self.tags or "").split(",") if t.strip()]


class PostComment(Base):
    __tablename__ = "post_comments"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("post_comments.id"), nullable=True)  # 回复的评论
    content = Column(Text, nullable=False)
    image_url = Column(String(500), nullable=True)  # 评论配图
    pinned = Column(Boolean, default=False)  # 楼主置顶优质评论
    # ---- IP 属地快照（**发布时**的属地，个人主页用的是实时属地，二者语义不同）----
    # 内容一经发布就固定下来：作者之后搬去别处，旧帖子/旧评论上显示的仍是发布时那一处。
    ip_region = Column(String(50), default="")
    status = Column(String(20), default="active")  # active 正常 / pending 敏感词待审（隐藏）
    created_at = Column(DateTime, default=now)

    post = relationship("Post", back_populates="comments")
    user = relationship("User")
    parent = relationship("PostComment", remote_side=[id], foreign_keys=[parent_id])


class WorkComment(Base):
    __tablename__ = "work_comments"

    id = Column(Integer, primary_key=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("work_comments.id"), nullable=True)  # 回复的评论
    content = Column(Text, nullable=False)
    image_url = Column(String(500), nullable=True)  # 评论配图
    pinned = Column(Boolean, default=False)  # 作者置顶优质评论
    # ---- IP 属地快照（**发布时**的属地，个人主页用的是实时属地，二者语义不同）----
    # 内容一经发布就固定下来：作者之后搬去别处，旧帖子/旧评论上显示的仍是发布时那一处。
    ip_region = Column(String(50), default="")
    status = Column(String(20), default="active")  # active 正常 / pending 敏感词待审（隐藏）
    created_at = Column(DateTime, default=now)

    work = relationship("Work", back_populates="comments")
    user = relationship("User")
    parent = relationship("WorkComment", remote_side=[id], foreign_keys=[parent_id])


class Like(Base):
    """通用点赞：target_type 取值 work / post。"""
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("user_id", "target_type", "target_id", name="uq_like"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String(20), nullable=False)
    target_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=now)


class Favorite(Base):
    """通用收藏：target_type 取值 work / post。"""
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "target_type", "target_id", name="uq_favorite"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String(20), nullable=False)  # work / post
    target_id = Column(Integer, nullable=False)
    folder_id = Column(Integer, ForeignKey("favorite_folders.id"), nullable=True)  # 收藏夹
    created_at = Column(DateTime, default=now)


class FavoriteFolder(Base):
    """自定义收藏夹。"""
    __tablename__ = "favorite_folders"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=now)


class PlayHistory(Base):
    """浏览/播放历史（最近玩过）。"""
    __tablename__ = "play_history"
    __table_args__ = (UniqueConstraint("user_id", "work_id", name="uq_play_history"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False)
    viewed_at = Column(DateTime, default=now, onupdate=now)

    work = relationship("Work")


class AdminLog(Base):
    """管理员操作日志。"""
    __tablename__ = "admin_logs"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(50), nullable=False)  # ban / unban / edit_user / delete_work ...
    target_type = Column(String(20), nullable=True)  # user / work / post / comment / studio
    target_id = Column(Integer, nullable=True)
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=now)

    admin = relationship("User", foreign_keys=[admin_id])


class PasswordReset(Base):
    """找回密码（演示版：无邮件服务，重置码直接返回）。"""
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    code = Column(String(64), unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now)


class Banner(Base):
    """首页轮播 Banner（管理员管理）。"""
    __tablename__ = "banners"

    id = Column(Integer, primary_key=True)
    title = Column(String(100), nullable=False)
    image_url = Column(String(500), default="")
    # 轮播底色（#rrggbb）。没有配图时就是它铺底；留空则用站点品牌色 primary。
    color = Column(String(20), default="")
    target_type = Column(String(20), default="none")  # none / work / post / url
    target_id = Column(Integer, nullable=True)
    target_url = Column(String(500), nullable=True)
    sort_order = Column(Integer, default=0)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "following_id", name="uq_follow"),)

    id = Column(Integer, primary_key=True)
    follower_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    following_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    grp = Column(String(20), default="")  # 关注分组：好友/大神/同事/默认
    silent = Column(Boolean, default=False)  # 悄悄关注（不通知对方）
    created_at = Column(DateTime, default=now)


class UserBlock(Base):
    """拉黑用户：对方的内容全站不可见。"""
    __tablename__ = "user_blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block"),)

    id = Column(Integer, primary_key=True)
    blocker_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    blocked_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=now)


# ===========================================================================
# 聊天（全新统一模型）
#   私聊 / 群聊都是 ChatThread，成员关系在 ChatMember，消息在 ChatMessage。
#   旧模型（Conversation / Message / ChatRoom / ChatRoomMember / RoomRead /
#   ConversationSetting）已废弃，数据归档后不再使用。
# ===========================================================================
class ChatThread(Base):
    """聊天会话（私聊与群聊统一）。

    kind='dm'    私聊：两人一条，靠 ChatDmIndex 去重，title 为空
    kind='group' 群聊：title/announcement/avatar_url 生效；studio_id 非空 = 工作室群
    """
    __tablename__ = "chat_threads"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(10), nullable=False, default="dm", index=True)
    title = Column(String(100), default="")
    avatar_url = Column(String(500), nullable=True)
    announcement = Column(Text, default="")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    studio_id = Column(Integer, ForeignKey("studios.id"), nullable=True, index=True)
    mute_all_until = Column(DateTime, nullable=True)  # 全员禁言到期时间
    last_message_at = Column(DateTime, nullable=True, index=True)  # 会话列表排序用
    created_at = Column(DateTime, default=now)

    owner = relationship("User", foreign_keys=[owner_id])


class ChatMember(Base):
    """会话成员（私聊两人、群聊多人统一）。"""
    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("thread_id", "user_id", name="uq_chat_member"),)

    id = Column(Integer, primary_key=True)
    thread_id = Column(Integer, ForeignKey("chat_threads.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), default="member")  # owner / admin / member
    muted = Column(Boolean, default=False)  # 单人禁言
    pinned = Column(Boolean, default=False)  # 置顶会话
    notify_off = Column(Boolean, default=False)  # 免打扰
    last_read_message_id = Column(Integer, default=0)  # 已读水位（未读统计用）
    joined_at = Column(DateTime, default=now)

    user = relationship("User")


class ChatMessage(Base):
    """聊天消息（私聊/群聊统一，归属于 thread_id）。"""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("chat_threads.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content = Column(Text, default="")
    image_url = Column(String(500), nullable=True)
    voice_url = Column(String(500), nullable=True)
    voice_duration = Column(Integer, nullable=True)
    reply_to_id = Column(Integer, nullable=True)
    recalled = Column(Boolean, default=False)
    deleted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now, index=True)

    sender = relationship("User")


class ChatDmIndex(Base):
    """私聊去重索引：确保同一对用户只有一条私聊会话。"""
    __tablename__ = "chat_dm_index"
    __table_args__ = (UniqueConstraint("user_a", "user_b", name="uq_chat_dm"),)

    id = Column(Integer, primary_key=True)
    thread_id = Column(Integer, ForeignKey("chat_threads.id"), nullable=False)
    user_a = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_b = Column(Integer, ForeignKey("users.id"), nullable=False)


class Studio(Base):
    __tablename__ = "studios"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    announcement = Column(Text, default="")
    avatar_url = Column(String(500), nullable=True)
    cover_url = Column(String(500), nullable=True)  # 工作室封面
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    join_mode = Column(String(20), default="open")  # open 直接加入 / approval 需审核
    category = Column(String(20), default="综合", index=True)  # 游戏 / 美术 / 音乐 / 综合
    status = Column(String(20), default="active", index=True)  # active 正常 / frozen 冻结只读 / banned 封禁隐藏
    invite_code = Column(String(20), nullable=True, index=True)  # 邀请码（凭码可直接加入）
    # 加入条件：原来是 entry_rules 里的一坨 JSON，每次读取都要解析；现已拆成三列
    min_level = Column(Integer, default=0)  # 加入所需最低等级，0 = 不限
    multi_studio_only = Column(Boolean, default=False)  # True = 禁止多室籍（成员只能有这一个工作室）
    apply_required = Column(Boolean, default=False)  # True = 申请时必须填留言
    member_limit = Column(Integer, default=50)  # 成员数上限（按创建者等级扩展）
    pending_owner_id = Column(Integer, nullable=True, index=True)  # 转让待确认的目标用户
    created_at = Column(DateTime, default=now, index=True)

    owner = relationship("User")

    @property
    def entry_rules_dict(self) -> dict:
        """向后兼容旧调用点：把三列再拼回字典。"""
        return {
            "min_level": int(self.min_level or 0),
            "multi_studio_only": bool(self.multi_studio_only),
            "apply_required": bool(self.apply_required),
        }


class StudioMember(Base):
    __tablename__ = "studio_members"
    __table_args__ = (
        UniqueConstraint("studio_id", "user_id", name="uq_studio_member"),
        Index("ix_studio_members_studio_status", "studio_id", "status"),
        Index("ix_studio_members_user_status", "user_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    studio_id = Column(Integer, ForeignKey("studios.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(20), default="member")  # owner / admin / member
    status = Column(String(20), default="active")  # active / pending（待审核）
    muted = Column(Boolean, default=False)  # 禁言
    apply_note = Column(Text, default="")  # 申请留言
    joined_at = Column(DateTime, default=now)
    reviewed_at = Column(DateTime, nullable=True)  # 审核通过/驳回时间
    reviewed_by = Column(Integer, nullable=True)  # 审核人 user id

    user = relationship("User")


class StudioWork(Base):
    __tablename__ = "studio_works"
    __table_args__ = (
        UniqueConstraint("studio_id", "work_id", name="uq_studio_work"),
        Index("ix_studio_works_studio_status", "studio_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    studio_id = Column(Integer, ForeignKey("studios.id"), nullable=False, index=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False, index=True)
    # active 已上墙 / pending 待审核 / rejected 已驳回（保留记录，作者能看到原因并可重新投稿）
    status = Column(String(20), default="active")
    pinned = Column(Boolean, default=False)  # 作品墙置顶（室长选最多 3 个）
    reject_reason = Column(Text, default="")  # 驳回原因
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, nullable=True)
    added_at = Column(DateTime, default=now)

    work = relationship("Work")


class StudioBan(Base):
    """工作室黑名单：被移出的用户禁止再次申请加入。"""
    __tablename__ = "studio_bans"
    __table_args__ = (UniqueConstraint("studio_id", "user_id", name="uq_studio_ban"),)

    id = Column(Integer, primary_key=True)
    studio_id = Column(Integer, ForeignKey("studios.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=now)

    user = relationship("User")


class StudioFollow(Base):
    """关注工作室：关注后收到工作室动态通知。"""
    __tablename__ = "studio_follows"
    __table_args__ = (UniqueConstraint("user_id", "studio_id", name="uq_studio_follow"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    studio_id = Column(Integer, ForeignKey("studios.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=now)


class Notification(Base):
    """站内通知：点赞/评论/回复/关注等事件。"""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # 接收者
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 触发者
    type = Column(String(30), nullable=False)  # like / comment / reply / follow
    target_type = Column(String(20), nullable=True)  # work / post / comment / user
    target_id = Column(Integer, nullable=True)
    content = Column(Text, default="")
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now)

    actor = relationship("User", foreign_keys=[actor_id])


class SearchHot(Base):
    """热搜词：搜索时累加计数，云端展示。"""
    __tablename__ = "search_hot"

    id = Column(Integer, primary_key=True)
    keyword = Column(String(50), unique=True, index=True, nullable=False)
    count = Column(Integer, default=1)
    updated_at = Column(DateTime, default=now)


class RecycleBin(Base):
    """内容回收站：删除的稿件/帖子暂存，可恢复。"""
    __tablename__ = "recycle_bin"

    id = Column(Integer, primary_key=True)
    target_type = Column(String(20), nullable=False)  # work / post
    target_id = Column(Integer, nullable=False)
    title = Column(String(200), default="")
    reason = Column(String(200), default="")  # 删除原因（管理员/作者/自动）
    deleted_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now)


class Report(Base):
    """举报：对稿件/帖子/评论的举报，管理员审核处理。"""
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("reporter_id", "target_type", "target_id", name="uq_report"),)

    id = Column(Integer, primary_key=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String(20), nullable=False)  # work / post / comment / studio
    target_id = Column(Integer, nullable=False)
    reason = Column(String(50), default="其他")
    status = Column(String(20), default="pending")  # pending / handled / dismissed
    created_at = Column(DateTime, default=now)
    # 处理留痕（2026-09-24 补）：谁处理的、什么时候、为什么这么判
    handled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    handled_at = Column(DateTime, nullable=True)
    note = Column(String(200), default="")

    reporter = relationship("User", foreign_keys=[reporter_id])
    handler = relationship("User", foreign_keys=[handled_by])


class Draft(Base):
    """草稿箱：帖子/稿件自动保存的草稿（同一类型可有多份）。"""
    __tablename__ = "drafts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    draft_type = Column(String(20), nullable=False)  # post / work
    data = Column(Text, default="{}")  # JSON 字符串
    updated_at = Column(DateTime, default=now, onupdate=now)


class EventClaim(Base):
    """限时活动奖励的领取记录（例如「9 月 30 日当天登录送 300 经验 + 100 小鱼干」）。

    为什么单开一张表，而不是往 users 上加一列：
      · 活动是一个接一个来的，加列就得反复改表结构；这里 `event_key` 一行一个活动。
      · 经验要能**算出来**：经验明细里的「活动奖励」直接 SUM 这张表，不需要另设累加器，
        也就不会出现「奖励发了但经验没加上」的错位（本站的经验一直是这种算法优先的风格）。
      · `(user_id, event_key)` 唯一约束顺手解决并发重复发放：两个请求同时进来只会成功一条。
    """
    __tablename__ = "event_claims"
    __table_args__ = (UniqueConstraint("user_id", "event_key", name="uq_event_claim"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    event_key = Column(String(60), nullable=False, index=True)  # 活动标识（见 app/events.py）
    xp = Column(Integer, default=0)      # 这次发了多少经验
    fish = Column(Integer, default=0)    # 这次发了多少小鱼干
    created_at = Column(DateTime, default=now, index=True)


class MapLight(Base):
    """「锦绣山河·点亮中国」里被点亮的省。

    站长 2026-09-27 定的口径：**活动期间（10.1 00:00 起）有该省用户访问过站点**才算点亮
    （不是「历史上有该省用户」，所以活动一开始地图是暗的，靠人来点亮）。

    一行一个省，`(event_key, region)` 唯一 —— 并发请求同时点亮同一个省时只会成功一条，
    和 event_claims 一个思路。`first_*` 记的是「谁在什么时候点亮了这个省」，
    用来在页面上播报「XX省已点亮」。
    """
    __tablename__ = "map_lights"
    __table_args__ = (UniqueConstraint("event_key", "region", name="uq_map_light_region"),)

    id = Column(Integer, primary_key=True)
    event_key = Column(String(60), nullable=False, index=True)
    region = Column(String(50), nullable=False)        # 省级行政区全称（辽宁省 / 新疆维吾尔自治区）
    first_at = Column(DateTime, default=now, nullable=False, index=True)
    first_uid = Column(String(32), default="")         # 点亮者 uid（访客点亮的为空）
    first_nickname = Column(String(64), default="")


class ScratchQuotaRequest(Base):
    """账号存储扩容申请（原「Scratch 作品容量」申请，表名沿用不改，省一次迁移）。

    站长 2026-09-27 起的规则（见 app/storage_quota.py）：
      · 默认每人 **500MB**（`config.STORAGE_PER_USER_MB`，可被环境变量覆盖）；
      · 空间算的是这个账号上传的**全部**文件（.sb3 源文件、图片、语音、附件…），不只是作品；
      · 用户级配额在 `users.storage_quota_mb`（NULL = 用默认值）；
      · **用到剩余不足 50MB**（`config.STORAGE_QUOTA_APPLY_REMAINING_MB`）才有资格申请；
      · 管理员在后台审核：通过时填「新配额(MB)」，驳回可写理由；
      · 申请人同一时间只允许有一条 pending（重复提交会被挡下）。
    这张表只记「申请与审批过程」，真正的配额数字始终以 users.storage_quota_mb 为准。
    """
    __tablename__ = "scratch_quota_requests"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    used_mb = Column(Integer, default=0)      # 申请时的已用量（MB，向上取整）
    quota_mb = Column(Integer, default=0)     # 申请时的配额（MB）
    message = Column(Text, default="")        # 申请人写的说明
    status = Column(String(16), default="pending", index=True)   # pending / approved / rejected
    created_at = Column(DateTime, default=now, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    grant_mb = Column(Integer, nullable=True)  # 批下来的**新配额**（MB）
    admin_note = Column(Text, default="")      # 管理员备注 / 驳回理由


class SiteSetting(Base):
    """站点设置（键值对）：如全站公告。"""
    __tablename__ = "site_settings"

    key = Column(String(50), primary_key=True)
    value = Column(Text, default="")


class SensitiveWord(Base):
    """敏感词（存数据库，管理员可动态增删；builtin=1 表示内置词，可删除）。"""
    __tablename__ = "sensitive_words"

    id = Column(Integer, primary_key=True)
    word = Column(String(50), unique=True, nullable=False)
    builtin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now)


class ContentReview(Base):
    """内容复审队列：命中敏感词、或被风纪委员隐藏的内容，等管理员裁决。

    站长 2026-10-01 加的风纪委员系统**复用这张表**，靠 `source` 区分来源：
      · source = 'sensitive'：命中敏感词自动进队（原有逻辑）；
      · source = 'committee'：风纪委员巡逻时「先隐藏、再送审」，`reviewer_id` 记是谁办的，
        `reviewer_note` 是他写的理由。管理员「通过」＝内容没问题（这一票算该委员误判），
        「驳回」＝维持隐藏并可按原逻辑追加处罚。
    两个来源共用管理端同一套 approve / reject 处理逻辑（见 routers/admin.py）。
    """
    __tablename__ = "content_reviews"

    id = Column(Integer, primary_key=True)
    target_type = Column(String(20), nullable=False)  # work / post / work_comment / post_comment
    target_id = Column(Integer, nullable=False)
    sensitive_words = Column(String(200), default="")  # 逗号分隔命中的敏感词
    status = Column(String(20), default="pending")  # pending / approved / rejected
    penalty = Column(String(50), default="")  # 审核拒绝时追加的惩罚：warn / mute / ban / xp
    penalty_detail = Column(String(200), default="")  # 惩罚说明（如禁言天数）
    created_at = Column(DateTime, default=now)
    handled_at = Column(DateTime, nullable=True)
    handled_by = Column(Integer, nullable=True)  # 管理员 user id
    # ---- 风纪委员送审（站长 2026-10-01）----
    source = Column(String(16), default="sensitive", index=True)  # sensitive / committee
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 送审的风纪委员
    reviewer_note = Column(String(200), default="")  # 风纪委员写的理由
    # 谁把它结掉的：'' 未结 / 'admin' 管理员裁决 / 'committee_vote' 风纪委员投票判定无违规。
    # 用途：投票判定无违规**不算送审人的误判**（内容有争议，不是明显办错），统计里要能区分。
    resolved_by = Column(String(16), default="")


class CommitteeVote(Base):
    """风纪委员对「待审内容」的投票（站长 2026-10-01）。

    规则：**3 位风纪委员都投「无违规」→ 判定无违规**（`app/committee.py` 的 `VOTE_THRESHOLD`）。
    判定通过后：内容恢复展示、复审记录按「内容没问题」结掉、这条内容上还没处理的举报一并驳回，
    并通知作者。投票只记「无违规」一种（赞成票），不做反对票 —— 站长原话只有「无违规」。

    唯一约束 `(voter_id, target_type, target_id)`：一人一条、不可改（避免刷票/反复横跳）。
    """
    __tablename__ = "committee_votes"
    __table_args__ = (UniqueConstraint("voter_id", "target_type", "target_id", name="uq_committee_vote"),)

    id = Column(Integer, primary_key=True)
    voter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String(20), nullable=False)  # work / post / work_comment / post_comment
    target_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=now, index=True)


class Reaction(Base):
    """表情回应：对稿件/帖子/评论快速回应。"""
    __tablename__ = "reactions"
    __table_args__ = (UniqueConstraint("user_id", "target_type", "target_id", "emoji", name="uq_reaction"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String(20), nullable=False)  # work / post / work_comment / post_comment
    target_id = Column(Integer, nullable=False)
    emoji = Column(String(10), nullable=False)
    created_at = Column(DateTime, default=now)


class PostVersion(Base):
    """帖子编辑历史（保留最近版本，供管理员查看）。"""
    __tablename__ = "post_versions"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    title = Column(String(200), default="")
    content = Column(Text, default="")
    created_at = Column(DateTime, default=now)


class WorkVersion(Base):
    """稿件编辑历史（保留最近版本，供管理员查看）。"""
    __tablename__ = "work_versions"

    id = Column(Integer, primary_key=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False, index=True)
    title = Column(String(200), default="")
    description = Column(Text, default="")
    created_at = Column(DateTime, default=now)


class ChatBlock(Base):
    """私聊黑名单：屏蔽后对方无法再给你发私聊。"""
    __tablename__ = "chat_blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id", name="uq_chat_block"),)

    id = Column(Integer, primary_key=True)
    blocker_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    blocked_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=now)


class Series(Base):
    """稿件系列：作者把稿件归入系列。"""
    __tablename__ = "series"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    cover_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now)


class SeriesWork(Base):
    __tablename__ = "series_works"
    __table_args__ = (UniqueConstraint("series_id", "work_id", name="uq_series_work"),)

    id = Column(Integer, primary_key=True)
    series_id = Column(Integer, ForeignKey("series.id"), nullable=False)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False)
    added_at = Column(DateTime, default=now)

    work = relationship("Work")


class Collection(Base):
    """公开精选集：把喜欢的稿件整理成可分享的专题。"""
    __tablename__ = "collections"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=now)


class CollectionItem(Base):
    __tablename__ = "collection_items"
    __table_args__ = (UniqueConstraint("collection_id", "work_id", name="uq_collection_item"),)

    id = Column(Integer, primary_key=True)
    collection_id = Column(Integer, ForeignKey("collections.id"), nullable=False)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False)
    added_at = Column(DateTime, default=now)

    work = relationship("Work")


class Friendship(Base):
    """好友关系：双向各存一条 active 记录。"""
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("user_id", "friend_id", name="uq_friendship"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    friend_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="pending")  # pending / active
    created_at = Column(DateTime, default=now)


class WorkRating(Base):
    """试玩评价：评分 + 快捷标签。"""
    __tablename__ = "work_ratings"
    __table_args__ = (UniqueConstraint("work_id", "user_id", name="uq_work_rating"),)

    id = Column(Integer, primary_key=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    score = Column(Integer, default=5)  # 1-5 星
    tags = Column(String(100), default="")  # 逗号分隔（好玩/卡顿/烧脑/画面好）
    created_at = Column(DateTime, default=now, onupdate=now)


class WorkView(Base):
    """稿件浏览去重记录：同用户/同IP 30 分钟内只计一次浏览。"""
    __tablename__ = "work_views"

    id = Column(Integer, primary_key=True)
    work_id = Column(Integer, ForeignKey("works.id"), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)  # 未登录为 None
    ip = Column(String(50), default="")
    viewed_at = Column(DateTime, default=now, index=True)


class Feedback(Base):
    """用户反馈：报 Bug / 提建议（页脚「意见反馈」入口）。"""
    __tablename__ = "feedbacks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 未登录也可反馈
    kind = Column(String(20), default="suggestion")  # bug / suggestion / other
    title = Column(String(120), default="")
    content = Column(Text, nullable=False)
    contact = Column(String(200), default="")  # 邮箱/QQ 等联系方式（可选）
    status = Column(String(20), default="open")  # open / done
    reply = Column(Text, nullable=True)  # 管理员回复（可选）
    media = Column(Text, default="")  # 附件 JSON：[{type:'image'|'video', url:'/uploads/xx'}]
    created_at = Column(DateTime, default=now)
    handled_at = Column(DateTime, nullable=True)

    user = relationship("User")


class AuditLog(Base):
    """安全审计日志：自动记录后台写操作 + 登录/改密/注销等敏感请求（含操作人与IP）。"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=now, index=True)
    user_id = Column(Integer, nullable=True)  # 操作人（未登录为 None）
    username = Column(String(60), default="")  # 操作人用户名快照（防账号被删后丢线索）
    method = Column(String(10), default="")
    path = Column(String(300), default="")
    status = Column(Integer, default=0)
    ip = Column(String(64), default="")
    detail = Column(String(500), default="")


class CodemaoCode(Base):
    """编程猫「免密码验证」登录的一次性校验码。

    流程：用户把 code 写进编程猫个人主页的「我正在做什么」，我们读回来比对，
    以此证明他控制那个编程猫号 —— 好处是**用户永远不用在本站输入编程猫密码**。

    ⚠️ 「我正在做什么」是**公开字段**，所以这个码在有效期内谁都能在他主页看到。
    安全性完全依赖三点，缺一不可：
      1. 有效期只有 120 秒（CODEMAO_CODE_TTL）
      2. 一次性：兑换成功即作废该 uid 的所有未用码
      3. session_hash 绑定：只有发起发码的那个浏览器会话能兑换（光偷到码没用）
    """
    __tablename__ = "codemao_codes"

    id = Column(Integer, primary_key=True)
    codemao_uid = Column(String(32), index=True, nullable=False)
    code = Column(String(32), nullable=False)
    session_hash = Column(String(64), index=True, nullable=False)  # sha256(token)，不存明文
    prev_doing = Column(Text, default="")  # 发码时他原来的签名，登录后提示他改回去
    attempts = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=now, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    request_ip = Column(String(64), default="")  # 仅用于「兑换 IP ≠ 发码 IP」的盗码告警


class Upload(Base):
    """上传文件登记表。

    storage_quota 依据本表统计每个用户**已登记**的上传占用（与"扫描作品引用到的文件"
    互为兜底：used_bytes 取两者较大值）。文件被删除或作品被清空时，由
    unregister_upload / purge 相应减少记录。
    """

    __tablename__ = "uploads"

    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, index=True)
    path = Column(String(400), unique=True, index=True)
    size = Column(Integer, default=0)
    kind = Column(String(16), default="")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
