"""轻量防刷：内存级节流（进程内），用于点赞等高频操作。"""
import threading
import time

_lock = threading.Lock()
# key -> 时间戳
_last_ops: dict[str, float] = {}


def throttle(key: str, seconds: float = 60) -> bool:
    """同 key 在 seconds 秒内已操作过则返回 False。"""
    now = time.time()
    with _lock:
        last = _last_ops.get(key)
        if last is not None and now - last < seconds:
            return False
        _last_ops[key] = now
        # 清理过期
        if len(_last_ops) > 2000:
            for k in [k for k, v in _last_ops.items() if now - v > 300]:
                _last_ops.pop(k, None)
        return True
