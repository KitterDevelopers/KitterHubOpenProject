/**
 * 发现页（改版）：把原来「五行控件」压成两行，内容上移；再加三件实用的。
 *
 * 改版前：搜索框（带 label 的大输入框 + 独立按钮）→ 分类 chips → 编辑器 chips（带 Logo 标签）
 * → 排序 chips → 热门标签 → 才轮到作品网格。控件比内容还抢眼，网格被压到折叠线以下。
 *
 * 现在：
 *   一行头：标题 + 紧凑搜索框（按 / 聚焦）+ 随机看看
 *   一行吸顶筛选：分类（横向滚动）| 排序分段控件 | 筛选（带已选数量角标）
 *   展开区（默认收起）：编辑器 + 热门标签
 *   本周黑马（用现成的 /discover/works/hot_week，此前前端没人用）
 *   作品网格 + 分页 + 空状态（可一键清筛选）
 *   今日热议（/discover/posts/hot_today，论坛在用，发现页也放一个）
 *   回到顶部
 *
 * 另外把筛选**写回 URL**（以前只读不写）：可分享、可后退、刷新不丢。
 * 卡片悬停可收藏/稍后再看（quickActions）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Shuffle, ArrowUp, ChevronDown } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import CodemaoLogo from '../components/CodemaoLogo';
import { OutlinedTextField, FilledButton, FilterChip, CircularProgress, IconButton, TextButton } from '../ui';
import client from '../api/client';
import { useI18n } from '../i18n';
import WorkCard from '../components/WorkCard';
import WorkSortMenu from '../components/WorkSortMenu';
import EmptyState from '../components/EmptyState';
import { EDITOR_LABELS, CODEMAO_EDITOR_CODES, displayName, formatTime } from '../utils';

// 「编辑器」筛选可用的取值：编程猫合集 + 各编辑器 + Scratch（Scratch 作品在库里是 work_type='scratch'，
// 后端按 work_type 过滤，见 routers/discover.py 里的注释）。
const EDITOR_VALUES = ['codemao', 'scratch', ...CODEMAO_EDITOR_CODES];
// 「来源」筛选：原创（非转载）/ 转载
const ORIGIN_VALUES = ['original', 'repost'];

// value 是分类原文（用于链接与后端查询参数），key 是对应词条。
const CATEGORIES = [
  { value: '全部', key: 'discover.catAll' },
  { value: '游戏', key: 'discover.catGame' },
  { value: '动画', key: 'discover.catAnimation' },
  { value: '故事', key: 'discover.catStory' },
  { value: '音乐', key: 'discover.catMusic' },
  { value: '绘画', key: 'discover.catArt' },
  { value: '数学', key: 'discover.catMath' },
  { value: '科学', key: 'discover.catScience' },
  { value: '其他', key: 'discover.catOther' },
];
const PAGE_SIZE = 24;  // 每页作品数（站长 2026-09-27：一页 24 件；要改只改这一个数字）

// 页码序列（超过 7 页时中间用省略号）
function pageList(current, totalPages) {
  const out = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) out.push(i);
    return out;
  }
  let start = Math.max(2, current - 1);
  let end = Math.min(totalPages - 1, current + 1);
  if (current <= 3) {
    start = 2;
    end = 4;
  }
  if (current >= totalPages - 2) {
    start = totalPages - 3;
    end = totalPages - 1;
  }
  out.push(1);
  if (start > 2) out.push('...');
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < totalPages - 1) out.push('...');
  out.push(totalPages);
  return out;
}

export default function Discover() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlCategory = params.get('category');
  const urlSort = params.get('sort');
  const urlTag = params.get('tag');
  const urlEditor = params.get('editor');
  const urlOrigin = params.get('origin');

  const [works, setWorks] = useState([]);
  const [tags, setTags] = useState([]);
  const [hotWeek, setHotWeek] = useState([]);
  const [hotPosts, setHotPosts] = useState([]);
  const [q, setQ] = useState(params.get('q') || '');
  const [category, setCategory] = useState(CATEGORIES.some((c) => c.value === urlCategory) ? urlCategory : '全部');
  const [tag, setTag] = useState(urlTag || null);
  const [editor, setEditor] = useState(EDITOR_VALUES.includes(urlEditor) ? urlEditor : '');
  const [origin, setOrigin] = useState(ORIGIN_VALUES.includes(urlOrigin) ? urlOrigin : '');
  const [sort, setSort] = useState(urlSort === 'hot' ? 'hot' : 'new');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [total, setTotal] = useState(0);
  // 「跳至第 N 页」输入框：跟当前页联动（翻页后自动同步成新页码）
  const [jumpTo, setJumpTo] = useState(String(Math.max(1, Number(params.get('page')) || 1)));
  const [advOpen, setAdvOpen] = useState(Boolean(urlTag || urlEditor || urlOrigin));
  const [showTop, setShowTop] = useState(false);
  const [barStuck, setBarStuck] = useState(false);
  const [randBusy, setRandBusy] = useState(false);
  const gridRef = useRef(null);
  const searchRef = useRef(null);
  const lastRandomRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 展开区里已选了几项（收起时用角标提示，免得「明明开着筛选却看不见」）
  const advCount = (editor ? 1 : 0) + (tag ? 1 : 0) + (origin ? 1 : 0);

  const load = useCallback(async (targetPage = 1, keyword = q) => {
    setLoading(true);
    try {
      const res = await client.get('/discover/works', {
        params: {
          q: keyword || undefined,
          category: category === '全部' ? undefined : category,
          tag: tag || undefined,
          editor: editor || undefined,
          origin: origin || undefined,
          sort,
          skip: (targetPage - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
          with_total: 1,
        },
      });
      const data = res.data;
      if (Array.isArray(data)) {          // 兼容老格式（万一后端没返回信封）
        setWorks(data);
        setTotal(data.length);
      } else {
        setWorks(data.items || []);
        setTotal(data.total || 0);
      }
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  }, [category, tag, editor, origin, sort, q]);

  // 筛选变化 → 回到第一页重新拉
  useEffect(() => { load(1, q); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [category, tag, editor, origin, sort]);

  // 当前页变了（点页码/上一页下一页/后退）就把输入框同步成新页码
  useEffect(() => { setJumpTo(String(page)); }, [page]);

  // 筛选写回 URL：可分享、可后退、刷新不丢（改版前只读不写）
  useEffect(() => {
    const next = {};
    if (q.trim()) next.q = q.trim();
    if (category !== '全部') next.category = category;
    if (editor) next.editor = editor;
    if (origin) next.origin = origin;
    if (sort !== 'new') next.sort = sort;
    if (tag) next.tag = tag;
    if (page > 1) next.page = String(page);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, editor, origin, sort, tag, page]);

  useEffect(() => {
    client.get('/discover/tags').then((r) => setTags(r.data)).catch(() => {});
    client.get('/discover/works/hot_week', { params: { limit: 10 } }).then((r) => setHotWeek(r.data || [])).catch(() => {});
    client.get('/discover/posts/hot_today', { params: { limit: 5 } }).then((r) => setHotPosts(r.data || [])).catch(() => {});
  }, []);

  // 按 / 聚焦搜索框（键盘党）
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        // md-outlined-text-field 的 input 在 shadow DOM 里：先试 ref 的几种形态，再退回查 DOM
        const el = searchRef.current;
        const inner = el && (el.input || (el.shadowRoot && el.shadowRoot.querySelector('input')));
        const fallback = document.querySelector('.dv-search input, .dv-search textarea');
        (inner || el || fallback)?.focus?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 长列表时给「回到顶部」；顺便记一下筛选条是否已经吸顶（吸顶后空隙里才需要那层模糊）
  useEffect(() => {
    const onScroll = () => {
      setShowTop(window.scrollY > 700);
      setBarStuck(window.scrollY > 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const onSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load(1, q);
  };

  const clearAll = () => {
    setCategory('全部'); setTag(null); setEditor(''); setOrigin(''); setSort('new'); setQ('');
    setPage(1);
  };

  // 翻页后把结果区滚回视野（留出吸顶导航的高度）
  const goPage = async (target) => {
    const next = Math.min(Math.max(1, target), totalPages);
    if (next === page || loading) return;
    await load(next, q);
    const el = gridRef.current;
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  };

  // 「跳至第 N 页」：输入框里手打的页码（超出范围就夹到 1..totalPages，非数字忽略）
  const jump = () => {
    const n = Number.parseInt(String(jumpTo).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(n)) { setJumpTo(String(page)); return; }
    const target = Math.min(Math.max(1, n), totalPages);
    setJumpTo(String(target));
    goPage(target);
  };

  const randomWork = async () => {
    if (randBusy) return;
    setRandBusy(true);
    try {
      const r = await client.get('/discover/random', { params: { exclude: lastRandomRef.current || undefined } });
      lastRandomRef.current = r.data.id;
      navigate(`/works/${r.data.id}`);
    } catch {
      lastRandomRef.current = null;
    } finally {
      setRandBusy(false);
    }
  };

  const activeFilters = useMemo(() => {
    const list = [];
    if (q.trim()) list.push(t('discover.filterQ', { q: q.trim() }));
    if (category !== '全部') list.push(category);
    if (tag) list.push(`#${tag}`);
    if (editor) list.push(editor === 'codemao' ? t('discover.codemaoWorks') : (editor === 'scratch' ? t('discover.editorScratch') : (EDITOR_LABELS[editor] || editor)));
    if (origin) list.push(origin === 'original' ? t('discover.originOriginal') : t('discover.originRepost'));
    return list;
  }, [q, category, tag, editor, origin, t]);

  return (
    <div className="page-pad dv-shell">
      {/* ---- 头：标题 + 搜索 + 随机看看 ---- */}
      <div className="dv-head">
        <h1 className="dv-title">{t('nav.discover')}</h1>
        <form onSubmit={onSearch} className="dv-search" role="search">
          <OutlinedTextField
            ref={searchRef}
            label={t('discover.searchLabel')}
            placeholder={t('discover.searchPlaceholder')}
            value={q}
            onInput={(e) => setQ(e.target.value)}
            // 同上：光靠外层 form 收不到影子根里 input 的回车，得显式监听
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(e); } }}
            style={{ flex: 1 }}
          />
          <IconButton onClick={onSearch} aria-label={t('common.search')} title={t('common.search')}>
            <Search size={20} />
          </IconButton>
        </form>
        <FilledButton onClick={randomWork} disabled={randBusy} className="dv-random">
          <span slot="icon"><Shuffle size={16} /></span>
          {t('discover.random')}
        </FilledButton>
      </div>

      {/* ---- 吸顶筛选条：分类（横滚）+ 排序 + 更多筛选 ---- */}
      <div className={`dv-bar${barStuck ? ' is-stuck' : ''}`}>
        <div className="dv-cats" role="tablist" aria-label={t('discover.catLabel')}>
          {CATEGORIES.map((c) => (
            <FilterChip key={c.value} label={t(c.key)} selected={category === c.value} onClick={() => { setCategory(c.value); setTag(null); }} />
          ))}
        </div>
        <div className="dv-bar-right">
          {/* 排序：从「最新/最热」两个分段按钮换成下拉，才有地方放「喜欢/收藏/浏览」这些口径 */}
          <WorkSortMenu value={sort} onChange={setSort} anchorId="dv-sort-menu" />
          <button
            type="button"
            className={`dv-more${advOpen ? ' on' : ''}`}
            aria-expanded={advOpen}
            onClick={() => setAdvOpen((v) => !v)}
          >
            {t('discover.filterMore')}
            {advCount > 0 && <span className="dv-more-count">{advCount}</span>}
            <ChevronDown size={15} className="dv-more-arrow" />
          </button>
        </div>
      </div>

      {/* ---- 展开的更多筛选 ---- */}
      {advOpen && (
        <div className="dv-adv">
          <div className="dv-adv-row">
            <span className="dv-adv-label"><CodemaoLogo size={14} /> {t('discover.editorLabel')}</span>
            <FilterChip label={t('discover.codemaoWorks')} selected={editor === 'codemao'} onClick={() => setEditor(editor === 'codemao' ? '' : 'codemao')} />
            {CODEMAO_EDITOR_CODES.map((code) => (
              <FilterChip key={code} label={EDITOR_LABELS[code]} selected={editor === code} onClick={() => setEditor(editor === code ? '' : code)} />
            ))}
            <FilterChip
              label={t('discover.editorScratch')}
              selected={editor === 'scratch'}
              onClick={() => setEditor(editor === 'scratch' ? '' : 'scratch')}
            />
          </div>
          {/* 作品来源：站长 2026-09-27 要的「原创（非转载）」筛选项 */}
          <div className="dv-adv-row">
            <span className="dv-adv-label"><MsIcon name="verified" size={14} /> {t('discover.originLabel')}</span>
            <FilterChip label={t('discover.originOriginal')} selected={origin === 'original'} onClick={() => setOrigin(origin === 'original' ? '' : 'original')} />
            <FilterChip label={t('discover.originRepost')} selected={origin === 'repost'} onClick={() => setOrigin(origin === 'repost' ? '' : 'repost')} />
          </div>
          {tags.length > 0 && (
            <div className="dv-adv-row">
              <span className="dv-adv-label">{t('discover.hotTags')}</span>
              {tags.slice(0, 18).map((item) => (
                <FilterChip key={item.name} label={`# ${item.name}`} selected={tag === item.name} onClick={() => setTag(tag === item.name ? null : item.name)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- 已选条件（一行小字，可单个移除）---- */}
      {activeFilters.length > 0 && (
        <div className="dv-active">
          <span className="muted" style={{ fontSize: 12.5 }}>{t('discover.activeFilters')}</span>
          {activeFilters.map((label) => (
            <span key={label} className="dv-active-chip">{label}</span>
          ))}
          <TextButton onClick={clearAll} style={{ fontSize: 12.5 }}>{t('discover.clearFilters')}</TextButton>
        </div>
      )}

      {/* ---- 本周黑马（现成接口，此前前端没用）---- */}
      {hotWeek.length > 0 && (
        <section className="dv-section">
          <div className="dv-sec-head">
            <MsIcon name="trending_up" size={17} style={{ color: 'var(--md-sys-color-primary)' }} />
            <b>{t('discover.hotWeek')}</b>
            <span className="muted" style={{ fontSize: 12 }}>{t('discover.hotWeekHint')}</span>
          </div>
          <div className="dv-strip">
            {hotWeek.map((w, i) => (
              <Link key={w.id} to={`/works/${w.id}`} className="dv-strip-card m3-card">
                <span className="dv-strip-rank">{i + 1}</span>
                {w.cover_url
                  ? <img src={w.cover_url} alt="" loading="lazy" />
                  : <span className="dv-strip-ph"><MsIcon name="movie" size={20} /></span>}
                <span className="dv-strip-body">
                  <span className="dv-strip-title">{w.title}</span>
                  <span className="muted dv-strip-meta">
                    {displayName(w.author)} - {w.views} {t('discover.viewsUnit')}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---- 结果 ---- */}
      <div ref={gridRef} className="dv-results">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
        ) : works.length === 0 ? (
          <EmptyState msIcon="search" title={t('discover.emptyTitle')} subtitle={t('discover.emptyDesc')}>
            <FilledButton onClick={clearAll}>{t('discover.clearFilters')}</FilledButton>
          </EmptyState>
        ) : (
          <>
            <div className="dv-count muted">
              {t('discover.totalBefore')} <b style={{ color: 'var(--md-sys-color-primary)' }}>{total}</b> {t('discover.totalAfter')}
              {totalPages > 1 && <> - {t('discover.pageInfo', { page, totalPages })}</>}
            </div>
            <div className="grid-works">
              {works.map((w) => (
                <div key={w.id} className="dv-cell">
                  <WorkCard work={w} fillHeight={false} quickActions />
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="pager" aria-label={t('discover.pagination')}>
                <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => goPage(page - 1)}>
                  {t('discover.prevPage')}
                </button>
                {pageList(page, totalPages).map((p, i) => (
                  typeof p === 'number'
                    ? <button key={p} type="button" className={`pager-btn${p === page ? ' active' : ''}`} onClick={() => goPage(p)}>{p}</button>
                    : <span key={`gap-${i}`} className="pager-gap">…</span>
                ))}
                <button type="button" className="pager-btn" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
                  {t('discover.nextPage')}
                </button>
                {/* 手动跳页：MD3 描边输入框 + 文字按钮。
                    回车另外用 onKeyDown 显式处理 —— md-outlined-text-field 的真实 input 在**影子根**里，
                    而表单关联不跨树，外层 <form> 收不到它的提交事件（原来这里只包 form 是跳不动的）。 */}
                <form className="pager-jump" onSubmit={(e) => { e.preventDefault(); jump(); }}>
                  <OutlinedTextField
                    type="number"
                    label={t('discover.jumpLabel')}
                    value={jumpTo}
                    min={1}
                    max={totalPages}
                    onInput={(e) => setJumpTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jump(); } }}
                  />
                  <span className="muted pager-jump-unit">{t('discover.jumpUnit', { n: totalPages })}</span>
                  <TextButton onClick={jump}>{t('discover.jumpGo')}</TextButton>
                </form>
              </nav>
            )}
          </>
        )}
      </div>

      {/* ---- 今日热议（论坛在用同一个接口）---- */}
      {hotPosts.length > 0 && (
        <section className="dv-section dv-hotposts">
          <div className="dv-sec-head">
            <MsIcon name="whatshot" size={17} style={{ color: 'var(--md-sys-color-primary)' }} />
            <b>{t('discover.hotToday')}</b>
            <Link to="/forum" className="muted dv-sec-more" style={{ fontSize: 12 }}>{t('discover.goForum')}</Link>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {hotPosts.map((p) => (
              <Link key={p.id} to={`/posts/${p.id}`} className="dv-post-row">
                <span className="dv-post-title">{p.title}</span>
                <span className="muted dv-post-meta">
                  {displayName(p.author)} - {formatTime(p.created_at)} - {p.views} {t('discover.viewsUnit')}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {showTop && (
        <button type="button" className="dv-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label={t('discover.backToTop')} title={t('discover.backToTop')}>
          <ArrowUp size={18} />
        </button>
      )}
    </div>
  );
}
