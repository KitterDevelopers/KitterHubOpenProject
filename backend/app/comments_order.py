"""评论列表排序：置顶的评论必须真的排到最前面。

历史 bug：`pinned` 只在序列化时输出成「置顶」徽章，列表本身一直按 created_at 排，
于是置顶看起来生效了、位置却一动不动 —— 用户看到的就是「明明置顶了但其实没置顶」。
（线上 work 43 的置顶评论当时停在顶层第 2/4 位。）

规则：
- 顶层评论里，被置顶的提到最前；它的回复仍然挂在它下面。
- 置顶的是**回复**时（接口允许），把该回复所在的整层楼提到最前，
  并把这条回复排在该楼层回复列表的第一位，否则置顶藏在折叠里等于没有。
- `new`：置顶之后**新的在前**（created_at 倒序）。
- `hot`：置顶之后先放点赞 ≥1 的最多 3 条「热评」（按赞数），其余按时间倒序。
帖子评论与作品评论共用本模块，避免两边再走偏。
"""
from . import models, serializers


def _split(comments):
    top = [c for c in comments if c.parent_id is None]
    kids = [c for c in comments if c.parent_id is not None]
    return top, kids


def _hoisted_floor_ids(top, kids):
    """要提到最前的顶层楼层 id：自己置顶，或它的回复里有人置顶。"""
    ids = {c.id for c in top if c.pinned}
    ids |= {c.parent_id for c in kids if c.pinned}
    return ids


def _kids_ordered(kids):
    """回复顺序：同楼层内先置顶，其余保持创建时间（sorted 稳定）。"""
    return sorted(kids, key=lambda c: (c.parent_id, 0 if c.pinned else 1))


def order_comments(comments, sort="new", likes_map=None):
    """把 ORM 评论列表排成最终展示顺序（扁平，前端按 parent_id 组装楼层）。"""
    if not comments:
        return comments
    top, kids = _split(comments)
    hoisted = _hoisted_floor_ids(top, kids)
    head = [c for c in top if c.id in hoisted]
    rest_top = [c for c in top if c.id not in hoisted]

    # 站长 2026-09-27：「评论区点击按时间没有效果」——
    # 原因是这里一直按 created_at **升序**（最老的在前），而默认排序本身就是 new，
    # 于是「最新」和默认看起来一模一样、点了跟没点一样；热评在没什么赞的楼里也一样。
    # 现在 new = 新的在最前；hot = 有赞的按赞数在前（≥1 赞的最多挑 3 条「热评」），其余按时间倒序。
    def _ts(c):
        return serializers.as_utc(c.created_at) or models.now()

    if sort == "hot" and likes_map is not None:
        rest_top.sort(key=lambda c: (-likes_map.get(c.id, 0), _ts(c)))
        hot = [c for c in rest_top if likes_map.get(c.id, 0) >= 1][:3]
        tail = sorted([c for c in rest_top if c not in hot], key=_ts, reverse=True)
        return head + hot + tail + _kids_ordered(kids)

    rest_top.sort(key=_ts, reverse=True)
    return head + rest_top + _kids_ordered(kids)
