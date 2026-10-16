"""运行时站点开关（后台可改，不用改环境变量、不用重启）。

背景：`config.CHAT_ENABLED`、`config.ENABLE_RATE_LIMIT` 这类开关以前只能改 `/etc/nimao/nimao.env`
再重启服务 —— 站长想临时关掉聊天、或者打开限流，都得运维介入。现在这些开关存进 `site_settings`
（键名前缀 `switch.`），后台「系统设置 → 站点开关」里一点就生效。

设计要点：
1. **默认值仍然来自 config 的环境变量** —— 没在后台动过的开关行为与以前完全一致，升级不改变现状。
2. **进程内短 TTL 缓存**（`_TTL` 秒）：这些开关在每个请求路径上都会被读到（限流、聊天…），
   不能每个请求查一次库。写入时立刻失效缓存，所以后台点完马上生效（最多多一次查询）。
3. 读库失败（比如库被锁）**不抛错**：退回默认值，宁可开关不生效也不能把请求打挂。
"""
import threading
import time as _time

from . import config, models

PREFIX = "switch."

# key -> (默认值, 后台显示名, 说明)
SWITCHES: dict[str, tuple[bool, str, str]] = {
    "chat": (config.CHAT_ENABLED, "聊天功能", "关闭后消息页、群聊、私聊整体不可用（已有的聊天记录保留）"),
    "rate_limit": (config.ENABLE_RATE_LIMIT, "全局限流", "按 IP 限制每分钟请求数，挡爬虫/脚本刷站"),
    "freq_limit": (config.ENABLE_FREQ_LIMIT, "高频发布限制", "同一动作（发帖/评论/投稿）短时间连发会被拦下"),
    "daily_limit": (config.ENABLE_DAILY_LIMIT, "每日数量上限", "每人每天稿件/帖子/评论的数量上限"),
    "login_lock": (config.ENABLE_LOGIN_LOCK, "登录失败锁定", "同一账号连续输错密码后暂时锁定"),
    "reg_cap": (config.ENABLE_REG_CAP, "自动注册配额", "限制单个 IP 自动注册的账号数量"),
    "cloud": (config.CLOUD_ENABLED, "Scratch 云变量", "关闭后播放器退回 TurboWarp 公共云（自建云的数据会保留）")
}

_LOCK = threading.Lock()
_CACHE: dict[str, tuple[float, bool]] = {}
_TTL = 10.0          # 秒；后台写入会立刻失效，所以这里只是兜底


def _read(key: str) -> bool:
    """从库里读一个开关；没有记录就用默认值。"""
    from .database import SessionLocal

    default = SWITCHES[key][0]
    db = None
    try:
        db = SessionLocal()
        row = db.get(models.SiteSetting, PREFIX + key)
        if row is None or row.value is None or row.value == "":
            return default
        return row.value == "1"
    except Exception:
        return default
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def enabled(key: str) -> bool:
    """开关是否打开（带短缓存）。未知 key 一律返回 False，避免拼错 key 时静默放行。"""
    if key not in SWITCHES:
        return False
    now = _time.time()
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None and now - hit[0] < _TTL:
            return hit[1]
    value = _read(key)
    with _LOCK:
        _CACHE[key] = (now, value)
    return value


def set_value(db, key: str, value: bool) -> bool:
    """后台写入：写库 + 立刻刷新缓存（下一个请求就生效）。"""
    if key not in SWITCHES:
        raise KeyError(key)
    row = db.get(models.SiteSetting, PREFIX + key)
    if row is None:
        row = models.SiteSetting(key=PREFIX + key, value="1" if value else "0")
        db.add(row)
    else:
        row.value = "1" if value else "0"
    db.commit()
    with _LOCK:
        _CACHE[key] = (_time.time(), bool(value))
    return bool(value)


def clear_cache() -> None:
    """测试或多进程场景下手动失效（单进程部署其实用不到）。"""
    with _LOCK:
        _CACHE.clear()


def all_switches(db) -> list[dict]:
    """给后台用：每个开关当前值 + 默认值 + 文案。"""
    out = []
    for key, (default, label, hint) in SWITCHES.items():
        row = db.get(models.SiteSetting, PREFIX + key)
        value = default if row is None or row.value in (None, "") else row.value == "1"
        out.append({
            "key": key,
            "label": label,
            "hint": hint,
            "value": bool(value),
            "default": bool(default),
            "changed": bool(value) != bool(default),
        })
    return out
