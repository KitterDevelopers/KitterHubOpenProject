import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Plus } from 'lucide-react';
import { OutlinedTextField, FilledButton, OutlinedButton, TextButton, Dialog, CircularProgress } from '../ui';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import { useI18n } from '../i18n';

export default function Collections() {
  const { t } = useI18n();
  const [cols, setCols] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => client.get('/users/me/collections').then((r) => setCols(r.data)).catch(() => setCols([])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    const r = await client.post('/users/me/collections', { name, description: desc });
    setOpen(false); setName(''); setDesc('');
    load();
    window.location.href = `/collections/${r.data.id}`;
  };

  return (
    <div className="page-pad" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Star size={22} /> {t('collection.myTitle')}</h1>
        <FilledButton onClick={() => setOpen(true)} style={{ marginLeft: 'auto' }}><span slot="icon"><Plus size={16} /></span>{t('collection.new')}</FilledButton>
      </div>
      {loading ? <CircularProgress indeterminate /> : cols.length === 0 ? <EmptyState icon={Star} title={t('collection.emptyTitle')} subtitle={t('collection.emptyDesc')} /> : (
        <div className="stack" style={{ gap: 10 }}>
          {cols.map((c) => (
            <Link to={`/collections/${c.id}`} key={c.id} className="m3-card row" style={{ gap: 12, padding: 14, textDecoration: 'none' }}>
              <Star size={30} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{c.description || t('collection.noDescription')} - {t('collection.workCount', { n: c.item_count })}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
        <div slot="headline">{t('collection.new')}</div>
        <div slot="content" className="stack">
          <OutlinedTextField label={t('collection.nameLabel')} value={name} onInput={(e) => setName(e.target.value)} />
          <OutlinedTextField label={t('collection.descLabel')} value={desc} onInput={(e) => setDesc(e.target.value)} />
        </div>
        <div slot="actions">
          <TextButton onClick={() => setOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={create} disabled={!name.trim()}>{t('collection.create')}</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
