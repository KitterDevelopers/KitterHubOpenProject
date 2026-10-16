import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Newspaper } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import { OutlinedTextField, FilledButton, FilterChip, CircularProgress } from '../ui';
import client from '../api/client';
import UserAvatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { formatTime, displayName, plainPreview } from '../utils';
import { useI18n } from '../i18n';

const CATS = ['全部', '讨论', '教程', '求助', '展示'];
// 分类值同时用于接口查询，所以这里只把「显示文案」映射到词条
const CAT_KEYS = {
  '全部': 'common.all',
  '讨论': 'forum.catDiscussion',
  '教程': 'forum.catTutorial',
  '求助': 'forum.catHelp',
  '展示': 'forum.catShowcase',
};

export default function Forum() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [cat, setCat] = useState('全部');
  const [sort, setSort] = useState('new');
  const [filter, setFilter] = useState(''); // featured 只看精华
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);

  // 分页加载：原来一次拉 100 条全渲染，帖子一多首屏就很长
  const PAGE = 20;

  const load = async (searchQ) => {
    setLoading(true);
    try {
      const res = await client.get('/posts', {
        params: {
          category: cat === '全部' ? undefined : cat,
          q: searchQ || undefined, sort, filter: filter || undefined,
          skip: 0, limit: PAGE,
        },
      });
      setPosts(res.data);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const res = await client.get('/posts', {
        params: {
          category: cat === '全部' ? undefined : cat,
          q: q || undefined, sort, filter: filter || undefined,
          skip: posts.length, limit: PAGE,
        },
      });
      setPosts((prev) => prev.concat(res.data || []));
    } catch {
      /* 保持原样，按钮还在 */
    } finally {
      setMoreLoading(false);
    }
  };
  // 上一页正好取满，说明后面可能还有
  const hasMore = posts.length > 0 && posts.length % PAGE === 0;

  useEffect(() => {
    load(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, sort, filter]);

  const onSearch = (e) => {
    e.preventDefault();
    load(q);
  };

  return (
    <div className="page-pad">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Newspaper size={22} /> {t('forum.title')}</h1>
        <FilledButton onClick={() => navigate('/posts/new')}>
          <span slot="icon"><Plus size={18} /></span>
          {t('forum.newPost')}
        </FilledButton>
      </div>

      <div className="forum-grid">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            {CATS.map((c) => (
              <FilterChip key={c} label={t(CAT_KEYS[c])} selected={cat === c} onClick={() => setCat(c)} />
            ))}
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 16, justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8 }}>
          <FilterChip label={t('forum.sortNew')} selected={sort === 'new' && filter !== 'featured' && filter !== 'unanswered'} onClick={() => { setSort('new'); setFilter(''); }} />
          <FilterChip selected={sort === 'hot' && filter !== 'featured' && filter !== 'unanswered'} onClick={() => { setSort('hot'); setFilter(''); }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="local_fire_department" size={14} />{t('forum.sortHot')}</span>
          </FilterChip>
          <FilterChip selected={filter === 'featured'} onClick={() => setFilter(filter === 'featured' ? '' : 'featured')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="star" size={14} />{t('forum.featured')}</span>
          </FilterChip>
          <FilterChip selected={filter === 'unanswered'} onClick={() => setFilter(filter === 'unanswered' ? '' : 'unanswered')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="person" size={14} />{t('forum.needReply')}</span>
          </FilterChip>
        </div>
        <form onSubmit={onSearch} className="row" style={{ gap: 8 }}>
          <OutlinedTextField label={t('forum.searchPlaceholder')} value={q} onInput={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <FilledButton type="submit"><span slot="icon"><Search size={18} /></span>{t('common.search')}</FilledButton>
        </form>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : posts.length === 0 ? (
        <EmptyState loading={loading} msIcon="mark_email_unread" title={t('forum.emptyTitle')} subtitle={t('forum.emptyDesc')} />
      ) : (
        posts.map((p) => (
          <Link to={`/posts/${p.id}`} key={p.id} className="m3-card" style={{ display: 'block', padding: 18, marginBottom: 12 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="m3-badge m3-badge--primary">{p.category}</span>
              {p.is_pinned && <span className="m3-badge m3-badge--error">{t('forum.pinned')}</span>}
              {p.is_featured && <span className="m3-badge"><MsIcon name="star" size={13} />{t('forum.featured')}</span>}
              <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="visibility" size={13} />{p.views}</span>
            </div>            <div style={{ fontWeight: 700, fontSize: 17 }}>{p.title}</div>
            {p.topics?.length > 0 && (
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {p.topics.slice(0, 3).map((topic) => (
                  <span key={topic} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/search?q=${encodeURIComponent(topic)}`; }} className="m3-badge" style={{ cursor: 'pointer' }}># {topic}</span>
                ))}
              </div>
            )}
            <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{plainPreview(p.content, 120)}</div>
            <div className="row" style={{ gap: 12, marginTop: 10, fontSize: 12 }}>
              <UserAvatar user={p.author} size={18} />
              <span className="muted">{displayName(p.author)}</span>
              {/* 发帖时的 IP 属地（快照） */}
              {p.author?.ip_region && (
                <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <MsIcon name="location_on" size={13} />{p.author.ip_region}
                </span>
              )}
              <span className="muted">{formatTime(p.created_at)}</span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="favorite" size={13} />{p.like_count}</span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="chat_bubble" size={13} />{p.comment_count}</span>
            </div>
          </Link>
        ))
      )}
        {hasMore && (
          <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
            <FilledButton onClick={loadMore} disabled={moreLoading}>
              {moreLoading ? t('common.loading') : t('common.loadMore')}
            </FilledButton>
          </div>
        )}
        </div>
        <HotToday />
      </div>
    </div>
  );
}

// 侧栏：今日热帖
export function HotToday() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  useEffect(() => {
    client.get('/discover/posts/hot_today').then((r) => setItems(r.data)).catch(() => setItems([]));
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="m3-card m3-card--filled" style={{ padding: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><MsIcon name="local_fire_department" size={16} />{t('forum.hotToday')}</div>
      {items.map((p, i) => (
        <div key={p.id} onClick={() => navigate(`/posts/${p.id}`)} style={{ cursor: 'pointer', padding: '7px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border-soft)' : 'none', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: i < 3 ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-on-surface-variant)', width: 18 }}>{i + 1}</span>
          <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
          <span className="muted" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="chat_bubble" size={12} />{p.comment_count}</span>
        </div>
      ))}
    </div>
  );
}
