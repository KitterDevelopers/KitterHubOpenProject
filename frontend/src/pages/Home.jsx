import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FilledButton, CircularProgress } from '../ui';
import { Flame, Star, Sparkles, Megaphone, Users, Newspaper, Heart, Gamepad2, Clapperboard, BookOpen, Music, Palette, Calculator, FlaskConical, Puzzle, Trophy } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import WorkGrid from '../components/WorkGrid';
import UserAvatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import BannerCarousel from '../components/BannerCarousel';
import { formatTime, displayName } from '../utils';

// name 是分类原文（用于链接与后端查询参数），key 是对应词条。
const CATEGORIES = [
  { name: '游戏', key: 'home.catGame', icon: Gamepad2 }, { name: '动画', key: 'home.catAnimation', icon: Clapperboard }, { name: '故事', key: 'home.catStory', icon: BookOpen },
  { name: '音乐', key: 'home.catMusic', icon: Music }, { name: '绘画', key: 'home.catArt', icon: Palette }, { name: '数学', key: 'home.catMath', icon: Calculator },
  { name: '科学', key: 'home.catScience', icon: FlaskConical }, { name: '其他', key: 'home.catOther', icon: Puzzle },
];

function SectionTitle({ children, to }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ justifyContent: 'space-between', margin: '28px 0 12px' }}>
      <h2 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>{children}</h2>
      {to && <Link to={to} style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600, fontSize: 14 }}>{t('home.viewMore')}</Link>}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [home, setHome] = useState(null);
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [loading, setLoading] = useState(true);

  // 关注动态按页加载：首屏只拉 FEED_PAGE 条，点「加载更多」再拉下一页。
  // 之前是一次拉 50 条全渲染，关注的人一多首屏就会很长。
  const FEED_PAGE = 8;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.get('/discover/home'),
      client.get('/public/announcement'),
      user ? client.get('/discover/feed', { params: { limit: FEED_PAGE, offset: 0 } }) : Promise.resolve({ data: [] }),
    ]).then(([h, a, f]) => {
      setHome(h.data);
      setAnnouncement(a.data.announcement || '');
      setFeed(f.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const loadMoreFeed = async () => {
    setFeedLoading(true);
    try {
      const r = await client.get('/discover/feed', { params: { limit: FEED_PAGE, offset: feed.length } });
      setFeed((prev) => prev.concat(r.data || []));
    } catch {
      /* 失败就保持原样，按钮还在，可以再点 */
    } finally {
      setFeedLoading(false);
    }
  };
  // 上一页正好取满，说明后面可能还有；取不满就是到底了
  const feedHasMore = user && feed.length > 0 && feed.length % FEED_PAGE === 0;

  if (loading || !home) return <div style={{ textAlign: 'center', padding: '60px 0' }}><CircularProgress indeterminate /></div>;

  return (
    <div className="page-pad">
      {announcement && (
        <div className="row" style={{ gap: 8, padding: '12px 16px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-secondary-container)', color: 'var(--md-sys-color-on-secondary-container)', marginBottom: 16, fontWeight: 600 }}>
          <Megaphone size={18} style={{ flexShrink: 0 }} /> {announcement}
        </div>
      )}

      <BannerCarousel banners={home.banners || []} />

      {/* 分类导航 */}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {CATEGORIES.map((c) => (
          <Link
            key={c.name}
            to={`/discover?category=${encodeURIComponent(c.name)}`}
            style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 16px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container-high)', color: 'var(--md-sys-color-on-surface)' }}
          >
            <c.icon size={22} strokeWidth={1.8} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t(c.key)}</span>
          </Link>
        ))}
      </div>

      {/* 官方精选（轮播与分类下方，无查看更多） */}
      {home.featured?.length > 0 && (
        <>
          <SectionTitle><span className="row" style={{ gap: 6, alignItems: 'center' }}><Star size={19} /> {t('home.featured')}</span></SectionTitle>
          <WorkGrid works={home.featured} />
        </>
      )}

      {/* 推荐位帖子（官方精选帖） */}
      {home.featured_posts?.length > 0 && (
        <>
          <SectionTitle to="/forum"><span className="row" style={{ gap: 6, alignItems: 'center' }}><Newspaper size={19} /> {t('home.featuredPosts')}</span></SectionTitle>
          <div className="stack" style={{ gap: 8 }}>
            {home.featured_posts.map((p) => (
              <Link key={p.id} to={`/posts/${p.id}`} className="m3-card row" style={{ display: 'flex', gap: 10, padding: '12px 16px', alignItems: 'center' }}>
                <span className="m3-badge m3-badge--primary" style={{ flexShrink: 0 }}>{p.category}</span>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{displayName(p.author)} - {formatTime(p.created_at)}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* 猜你喜欢（个性化推荐，登录后展示） */}
      {user && home.for_you?.length > 0 && (
        <>
          <SectionTitle><span className="row" style={{ gap: 6, alignItems: 'center' }}><Heart size={19} /> {t('home.forYou')}</span></SectionTitle>
          <WorkGrid works={home.for_you} />
        </>
      )}

      {/* 最新投稿 */}
      {home.newest?.length > 0 && (
        <>
          <SectionTitle to="/discover"><span className="row" style={{ gap: 6, alignItems: 'center' }}><Sparkles size={19} /> {t('home.newest')}</span></SectionTitle>
          <WorkGrid works={home.newest} />
        </>
      )}

      {/* 关注动态 */}
      <div className="row" style={{ justifyContent: 'space-between', margin: '28px 0 12px' }}>
        <h2 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 20, gap: 6, alignItems: 'center' }}><Users size={19} /> {t('home.feed')}</h2>
        {!user && <FilledButton onClick={() => navigate('/login')} style={{ fontSize: 13 }}>{t('home.loginToView')}</FilledButton>}
      </div>
      {!user ? (
        <EmptyState icon={Users} title={t('home.feedLoginTitle')} subtitle={t('home.feedLoginDesc')} />
      ) : feed.length === 0 ? (
        <EmptyState icon={Users} title={t('home.feedEmptyTitle')} subtitle={t('home.feedEmptyDesc')} />
      ) : (
        <div style={{ maxWidth: 680 }}>
          {feed.map((f, i) => (
            <Link key={i} to={f.kind === 'work' ? `/works/${f.data.id}` : `/posts/${f.data.id}`} className="m3-card row" style={{ display: 'flex', gap: 12, padding: 14, marginBottom: 10, alignItems: 'center' }}>
              <UserAvatar user={f.data.author} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  <b style={{ color: 'var(--md-sys-color-on-surface)' }}>{displayName(f.data.author)}</b> {f.kind === 'work' ? t('home.postedWork') : t('home.postedPost')}
                </div>
                <div style={{ fontWeight: 700, marginTop: 2, fontSize: 15 }}>{f.data.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{formatTime(f.data.created_at)} - {f.kind === 'work' ? t('home.viewsCount', { n: f.data.views }) : t('home.commentsCount', { n: f.data.comment_count })}</div>
              </div>
            </Link>
          ))}
          {feedHasMore && (
            <div style={{ textAlign: 'center', marginTop: 4 }}>
              <FilledButton onClick={loadMoreFeed} disabled={feedLoading}>
                {feedLoading ? t('common.loading') : t('common.loadMore')}
              </FilledButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
