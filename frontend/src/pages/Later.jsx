// 稍后看：本地保存的稿件列表（整理：单个移除 / 清空）
import { useEffect, useState } from 'react';
import { Clock3, Trash2 } from 'lucide-react';
import { CircularProgress, OutlinedButton, TextButton } from '../ui';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import { toast } from '../components/Toast';
import { useI18n } from '../i18n';

export default function Later() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = `nimao_later_${user?.uid || 'anon'}`;
  const ids = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };

  const load = () => {
    setLoading(true);
    const list = ids();
    if (list.length === 0) { setWorks([]); setLoading(false); return; }
    client.get('/works/later', { params: { ids: list.join(',') } })
      .then((r) => setWorks(r.data))
      .catch(() => setWorks([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [key]);

  const remove = (id) => {
    localStorage.setItem(key, JSON.stringify(ids().filter((x) => x !== id)));
    setWorks((prev) => prev.filter((w) => w.id !== id));
    toast(t('later.removed'));
  };
  const clearAll = () => {
    if (!window.confirm(t('later.clearConfirm'))) return;
    localStorage.setItem(key, JSON.stringify([]));
    setWorks([]);
    toast(t('later.cleared'));
  };

  return (
    <div className="page-pad">
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="row" style={{ fontWeight: 800, fontSize: 24, margin: 0, gap: 8, alignItems: 'center' }}><Clock3 size={22} /> {t('later.title')}</h1>
        <span style={{ flex: 1 }} />
        {works.length > 0 && <OutlinedButton onClick={clearAll}><Trash2 size={16} /> {t('later.clearAll')}</OutlinedButton>}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : works.length === 0 ? (
        <EmptyState loading={loading} msIcon="schedule" title={t('later.emptyTitle')} subtitle={t('later.emptyDesc')} />
      ) : (
        <div className="grid-works">
          {works.map((w) => (
            <div key={w.id}>
              <WorkCard work={w} />
              <TextButton onClick={() => remove(w.id)} style={{ width: '100%', fontSize: 12, '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('later.remove')}</TextButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
