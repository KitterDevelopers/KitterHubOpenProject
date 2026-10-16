"""Pydantic 请求/响应模型（请求体校验为主，序列化交给 serializers.py）。"""
from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    nickname: str | None = Field(default=None, max_length=50)  # 可选，默认等于用户名
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    email_code: str = Field(min_length=4, max_length=8)  # 邮箱验证码（注册前必须先获取）
    invite_code: str | None = None  # 邀请码（可选）
    # 注册必须勾选同意《用户协议》《隐私政策》《社区发言守则》（站长 2026-10-02）
    agree_terms: bool = False
    lang: str | None = None  # 注册时的界面语言 zh / en，记进 users.reg_lang


class EmailCodeIn(BaseModel):
    email: EmailStr
    purpose: str = "register"  # register 注册 / reset 找回密码
    # 当前界面语言：决定验证码邮件用中文还是英文模板
    lang: str | None = None


class LoginIn(BaseModel):
    account: str = Field(min_length=1, description="用户名或邮箱")
    password: str
    # 当前界面语言。2026-09-24 起不再用于限制登录（原来「待实名账号只能英文模式登录」的
    # 闸已拆掉），保留字段是为了兼容老前端与日志排查。
    lang: str | None = None


class UserUpdate(BaseModel):
    avatar_url: str | None = None
    cover_url: str | None = None
    show_cover: bool | None = None
    show_level_badge: bool | None = None  # 【旧】是否在个人主页展示本站等级徽章（已由 badge_choice 取代）
    show_codemao_badge: bool | None = None  # 【旧】是否展示编程猫等级徽章
    # 展示哪一个徽章：codemao（编程猫，默认）/ site（本站等级）/ none（都不展示）
    badge_choice: str | None = None
    bio: str | None = None
    nickname: str | None = Field(default=None, max_length=50)  # 用户名不可改
    gender: str | None = None  # male / female / secret
    show_personal: bool | None = None  # 是否在主页公开性别
    show_ip_region: bool | None = None  # 是否展示 IP 属地（默认展示）


class PostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    category: str = "讨论"
    poll: dict | None = None  # 可选投票 {question, options:[text,...]}
    image_url: str | None = None  # 帖子配图（本站上传）


class PostUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    category: str | None = None
    poll: dict | None = None
    image_url: str | None = None


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None  # 回复某条评论（楼中楼）
    image_url: str | None = None  # 评论配图（可选）


class WorkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    work_type: str = Field(default="url", pattern="^(url|editor|scratch)$")
    source_url: str | None = None
    editor_code: str | None = None
    editor_work_id: str | None = None
    sb3_url: str | None = None  # Scratch 作品文件（先调 /api/upload/scratch 拿到）
    cover_url: str | None = None
    category: str = "其他"
    tags: str = ""  # 逗号分隔的标签
    publish_mode: str = Field(default="auto", pattern="^(auto|review)$")  # auto 直接发布 / review 提交审核
    derived_from: int | None = None  # 二创：改编自的稿件 id
    is_original: bool = False  # 原创声明（原创投稿必选）
    is_repost: bool = False  # 转载作品
    original_url: str = ""  # 转载作品的原作链接
    scheduled_at: str | None = None  # 定时发布（ISO 时间，可选）


class WorkUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    source_url: str | None = None
    cover_url: str | None = None
    category: str | None = None
    tags: str | None = None
    is_repost: bool | None = None  # 是否转载（None = 不变）
    original_url: str | None = None  # 原作链接（None = 不变；置空串 = 清除）


class ChatRoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""


class StudioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    announcement: str = ""
    avatar_url: str | None = None
    cover_url: str | None = None
    category: str = "综合"  # 综合 / 游戏 / 美术 / 音乐
    join_mode: str = "open"  # open 直接加入 / approval 需审核
    # 加入条件：创建时就能设，不用先建好再进设置页改
    min_level: int = 0  # 加入所需最低等级，0 = 不限
    multi_studio_only: bool = False  # 禁止多室籍
    apply_required: bool = False  # 申请时必须填留言（仅审核制有意义）


class StudioUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    announcement: str | None = None
    avatar_url: str | None = None
    cover_url: str | None = None
    category: str | None = None
    join_mode: str | None = None
    entry_rules: dict | None = None  # {min_level, multi_studio_only, apply_required}


# ---- 扩展 ----
class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class FolderUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class PasswordChange(BaseModel):
    old_password: str = ""  # 编程猫注册用户首次设置密码时无需旧密码
    new_password: str = Field(min_length=6, max_length=128)


class ForgotIn(BaseModel):
    account: str = Field(min_length=1, description="用户名或邮箱")
    # 当前界面语言：决定重置验证码邮件用中文还是英文模板（缺省时回落到注册语言）
    lang: str | None = None


class BindClaimIn(BaseModel):
    """领取绑定奖励：key 只能是 codemao / github / email（见 serializers.BIND_REWARDS）。"""

    key: str = Field(min_length=1, max_length=20)


class ResetPasswordIn(BaseModel):
    account: str = Field(min_length=1, description="用户名或邮箱")
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=6, max_length=128)


class AdminUserUpdate(BaseModel):
    nickname: str | None = Field(default=None, max_length=50)
    bio: str | None = None
    avatar_url: str | None = None
    ban_until: str | None = None  # ISO 时间；传空字符串表示解除临时封禁
    sensitive_exempt: bool | None = None  # 豁免违禁词审核（None = 不变）


class BannerCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    image_url: str = ""
    # 轮播底色：留空 = 用站点品牌色；否则必须是 #rrggbb
    color: str = Field(default="", pattern=r"^$|^#[0-9A-Fa-f]{6}$")
    target_type: str = Field(default="none", pattern="^(none|work|post|url)$")
    target_id: int | None = None
    target_url: str | None = None
    sort_order: int = 0
    enabled: bool = True


class ReviewIn(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    reason: str = ""


class ScratchQuotaReview(BaseModel):
    """管理员审批 Scratch 容量扩容申请。"""
    decision: str = Field(pattern="^(approve|reject)$")
    grant_mb: int | None = None      # 通过时填「新配额(MB)」
    note: str = ""                   # 备注 / 驳回理由


class ScratchQuotaSet(BaseModel):
    """管理员直接设置某人的配额。"""
    quota_mb: int = Field(gt=0)
