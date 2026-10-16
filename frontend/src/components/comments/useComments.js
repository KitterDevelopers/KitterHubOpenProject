/**
 * 评论区的数据与操作。
 *
 * ⚠️ 这里刻意**不把父组件传进来的回调放进依赖数组**。
 *    页面调用方式一直是 `getComments={(sort) => client.get(...)}` —— 每次渲染都是新函数，
 *    一旦进依赖就会「load → setState → 重渲染 → 新函数 → 再 load」无限循环。
 *    所以用 ref 存最新回调，load 只依赖调用方希望它变的东西。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export default function useComments({ getComments, onSubmit, onDelete, onLikeComment, onPinComment }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('new');       // new 最新 / hot 热评
  const [onlyAuthor, setOnlyAuthor] = useState(false);

  // 始终指向最新一次渲染拿到的回调，避免把它们写进依赖
  const cb = useRef({ getComments, onSubmit, onDelete, onLikeComment, onPinComment });
  useEffect(() => {
    cb.current = { getComments, onSubmit, onDelete, onLikeComment, onPinComment };
  });

  const load = useCallback(async (s = 'new') => {
    setLoading(true);
    try {
      const list = await cb.current.getComments(s);
      setComments(Array.isArray(list) ? list : []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load('new'); }, [load]);

  const switchSort = (s) => {
    if (s === sort) return;
    setSort(s);
    load(s);
  };

  const submit = async (content, parentId, imageUrl) => {
    await cb.current.onSubmit(content, parentId, imageUrl);
    await load(sort);
  };

  const remove = async (commentId) => {
    if (!cb.current.onDelete) return;
    await cb.current.onDelete(commentId);
    await load(sort);
  };

  const pin = async (commentId) => {
    if (!cb.current.onPinComment) return;
    await cb.current.onPinComment(commentId);
    await load(sort);
  };

  /** 点赞：先乐观更新，失败回滚（撤销时两个分支都要还原，所以整体存一份快照） */
  const like = async (commentId) => {
    if (!cb.current.onLikeComment) return;
    const snapshot = comments;
    setComments((list) =>
      list.map((c) => (c.id === commentId ? { ...c, liked: !c.liked, like_count: Math.max(0, (c.like_count || 0) + (c.liked ? -1 : 1)) } : c))
    );
    try {
      await cb.current.onLikeComment(commentId);
    } catch {
      setComments(snapshot);
    }
  };

  return {
    comments,
    loading,
    sort,
    switchSort,
    onlyAuthor,
    toggleOnlyAuthor: () => setOnlyAuthor((v) => !v),
    submit,
    remove,
    pin,
    like,
    reload: () => load(sort),
  };
}
