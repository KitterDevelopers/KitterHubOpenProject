import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { CircularProgress } from '../ui';
import client from '../api/client';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { useI18n } from '../i18n';
import { formatTime } from '../utils';

const STATUS = {
  // [文案 key, 图标名(null=无对应图标，保留原样), 背景色, 前景色]
  pending: ['report.statusPending', null, 'var(--md-sys-color-tertiary-container)', 'var(--md-sys-color-on-tertiary-container)'],
  handled: ['report.statusHandled', 'check_circle', 'var(--md-sys-color-secondary-container)', 'var(--md-sys-color-on-secondary-container)'],
  dismissed: ['report.statusDismissed', 'visibility_off', 'var(--md-sys-color-surface-container-high)', 'var(--md-sys-color-on-surface)'],
};
const TARGET = { work: 'report.targetWork', post: 'report.targetPost', comment: 'report.targetComment', studio: 'report.targetStudio' };

export default function MyReports() {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/reports/me').then((r) => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-pad" style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1 className="row" style={{ margin: '0 0 16px', fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Flag size={22} /> {t('report.mine')}</h1>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : items.length === 0 ? (
        <EmptyState loading={loading} icon={Flag} title={t('report.emptyTitle')} subtitle={t('report.emptyDesc')} />
      ) : (
        items.map((r) => {
          const [labelKey, icon, bg, fg] = STATUS[r.status] || STATUS.pending;
          return (
            <div key={r.id} className="m3-card row" style={{ gap: 12, padding: 14, marginBottom: 10 }}>
              <MsIcon name="flag" size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {TARGET[r.target_type] ? t(TARGET[r.target_type]) : r.target_type}
                  {r.target_id ? ` #${r.target_id}` : ''} - <span style={{ color: 'var(--md-sys-color-primary)' }}>{r.reason || t('report.noReason')}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{formatTime(r.created_at)}</div>
              </div>
              <span className="m3-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, flexShrink: 0 }}>{icon ? <><MsIcon name={icon} size={14} /> {t(labelKey)}</> : t(labelKey)}</span>
            </div>
          );
        })
      )}
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 12 }}>
        {t('report.appealPrefix')}<Link to="/help" style={{ color: 'var(--md-sys-color-primary)' }}>{t('help.title')}</Link>
      </p>
    </div>
  );
}
