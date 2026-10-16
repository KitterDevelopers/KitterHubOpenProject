"""编程猫（Codemao）账号对接：通过逆向登录接口换取用户信息。

仅用于「绑定/注册」时验证账号并读取 uid、昵称、头像。
密码即用即弃：只在本函数内随请求发出，不落库、不记录。
⚠️ 接口为社区逆向整理，非编程猫官方开放，编程猫改版时可能失效。
"""
import json
import urllib.request
import urllib.error

from fastapi import HTTPException

# 编程猫社区平台 ID（可从官网 JS 获取；社区 pid 固定）
CODEMAO_PID = "65edCTyg"
LOGIN_URL = "https://api.codemao.cn/tiger/v3/web/accounts/login"

TIMEOUT = 15


class CodemaoError(Exception):
    pass


def codemao_login(identity: str, password: str) -> dict:
    """调用编程猫登录接口，返回 {uid, nickname, avatar}；失败抛 CodemaoError。"""
    identity = (identity or "").strip()
    if not identity or not password:
        raise CodemaoError("请输入编程猫账号和密码")
    body = json.dumps({"pid": CODEMAO_PID, "identity": identity, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        LOGIN_URL,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        msg = "编程猫账号或密码错误"
        try:
            err = json.loads(e.read().decode("utf-8", "ignore"))
            msg = err.get("error_message") or msg
        except Exception:
            pass
        raise CodemaoError(msg) from e
    except Exception as e:
        raise CodemaoError("无法连接编程猫，请稍后重试") from e

    ui = data.get("user_info") or {}
    uid = ui.get("id")
    if not uid:
        raise CodemaoError("编程猫登录失败，请稍后重试")
    return {
        "uid": str(uid),
        "nickname": str(ui.get("nickname") or ""),
        "avatar": ui.get("avatar_url") or None,
    }


def http_error(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def save_avatar_locally(avatar_url: str, user_id: int) -> str | None:
    """编程猫 CDN 有防盗链，服务器无法稳定下载头像；直接保留外链 URL。

    前端头像组件会做加载失败兜底（显示首字母），避免裂图。
    """
    return avatar_url


# ---- 公开只读接口（无需登录） ----
WORK_LIST_URL = "https://api.codemao.cn/creation-tools/v1/user/center/work-list"
HONOR_URL = "https://api.codemao.cn/creation-tools/v1/user/center/honor"
# 作品详情：公开免登录，返回**权威的 player_url** 和作品类型
WORK_DETAIL_URL = "https://api.codemao.cn/creation-tools/v1/works/{work_id}"

# 作品详情里的 type -> 本站编辑器 code。
#
# ⚠️ 为什么必须拉详情、不能只看列表：列表里的 `type` 是数字，实测
#   1 → 既可能是 KITTEN4 也可能是 KITTEN3（分不出来）
#   8 → NEMO
#   15 → NEKO
#   而详情接口的 type 是字符串（NEKO / KITTEN4 / KITTEN3 / NEMO），并且直接给出
#   `player_url` —— 用它反推编辑器才不会选错。
#
# 实测对照（2026-09-22，用站长 10 个作品逐个拉详情得到）：
#   NEKO    -> https://kn.codemao.cn/player?type=2&workId=…   = KN
#   KITTEN4 -> https://player.codemao.cn/new/…               = kitten4
#   KITTEN3 -> https://player.codemao.cn/old/…               = kitten3
#   NEMO    -> https://nemo.codemao.cn/w/…                   = nemo（三维作品）
CODEMAO_TYPE_TO_EDITOR = {
    "NEKO": "KN",
    "KITTEN4": "kitten4",
    "KITTEN3": "kitten3",
    "COCO": "coco",
    "NEMO": "nemo",
}


class CodemaoUserNotFound(CodemaoError):
    """该训练师编号在编程猫不存在。"""


class CodemaoBadUid(CodemaoError):
    """训练师编号格式不合法（编程猫返回「参数异常」）。"""


# 免密码验证的「发码」那一步允许 10 秒缓存，避免同一个 uid 被反复打；
# **核验那一步必须绕过缓存**，否则会读到他改签名之前的旧值，必然失败。
_HONOR_CACHE: dict[str, tuple[float, dict]] = {}
_HONOR_CACHE_TTL = 10.0


def codemao_honor(cm_uid: str, *, use_cache: bool = True) -> dict:
    """读某个训练师编号的公开资料：{uid, nickname, avatar, doing, description}。

    这是**公开只读接口**（无需登录、无需密码）。`doing` 就是社区个人主页上的
    「我正在做什么」，免密码验证登录靠它证明用户控制着那个编程猫号。

    ⚠️ 接口为社区逆向整理，非官方开放；编程猫改版时可能失效。
    调用方必须能优雅降级（引导用户改用密码登录），不要当成永远可用的依赖。
    """
    import time
    import urllib.parse

    cm_uid = str(cm_uid or "").strip()
    if not cm_uid:
        raise CodemaoBadUid("请填写训练师编号")

    started = time.time()
    if use_cache:
        hit = _HONOR_CACHE.get(cm_uid)
        if hit is not None and started - hit[0] < _HONOR_CACHE_TTL:
            return hit[1]

    url = f"{HONOR_URL}?user_id={urllib.parse.quote(cm_uid)}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://shequ.codemao.cn/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        err: dict = {}
        try:
            err = json.loads(e.read().decode("utf-8", "ignore")) or {}
        except Exception:
            err = {}
        code = str(err.get("error_code") or "")
        if e.code == 422 or code == "40103001":
            raise CodemaoUserNotFound("找不到这个训练师编号，请检查有没有填错") from e
        if e.code in (400, 406) or code == "40100004":
            raise CodemaoBadUid("训练师编号格式不对，应该是一串数字") from e
        raise CodemaoError("编程猫暂时无法访问，请稍后再试或改用密码登录") from e
    except CodemaoError:
        raise
    except Exception as e:
        raise CodemaoError("编程猫暂时无法访问，请稍后再试或改用密码登录") from e

    got_uid = str(data.get("user_id") or "")
    # 防御：响应里的 uid 必须与请求的一致，避免把 A 的资料写到 B 的账号上
    if got_uid and got_uid != cm_uid:
        raise CodemaoError("编程猫返回的数据对不上，请稍后重试")

    info = {
        "uid": got_uid or cm_uid,
        "nickname": str(data.get("nickname") or ""),
        "avatar": data.get("avatar_url") or None,
        "doing": str(data.get("doing") or ""),
        "description": str(data.get("user_description") or ""),
        # 作者等级（社区个人主页上那个徽章）：0=无徽章，2=潜力新星，3=进阶高手，4=编程大佬，5=源码传说。
        # 经验中心的「一键加满」读它；读不到就是 0，调用方按「没有奖励」处理。
        "author_level": int(data.get("author_level") or 0),
    }
    if use_cache:
        if len(_HONOR_CACHE) > 5000:  # 兜底：别让缓存无限涨
            _HONOR_CACHE.clear()
        _HONOR_CACHE[cm_uid] = (started, info)
    return info


WORK_LIST_PAGE = 50       # 一页要多少（实测 limit=100 也能给全，50 更稳）
WORK_LIST_MAX = 200       # 兜底上限：有人作品很多时别把接口拖死
WORK_LIST_BUDGET = 12.0   # 秒；翻页总耗时上限，超时返回已拿到的部分并标记截断


def _normalize_work(w: dict) -> dict:
    return {
        "id": w.get("id"),
        "work_name": w.get("work_name") or w.get("name") or "未命名作品",
        "preview": w.get("preview") or None,
        "view_times": w.get("view_times") or 0,
        "liked_times": w.get("liked_times") or 0,
        "collect_times": w.get("collect_times") or 0,
        "description": str(w.get("description") or "").strip(),
        "publish_time": w.get("publish_time"),
        "is_coll_work": bool(w.get("is_coll_work")),
    }


def _work_list_page(cm_uid: str, offset: int, limit: int) -> tuple[list[dict], int | None]:
    """拉一页作品，返回 (规范化列表, 编程猫报的 total)。请求失败返回 ([], None)。"""
    import urllib.parse

    url = f"{WORK_LIST_URL}?user_id={urllib.parse.quote(cm_uid)}&offset={int(offset)}&limit={int(limit)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except Exception:
        return [], None
    items = data.get("items") or []
    total = data.get("total")
    return [_normalize_work(w) for w in items], (int(total) if isinstance(total, int) else None)


def codemao_work_list_all(cm_uid: str, *, max_items: int = WORK_LIST_MAX) -> dict:
    """把某个编程猫账号的已发布作品**全部**拉回来（翻页）。

    为什么必须翻页：编程猫这个接口支持 offset/limit 并返回 `total`，而旧代码写死了
    `offset=0&limit=20` 且只请求一次 —— 作品超过 20 个的人，第 21 个之后**永远导入不了**。
    （2026-09-23 用户「一只白给的小绿」22 个作品只显示 20 个，就是这个原因。）

    返回 {"items": [...], "total": int, "truncated": bool}：
        total      编程猫报的作品总数（拿不到时回退成已取到的条数）
        truncated  是否因为我们自己的上限/超时没取全
    """
    import time

    started = time.monotonic()
    out: list[dict] = []
    seen: set = set()
    total: int | None = None
    offset = 0
    truncated = False

    while True:
        page, page_total = _work_list_page(cm_uid, offset, WORK_LIST_PAGE)
        if total is None and page_total is not None:
            total = page_total
        if not page:
            break
        for w in page:
            key = w.get("id")
            if key in seen:
                continue
            seen.add(key)
            out.append(w)
        offset += len(page)
        # 取够了 / 已经到总数 / 触到自己的上限 / 超时 —— 四种情况都停
        if total is not None and offset >= total:
            break
        if len(out) >= max_items:
            truncated = total is None or len(out) < total
            break
        if time.monotonic() - started > WORK_LIST_BUDGET:
            truncated = True
            break

    return {"items": out, "total": total if total is not None else len(out), "truncated": truncated}


def codemao_work_list(cm_uid: str, limit: int = 20) -> list[dict]:
    """拉取某个编程猫 uid 的作品列表，最多 limit 条（翻页取，兼容旧调用）。

    ⚠️ 列表接口**只给数字 type**，分不出 Kitten3/Kitten4 —— 想确定编辑器必须再拉一次详情，
    见 `codemao_work_detail()`。所以这里的职责就是「列出来」，不给编辑器判断。
    """
    data = codemao_work_list_all(cm_uid, max_items=max(1, int(limit)))
    return data["items"][: max(1, int(limit))]


def codemao_work_detail(work_id) -> dict:
    """拉某个编程猫作品的详情，解析出「该用哪个编辑器」和权威播放地址。

    返回：
        {
          id, work_name, cm_type,        # cm_type 是 NEKO / KITTEN4 / KITTEN3 / NEMO …
          editor_code,                   # 对应本站编辑器 code；本站没有的返回 None
          play_url,                      # 编程猫给的权威播放地址
          cover, description, publish_time, parent_id,
        }

    失败抛 CodemaoError，调用方负责降级成「读不到，请手动填写编号」。
    """
    import re

    wid = re.sub(r"[^0-9]", "", str(work_id or ""))
    if not wid:
        raise CodemaoBadUid("稿件编号格式不对，应该是一串数字")

    url = WORK_DETAIL_URL.format(work_id=wid)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://shequ.codemao.cn/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise CodemaoUserNotFound("找不到这个编程猫作品，确认一下编号") from e
        raise CodemaoError("编程猫暂时无法访问，请稍后再试") from e
    except CodemaoError:
        raise
    except Exception as e:
        raise CodemaoError("编程猫暂时无法访问，请稍后再试") from e

    # 防御：回来的 id 必须和请求的一致
    got = str(data.get("id") or "")
    if got and got != wid:
        raise CodemaoError("编程猫返回的数据对不上，请稍后重试")

    cm_type = str(data.get("type") or "").strip().upper()
    player_url = str(data.get("player_url") or "").strip() or None
    return {
        "id": got or wid,
        "work_name": str(data.get("work_name") or "").strip(),
        "cm_type": cm_type,
        # 详情里的 type 是权威的；映射不到就说明本站没有对应编辑器（例如 NEMO 三维作品）
        "editor_code": CODEMAO_TYPE_TO_EDITOR.get(cm_type),
        "play_url": player_url,
        "cover": data.get("screenshot_cover_url") or data.get("preview") or None,
        "description": str(data.get("description") or "").strip(),
        "publish_time": data.get("publish_time"),
        "parent_id": data.get("parent_id") or 0,
    }
