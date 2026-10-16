/**
 * 作品详情页的数据与操作。
 *
 * 把原来散在组件里的 18 个 useState 和十几个请求收敛到这里，页面组件只负责画。
 * 约定：
 * - 所有写操作成功后**用服务器返回值更新本地 work**，不再盲改数字、更不整页 reload。
 * - 提示统一走全站 toast（不再自己实现 snackbar、也不用 alert）。
 * - 破坏性操作仍用 window.confirm —— 这是全站既有约定，这里不单独发明一套。
 */
import { useEffect, useState } from 'react';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';
import { toast } from '../../components/Toast';

const laterKeyFor = (uid) => `nimao_later_${uid || 'anon'}`;

function readLater(uid) {
  try {
    const arr = JSON.parse(localStorage.getItem(laterKeyFor(uid)) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function useWorkDetail(id) {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const errOf = useErr();

  const [work, setWork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [related, setRelated] = useState([]);
  const [isLater, setIsLater] = useState(false);

  const isOwner = Boolean(user && work && work.author?.uid === user.uid);

  // ---- 首屏加载 ----
  useEffect(() => {
    let alive = true;
    setWork(null);
    setError('');
    setLoading(true);
    client.get(`/works/${id}`)
      .then((r) => { if (alive) setWork(r.data); })
      .catch((e) => { if (alive) setError(errOf(e)); })
      .finally(() => { if (alive) setLoading(false); });
    client.get(`/works/${id}/related`).then((r) => { if (alive) setRelated(r.data || []); }).catch(() => {});
    setIsLater(readLater(user?.uid).includes(Number(id)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- 浏览记录（登录用户，作品加载成功后才记）----
  useEffect(() => {
    if (user && work) client.post(`/works/${id}/view`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, Boolean(work)]);

  const patch = (fields) => setWork((w) => (w ? { ...w, ...fields } : w));

  // ---- 点赞 ----
  // ⚠️ 必须 catch：点赞接口有防刷（取消后 60 秒内不能再赞 → 429）与等级门槛（403）。
  // 原来没有 catch，失败时**页面上一点反馈都没有**（只在控制台留一条 unhandled rejection），
  // 用户只会觉得「按钮坏了」。
  const toggleLike = async () => {
    try {
      const r = await client.post(`/works/${id}/like`);
      patch({ liked: r.data.liked, like_count: r.data.like_count });
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  // ---- 收藏 ----
  const unfavorite = async () => {
    try {
      const r = await client.post(`/works/${id}/favorite`, {});
      patch({ favorited: r.data.favorited, favorite_count: r.data.favorite_count ?? Math.max(0, (work.favorite_count || 0) - 1) });
      toast(t('work.unfavorited'), 'ok');
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };
  const favoriteInto = async (folderId) => {
    try {
      const r = await client.post(`/works/${id}/favorite`, { folder_id: folderId || null });
      patch({ favorited: r.data.favorited, favorite_count: r.data.favorite_count ?? (work.favorite_count || 0) + 1 });
      toast(t('work.favoritedDone'), 'ok');
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  // ---- 投喂 ----
  const feed = async (count) => {
    try {
      const r = await client.post(`/works/${id}/feed`, { count });
      patch({ feed_count: r.data.feed_count });
      toast(t('work.feedDone', { n: r.data.my_fish }), 'ok');
      if (refresh) refresh();
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  // ---- 关注作者 ----
  const follow = async (uid) => {
    if (!uid) return;
    await client.post(`/users/${uid}/follow`).catch(() => {});
  };

  // ---- 稍后再看（本机）----
  const toggleLater = () => {
    const key = laterKeyFor(user?.uid);
    const arr = readLater(user?.uid);
    const nid = Number(id);
    const next = arr.includes(nid) ? arr.filter((x) => x !== nid) : [...arr, nid];
    try {
      localStorage.setItem(key, JSON.stringify(next));
      const nowLater = next.includes(nid);
      setIsLater(nowLater);
      toast(nowLater ? t('work.addedToLater') : t('work.removedFromLater'), 'ok');
    } catch {
      toast(t('work.copyFailed'), 'error');
    }
  };

  // ---- 分享 ----
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: work?.title || 'KitterHub', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast(t('work.linkCopied'), 'ok');
    } catch {
      // 用户取消分享不算错误，只有真复制失败才提示
      try {
        await navigator.clipboard.writeText(url);
        toast(t('work.linkCopied'), 'ok');
      } catch {
        toast(t('work.copyFailed'), 'error');
      }
    }
  };

  // ---- 一键三连 ----
  /**
   * 三连 = **补齐**点赞 / 收藏 / 关注，不是「再点一遍」。
   *
   * ⚠️ 这里原来无条件 POST /like 与 /favorite，而这两个接口是**开关**：
   * 已经赞过的作品点三连，会把赞**取消掉**（收藏同理）—— 也就是「三连」反而减了两项。
   * 现在改成：已经有了就跳过，只补缺的；并且**不许再用 `?? true` 编造状态**
   * （原来点赞请求失败时会硬写成 liked:true，界面显示已赞、服务器其实没有）。
   */
  const triple = async () => {
    const missing = [];
    if (!work?.liked) missing.push('like');
    if (!work?.favorited) missing.push('favorite');
    if (work?.author?.uid && work.author.uid !== user?.uid && !work.author.is_following) missing.push('follow');

    const fields = {};
    const failed = [];
    if (missing.includes('like')) {
      const r = await client.post(`/works/${id}/like`).then((x) => x.data).catch(() => null);
      if (r) { fields.liked = r.liked; fields.like_count = r.like_count; }
      else failed.push(t('common.like'));
    }
    if (missing.includes('favorite')) {
      const r = await client.post(`/works/${id}/favorite`, {}).then((x) => x.data).catch(() => null);
      if (r) { fields.favorited = r.favorited; fields.favorite_count = r.favorite_count; }
      else failed.push(t('work.favorite'));
    }
    if (missing.includes('follow')) {
      const r = await client.post(`/users/${work.author.uid}/follow`).then((x) => x.data).catch(() => null);
      if (r) fields.author = { ...work.author, is_following: true };
      else failed.push(t('work.followAuthor'));
    }
    if (Object.keys(fields).length) patch(fields);

    if (failed.length) toast(t('work.tripleFail', { items: failed.join('、') }), 'error');
    else if (!missing.length) toast(t('work.tripleAlready'), 'ok');
    else toast(t('work.tripleDone'), 'ok');
  };

  // ---- 删除 ----
  const remove = async () => {
    await client.delete(`/works/${id}`);
    toast(t('work.deleted'), 'ok');
  };

  // ---- 申诉 ----
  const appeal = async (reason) => {
    await client.post(`/works/${id}/appeal`, { reason });
    toast(t('work.appealSent'), 'ok');
  };

  return {
    user,
    work,
    loading,
    error,
    related,
    isLater,
    isOwner,
    toggleLike,
    unfavorite,
    favoriteInto,
    feed,
    follow,
    toggleLater,
    share,
    triple,
    remove,
    appeal,
  };
}
