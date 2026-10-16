import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, PrimaryTab, CircularProgress, OutlinedButton } from '../ui';
import { UserRound, Heart, MessageCircle, Star } from 'lucide-react';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { useI18n } from '../i18n';
import { formatTime, plainPreview } from '../utils';

function ItemCard({ kind, data }) {
  if (kind === 'work') {
    return <WorkCard work={data} />;
  }
  const p = data;
  return (
    <Link to={`/posts/${p.id}`} className="m3-card" style={{ display: 'block', padding: 16 }}>
      <span className="m3-badge m3-badge--primary">{p.category}</span>
      <div style={{ fontWeight: 700, marginTop: 6 }}>{p.title}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{plainPreview(p.content, 80)}</div>
    </Link>
  );
}

export default function Me() {
  const { t } = useI18n();
  const [tab, setTab] = useState(0);
  const [likes, setLikes] = useState([]);
  const [comments, setComments] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.get('/users/me/likes'),
      client.get('/users/me/comments'),
      client.get('/users/me/favorites'),
    ]).then(([l, c, f]) => {
      setLikes(l.data);
      setComments(c.data);
      setFavorites(f.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-pad">
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 className="row" style={{ fontWeight: 800, fontSize: 24, margin: 0, gap: 8, alignItems: 'center' }}><UserRound size={22} /> {t('topbar.me')}</h1>
        <span style={{ flex: 1 }} />
        <Link to="/xp"><OutlinedButton><span slot="icon"><MsIcon name="military_tech" size={16} /></span>{t('xp.title')}</OutlinedButton></Link>
        <Link to="/collections"><OutlinedButton>{t('me.collections')}</OutlinedButton></Link>
        <Link to="/later"><OutlinedButton>{t('later.title')}</OutlinedButton></Link>
        <Link to="/my-reports"><OutlinedButton>{t('report.mine')}</OutlinedButton></Link>
        <Link to="/help"><OutlinedButton>{t('help.title')}</OutlinedButton></Link>
        <Link to="/settings"><OutlinedButton><span slot="icon"><MsIcon name="settings" size={16} /></span>{t('settings.title')}</OutlinedButton></Link>
      </div>
      <Tabs>
        <PrimaryTab selected={tab === 0} onClick={() => setTab(0)}><span className="row" style={{ gap: 4, alignItems: 'center' }}><Heart size={15} /> {t('me.tabLikes', { n: likes.length })}</span></PrimaryTab>
        <PrimaryTab selected={tab === 1} onClick={() => setTab(1)}><span className="row" style={{ gap: 4, alignItems: 'center' }}><MessageCircle size={15} /> {t('me.tabComments', { n: comments.length })}</span></PrimaryTab>
        <PrimaryTab selected={tab === 2} onClick={() => setTab(2)}><span className="row" style={{ gap: 4, alignItems: 'center' }}><Star size={15} /> {t('me.tabFavorites', { n: favorites.length })}</span></PrimaryTab>
      </Tabs>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
        ) : tab === 0 ? (
          likes.length === 0 ? <EmptyState msIcon="favorite" title={t('me.emptyLikes')} /> : <div className="grid-works">{likes.map((x, i) => <ItemCard key={i} kind={x.kind} data={x.data} />)}</div>
        ) : tab === 1 ? (
          comments.length === 0 ? <EmptyState msIcon="chat_bubble" title={t('me.emptyComments')} /> : comments.map((c) => (
            <Link to={c.target_type === 'work' ? `/works/${c.target_id}` : `/posts/${c.target_id}`} key={c.id} className="m3-card" style={{ display: 'block', padding: 14, marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 12 }}>{c.target_type === 'work' ? t('report.targetWork') : t('report.targetPost')} - {c.target_title || t('me.deleted')}</div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{c.content}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{formatTime(c.created_at)}</div>
            </Link>
          ))
        ) : favorites.length === 0 ? (
          <EmptyState loading={loading} msIcon="star" title={t('me.emptyFavorites')} />
        ) : (
          <div className="grid-works">{favorites.map((x, i) => <ItemCard key={i} kind={x.kind} data={x.data} />)}</div>
        )}
      </div>
    </div>
  );
}
