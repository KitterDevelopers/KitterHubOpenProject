import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X, Flame, Hash, FileText } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import { OutlinedTextField, FilledButton, Tabs, PrimaryTab, CircularProgress, OutlinedSelect, SelectOption, TextButton } from '../ui';
import client from '../api/client';
import { useI18n } from '../i18n';
import WorkCard from '../components/WorkCard';
import UserAvatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { displayName, plainPreview } from '../utils';

// value 是分类原文（用于后端查询参数），key 是对应词条。
const CATEGORIES = [
  { value: '全部', key: 'search.catAll' },
  { value: '游戏', key: 'search.catGame' },
  { value: '动画', key: 'search.catAnimation' },
  { value: '故事', key: 'search.catStory' },
  { value: '音乐', key: 'search.catMusic' },
  { value: '绘画', key: 'search.catArt' },
  { value: '数学', key: 'search.catMath' },
  { value: '科学', key: 'search.catScience' },
  { value: '其他', key: 'search.catOther' },
];
const DAY_OPTIONS = [
  { value: '', key: 'search.anyTime' },
  { value: '7', key: 'search.last7' },
  { value: '30', key: 'search.last30' },
  { value: '90', key: 'search.last90' },
];
const SORT_OPTIONS = [
  { value: 'new', key: 'search.sortNew' },
  { value: 'hot', key: 'search.sortHot' },
];

/* 结果行组件：专用页签与「综合」共用同一套渲染，避免两处长得不一样 */
function SectionHead({ title, count, onMore }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
      <span style={{ fontWeight: 800, fontSize: 15 }}>{title}</span>
      <span className="m3-badge">{count}</span>
      <TextButton onClick={onMore} style={{ marginLeft: 'auto', fontSize: 13 }}>{t('search.viewAll')}</TextButton>
    </div>
  );
}

function UserRow({ u }) {
  const { t } = useI18n();
  return (
    <Link to={`/users/${u.uid}`} className="m3-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10 }}>
      <UserAvatar user={u} size={40} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{displayName(u)}</div>
        <div className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{u.bio || t('search.noBio')}</div>
      </div>
    </Link>
  );
}

function PostRow({ p }) {
  return (
    <Link to={`/posts/${p.id}`} className="m3-card" style={{ display: 'block', padding: 16, marginBottom: 10 }}>
      <span className="m3-badge m3-badge--primary">{p.category}</span>
      <div style={{ fontWeight: 700, marginTop: 6, overflowWrap: 'anywhere' }}>{p.title}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4, overflowWrap: 'anywhere' }}>{plainPreview(p.content, 100)}</div>
    </Link>
  );
}

function StudioRow({ s }) {
  const { t } = useI18n();
  return (
    <Link to={`/studios/${s.id}`} className="m3-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10 }}>
      <MsIcon name="home" size={28} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700 }}>{s.name}</span>
          {s.category && <span className="m3-badge">{s.category}</span>}
        </div>
        <div className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="group" size={13} />{t('search.members', { n: s.member_count })}</span> - {s.description || ''}
        </div>
      </div>
    </Link>
  );
}
export default function Search() {
  const [hi, setHi] = useState(-1);  // 建议列表的键盘选中项（↑/↓）
  // 查询词同步到地址栏：可分享、可刷新、前进后退能还原（带 ?q= 进来默认落在「综合」）
  const initialQ = (() => {
    try { return new URLSearchParams(window.location.search).get('q') || ''; } catch (e) { return ''; }
  })();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [input, setInput] = useState(q);
  const [tab, setTab] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('全部');
  const [days, setDays] = useState('');
  const [sort, setSort] = useState('new');
  const [history, setHistory] = useState([]);
  const [hot, setHot] = useState([]);
  const [suggests, setSuggests] = useState([]);
  const [pickcat, setPickcat] = useState([]);   // 来自 PickCat 的搜索结果
  const suggestTimer = useRef(null);

  const HISTORY_KEY = 'nimao_search_history';
  const loadHistory = () => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
    } catch { setHistory([]); }
  };
  const saveHistory = (kw) => {
    const next = [kw, ...history.filter((h) => h !== kw)].slice(0, 10);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  };
  const removeHistory = (kw) => {
    const next = history.filter((h) => h !== kw);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  };

  useEffect(() => {
    loadHistory();
    client.get('/search/hot').then((r) => setHot(r.data || [])).catch(() => {});
  }, []);

  // 输入联想（防抖）
  const onInput = (val) => {
    setInput(val);
    clearTimeout(suggestTimer.current);
    const v = val.trim();
    if (!v) { setSuggests([]); return; }
    suggestTimer.current = setTimeout(() => {
      client.get('/search/suggest', { params: { q: v } }).then((r) => setSuggests(r.data || [])).catch(() => setSuggests([]));
    }, 200);
  };

  const run = (query, cat = category, d = days, s = sort) => {
    const kw = (query ?? '').trim();
    if (!kw) return;
    saveHistory(kw);
    setSuggests([]);
    setParams({ q: kw });
    setLoading(true);
    client.get('/search', {
      params: { q: kw, category: cat === '全部' ? undefined : cat, days: d || undefined, sort: s },
    }).then((r) => setResult(r.data)).catch(() => {}).finally(() => setLoading(false));
    /* 同时查 PickCat（后端失败安全，取不到就是空数组，不影响本站结果） */
    client.get('/search/pickcat', { params: { q: kw } })
      .then((r) => setPickcat((r.data && r.data.items) || []))
      .catch(() => setPickcat([]));
  };

  useEffect(() => {
    if (q) run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (q) run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, days, sort]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
      window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    } catch (e) { /* 忽略：地址栏同步失败不影响搜索 */ }
  }, [q]);

  // 首次进入若地址栏带 q，自动搜一次并停在「综合」（tab 默认就是 0）
  useEffect(() => {
    if (initialQ) { setInput(initialQ); run(initialQ); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e) => { e.preventDefault(); run(input); };

  const counts = result
    ? [result.works?.length || 0, result.posts?.length || 0, result.users?.length || 0, result.studios?.length || 0]
    : [0, 0, 0, 0];
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="page-pad">
      <form onSubmit={onSubmit} className="row" style={{ gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <OutlinedTextField
            label={t('search.label')}
            placeholder={t('search.placeholder')}
            value={input}
            onInput={(e) => { onInput(e.target.value); setHi(-1); }}
            onKeyDown={(e) => {
              if (!suggests.length) return;
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((v) => (v + 1) % suggests.length); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((v) => (v <= 0 ? suggests.length - 1 : v - 1)); }
              else if (e.key === 'Escape') { setHi(-1); }
              else if (e.key === 'Enter' && hi >= 0) {
                // 选中了某条建议就直接用它，别让表单再提交一遍
                e.preventDefault();
                const pick = suggests[hi];
                setInput(pick.label); run(pick.label); setHi(-1);
              }
            }}
            style={{ width: '100%' }}
          />
          {suggests.length > 0 && (
            <div className="m3-card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', marginTop: 4, padding: 6, maxHeight: 260, overflowY: 'auto' }}>
              {suggests.map((s, i) => (
                <div
                  key={i}
                  onClick={() => { setInput(s.label); run(s.label); setHi(-1); }}
                  onMouseEnter={() => setHi(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                    borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13,
                    background: hi === i ? 'var(--md-sys-color-surface-container-high)' : 'transparent',
                  }}
                >
                  {s.type === 'hot' ? <Flame size={14} style={{ color: '#f59f00' }} /> : s.type === 'tag' ? <Hash size={14} style={{ color: 'var(--md-sys-color-primary)' }} /> : <FileText size={14} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />}
                  {s.type === 'hot' && <span className="muted" style={{ fontSize: 11 }}>{t('search.suggestHot')}</span>}
                  {s.type === 'tag' && <span className="muted" style={{ fontSize: 11 }}>{t('search.suggestTag')}</span>}
                  {s.type === 'work' && <span className="muted" style={{ fontSize: 11 }}>{t('search.suggestWork')}</span>}
                  <span style={{ fontWeight: 600 }}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <FilledButton type="submit"><span slot="icon"><SearchIcon size={18} /></span>{t('common.search')}</FilledButton>
      </form>

      {/* 筛选器常驻：原来只有搜过一次才出现，想先按分类看的人根本找不到入口。
          另外这三个筛选只作用于「作品」，所以明确写出来，避免以为能筛用户/帖子。 */}
      <div className="row" style={{ gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t('search.workFilters')}</span>
        <OutlinedSelect label={t('search.category')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 140 }}>
          {CATEGORIES.map((c) => <SelectOption key={c.value} value={c.value} headline={t(c.key)} />)}
        </OutlinedSelect>
        <OutlinedSelect label={t('search.time')} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 140 }}>
          {DAY_OPTIONS.map((d) => <SelectOption key={d.value} value={d.value} headline={t(d.key)} />)}
        </OutlinedSelect>
        <OutlinedSelect label={t('search.sort')} value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 110 }}>
          {SORT_OPTIONS.map((s) => <SelectOption key={s.value} value={s.value} headline={t(s.key)} />)}
        </OutlinedSelect>
        {(category !== CATEGORIES[0].value || days !== DAY_OPTIONS[0].value || sort !== SORT_OPTIONS[0].value) && (
          <TextButton
            onClick={() => { setCategory(CATEGORIES[0].value); setDays(DAY_OPTIONS[0].value); setSort(SORT_OPTIONS[0].value); }}
            style={{ fontSize: 13 }}
          >
            {t('search.clearFilters')}
          </TextButton>
        )}
      </div>

      {q && (
        <Tabs>
          <PrimaryTab selected={tab === 0} onClick={() => setTab(0)}>{t('search.tabAll')} {total}</PrimaryTab>
          <PrimaryTab selected={tab === 1} onClick={() => setTab(1)}>{t('search.tabWorks')} {counts[0]}</PrimaryTab>
          <PrimaryTab selected={tab === 2} onClick={() => setTab(2)}>{t('search.tabPosts')} {counts[1]}</PrimaryTab>
          <PrimaryTab selected={tab === 3} onClick={() => setTab(3)}>{t('search.tabUsers')} {counts[2]}</PrimaryTab>
          <PrimaryTab selected={tab === 4} onClick={() => setTab(4)}>{t('search.tabStudios')} {counts[3]}</PrimaryTab>
        </Tabs>
      )}

      {/* 来自 PickCat 的搜索结果：后端失败安全（取不到就是空数组），只在「综合」页签展示 */}
      {q && tab === 0 && pickcat.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionHead
            title={t('search.fromPickcat')}
            count={pickcat.length}
            onMore={() => window.open('https://pickcat.dao3.fun/search?q=' + encodeURIComponent(q), '_blank', 'noopener')}
          />
          {pickcat.map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="m3-card"
              style={{ display: 'block', padding: 14, marginBottom: 10 }}
            >
              <div style={{ fontWeight: 700 }}>{p.title}</div>
              {p.excerpt ? <div className="muted" style={{ fontSize: 13 }}>{p.excerpt}</div> : null}
            </a>
          ))}
        </section>
      )}

      {(history.length > 0 || hot.length > 0) && (
        <details className="m3-card m3-card--filled" open={!result} style={{ padding: 16, marginBottom: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, marginBottom: 8, listStyle: 'none' }}>
            {t('search.historyAndHot')}
          </summary>
          {history.length > 0 && (
            <>
              <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{t('search.history')}</span>
                <TextButton onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }} style={{ marginLeft: 'auto', fontSize: 12 }}>{t('search.clear')}</TextButton>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {history.map((h) => (
                  <span key={h} className="row" style={{ gap: 2 }}>
                    <span onClick={() => { setInput(h); run(h); }} style={{ cursor: 'pointer', padding: '4px 4px 4px 12px', borderRadius: 'var(--radius)', fontSize: 12, background: 'var(--md-sys-color-surface-container-high)', maxWidth: 'calc(100vw - 90px)', overflowWrap: 'anywhere' }}>{(h || '').length > 20 ? `${h.slice(0, 20)}…` : h}</span>
                    <button onClick={() => removeHistory(h)} aria-label={t('search.removeHistory', { q: h })} style={{ border: 'none', background: 'var(--md-sys-color-surface-container-high)', color: 'var(--md-sys-color-on-surface-variant)', cursor: 'pointer', borderRadius: '0 var(--radius) var(--radius) 0', padding: '4px 8px 4px 2px', display: 'inline-flex', alignItems: 'center' }}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
          {hot.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><MsIcon name="local_fire_department" size={15} />{t('search.everyoneSearching')}</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {hot.map((h, i) => (
                  <span key={h.keyword} onClick={() => { setInput(h.keyword); run(h.keyword); }} style={{ cursor: 'pointer', padding: '4px 12px', borderRadius: 'var(--radius)', fontSize: 12, background: i < 3 ? 'var(--md-sys-color-secondary-container)' : 'var(--md-sys-color-surface-container-high)', color: i < 3 ? 'var(--md-sys-color-on-secondary-container)' : 'var(--md-sys-color-on-surface)', fontWeight: i < 3 ? 700 : 400, maxWidth: 'calc(100vw - 80px)', overflowWrap: 'anywhere' }}>
                    {`${i + 1}.`} {(h.keyword || '').length > 26 ? `${h.keyword.slice(0, 26)}…` : h.keyword}
                  </span>
                ))}
              </div>
            </>
          )}
        </details>
      )}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
        ) : !result ? (
          <EmptyState msIcon="search" title={t('search.startTitle')} subtitle={t('search.startDesc')} />
        ) : (
          <>
            {tab === 0 && (
              total === 0 ? (
                <EmptyState msIcon="search" title={t('search.noAny')} subtitle={t('search.noAnyDesc')} />
              ) : (
                <>
                  {result.users?.length > 0 && (
                    <section style={{ marginBottom: 18 }}>
                      <SectionHead title={t('search.tabUsers')} count={result.users.length} onMore={() => setTab(3)} />
                      {result.users.slice(0, 4).map((u) => <UserRow key={u.uid} u={u} />)}
                    </section>
                  )}
                  {result.works?.length > 0 && (
                    <section style={{ marginBottom: 18 }}>
                      <SectionHead title={t('search.tabWorks')} count={result.works.length} onMore={() => setTab(1)} />
                      <div className="grid-works">{result.works.slice(0, 6).map((w) => <WorkCard key={w.id} work={w} />)}</div>
                    </section>
                  )}
                  {result.posts?.length > 0 && (
                    <section style={{ marginBottom: 18 }}>
                      <SectionHead title={t('search.tabPosts')} count={result.posts.length} onMore={() => setTab(2)} />
                      {result.posts.slice(0, 4).map((p) => <PostRow key={p.id} p={p} />)}
                    </section>
                  )}
                  {result.studios?.length > 0 && (
                    <section style={{ marginBottom: 18 }}>
                      <SectionHead title={t('search.tabStudios')} count={result.studios.length} onMore={() => setTab(4)} />
                      {result.studios.slice(0, 4).map((st) => <StudioRow key={st.id} s={st} />)}
                    </section>
                  )}
                </>
              )
            )}            {tab === 1 && (result.works.length === 0 ? <EmptyState msIcon="search" title={t('search.noWorks')} /> : <div className="grid-works">{result.works.map((w) => <WorkCard key={w.id} work={w} />)}</div>)}
            {tab === 2 && (result.posts.length === 0 ? <EmptyState msIcon="search" title={t('search.noPosts')} /> : result.posts.map((p) => (
              <Link to={`/posts/${p.id}`} key={p.id} className="m3-card" style={{ display: 'block', padding: 16, marginBottom: 10 }}>
                <span className="m3-badge m3-badge--primary">{p.category}</span>
                <div style={{ fontWeight: 700, marginTop: 6 }}>{p.title}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{plainPreview(p.content, 100)}</div>
              </Link>
            )))}
            {tab === 3 && (result.users.length === 0 ? <EmptyState msIcon="search" title={t('search.noUsers')} /> : result.users.map((u) => (
              <Link to={`/users/${u.uid}`} key={u.uid} className="m3-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10 }}>
                <UserAvatar user={u} size={40} />
                <div>
                  <div style={{ fontWeight: 700 }}>{displayName(u)}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{u.bio || t('search.noBio')}</div>
                </div>
              </Link>
            )))}
            {tab === 4 && (result.studios.length === 0 ? <EmptyState msIcon="search" title={t('search.noStudios')} /> : result.studios.map((s) => (
              <Link to={`/studios/${s.id}`} key={s.id} className="m3-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10 }}>
                <MsIcon name="home" size={28} />
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{s.name}</span>
                    {s.category && <span className="m3-badge">{s.category}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="group" size={13} />{t('search.members', { n: s.member_count })}</span> - {s.description || ''}</div>
                </div>
              </Link>
            )))}
          </>
        )}
      </div>
    </div>
  );
}
