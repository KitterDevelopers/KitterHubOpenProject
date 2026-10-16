/**
 * 编程猫作品导入的数据层。
 *
 * 关键设计：**列表**和**详情**分开拉。
 * - 列表（`/users/me/codemao-works`）便宜，进来就拉，用来铺卡片；后端顺便标好了「已投稿」。
 * - 详情（`/users/me/codemao-works/{id}`）只在**用户点了某一个作品**时才拉 —— 因为
 *     编程猫列表里的 type 分不出 Kitten3/Kitten4，只有详情才给权威的 player_url 和编辑器，
 *     但每个作品一次请求，10 个作品就是 10 次，全部预拉会让页面卡住。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../../api/client';
import { toast } from '../../components/Toast';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';

/** 已投稿里哪些状态算「不能再投」：已发布 / 审核中都不让重复投；被驳回的允许重投 */
export function isBlocked(item) {
  return Boolean(item.imported) && item.imported_status !== 'rejected';
}

export default function useCodemaoImport({ enabled, hasCodemao, applyImport }) {
  const { t } = useI18n();
  const errOf = useErr();
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [pickingId, setPickingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // 后端翻页拿到多少、编程猫那边一共多少、有没有被上限截断（见 codemao_work_list_all）
  const [meta, setMeta] = useState({ total: null, loadedCount: null, truncated: false });

  // ⚠️ errOf 来自 useErr()，**每次渲染都是新函数**。如果把它写进 useCallback 的依赖，
  //    load 就每次都变 → 下面的 effect 每次都重跑 → 编程猫作品列表被反复请求
  //    （实测一次进页面发了 4 次 GET /me/codemao-works）。用 ref 存住它。
  const errRef = useRef(errOf);
  useEffect(() => { errRef.current = errOf; });

  const load = useCallback(async () => {
    if (!hasCodemao) return;
    setLoading(true);
    setError('');
    try {
      const r = await client.get('/users/me/codemao-works');
      setWorks(r.data || []);
      const total = Number(r.headers && r.headers['x-total-count']);
      setMeta({
        total: Number.isNaN(total) ? null : total,
        loadedCount: (r.data || []).length,
        truncated: String((r.headers && r.headers['x-truncated']) || '0') === '1',
      });
      setLoaded(true);
    } catch (e) {
      setError(errRef.current(e));
      setWorks([]);
    } finally {
      setLoading(false);
    }
  }, [hasCodemao]);

  // 只有切到「从编程猫导入」时才去拉，别让进页面就多一次外部请求
  useEffect(() => {
    if (enabled && hasCodemao && !loaded) load();
  }, [enabled, hasCodemao, loaded, load]);

  /** 点一个作品：拉详情 → 交给表单填好编辑器/编号/标题/简介/封面 */
  const pick = async (item) => {
    if (isBlocked(item)) return;
    setPickingId(item.id);
    try {
      const r = await client.get(`/users/me/codemao-works/${item.id}`);
      const detail = r.data || {};
      if (!detail.supported) {
        toast(t('form.cmNoEditor', { type: detail.cm_type || '?' }), 'error');
        return;
      }
      applyImport(detail);
      setSelectedId(String(item.id));
    } catch (e) {
      toast(errRef.current(e), 'error');
    } finally {
      setPickingId(null);
    }
  };

  return { works, loading, error, loaded, load, pick, pickingId, selectedId, setSelectedId, meta };
}
