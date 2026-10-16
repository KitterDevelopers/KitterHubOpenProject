// 作品合集（系列）页：我的系列列表 + 详情
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { FilledButton, CircularProgress, OutlinedTextField, Dialog, TextButton, IconButton } from '../ui';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

export function SeriesList({ items: itemsProp, onChanged }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const err = useErr();
  const controlled = itemsProp !== undefined;
  const [local, setLocal] = useState([]);
  const [localLoading, setLocalLoading] = useState(!controlled);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLocalLoading(true);
    client.get('/works/series/list').then((r) => setLocal(r.data || [])).catch(() => setLocal([])).finally(() => setLocalLoading(false));
  };
  useEffect(() => {
    if (!controlled) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);

  const items = controlled ? itemsProp : local;
  const loading = controlled ? false : localLoading;

  const reload = () => {
    if (controlled) onChanged?.();
    else load();
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await client.post('/works/series', { name: name.trim(), description: desc.trim() });
      toast(t('series.created'), 'success');
      setOpen(false);
      setName('');
      setDesc('');
      reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (s) => {
    if (!window.confirm(t('series.deleteConfirm', { name: s.name }))) return;
    try {
      await client.delete(`/works/series/${s.id}`);
      toast(t('series.deleted'), 'success');
      reload();
    } catch {
      toast(t('series.deleteFailed'), 'error');
    }
  };

  const newButton = (
    <FilledButton onClick={() => setOpen(true)}>
      <span slot="icon"><Plus size={18} /></span>{t('series.new')}
    </FilledButton>
  );

  return (
    <>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>
      ) : items.length === 0 ? (
        <EmptyState
          msIcon="folder"
          title={t('series.emptyTitle')}
          subtitle={t('series.emptyDesc')}
        >
          {newButton}
        </EmptyState>
      ) : (
        <>
          <div className="cc-toolbar">
            <span className="muted" style={{ fontSize: 13 }}>{t('series.count', { n: items.length })}</span>
            <span className="cc-toolbar-gap" />
            {newButton}
          </div>
          <div className="cc-series-grid">
            {items.map((s) => (
              <div
                key={s.id}
                className="cc-series-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/series/${s.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/series/${s.id}`); }}
              >
                <span className="cc-series-icon"><MsIcon name="folder" size={26} /></span>
                <div className="cc-series-body">
                  <div className="cc-series-name">{s.name}</div>
                  <div className="cc-series-desc">{s.description || t('series.noDescription')}</div>
                  <div className="cc-series-count">
                    <MsIcon name="videocam" size={13} /> {t('series.workCount', { n: s.work_count })}
                  </div>
                </div>
                <IconButton
                  title={t('series.deleteTitle')}
                  style={{ color: 'var(--md-sys-color-error)' }}
                  onClick={(e) => { e.stopPropagation(); del(s); }}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
        <div slot="headline">{t('series.newTitle')}</div>
        <div slot="content" className="stack">
          <OutlinedTextField label={t('series.nameLabel')} value={name} onInput={(e) => setName(e.target.value)} />
          <OutlinedTextField label={t('series.descLabel')} value={desc} onInput={(e) => setDesc(e.target.value)} supportingText={t('series.descHint')} />
        </div>
        <div slot="actions">
          <TextButton onClick={() => setOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={create} disabled={!name.trim() || busy}>{busy ? t('series.creating') : t('series.create')}</FilledButton>
        </div>
      </Dialog>
    </>
  );
}

export function SeriesDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const [series, setSeries] = useState(null);
  const [myWorks, setMyWorks] = useState([]);
  const [addId, setAddId] = useState('');

  const load = () => {
    client.get(`/works/series/${id}`).then((r) => setSeries(r.data)).catch(() => {});
    if (user) client.get(`/works/user/${user.uid}`).then((r) => setMyWorks(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id, user]);

  const addWork = async () => {
    await client.post(`/works/series/${id}/works`, { work_id: Number(addId) }).catch((e) => alert(err(e)));
    setAddId(''); load();
  };

  if (!series) return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  const isMine = user && series.owner?.uid === user.uid;
  return (
    <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 24, display: 'flex', alignItems: 'center', gap: 8 }}><MsIcon name="folder" size={24} /> {series.name}</h1>
      <p className="muted" style={{ margin: '0 0 16px' }}>{series.description || t('series.noDescription')}</p>
      {isMine && (
        <div className="m3-card m3-card--filled" style={{ padding: 14, marginBottom: 14 }}>
          <form onSubmit={(e) => { e.preventDefault(); addWork(); }} className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <select value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 'var(--radius)', border: '1px solid var(--border-soft)', background: 'var(--md-sys-color-surface-container)' }}>
              <option value="">{t('series.selectWork')}</option>
              {myWorks.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
            <FilledButton type="submit" disabled={!addId}>{t('series.addTo')}</FilledButton>
          </form>
        </div>
      )}
      {series.works?.length === 0 ? (
        <EmptyState msIcon="folder" title={t('series.emptyDetail')} />
      ) : (
        <div className="grid-works">{series.works.map((w) => <WorkCard key={w.id} work={w} />)}</div>
      )}
      <div style={{ marginTop: 20 }}>
        <Link to="/create?tab=series" style={{ color: 'var(--md-sys-color-primary)' }}>{t('series.backToList')}</Link>
      </div>
    </div>
  );
}
