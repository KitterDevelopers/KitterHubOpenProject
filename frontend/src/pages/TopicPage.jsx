// 话题聚合页：某话题下的所有帖子（支持订阅话题，新帖会通知）
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Hash, BellRing } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import { CircularProgress, FilledButton, FilledTonalButton } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import EmptyState from '../components/EmptyState';
import { toast } from '../components/Toast';
import { displayName, formatTime } from '../utils';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

export default function TopicPage() {
  const { topic } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  // 原来一次拉 50 条全渲染，话题热起来首屏就会很长
  const PAGE = 20;

  useEffect(() => {
    setLoading(true);
    client.get('/posts', { params: { topic, skip: 0, limit: PAGE } })
      .then((r) => setPosts(r.data))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [topic]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const r = await client.get('/posts', { params: { topic, skip: posts.length, limit: PAGE } });
      setPosts((prev) => prev.concat(r.data || []));
    } catch {
      /* 保持原样，按钮还在 */
    } finally {
      setMoreLoading(false);
    }
  };
  const hasMore = posts.length > 0 && posts.length % PAGE === 0;

  useEffect(() => {
    if (!user) return;
    client.get('/users/me/topic_subscriptions').then((r) => {
      setSubscribed((r.data.topics || []).includes(topic));
    }).catch(() => {});
  }, [user, topic]);

  const toggle = async () => {
    if (!user) { toast(t('topic.loginToSubscribe')); return; }
    try {
      const r = await client.post('/users/me/topic_subscriptions', { topic, subscribe: !subscribed });
      const next = (r.data.topics || []).includes(topic);
      setSubscribed(next);
      toast(next ? t('topic.subscribed', { topic }) : t('topic.unsubscribed', { topic }));
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 className="row" style={{ margin: '0 0 16px', fontWeight: 800, fontSize: 22, gap: 8, alignItems: 'center' }}><Hash size={22} /> {topic}</h1>
        <FilledTonalButton onClick={toggle} style={{ marginBottom: 16 }}>
          <span slot="icon"><BellRing size={17} /></span>
          {subscribed ? t('topic.subscribedBtn') : t('topic.subscribe')}
        </FilledTonalButton>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : posts.length === 0 ? (
        <EmptyState loading={loading} msIcon="search" title={t('topic.emptyTitle')} subtitle={t('topic.emptyDesc')} />
      ) : (
        posts.map((p) => (
          <Link to={`/posts/${p.id}`} key={p.id} className="m3-card" style={{ display: 'block', padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>{p.title}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{displayName(p.author)} - {formatTime(p.created_at)} - <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="chat_bubble" size={13} />{p.comment_count}</span></div>
          </Link>
        ))
      )}
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <FilledButton onClick={loadMore} disabled={moreLoading}>
            {moreLoading ? t('common.loading') : t('common.loadMore')}
          </FilledButton>
        </div>
      )}
    </div>
  );
}
