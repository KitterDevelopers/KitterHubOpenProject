/**
 * 管理员后台 - 共用层（列表页骨架的唯一来源）
 *
 * 这里集中四件容易写错的事：
 *   1. 分页：useList 按后端契约自动选择"服务端 limit+skip"或"全量返回 + 本地切片"，
 *      多取一条判断是否还有下一页（后端没有 total 字段），并保留 X-Total-Count
 *   2. 渲染安全：后端不少字段是对象/数组（分类、作者、驳回原因），直接当 React 子节点
 *      渲染会抛 React #31 整页崩；统一走 s() 收敛
 *   3. 错误提示：所有动作统一走 useList().run() / useAwait()，把后端 detail 原文显示出来，不吞异常
 *   4. 交互骨架：FilterBar（筛选区）/ ListCard（计数 + 行列表 + 分页）/ RowActions（行内按钮组）
 *      / Modal（编辑确认）/ ConfirmProvider（二次确认）—— 面板不允许再各写一套
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import {
  Checkbox, CircularProgress, Dialog, FilledButton, OutlinedButton, OutlinedSelect,
  OutlinedTextField, SelectOption, TextButton,
} from '../../ui';
import EmptyState from '../../components/EmptyState';
import UserAvatar from '../../components/Avatar';
import { msgOf, toList } from './client';

export const PAGE_SIZE = 50;

/* ---------------------------------------------------------------- 工具 */
export const detail = (e) => msgOf(e);

/** 只放行字符串/数字；对象按常见字段名取内层值 —— 防止 React #31 */
export const s = (v) => {
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (v == null) return '';
  if (Array.isArray(v)) return s(v[0]);
  if (typeof v === 'object') return s(v.name || v.title || v.label || v.nickname || v.username || v.display_name || '');
  return '';
};

export const T = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—');
export const num = (v) => (typeof v === 'number' ? v : Number(s(v)) || 0);

/** 作者显示名：列表接口的作者既可能是 author 对象，也可能把昵称铺平在行上 */
export const authorOf = (o) => s(o && o.author && (o.author.nickname || o.author.username)) || s(o && (o.nickname || o.username)) || '—';

/** 列表返回可能是裸数组，也可能是 {items}/{logs}/... 包装（收敛在 client.toList 一处） */
export const pickList = (data, keys = []) => toList(data, keys);

export const ask = (msg) => window.confirm(msg);

/* ---------------------------------------------------------------- 列表数据 */
/**
 * 列表取数。fetcher 必须是 client.js 里的函数（返回 {data,total}）。
 *   mode='server' 交给后端 limit+skip；mode='client' 全量取回本地切片。
 * 返回 rows（当前页）/ all（本轮全部）/ total / page / pages / hasMore / loading / err / msg
 * 以及 run(fn, okMsg)（写操作 + 刷新 + 统一提示）。
 */
export function useList(fetcher, { mode = 'client', keys = [], params = {}, pageSize = PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [all, setAll] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [hasMore, setHasMore] = useState(false);

  const paramsKey = JSON.stringify(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const keysKey = keys.join(',');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const query = { ...paramsRef.current };
      if (mode === 'server') {
        query.limit = pageSize + 1;                 // 多取一条 = 有下一页
        query.skip = (page - 1) * pageSize;
      }
      const r = await fetcher(query);
      const items = pickList(r.data, keys);
      setAll(items);
      setTotal(r.total);
      if (mode === 'server') {
        setRows(items.slice(0, pageSize));
        setHasMore(items.length > pageSize);
      } else {
        setRows(items.slice((page - 1) * pageSize, page * pageSize));
        setHasMore(page * pageSize < items.length);
      }
    } catch (e) {
      setErr(detail(e)); setRows([]); setAll([]); setTotal(null);
    } finally { setLoading(false); }
  }, [fetcher, mode, pageSize, page, keysKey, paramsKey]);   // eslint-disable-line

  useEffect(() => { load(); }, [load]);
  // 筛选条件变化 -> 回到第一页
  useEffect(() => { setPage(1); }, [paramsKey]);

  const pages = mode === 'server'
    ? (hasMore ? page + 1 : page)
    : Math.max(1, Math.ceil(all.length / pageSize));

  const run = async (fn, ok = '已完成') => {
    setMsg(''); setErr('');
    try { await fn(); setMsg(ok); await load(); }
    catch (e) { setErr(detail(e)); }
  };

  // 服务端分页时总数以响应头为准（比"多取一条"更准）
  const shownTotal = mode === 'server' ? (total ?? (hasMore ? page * pageSize + 1 : rows.length + (page - 1) * pageSize)) : all.length;

  return {
    rows, all, page, setPage, pages, total: shownTotal, headerTotal: total,
    hasMore, loading, err, setErr, msg, setMsg, reload: load, run,
  };
}

/* ---------------------------------------------------------------- 单次取数 */
/** 非列表的一次性取数（详情/统计）：统一 loading / err / 手动 reload。 */
export function useAwait(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await fnRef.current(); setData(r && 'data' in r ? r.data : r); }
    catch (e) { setErr(detail(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { run(); }, deps);   // eslint-disable-line
  return { data, setData, loading, err, setErr, reload: run };
}

/* ---------------------------------------------------------------- 外壳组件 */
export const Card = ({ children, style, className = '' }) => (
  <div className={`m3-card m3-card--filled ${className}`} style={{ padding: 16, ...style }}>{children}</div>
);

export const PanelHead = ({ icon, title, count, children }) => (
  <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
    <div className="row" style={{ gap: 7, alignItems: 'center', color: 'var(--md-sys-color-primary)', fontSize: 15 }}>
      {icon}<b style={{ color: 'var(--md-sys-color-on-surface)' }}>{title}</b>
      {count != null && <Badge tone={count > 0 ? 'error' : 'plain'}>{count}</Badge>}
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{children}</div>
  </div>
);

export const Badge = ({ tone = 'plain', children }) => (
  <span className={`m3-badge${tone === 'primary' ? ' m3-badge--primary' : ''}${tone === 'error' ? ' m3-badge--error' : ''}`}>{children}</span>
);

export const Note = ({ tone = 'info', children }) => (
  <div className={tone === 'error' ? 'm3-badge m3-badge--error' : tone === 'ok' ? 'm3-badge m3-badge--primary' : 'muted'}
       style={tone === 'info' ? { fontSize: 12.5, lineHeight: 1.9 } : { display: 'block', padding: '10px 12px', borderRadius: 'var(--radius)' }}>
    {children}
  </div>
);

export const Loading = () => (
  <div className="row" style={{ justifyContent: 'center', padding: 36 }}><CircularProgress indeterminate /></div>
);

export const Empty = ({ icon = 'inbox', title = '暂无数据' }) => (
  <EmptyState msIcon={icon} title={title} />
);

export const SearchInput = ({ label = '搜索', value, onChange, onSubmit }) => (
  <OutlinedTextField
    label={label} value={value}
    onInput={(e) => onChange(e.target.value)}
    onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit(); }}
  />
);

export const SelectField = ({ label, value, onChange, options }) => (
  <OutlinedSelect label={label} value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, l]) => <SelectOption key={v} value={v} headline={l} />)}
  </OutlinedSelect>
);

export const Pager = ({ page, setPage, pages, total, hasMore, mode }) => {
  const last = mode === 'server' ? (hasMore ? page + 1 : page) : pages;
  return (
    <div className="row" style={{ gap: 8, justifyContent: 'center', alignItems: 'center', paddingTop: 12, flexWrap: 'wrap' }}>
      <OutlinedButton onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
        <span slot="icon"><ChevronLeft size={16} /></span>上一页
      </OutlinedButton>
      <span className="muted" style={{ fontSize: 13 }}>
        {total != null ? `共 ${total} 条 - 第 ${page} / ${pages} 页` : `第 ${page} 页`}
      </span>
      <OutlinedButton onClick={() => setPage(page + 1)} disabled={mode === 'server' ? !hasMore : page >= last}>
        下一页<span slot="icon"><ChevronRight size={16} /></span>
      </OutlinedButton>
    </div>
  );
};

/** 筛选区（所有列表页统一的第一块）。 */
export const Toolbar = ({ children, footer }) => (
  <Card>
    <div className="adm-filter">{children}</div>
    {footer && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{footer}</div>}
  </Card>
);

export const RefreshButton = ({ onClick, busy }) => (
  <OutlinedButton onClick={onClick} disabled={busy}>
    <span slot="icon"><RefreshCw size={16} /></span>刷新
  </OutlinedButton>
);

/** 行内按钮组：统一间距与换行（避免每个面板各写一个 flex row）。 */
export const RowActions = ({ children }) => (
  <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>
);

export const InlineBusy = ({ label = '处理中' }) => (
  <span className="muted row" style={{ gap: 6, alignItems: 'center', fontSize: 12.5 }}>
    <Loader2 size={14} className="adm-spin" />{label}
  </span>
);

/* ---------------------------------------------------------------- 行 */
export const Row = ({ leading, title, meta, body, actions }) => (
  <div className="adm-row">
    {leading}
    <div className="adm-row-main">
      <div className="adm-row-title">{title}</div>
      {meta && <div className="muted adm-row-meta">{meta}</div>}
      {body}
    </div>
    {actions && <div className="adm-row-actions">{actions}</div>}
  </div>
);

/**
 * 后台头像：直接复用站内通用 UserAvatar（components/Avatar.jsx）。
 * 兼容两种用法：传 user 对象，或传 name/src（工作室等只有名字+图片的场景）。
 */
export const Avatar = ({ user, name, src, size = 32 }) => (
  <UserAvatar
    user={user || { display_name: name || '', avatar_url: src || '' }}
    size={size}
    showVerify={false}
  />
);

export const SelectAllRow = ({ checked, onChange, label = '全选本页' }) => (
  <label className="adm-row adm-row--head">
    <Checkbox checked={checked} onChange={onChange} />
    <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
  </label>
);

export const BatchBar = ({ count, actions, onClear }) => (
  <div className="m3-card m3-card--filled adm-batchbar">
    <b>已选 {count} 项</b>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {actions}
      <TextButton onClick={onClear}>取消选择</TextButton>
    </div>
  </div>
);

/* ---------------------------------------------------------------- 弹窗 */
/**
 * 弹窗（编辑 / 确认的统一入口）。
 * ⚠️ md-dialog 只渲染具名插槽（headline / content / actions），
 * 直接塞进去的子节点会被丢掉 —— 之前发放、封禁弹窗里"没有输入框"就是这个原因。
 * 所以正文必须包一层 slot="content"。
 */
export const Modal = ({ open, title, onClose, onSubmit, submitLabel = '保存', busy, disabled, children, width = 380 }) => (
  <Dialog open={open} onClosed={onClose}>
    <div slot="headline">{title}</div>
    <div slot="content" className="stack" style={{ gap: 12, minWidth: width, maxWidth: '86vw', marginTop: 8 }}>
      {children}
    </div>
    <div slot="actions">
      <TextButton onClick={onClose}>取消</TextButton>
      {onSubmit && <FilledButton onClick={onSubmit} disabled={busy || disabled}>{busy ? '处理中…' : submitLabel}</FilledButton>}
    </div>
  </Dialog>
);

/* ---------------------------------------------------------------- 二次确认 */
const ConfirmContext = createContext(null);

/**
 * 统一的二次确认：与 window.confirm 同样的调用形态（await confirm(text) -> bool），
 * 但用站内 MD3 弹窗渲染，风格统一、可被自动化测试覆盖。
 * 用法：包在 <AdminApp> 外层一次，面板里 `const confirm = useConfirm()`。
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((text, opts = {}) => new Promise((resolve) => {
    resolver.current = resolve;
    setState({ text, title: opts.title || '请确认', danger: opts.danger !== false, okLabel: opts.okLabel || '确定' });
  }), []);

  const close = (val) => {
    setState(null);
    if (resolver.current) { resolver.current(val); resolver.current = null; }
  };

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={!!state} onClosed={() => close(false)}>
        <div slot="headline">{state?.title}</div>
        <div slot="content" style={{ minWidth: 300, maxWidth: '86vw', marginTop: 8, lineHeight: 1.7 }}>{state?.text}</div>
        <div slot="actions">
          <TextButton onClick={() => close(false)}>取消</TextButton>
          <FilledButton onClick={() => close(true)}>{state?.okLabel}</FilledButton>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  // 没有 Provider 时退回原生 confirm，保证单独渲染面板也不会崩
  return ctx ? ctx.confirm : async (text) => window.confirm(text);
}
