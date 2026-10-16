"""稿件系统：稿件 CRUD + 编辑器规则 + 标签 + 评论(楼中楼) + 点赞 + 收藏 + 播放记录。"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import config, gamefile, imageurl, iplocate, limits, models, schemas, sensitive, serializers
from .. import cascade
from .. import comments_order
from .. import work_sort
from ..deps import get_active_user, get_current_user, get_optional_user, get_db
from ..ratelimit import client_ip

router = APIRouter(prefix="/works", tags=["works"])

VIEW_DEDUP_WINDOW = timedelta(minutes=30)  # 同一用户/IP 30 分钟内只计一次浏览


def _normalize_tags(tags: str) -> str:
    if not tags:
        return ""
    parts = [t.strip() for t in tags.replace("，", ",").split(",") if t.strip()]
    seen: set[str] = set()
    result: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            result.append(p)
    return ",".join(result)


def _validate_and_normalize(body: schemas.WorkCreate) -> tuple[str, str | None, str | None, str | None, str | None]:
    """校验稿件类型，返回规范化后的 (work_type, source_url, editor_code, editor_work_id, sb3_url)。"""
    if body.work_type == "editor":
        if not body.editor_code or not body.editor_work_id:
            raise HTTPException(status_code=400, detail="请选择编辑器并填写稿件编号")
        if config.build_play_url(body.editor_code, body.editor_work_id) is None:
            raise HTTPException(status_code=400, detail="未知的编辑器")
        return "editor", None, body.editor_code, body.editor_work_id.strip(), None
    if body.work_type == "scratch":
        sb3 = gamefile.check_uploaded_sb3(body.sb3_url)
        if not sb3:
            raise HTTPException(status_code=400, detail="请先上传 Scratch 作品文件（.sb3）")
        return "scratch", None, None, None, sb3
    # url 类型：只允许 http/https（禁止 javascript:、data: 等协议注入）
    if not body.source_url:
        raise HTTPException(status_code=400, detail="请填写稿件网址")
    u = body.source_url.strip()
    if not u.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="稿件网址仅支持 http:// 或 https:// 开头的链接")
    return "url", u, None, None, None


@router.get("/editors")
def list_editors():
    return config.EDITORS


@router.get("")
def list_works(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    query = db.query(models.Work)
    if current is None or current.role != "admin":
        query = query.filter(models.Work.status == "published")
    works = query.order_by(models.Work.created_at.desc()).offset(skip).limit(min(limit, 100)).all()
    return [serializers.work_out(w, db, current.id if current else None) for w in works]


@router.post("", status_code=201)
def create_work(
    request: Request,
    body: schemas.WorkCreate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    work_type, source_url, editor_code, editor_work_id, sb3_url = _validate_and_normalize(body)
    # 原创声明 / 转载 二者必选其一
    if body.is_repost:
        original_url = (body.original_url or "").strip()
        if not original_url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="转载作品需填写原作链接（以 http:// 或 https:// 开头）")
    else:
        original_url = ""
    if not body.is_original and not body.is_repost:
        raise HTTPException(status_code=400, detail="请先勾选「我声明该作品是我的原创作品」，或将作品标记为「转载」并注明原作")
    # 判重：同一用户不能重复投稿同一个作品（被驳回的记录允许修改后重新投稿）
    if work_type == "editor":
        dup = (
            db.query(models.Work)
            .filter(
                models.Work.user_id == user.id,
                models.Work.editor_code == editor_code,
                models.Work.editor_work_id == editor_work_id,
                models.Work.status != "rejected",
            )
            .first()
        )
    elif work_type == "scratch":
        # 同一份 .sb3 文件（内容 sha256）不能投两次
        sha = gamefile.sb3_sha256(sb3_url)
        dup = (
            db.query(models.Work)
            .filter(
                models.Work.user_id == user.id,
                models.Work.sb3_sha256 == sha,
                models.Work.status != "rejected",
            )
            .first()
        )
    else:
        dup = (
            db.query(models.Work)
            .filter(
                models.Work.user_id == user.id,
                models.Work.source_url == source_url,
                models.Work.status != "rejected",
            )
            .first()
        )
    if dup is not None:
        raise HTTPException(status_code=400, detail="你已经投稿过这个作品了，不能重复投稿")
    # 等级特权：LV1 可投稿编程猫（编辑器）作品；LV4 解锁投稿所有作品（含外链稿件）
    serializers.check_level(db, user, 4 if work_type == "url" else 1, "投稿稿件")
    limits.ensure_under_limit(db, models.Work, user.id, config.DAILY_WORK_LIMIT, "稿件")
    limits.check_frequency(f"u{user.id}:work")
    # 敏感词：不再硬拒绝，改为入库但标记待审（不展示），进入管理员审核队列
    # （豁免用户走 sensitive.hits()：直接返回空 → 既不置待审也不进队列）
    sensitive_hits = sensitive.hits(f"{body.title} {body.description}", user, db)
    # 发布规则：编程猫编辑器作品可选「直接发布/提交审核」；自行粘贴链接（url）与
    # Scratch 作品（scratch）**一律强制审核** —— 站长 2026-09-26 明确：LV1 就能投，但必须过审。
    is_codemao_editor = work_type == "editor" and editor_code in config.EDITOR_CODEMAO_CODES
    scheduled_at = None
    if body.scheduled_at:
        try:
            # 统一成带时区的 UTC：没带时区的时间直接和 models.now() 比会 TypeError
            scheduled_at = serializers.parse_dt_utc(body.scheduled_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="定时发布时间格式不正确")
        if scheduled_at <= models.now():
            raise HTTPException(status_code=400, detail="定时发布时间需晚于当前时间")
    if work_type in ("url", "scratch"):
        status = "pending"
    elif scheduled_at:
        status = "scheduled"
    elif sensitive_hits:
        # 命中敏感词：强制进入审核队列（不展示），审核通过后上架
        status = "pending"
    else:
        status = "pending" if body.publish_mode == "review" else "published"
    derived_from = None
    if body.derived_from:
        origin = db.get(models.Work, body.derived_from)
        if origin is None:
            raise HTTPException(status_code=404, detail="被改编的稿件不存在")
        derived_from = origin.id
    work = models.Work(
        user_id=user.id,
        title=body.title.strip(),
        description=body.description,
        work_type=work_type,
        source_url=source_url,
        editor_code=editor_code,
        editor_work_id=editor_work_id,
        sb3_url=sb3_url,
        sb3_sha256=gamefile.sb3_sha256(sb3_url) if sb3_url else None,
        sb3_size=gamefile.sb3_size(sb3_url) if sb3_url else 0,
        cover_url=imageurl.check_cover_image(body.cover_url, "封面图"),
        category=body.category or "其他",
        tags=_normalize_tags(body.tags),
        status=status,
        # 投稿时的属地快照（个人主页用实时属地，两者语义不同）
        ip_region=iplocate.publisher_region(client_ip(request), user),
        derived_from=derived_from,
        is_repost=body.is_repost,
        original_url=original_url,
        scheduled_at=scheduled_at,
    )
    db.add(work)
    db.commit()
    db.refresh(work)
    if sensitive_hits:
        serializers.queue_sensitive_review(db, "work", work.id, sensitive_hits, user.id, work.title)
        db.commit()
    if status == "published":
        serializers.notify_followers(db, user.id, "follow_work", "work", work.id, f"你关注的 {user.display_name} 发布了新稿件《{work.title}》")
        if derived_from:
            origin = db.get(models.Work, derived_from)
            if origin and origin.user_id != user.id:
                serializers.notify_user(db, origin.user_id, user.id, "admin", "work", work.id, f"{user.display_name} 基于你的稿件《{origin.title}》创作了二创《{work.title}》")
    return serializers.work_out(work, db, user.id)


# ==================== 稿件系列（须在 /{work_id} 前注册） ====================
@router.get("/series/list")
def list_my_series(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(models.Series).filter_by(user_id=user.id).order_by(models.Series.id.desc()).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "description": s.description or "",
            "cover_url": s.cover_url,
            "work_count": db.query(models.SeriesWork).filter_by(series_id=s.id).count(),
        }
        for s in rows
    ]


@router.post("/series", status_code=201)
def create_series(body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="请输入系列名称")
    s = models.Series(user_id=user.id, name=name[:50], description=(body.get("description") or "")[:300], cover_url=imageurl.check_uploaded_image(body.get("cover_url"), "系列封面"))
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "name": s.name}


@router.get("/series/{series_id}")
def get_series(series_id: int, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    s = db.get(models.Series, series_id)
    if s is None:
        raise HTTPException(status_code=404, detail="系列不存在")
    items = db.query(models.SeriesWork).filter_by(series_id=series_id).order_by(models.SeriesWork.id.desc()).all()
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description or "",
        "cover_url": s.cover_url,
        "owner": serializers.user_brief(db.get(models.User, s.user_id)),
        "works": [serializers.work_out(it.work, db, current.id if current else None) for it in items if it.work is not None],
    }


@router.post("/series/{series_id}/works")
def add_series_work(series_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    s = db.get(models.Series, series_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己的系列")
    work_id = body.get("work_id")
    if not isinstance(work_id, int) or db.get(models.Work, work_id) is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if db.query(models.SeriesWork).filter_by(series_id=series_id, work_id=work_id).first() is None:
        db.add(models.SeriesWork(series_id=series_id, work_id=work_id))
        db.commit()
    return {"ok": True}


@router.delete("/series/{series_id}/works/{work_id}", status_code=204)
def remove_series_work(series_id: int, work_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    s = db.get(models.Series, series_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己的系列")
    db.query(models.SeriesWork).filter_by(series_id=series_id, work_id=work_id).delete()
    db.commit()


@router.delete("/series/{series_id}", status_code=204)
def delete_series(series_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    s = db.get(models.Series, series_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=403, detail="只能删除自己的系列")
    db.query(models.SeriesWork).filter_by(series_id=series_id).delete()
    db.delete(s)
    db.commit()


@router.get("/favorites")
def my_favorites(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    favs = (
        db.query(models.Favorite)
        .filter(models.Favorite.user_id == user.id, models.Favorite.target_type == "work")
        .order_by(models.Favorite.id.desc())
        .all()
    )
    result = []
    for f in favs:
        work = db.get(models.Work, f.target_id)
        if work:
            result.append(serializers.work_out(work, db, user.id))
    return result


@router.get("/user/{uid}")
def user_works(
    uid: str,
    sort: str = "new",  # new 最新 / hot 综合热度 / likes 喜欢最多 / favs 收藏最多 / views 浏览最多
    status: str | None = None,  # published = 只要已发布（个人主页用；创作中心不传，要看到自己的待审/未过审）
    skip: int = 0,
    limit: int | None = None,  # 不传 = 全量返回（创作中心沿用旧行为）；传了则分页
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """某个用户的稿件列表。

    ⚠️ 站长 2026-10-01：「审核未过或者待审的稿件还是会出现在个人主页」——
    原来这里对**本人和管理员**不过滤状态（本意是让作者能在创作中心管理自己的稿件），
    但个人主页也用同一个接口 → 站长（本人 + 管理员）在自己主页看到待审/未过审稿件。
    现在多一个显式开关：`status=published` 表示「不管谁看，只要已发布」，
    个人主页用它；创作中心不传，继续看得到自己的全部稿件。

    ⚠️ 站长 2026-10-04：个人主页作品一多就一次性拉全量、把所有卡片都渲染出来，
    页面又长又慢。这里补上 `skip`/`limit`（个人主页按页取，创作中心不传 limit 仍取全量）。
    """
    target = db.query(models.User).filter(models.User.uid == uid).first()
    if target is None:
        return []
    query = db.query(models.Work).filter(models.Work.user_id == target.id)
    if status == "published":
        query = query.filter(models.Work.status == "published")
    elif current is None or (current.id != target.id and current.role != "admin"):
        query = query.filter(models.Work.status == "published")
    # 排序口径与发现页同一处（app/work_sort.py）；个人主页只看自己的稿件，置顶不必提前
    q = work_sort.order_works(query, db, sort, pinned_first=False)
    if skip and skip > 0:
        q = q.offset(skip)
    if limit is not None and limit > 0:
        q = q.limit(min(limit, 100))
    works = q.all()
    return [serializers.work_out(w, db, current.id if current else None) for w in works]


@router.get("/later")
def later_works(
    ids: str = "",
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """稍后看列表：按 ids 顺序返回（逗号分隔），未发布/不存在自动跳过。"""
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()][:100]
    if not id_list:
        return []
    works = db.query(models.Work).filter(models.Work.id.in_(id_list)).all()
    by_id = {w.id: w for w in works}
    me = current.id if current else None
    result = []
    for wid in id_list:
        w = by_id.get(wid)
        if w is None or w.status != "published":
            continue
        result.append(serializers.work_out(w, db, me))
    return result


@router.get("/{work_id}/related")
def related_works(
    work_id: int,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """相关推荐：同分类稿件为主，不足时补热门稿件（排除自己）。"""
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    me = current.id if current else None
    same = (
        db.query(models.Work)
        .filter(
            models.Work.status == "published",
            models.Work.category == work.category,
            models.Work.id != work_id,
        )
        .order_by(models.Work.views.desc())
        .limit(8)
        .all()
    )
    if len(same) < 8:
        taken = [w.id for w in same]
        extra = (
            db.query(models.Work)
            .filter(
                models.Work.status == "published",
                models.Work.id != work_id,
                ~models.Work.id.in_(taken),
            )
            .order_by(models.Work.views.desc())
            .limit(8 - len(same))
            .all()
        )
        same += extra
    return [serializers.work_out(w, db, me) for w in same]


@router.get("/{work_id}")
def get_work(
    work_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    """作品详情：可见性校验（已发布人人可见；审核中/被驳回仅作者或管理员可见）+ 播放地址 + 浏览量去重。"""
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    # 可见性
    if work.status != "published" and (current is None or (current.id != work.user_id and current.role != "admin")):
        raise HTTPException(status_code=404, detail="稿件不存在或未发布")
    # 播放地址兜底：编辑器稿件必须能拼出合法播放地址
    if work.work_type == "editor" and work.editor_code and work.editor_work_id:
        if config.build_play_url(work.editor_code, work.editor_work_id) is None:
            raise HTTPException(status_code=500, detail="稿件播放地址配置异常，请联系管理员")
    # 浏览量去重：同一用户/IP 30 分钟内只计一次（修复访问一次 +2 的 bug，也防刷）
    since = models.now() - VIEW_DEDUP_WINDOW
    identity = current.id if current else (request.client.host if request.client else "")
    if identity:
        dup = (
            db.query(models.WorkView)
            .filter(
                models.WorkView.work_id == work_id,
                models.WorkView.user_id == (current.id if current else None),
                models.WorkView.ip == ("" if current else (request.client.host if request.client else "")),
                models.WorkView.viewed_at >= since,
            )
            .first()
        )
        if dup is None:
            work.views += 1
            db.add(models.WorkView(work_id=work_id, user_id=current.id if current else None, ip="" if current else (request.client.host if request.client else "")))
        db.commit()
        db.refresh(work)
    return serializers.work_out(work, db, current.id if current else None, with_follow=True)


# ---- 播放/浏览记录 ----
@router.post("/{work_id}/view")
def record_view(work_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    existing = db.query(models.PlayHistory).filter_by(user_id=user.id, work_id=work_id).first()
    if existing is None:
        db.add(models.PlayHistory(user_id=user.id, work_id=work_id))
    else:
        existing.viewed_at = models.now()
    db.commit()
    return {"ok": True}


@router.patch("/{work_id}")
def update_work(
    work_id: int,
    body: schemas.WorkUpdate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if work.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权修改他人稿件")
    changed = False
    if body.source_url is not None:
        su = body.source_url.strip()
        if not su.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="稿件网址仅支持 http:// 或 https:// 开头的链接")
    if "cover_url" in body.model_fields_set:
        # 显式提交了封面：空串=清除，URL=更新（都经本站图片校验）
        new_cover = imageurl.check_cover_image(body.cover_url, "封面图")
        if new_cover != work.cover_url:
            work.cover_url = new_cover
            changed = True
    for field in ("title", "description", "source_url", "category"):
        val = getattr(body, field)
        if val is not None and val != getattr(work, field):
            setattr(work, field, val)
            changed = True
    if body.tags is not None:
        new_tags = _normalize_tags(body.tags)
        if new_tags != work.tags:
            work.tags = new_tags
            changed = True
    # 转载属性：标记转载必须给有效原作链接；取消转载则清空原作链接
    if "is_repost" in body.model_fields_set or "original_url" in body.model_fields_set:
        repost = work.is_repost if body.is_repost is None else body.is_repost
        if repost:
            final_url = (body.original_url if body.original_url is not None else (work.original_url or "")).strip()
            if not final_url.startswith(("http://", "https://")):
                raise HTTPException(status_code=400, detail="转载作品需填写原作链接（以 http:// 或 https:// 开头）")
        else:
            final_url = ""
        if repost != work.is_repost or final_url != (work.original_url or ""):
            work.is_repost = repost
            work.original_url = final_url
            changed = True
    if changed:
        # 编辑留痕：保存旧版（每稿保留最近 5 版）
        db.add(models.WorkVersion(work_id=work.id, title=work.title, description=work.description))
        work.edited_at = models.now()
        old = db.query(models.WorkVersion).filter_by(work_id=work.id).order_by(models.WorkVersion.id.desc()).offset(5).all()
        for v in old:
            db.delete(v)
    # 编辑后重新检测敏感词：命中则回到待审（不展示），进入审核队列（豁免用户不检测）
    edit_hits = sensitive.hits(f"{work.title} {work.description}", user, db)
    if edit_hits and work.status == "published":
        work.status = "pending"
        db.commit()
        serializers.queue_sensitive_review(db, "work", work.id, edit_hits, user.id, work.title)
        db.refresh(work)
    db.commit()
    db.refresh(work)
    return serializers.work_out(work, db, user.id)


@router.get("/{work_id}/related")
def related_works(work_id: int, limit: int = 4, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    """猜你喜欢：同分类 / 共享标签 -> 按热度推荐。"""
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    my_tags = set(work.tag_list)
    candidates = (
        db.query(models.Work)
        .filter(models.Work.status == "published", models.Work.id != work_id)
        .limit(60)
        .all()
    )

    def score(w: models.Work) -> int:
        s = 0
        if w.category == work.category:
            s += 20
        shared = len(my_tags & set(w.tag_list))
        s += shared * 15
        s += serializers.count_likes(db, "work", w.id) * 2
        return s

    candidates.sort(key=lambda w: (-score(w), -(w.views or 0)))
    result = [serializers.work_out(w, db, current.id if current else None) for w in candidates[: min(limit, 8)]]
    return [r for r in result if r["id"] != work_id][: min(limit, 6)]


@router.delete("/{work_id}", status_code=204)
def delete_work(
    work_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if work.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除")
    # 进入回收站（可恢复）
    db.add(models.RecycleBin(target_type="work", target_id=work.id, title=work.title, deleted_by=user.id))
    cascade.clean_work_deps(db, work)  # 先清关联（观看/历史/版本/通知/点赞…），否则会留下悬空行
    db.delete(work)
    db.commit()


@router.post("/{work_id}/feed")
def feed_work(work_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """给稿件投喂小鱼干（1 或 2 个）。

    规则：作者拿到等量小鱼干，并被计为「被投喂」经验（每个 +1，按 feed_count 汇总）；
    投喂者拿到每个 +10 经验，每日上限 50。
    """
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if work.user_id == user.id:
        raise HTTPException(status_code=400, detail="不能给自己的稿件投喂")
    count = int(body.get("count") or 1)
    if count not in (1, 2):
        raise HTTPException(status_code=400, detail="每次可投喂 1 或 2 个小鱼干")
    if (user.fish_count or 0) < count:
        raise HTTPException(status_code=400, detail="小鱼干不足，每日签到可获得小鱼干")
    user.fish_count = (user.fish_count or 0) - count
    gained_xp = serializers.grant_feed_xp(db, user, count)  # 投喂者经验（每日上限 50）
    author = db.get(models.User, work.user_id)
    if author:
        author.fish_count = (author.fish_count or 0) + count
        serializers.notify_user(db, author.id, user.id, "like", "work", work_id, f"投喂了你 {count} 个小鱼干")
    work.feed_count = (work.feed_count or 0) + count
    db.commit()
    db.refresh(work)
    return {"feed_count": work.feed_count, "my_fish": user.fish_count, "xp_gained": gained_xp}


@router.post("/{work_id}/appeal")
def appeal_work(work_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """被下架/驳回的稿件申诉：提交理由，管理员可在后台查看。"""
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if work.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权申诉他人稿件")
    if work.status not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail="仅被下架或驳回的稿件可申诉")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="请填写申诉理由")
    work.appeal = reason[:500]
    db.commit()
    serializers.notify_admin_action(db, user.id, user.id, f"{user.display_name} 对稿件《{work.title}》提交了申诉", "work", work.id)
    return {"ok": True}


# ---- 评论 ----
@router.get("/{work_id}/comments")
def list_comments(
    work_id: int,
    sort: str = "new",  # new 最新 / hot 热评置顶
    db: Session = Depends(get_db),
    current: models.User | None = Depends(get_optional_user),
):
    comments = (
        db.query(models.WorkComment)
        .filter(models.WorkComment.work_id == work_id, models.WorkComment.status == "active")
        .order_by(models.WorkComment.created_at.asc())
        .all()
    )
    likes_map = None
    if sort == "hot" and comments:
        # 一次性统计点赞数
        cids = [c.id for c in comments]
        like_rows = (
            db.query(models.Like.target_id, func.count())
            .filter(models.Like.target_type == "work_comment", models.Like.target_id.in_(cids))
            .group_by(models.Like.target_id)
            .all()
        )
        likes_map = dict(like_rows)
    # 置顶必须真的排到最前（见 comments_order 模块注释）
    comments = comments_order.order_comments(comments, sort, likes_map)
    return [serializers.comment_out(c, db, current.id if current else None) for c in comments]


@router.post("/{work_id}/comments", status_code=201)
def add_comment(
    request: Request,
    work_id: int,
    body: schemas.CommentCreate,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    serializers.check_level(db, user, 1, "评论稿件")
    limits.ensure_under_limit(db, models.WorkComment, user.id, config.DAILY_COMMENT_LIMIT, "评论")
    limits.check_frequency(f"u{user.id}:workcomment")
    # 敏感词：评论照常入库但标记待审（不展示），进入管理员审核队列（豁免用户不检测）
    comment_sensitive = sensitive.hits(body.content, user, db)

    parent = None
    if body.parent_id is not None:
        parent = db.get(models.WorkComment, body.parent_id)
        if parent is None or parent.work_id != work_id:
            raise HTTPException(status_code=400, detail="回复的评论不存在")

    comment = models.WorkComment(
        work_id=work_id, user_id=user.id, content=body.content, parent_id=body.parent_id,
        image_url=imageurl.check_uploaded_image(body.image_url, "评论图片"),
        # 评论发表时的属地快照
        ip_region=iplocate.publisher_region(client_ip(request), user),
        status="pending" if comment_sensitive else "active",
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    if comment_sensitive:
        serializers.queue_sensitive_review(db, "work_comment", comment.id, comment_sensitive, user.id, body.content[:30])
        db.commit()

    if parent is not None:
        serializers.notify_user(db, parent.user_id, user.id, "reply", "work", work_id, f"回复了你的评论：{body.content[:50]}")
    else:
        serializers.notify_user(db, work.user_id, user.id, "comment", "work", work_id, f"评论了你的稿件《{work.title}》")
    serializers.notify_mentions(db, user.id, user.display_name, body.content, "work", work_id)
    return serializers.comment_out(comment, db, user.id)


@router.delete("/{work_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    work_id: int,
    comment_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    comment = db.get(models.WorkComment, comment_id)
    if comment is None or comment.work_id != work_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    if comment.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除")
    cascade.clean_comment_deps(db, comment)  # 清点赞 + 把回复提升一层，避免 parent_id 悬空
    db.delete(comment)
    db.commit()


# ---- 点赞 / 收藏 ----
@router.get("/{work_id}/likes")
def work_likes(work_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """谁赞了这个稿件（头像列表）。"""
    rows = (
        db.query(models.Like)
        .filter(models.Like.target_type == "work", models.Like.target_id == work_id)
        .order_by(models.Like.id.desc())
        .limit(min(limit, 100))
        .all()
    )
    return [serializers.user_brief(db.get(models.User, r.user_id)) for r in rows if db.get(models.User, r.user_id) is not None]


@router.post("/{work_id}/like")
def like_work(
    work_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    serializers.check_level(db, user, 1, "点赞")
    existing = db.query(models.Like).filter_by(user_id=user.id, target_type="work", target_id=work_id).first()
    if existing is None:
        # 点赞防刷：取消后 60 秒内不能再赞
        from .. import antispam

        if not antispam.throttle(f"like:work:{user.id}:{work_id}", 60):
            raise HTTPException(status_code=429, detail="操作太频繁，请稍后再试")
        db.add(models.Like(user_id=user.id, target_type="work", target_id=work_id))
        db.commit()
        liked = True
        serializers.notify_user(db, work.user_id, user.id, "like", "work", work_id, f"赞了你的稿件《{work.title}》")
    else:
        db.delete(existing)
        db.commit()
        liked = False
    return {"liked": liked, "like_count": serializers.count_likes(db, "work", work_id)}


@router.post("/{work_id}/favorite")
def favorite_work(
    work_id: int,
    body: dict | None = None,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    if db.get(models.Work, work_id) is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    folder_id = (body or {}).get("folder_id") if isinstance(body, dict) else None
    if folder_id is not None:
        folder = db.query(models.FavoriteFolder).filter_by(id=folder_id, user_id=user.id).first()
        if folder is None:
            raise HTTPException(status_code=400, detail="收藏夹不存在")
    existing = db.query(models.Favorite).filter_by(user_id=user.id, target_type="work", target_id=work_id).first()
    if existing is None:
        db.add(models.Favorite(user_id=user.id, target_type="work", target_id=work_id, folder_id=folder_id))
        db.commit()
        favorited = True
    else:
        db.delete(existing)
        db.commit()
        favorited = False
    return {"favorited": favorited}


# ---- 评论点赞 ----
@router.post("/{work_id}/comments/{comment_id}/pin")
def pin_work_comment(work_id: int, comment_id: int, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    """作者置顶一条优质评论。"""
    work = db.get(models.Work, work_id)
    if work is None or work.user_id != user.id:
        raise HTTPException(status_code=403, detail="仅作者可置顶评论")
    c = db.get(models.WorkComment, comment_id)
    if c is None or c.work_id != work_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    # ⚠️ 先记住「这条现在是什么状态」再批量清零，最后写回取反值。
    # 原来的写法是「先批量 update pinned=False，再 c.pinned = not c.pinned」——
    # 批量 update 会把会话里这条对象的 pinned 一起同步成 False，于是 not False = True，
    # 结果「取消置顶」永远取消不掉（连点两次还是置顶状态）。
    want_pinned = not bool(c.pinned)
    db.query(models.WorkComment).filter(models.WorkComment.work_id == work_id).update(
        {"pinned": False}, synchronize_session=False
    )
    c.pinned = want_pinned
    db.commit()
    return {"pinned": bool(c.pinned)}


@router.post("/{work_id}/comments/{comment_id}/like")
def like_work_comment(
    work_id: int,
    comment_id: int,
    user: models.User = Depends(get_active_user),
    db: Session = Depends(get_db),
):
    comment = db.get(models.WorkComment, comment_id)
    if comment is None or comment.work_id != work_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    existing = db.query(models.Like).filter_by(user_id=user.id, target_type="work_comment", target_id=comment_id).first()
    if existing is None:
        db.add(models.Like(user_id=user.id, target_type="work_comment", target_id=comment_id))
        db.commit()
        liked = True
    else:
        db.delete(existing)
        db.commit()
        liked = False
    return {"liked": liked, "like_count": serializers.count_likes(db, "work_comment", comment_id)}


# ==================== 试玩评价 ====================
RATING_TAGS = ["好玩", "卡顿", "烧脑", "画面好", "一般"]


@router.get("/{work_id}/ratings")
def work_ratings(work_id: int, db: Session = Depends(get_db), current: models.User | None = Depends(get_optional_user)):
    rows = db.query(models.WorkRating).filter_by(work_id=work_id).all()
    if not rows:
        return {"average": None, "count": 0, "tags": [], "my_rating": None}
    avg = round(sum(r.score for r in rows) / len(rows), 1)
    from collections import Counter

    tag_counter: Counter = Counter()
    for r in rows:
        for t in (r.tags or "").split(","):
            if t:
                tag_counter[t] += 1
    my = None
    if current:
        mine = db.query(models.WorkRating).filter_by(work_id=work_id, user_id=current.id).first()
        if mine:
            my = {"score": mine.score, "tags": [t for t in (mine.tags or "").split(",") if t]}
    return {"average": avg, "count": len(rows), "tags": [{"tag": t, "count": c} for t, c in tag_counter.most_common()], "my_rating": my}


@router.post("/{work_id}/ratings")
def rate_work(work_id: int, body: dict, user: models.User = Depends(get_active_user), db: Session = Depends(get_db)):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    serializers.check_level(db, user, 1, "评价作品")
    if work.user_id == user.id:
        raise HTTPException(status_code=400, detail="不能给自己的稿件评分")
    score = body.get("score", 5)
    if not isinstance(score, int) or score < 1 or score > 5:
        raise HTTPException(status_code=400, detail="评分需为 1-5 星")
    tags = [t for t in (body.get("tags") or []) if t in RATING_TAGS][:5]
    row = db.query(models.WorkRating).filter_by(work_id=work_id, user_id=user.id).first()
    if row is None:
        db.add(models.WorkRating(work_id=work_id, user_id=user.id, score=score, tags=",".join(tags)))
    else:
        row.score = score
        row.tags = ",".join(tags)
    db.commit()
    return {"ok": True}


# ==================== 稿件数据面板（作者可见） ====================
@router.get("/{work_id}/stats")
def work_stats(work_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    work = db.get(models.Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="稿件不存在")
    if work.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="仅作者可见数据面板")
    from collections import Counter

    # 近 7/30 天播放
    def views_since(days):
        since = models.now() - timedelta(days=days)
        return db.query(models.WorkView).filter(models.WorkView.work_id == work_id, models.WorkView.viewed_at >= since).count()

    # 近 7 天播放趋势（按日）
    days7 = []
    for i in range(6, -1, -1):
        day_start = models.now() - timedelta(days=i + 1)
        day_end = models.now() - timedelta(days=i)
        days7.append(db.query(models.WorkView).filter(models.WorkView.work_id == work_id, models.WorkView.viewed_at >= day_start, models.WorkView.viewed_at < day_end).count())
    ratings = db.query(models.WorkRating).filter_by(work_id=work_id).all()
    avg_score = round(sum(r.score for r in ratings) / len(ratings), 1) if ratings else None
    return {
        "views_total": work.views,
        "views_7d": views_since(7),
        "views_30d": views_since(30),
        "views_trend_7d": days7,
        "likes": serializers.count_likes(db, "work", work_id),
        "favorites": db.query(models.Favorite).filter_by(target_type="work", target_id=work_id).count(),
        "comments": db.query(models.WorkComment).filter_by(work_id=work_id).count(),
        "rating_avg": avg_score,
        "rating_count": len(ratings),
    }
