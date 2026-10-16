import { useEffect, useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { CircularProgress, OutlinedButton } from '../ui';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import { useI18n } from '../i18n';
import { formatTime } from '../utils';

export default function History() {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    client.get('/users/me/history').then((r) => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const removeOne = async (workId) => {
    await client.delete(`/users/me/history/${workId}`).catch(() => {});
    setItems((prev) => prev.filter((h) => h.work?.id !== workId));
  };
  const clearAll = async () => {
    if (!window.confirm(t('history.clearConfirm'))) return;
    await client.delete('/users/me/history').catch(() => {});
    setItems([]);
  };

  return (
    <div className="page-pad">
      <h1 className="row" style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Clock size={22} /> {t('topbar.history')}</h1>
      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 16px' }}>
        <p className="muted" style={{ margin: 0 }}>{t('history.subtitle')}</p>
        {items.length > 0 && <OutlinedButton onClick={clearAll} style={{ fontSize: 12 }}>{t('history.clear')}</OutlinedButton>}
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : items.length === 0 ? (
        <EmptyState loading={loading} msIcon="schedule" title={t('history.emptyTitle')} subtitle={t('history.emptyDesc')} />
      ) : (
        <>
          <div className="grid-works">
            {items.map((h) => (h.work ? (
              <div key={h.work.id} style={{ position: 'relative' }}>
                <WorkCard work={h.work} />
                <button
                  onClick={() => removeOne(h.work.id)}
                  title={t('history.remove')}
                  style={{ position: 'absolute', top: 8, right: 8, border: 'none', borderRadius: 'var(--radius-circle)', background: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-error)', cursor: 'pointer', padding: 6, zIndex: 2 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : null))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 12, textAlign: 'center' }}>
            {t('history.footer', { n: items.length, time: formatTime(items[0]?.viewed_at) })}
          </div>
        </>
      )}
    </div>
  );
}
