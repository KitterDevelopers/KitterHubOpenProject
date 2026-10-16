"""敏感词过滤：发帖/评论/聊天/注册等内容的敏感词检测。

所有敏感词统一存数据库（SensitiveWord 表，含 builtin 标记的内置词），
管理员可在后台增删；删除后立即不再拦截。代码内置词库仅作为首次建库时的种子。
"""

# 内置兜底词库：按站长要求已全部清空（不再自动补回任何词）。
# 如需恢复过滤，把词写回这里或由管理后台添加即可。
SENSITIVE_WORDS: list[str] = []

_db_words_cache = {"words": None, "ts": 0.0}


def get_db_words(db) -> list[str]:
    """从数据库读取敏感词（60 秒缓存）。db 为 None 时使用缓存（聊天场景）。"""
    import time

    from . import models

    now = time.time()
    if _db_words_cache["words"] is not None and now - _db_words_cache["ts"] <= 60:
        return _db_words_cache["words"]
    if db is None:
        # 无 db（socket 聊天）：用上次缓存；从未加载则返回内置种子
        return _db_words_cache["words"] if _db_words_cache["words"] is not None else list(SENSITIVE_WORDS)
    words = [w.word for w in db.query(models.SensitiveWord).all()]
    if not words:
        # 数据库为空（极端情况）：自动补回内置种子，保证最低防护
        for w in SENSITIVE_WORDS:
            if db.query(models.SensitiveWord).filter_by(word=w).first() is None:
                db.add(models.SensitiveWord(word=w, builtin=True))
        db.commit()
        words = [w.word for w in db.query(models.SensitiveWord).all()]
    _db_words_cache["words"] = words
    _db_words_cache["ts"] = now
    return words


def contains_sensitive(text: str | None, db=None) -> bool:
    """检测文本是否包含敏感词（数据库 + 内置种子，不区分大小写）。"""
    return bool(find_sensitive(text, db))


def find_sensitive(text: str | None, db=None) -> list[str]:
    """返回文本中命中的敏感词列表（用于提示用户具体是哪个词）。"""
    if not text:
        return []
    lowered = text.lower()
    hit: list[str] = []
    for w in get_db_words(db):
        if w and w.lower() in lowered:
            hit.append(w)
    return hit


def hits(text: str | None, user=None, db=None) -> list[str]:
    """内容投稿链路专用的入口：**豁免用户直接返回空**。

    站长 2026-09-27：「管理员后台加一个豁免用户的选项，发的东西不受违禁词审核」。
    豁免开关在 `users.sensitive_exempt`（后台用户管理里可改）。豁免用户的内容：
      · 不命中任何敏感词 → 既不会进审核队列，也不会被强制置为待审；
    其它路径（注册用户名、改昵称、工作室名等）仍然照常检测 —— 豁免的是"他发的内容"，
    不是"他可以随便起违规的名字"。
    """
    if user is not None and getattr(user, "sensitive_exempt", False):
        return []
    return find_sensitive(text, db)
