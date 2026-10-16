import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilledButton, OutlinedButton, CircularProgress } from '../ui';
import { Bell, Trash2 } from 'lucide-react';
import client from '../api/client';
import UserAvatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { useI18n } from '../i18n';
import { formatTime, dayLabel } from '../utils';

// [文案 key, 图标名（null = 无对应图标，保留原样）]
const TYPE_LABEL = {
  like: ['notify.like', 'favorite'], comment: ['notify.comment', 'chat_bubble'], reply: ['notify.reply', null], follow: ['notify.follow', 'person_add'],
  mention: ['notify.mention', null], chat_dm: ['notify.chatDm', 'chat_bubble'], admin: ['notify.system', 'shield'], follow_work: ['notify.followActivity', 'campaign'], follow_post: ['notify.followActivity', 'campaign'],
  studio: ['notify.studio', 'home'], studio_work: ['notify.studio', 'home'], studio_approve: ['notify.studio', 'home'],
};
function dayGroup(ts) {
  return dayLabel(ts);
}

function TypeTag({ type }) {
  const { t } = useI18n();
  const row = TYPE_LABEL[type];
  if (!row) return <>{type}</>;
  const [labelKey, icon] = row;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {icon ? <MsIcon name={icon} size={13} /> : null}
      {t(labelKey)}
    </span>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [filter, setFilter] = useState('全部');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(30);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);

  const load = (reset = false) => {
    const l = reset ? 30 : limit;
    setLoading(true);
    client.get('/notifications', {
      params: {
        type: filter === '全部' ? undefined : filter,
        unread: onlyUnread || undefined,
        limit: l,
      },
    })
      .then((r) => setItems(r.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    client.get('/notifications/types').then((r) => setTypes(r.data)).catch(() => {});
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(true); }, [filter, onlyUnread]);

  const readAll = async () => {
    await client.post('/notifications/read_all');
    load(true);
  };

  const delSelected = async () => {
    if (!selected.length) return;
    if (!window.confirm(t('notify.deleteSelectedConfirm', { n: selected.length }))) return;
    await client.post('/notifications/delete_batch', { ids: selected }).catch(() => {});
    setSelected([]); setSelectMode(false);
    load(true);
  };

  const go = (n) => {
    if (!n.is_read) {
      client.post(`/notifications/${n.id}/read`).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    if (n.target_id && (n.target_type === 'work' || n.target_type === 'comment')) navigate(`/works/${n.target_id}`);
    else if (n.target_id && n.target_type === 'post') navigate(`/posts/${n.target_id}`);
    else if (n.target_id && n.target_type === 'studio') navigate(`/studios/${n.target_id}`);
    else if (n.target_id && n.target_type === 'room') navigate(`/chat?thread=${n.target_id}`);
    else if (n.type === 'follow' && n.actor?.uid) navigate(`/users/${n.actor.uid}`);
  };

  const del = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm(t('notify.deleteConfirm'))) return;
    await client.delete(`/notifications/${id}`).catch(() => {});
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  // 时间分组
  const groups = [];
  const seen = new Set();
  for (const n of items) {
    const g = dayGroup(n.created_at);
    if (!seen.has(g)) {
      seen.add(g);
      groups.push({ label: g, items: [] });
    }
    groups[groups.length - 1].items.push(n);
  }

  return (
    <div className="page-pad" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row" style={{ gap: 12, marginBottom: 16 }}>
        <h1 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Bell size={22} /> {t('topbar.notifications')}</h1>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <OutlinedButton onClick={() => { setSelectMode(!selectMode); setSelected([]); }} style={{ fontSize: 12 }}>{selectMode ? t('notify.cancelSelect') : t('notify.batchDelete')}</OutlinedButton>
          {selectMode && <FilledButton onClick={delSelected} disabled={!selected.length} style={{ fontSize: 12 }}>{t('notify.deleteSelected', { n: selected.length })}</FilledButton>}
          <OutlinedButton onClick={readAll}>{t('notify.readAll')}</OutlinedButton>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['全部', ...types].slice(0, 12).map((opt) => {
          // opt === '全部' 或后端返回的 { type, label, types } 分组（同显示名的类型已合并）
          const value = opt === '全部' ? '全部' : opt.types.join(',');
          return (
            <span
              key={value}
              onClick={() => setFilter(value)}
              style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: filter === value ? 700 : 400, background: filter === value ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-high)', color: filter === value ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)' }}
            >{opt === '全部' ? t('common.all') : (TYPE_LABEL[opt.type] ? <TypeTag type={opt.type} /> : opt.label)}</span>
          );
        })}
        <span
          onClick={() => setOnlyUnread((v) => !v)}
          style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: onlyUnread ? 700 : 400, background: onlyUnread ? 'var(--md-sys-color-tertiary-container)' : 'var(--md-sys-color-surface-container-high)' }}
        >{t('notify.onlyUnread')}</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : items.length === 0 ? (
        <EmptyState loading={loading} msIcon="notifications_off" title={t('notify.emptyTitle')} subtitle={t('notify.emptyDesc')} />
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 14 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px 4px' }}>{g.label}</div>
              {g.items.map((n) => (
                <div key={n.id} onClick={() => selectMode ? setSelected((p) => p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id]) : go(n)} className="m3-card row" style={{ gap: 12, padding: 12, marginBottom: 8, cursor: 'pointer', opacity: n.is_read ? 0.62 : 1, position: 'relative' }}>
                  {selectMode && <span style={{ width: 18, height: 18, borderRadius: 'var(--radius)', border: '2px solid var(--md-sys-color-outline)', background: selected.includes(n.id) ? 'var(--md-sys-color-primary)' : 'transparent', flexShrink: 0 }} />}
                  {n.actor ? <UserAvatar user={n.actor} size={36} /> : <MsIcon name="shield" size={28} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>{n.content}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{TYPE_LABEL[n.type] ? <TypeTag type={n.type} /> : n.type} - {formatTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-circle)', background: 'var(--md-sys-color-primary)', flexShrink: 0 }} />}
                  <button onClick={(e) => del(e, n.id)} title={t('notify.deleteOne')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--md-sys-color-on-surface-variant)', padding: 4 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ))}
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <FilledButton onClick={() => { setLimit((l) => l + 30); setTimeout(() => load(), 0); }}>{t('notify.loadMore')}</FilledButton>
          </div>
        </>
      )}
    </div>
  );
}
