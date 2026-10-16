import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star, Plus } from 'lucide-react';
import { OutlinedButton, CircularProgress } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import { displayName } from '../utils';
import { useI18n } from '../i18n';

export default function CollectionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [myWorks, setMyWorks] = useState([]);
  const [pick, setPick] = useState('');

  const load = () => {
    client.get(`/collections/${id}`).then((r) => setData(r.data)).catch(() => setData(null));
  };
  useEffect(() => { load(); }, [id]);

  if (!data) return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;

  const isMine = !!user && data.owner && user.uid === data.owner.uid;

  const loadMyWorks = () => {
    if (!user) return;
    client.get(`/works/user/${user.uid}`).then((r) => setMyWorks(r.data)).catch(() => setMyWorks([]));
  };
  useEffect(() => { if (isMine) loadMyWorks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user, data]);

  return (
    <div className="page-pad" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={{ padding: 20, marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Star size={32} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{data.name}</h1>
            <div className="muted" style={{ fontSize: 13 }}>{data.description || t('collection.noDescription')} - {t('collection.creator', { name: displayName(data.owner) })} - {t('collection.workCount', { n: data.items.length })}</div>
          </div>
        </div>
        {isMine && (
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-soft)', background: 'var(--md-sys-color-surface-container)' }}>
              <option value="">{t('collection.selectWork')}</option>
              {myWorks.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
            <OutlinedButton
              style={{ fontSize: 13 }}
              onClick={async () => {
                if (!pick) return;
                await client.post(`/collections/${id}/items`, { work_id: Number(pick) });
                setPick('');
                load();
              }}
            ><span slot="icon"><Plus size={14} /></span>{t('collection.addTo')}</OutlinedButton>
          </div>
        )}
      </div>
      {data.items.length === 0 ? <EmptyState icon={Star} title={t('collection.emptyDetail')} /> : <div className="grid-works">{data.items.map((w) => <WorkCard key={w.id} work={w} />)}</div>}
    </div>
  );
}
