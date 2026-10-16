import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { OutlinedTextField, FilledButton, CircularProgress, Tabs, PrimaryTab, FilterChip } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { formatTime, parseTs } from '../utils';
import { useI18n } from '../i18n';

const CATEGORIES = ['全部', '游戏', '美术', '音乐', '综合'];
// 分类值同时用于接口查询，所以这里只把「显示文案」映射到词条
const CAT_KEYS = {
  '全部': 'common.all',
  '游戏': 'studio.catGame',
  '美术': 'studio.catArt',
  '音乐': 'studio.catMusic',
  '综合': 'studio.catGeneral',
};
const SORTS = [['new', 'studio.sortNew'], ['hot', 'studio.sortHot'], ['members', 'studio.sortMembers']];
const PAGE_SIZE = 12;

// 卡片右上角的身份/成就角标
function studioBadge(s, t) {
  if (s.my_role === 'owner') return { icon: 'workspace_premium', text: t('studio.owner'), primary: true };
  if (s.my_role === 'admin') return { icon: 'shield', text: t('common.admin'), primary: true };
  if (s.my_status === 'pending') return { icon: 'hourglass_top', text: t('studio.pendingReview'), primary: true };
  if (s.my_role) return { icon: 'check_circle', text: t('studio.joined'), primary: true };
  if (s.is_full) return { icon: 'group', text: t('studio.full') };
  const ageDays = Math.floor((Date.now() - parseTs(s.created_at)) / 86400000);
  if (s.member_count >= 100) return { icon: 'workspace_premium', text: t('studio.badgeHundred') };
  if (ageDays >= 365) return { icon: 'cake', text: t('studio.badgeAnniversary') };
  if (ageDays >= 30) return { icon: 'calendar_today', text: t('studio.badgeMonth') };
  return null;
}

function StudioCard({ s }) {
  const { t } = useI18n();
  const b = studioBadge(s, t);
  return (
    <Link to={`/studios/${s.id}`} className="m3-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      {s.cover_url && (
        <img
          src={s.cover_url}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: 92, objectFit: 'cover', display: 'block' }}
        />
      )}
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'nowrap' }}>
          {s.avatar_url ? (
            <img
              src={s.avatar_url}
              alt=""
              style={{ width: 44, height: 44, borderRadius: 'var(--avatar-radius)', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <span
              style={{
                width: 44, height: 44, borderRadius: 'var(--avatar-radius)', flexShrink: 0,
                background: 'var(--md-sys-color-primary-container)',
                color: 'var(--md-sys-color-on-primary-container)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 20,
              }}
            >
              {s.name.charAt(0)}
            </span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <span className="m3-badge">{s.category}</span>
              {s.join_mode === 'approval' && <span className="m3-badge">{t('studio.needApproval')}</span>}
              {b && (
                <span className={`m3-badge${b.primary ? ' m3-badge--primary' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MsIcon name={b.icon} size={13} />
                  {b.text}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.6, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {s.description || t('studio.noDescription')}
        </div>

        <div className="row" style={{ gap: 12, marginTop: 'auto', paddingTop: 10, fontSize: 12, color: 'var(--md-sys-color-on-surface-variant)' }}>
          <span className="row" style={{ gap: 3, alignItems: 'center' }} title={t('studio.members')}>
            <MsIcon name="group" size={14} /> {s.member_count}/{s.member_limit}
          </span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }} title={t('studio.wallWorks')}>
            <MsIcon name="palette" size={14} /> {s.work_count}
          </span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }} title={t('studio.totalViews')}>
            <MsIcon name="visibility" size={14} /> {s.total_views}
          </span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }} title={t('common.follow')}>
            <MsIcon name="star" size={14} /> {s.follow_count}
          </span>
          <span style={{ marginLeft: 'auto' }}>{formatTime(s.created_at)}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Studios() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();

  const [tab, setTab] = useState('all');   // all / mine / followed
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');  // 已提交的搜索词
  const [category, setCategory] = useState('全部');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(0);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    try {
      if (tab === 'followed') {
        const r = await client.get('/studios/followed');
        if (seq !== reqRef.current) return;
        setItems(r.data || []);
        setTotal((r.data || []).length);
      } else {
        const r = await client.get('/studios', {
          params: {
            q: query || undefined,
            category: category === '全部' ? undefined : category,
            sort,
            mine: tab === 'mine' ? 1 : undefined,
            skip: page * PAGE_SIZE,
            limit: PAGE_SIZE,
            with_total: 1,
          },
        });
        if (seq !== reqRef.current) return;
        setItems(r.data?.items || []);
        setTotal(r.data?.total || 0);
      }
    } catch {
      if (seq === reqRef.current) { setItems([]); setTotal(0); }
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [tab, query, category, sort, page]);

  useEffect(() => { load(); }, [load]);

  // 搜索 / 切分类 / 换排序 / 换 tab 都回到第 1 页
  useEffect(() => { setPage(0); }, [query, category, sort, tab]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pager = useMemo(() => {
    if (tab === 'followed' || pages <= 1) return null;
    return (
      <div className="pager">
        <button type="button" className="pager-btn" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          {t('studio.prevPage')}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>{t('studio.pager', { page: page + 1, pages, total })}</span>
        <button type="button" className="pager-btn" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
          {t('studio.nextPage')}
        </button>
      </div>
    );
  }, [tab, page, pages, total, t]);

  const onSearch = (e) => {
    e.preventDefault();
    setQuery(q.trim());
  };

  const emptyText = tab === 'mine'
    ? [t('studio.emptyMineTitle'), t('studio.emptyMineDesc')]
    : tab === 'followed'
      ? [t('studio.emptyFollowedTitle'), t('studio.emptyFollowedDesc')]
      : [t('studio.emptyTitle'), t('studio.emptyDesc')];

  return (
    <div className="page-pad">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}>
            <MsIcon name="groups" size={22} /> {t('nav.studios')}
          </h1>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            {t('studio.subtitle')}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <form onSubmit={onSearch} className="row" style={{ gap: 8 }}>
            <OutlinedTextField label={t('studio.searchPlaceholder')} value={q} onInput={(e) => setQ(e.target.value)} style={{ width: 190 }} />
            <FilledButton type="submit"><span slot="icon"><Search size={18} /></span>{t('common.search')}</FilledButton>
          </form>
          {user && (
            <FilledButton onClick={() => navigate('/studios/new')}>
              <span slot="icon"><Plus size={18} /></span>{t('studio.create')}
            </FilledButton>
          )}
        </div>
      </div>

      {user && (
        <Tabs>
          <PrimaryTab selected={tab === 'all'} onClick={() => setTab('all')}>{t('studio.tabAll')}</PrimaryTab>
          <PrimaryTab selected={tab === 'mine'} onClick={() => setTab('mine')}>{t('studio.tabMine')}</PrimaryTab>
          <PrimaryTab selected={tab === 'followed'} onClick={() => setTab('followed')}>{t('studio.tabFollowed')}</PrimaryTab>
        </Tabs>
      )}

      {tab !== 'followed' && (
        <>
          <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {CATEGORIES.map((c) => (
              <FilterChip key={c} label={t(CAT_KEYS[c])} selected={category === c} onClick={() => setCategory(c)} />
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>{t('studio.sort')}</span>
            {SORTS.map(([k, label]) => (
              <FilterChip key={k} label={t(label)} selected={sort === k} onClick={() => setSort(k)} />
            ))}
            {query && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                {t('studio.searchResult', { q: query })}
              </span>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
        ) : items.length === 0 ? (
          <EmptyState loading={loading} msIcon="groups" title={emptyText[0]} subtitle={emptyText[1]} />
        ) : (
          <>
            <div className="grid-studios">
              {items.map((s) => <StudioCard key={s.id} s={s} />)}
            </div>
            {pager}
          </>
        )}
      </div>
    </div>
  );
}
