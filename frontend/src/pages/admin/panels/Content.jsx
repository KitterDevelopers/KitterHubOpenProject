/**
 * 内容类面板：稿件 / 审核 / 队列 / 帖子评论 / 举报 / 敏感词与处罚 / 回收站 / 精选
 * 全部照 .forensics/ADMIN-CONTRACT.md 的字段与动作实现。
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, Check, Clock, Eye, Flag, History, MessageSquare, Palette, Pin,
  RotateCcw, Search, ShieldAlert, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import {
  Checkbox, CircularProgress, Dialog, FilledButton, OutlinedButton, OutlinedSelect,
  OutlinedTextField, SelectOption, Switch, TextButton,
} from '../../../ui';
import * as api from '../client';
import WorkPreview from './WorkPreview';
import {
  Avatar, Badge, BatchBar, Card, Empty, Loading, Modal, Note, PAGE_SIZE, PanelHead, Pager,
  RefreshButton, Row, SearchInput, SelectAllRow, SelectField, T, Toolbar, authorOf, detail, num, s, useConfirm, useList,
} from '../ui';

const STATUS_WORK = [['all', '全部'], ['pending', '待审'], ['published', '已发布'], ['rejected', '已驳回']];
const STATUS_POST = [['all', '全部'], ['published', '已发布'], ['pending', '待审'], ['rejected', '已驳回']];
const CATS_WORK = [['all', '全部'], ['游戏', '游戏'], ['动画', '动画'], ['故事', '故事'], ['音乐', '音乐'], ['绘画', '绘画'], ['数学', '数学'], ['科学', '科学'], ['其他', '其他']];
const CATS_POST = [['all', '全部'], ['讨论', '讨论'], ['教程', '教程'], ['求助', '求助'], ['展示', '展示'], ['闲聊', '闲聊']];
const SORTS = [['new', '最新'], ['hot', '最热'], ['views', '播放最多']];

const avatarOf = (o) => s(o && o.author && (o.author.avatar_url || o.author.codemao_avatar)) || '/kitter-logo.png';
const statusBadge = (st) => {
  const v = s(st);
  if (v === 'pending') return <Badge><Clock size={12} /> 待审</Badge>;
  if (v === 'published') return <Badge tone="primary"><BadgeCheck size={12} /> 已发布</Badge>;
  if (v === 'rejected') return <Badge tone="error"><X size={12} /> 已驳回</Badge>;
  return v ? <Badge>{v}</Badge> : null;
};

/* 敏感词审核：后端 target_type 取值与处罚方式（见 admin.py reject_sensitive_review） */
const SENSITIVE_TYPE = {
  work: '稿件', post: '帖子', work_comment: '作品评论', post_comment: '帖子评论',
  comment: '评论', user: '用户资料', studio: '工作室', chat: '聊天消息',
};
const SENSITIVE_PENALTY = {
  '': '仅驳回内容', warn: '警告一次', mute: '禁言', ban: '永久封禁账号', xp: '扣除经验',
};
/** sensitive_words 可能是数组，也可能是逗号分隔字符串 */
const wordsOf = (r) => {
  const v = r && r.sensitive_words;
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean);
  const t = s(v);
  return t ? t.split(/[,，]/).map((x) => x.trim()).filter(Boolean) : [];
};

/* ============================================================ 稿件 */
export function Works({ defaultStatus = 'all' }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(defaultStatus);
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('new');
  const [sel, setSel] = useState([]);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [reject, setReject] = useState(null);
  const [why, setWhy] = useState('');
  const [vers, setVers] = useState(null);
  const [verRows, setVerRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);      // 预览中的稿件（审核前先看作品本体）

  const params = { q: query || undefined, status: status === 'all' ? undefined : status, category: cat === 'all' ? undefined : cat, sort };
  const L = useList(api.listWorks, { mode: 'server', keys: ['works'], params });
  const confirm = useConfirm();       // 统一二次确认（MD3 弹窗）

  const openEdit = (w) => {
    setForm({
      title: s(w.title), description: s(w.description), category: s(w.category) || '其他',
      tags: Array.isArray(w.tags) ? w.tags.join(' ') : s(w.tags), status: s(w.status) || 'published',
      cover_url: s(w.cover_url), is_pinned: !!w.is_pinned, is_featured: !!w.is_featured,
    });
    setEdit(w);
  };

  const saveEdit = () => L.run(async () => {
    await api.editWork(edit.id, {
      title: form.title.trim(), description: form.description, category: form.category,
      tags: form.tags.trim() ? form.tags.trim().split(/\s+/) : [],
      status: form.status, cover_url: form.cover_url.trim(),
      is_pinned: !!form.is_pinned, is_featured: !!form.is_featured,
    });
    setEdit(null);
  }, '已保存');

  const loadVersions = async (w) => {
    setVers(w); setVerRows([]);
    try { const r = await api.workVersions(w.id); setVerRows(Array.isArray(r.data) ? r.data : (r.data.items || r.data.versions || [])); }
    catch (e) { setVerRows([]); }
  };

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}

      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索标题 / 作者" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }} options={STATUS_WORK} />
        <SelectField label="分类" value={cat} onChange={(v) => { setCat(v); L.setPage(1); }} options={CATS_WORK} />
        <SelectField label="排序" value={sort} onChange={setSort} options={SORTS} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}><span slot="icon"><Search size={16} /></span>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {sel.length > 0 && (
        <BatchBar
          count={sel.length} onClear={() => setSel([])}
          actions={<>
            <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchWorks(sel, 'hide'); setSel([]); }, '已批量下架')}>批量下架</OutlinedButton>
            <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchWorks(sel, 'restore'); setSel([]); }, '已批量上架')}>批量重新上架</OutlinedButton>
            <OutlinedButton disabled={busy} onClick={async () => { if (await confirm(`删除选中的 ${sel.length} 件稿件？不可恢复。`)) L.run(async () => { await api.batchWorks(sel, 'delete'); setSel([]); }, '已批量删除'); }}>批量删除</OutlinedButton>
          </>}
        />
      )}

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="palette" title="没有符合条件的稿件" /></Card> : (
        <Card style={{ padding: 12 }}>
          <SelectAllRow
            checked={L.rows.length > 0 && sel.length === L.rows.length}
            onChange={() => setSel(sel.length === L.rows.length ? [] : L.rows.map((w) => w.id))}
          />
          {L.rows.map((w) => (
            <Row
              key={w.id}
              leading={<>
                <Checkbox checked={sel.includes(w.id)}
                          onChange={() => setSel((p) => (p.includes(w.id) ? p.filter((x) => x !== w.id) : [...p, w.id]))} />
                <Avatar user={w.author} />
              </>}
              title={<>
                <b>{s(w.title) || '(无标题)'}</b>
                {statusBadge(w.status)}
                {w.is_featured && <Badge><Sparkles size={12} /> 加精</Badge>}
                {w.is_pinned && <Badge><Pin size={12} /> 置顶</Badge>}
                {s(w.category) && <Badge>{s(w.category)}</Badge>}
              </>}
              meta={<>
                #{w.id} - {authorOf(w)} - <Eye size={13} /> {num(w.views)} - <Star size={13} /> {num(w.like_count)}
                {' - '}{T(w.created_at)}
                {s(w.sensitive_hits && (Array.isArray(w.sensitive_hits) ? w.sensitive_hits.join('、') : w.sensitive_hits)) ? ` - 命中敏感词：${s(w.sensitive_hits)}` : ''}
              </>}
              body={s(w.description) ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.7 }}>{s(w.description).slice(0, 110)}</div> : null}
              actions={<>
                <TextButton onClick={() => setPreview(w)}><Eye size={14} /> 预览</TextButton>
                {s(w.status) === 'pending' && (
                  <>
                    <FilledButton disabled={busy} onClick={() => L.run(() => api.reviewWork(w.id, { decision: 'approve' }), '已通过')}>通过</FilledButton>
                    <OutlinedButton disabled={busy} onClick={() => { setReject(w); setWhy(''); }}>驳回</OutlinedButton>
                  </>
                )}
                <TextButton disabled={busy} onClick={() => L.run(() => api.workFlag(w.id, 'feature', !w.is_featured), w.is_featured ? '已取消加精' : '已加精')}>
                  <Sparkles size={14} /> {w.is_featured ? '取消加精' : '加精'}
                </TextButton>
                <TextButton disabled={busy} onClick={() => L.run(() => api.workFlag(w.id, 'pin', !w.is_pinned), w.is_pinned ? '已取消置顶' : '已置顶')}>
                  <Pin size={14} /> {w.is_pinned ? '取消置顶' : '置顶'}
                </TextButton>
                <TextButton onClick={() => openEdit(w)}><Palette size={14} /> 编辑</TextButton>
                <TextButton onClick={() => loadVersions(w)}><History size={14} /> 版本</TextButton>
                <TextButton disabled={busy} onClick={async () => { if (await confirm(`删除稿件「${s(w.title)}」？不可恢复。`)) L.run(() => api.deleteWork(w.id), '已删除'); }}>
                  <Trash2 size={14} /> 删除
                </TextButton>
              </>}
            />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}

      {/* 预览：审核前直接看作品本体（封面 + 播放器 + 说明）。
          数据全部来自列表接口已有的字段，不额外请求；关闭后列表原地不动。
          弹窗里不放「通过 / 驳回」，那两个动作留在行内，避免误触。 */}
      <WorkPreview work={preview} onClose={() => setPreview(null)} />

      {/* 驳回：decision=reject + reason */}
      <Modal open={!!reject} title={`驳回「${reject ? s(reject.title) : ''}」`} onClose={() => setReject(null)}
             onSubmit={() => L.run(async () => { await api.reviewWork(reject.id, { decision: 'reject', reason: why.trim() }); setReject(null); }, '已驳回')}
             disabled={!why.trim()} submitLabel="确认驳回" busy={busy}>
        <OutlinedTextField label="驳回原因（会通知作者）" value={why} onInput={(e) => setWhy(e.target.value)} />
      </Modal>

      {/* 编辑：字段与 PATCH /admin/works/{id} 完全一致 */}
      <Modal open={!!edit} title={`编辑稿件 #${edit ? edit.id : ''}`} onClose={() => setEdit(null)} onSubmit={saveEdit}
             width={400} busy={busy} disabled={!form.title || !form.title.trim()}>
        <OutlinedTextField label="标题" value={form.title || ''} onInput={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <OutlinedTextField label="简介" value={form.description || ''} onInput={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} />
        <SelectField label="分类" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={CATS_WORK.filter(([v]) => v !== 'all')} />
        <OutlinedTextField label="标签（空格分隔）" value={form.tags || ''} onInput={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
        <SelectField label="状态" value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} options={STATUS_WORK.filter(([v]) => v !== 'all')} />
        <OutlinedTextField label="封面图地址" value={form.cover_url || ''} onInput={(e) => setForm((f) => ({ ...f, cover_url: e.target.value }))} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>置顶</span>
          <Switch selected={!!form.is_pinned} onChange={(e) => setForm((f) => ({ ...f, is_pinned: e.target.selected }))} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>加精</span>
          <Switch selected={!!form.is_featured} onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.selected }))} />
        </div>
      </Modal>

      {/* 历史版本 */}
      <Modal open={!!vers} title={`历史版本 - ${vers ? s(vers.title) : ''}`} onClose={() => setVers(null)} width={340}>
        {verRows.length === 0 ? <Note>没有版本记录</Note> : verRows.map((v, i) => (
          <div key={i} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span className="muted">{T(v.created_at || v.at)}</span>
            <b>{s(v.title) || s(v.version) || `#${i + 1}`}</b>
          </div>
        ))}
      </Modal>
    </>
  );
}

export const WorksReview = () => <Works defaultStatus="pending" />;

/* ============================================================ 审核队列（聚合） */
export function Queue({ setTab }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr('');
    try {
      const r = await api.reviewQueue();
      setData(r.data || {});
    } catch (e) { setErr(detail(e)); }
  };
  useEffect(() => { load(); }, []);

  const act = async (fn, ok) => {
    setBusy(true); setErr('');
    try { await fn(); await load(); } catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };
  const confirm = useConfirm();

  if (err) return <Note tone="error">{err}</Note>;
  if (!data) return <Loading />;
  const works = data.pending_works || [];
  const scheduled = data.scheduled_works || [];
  const reports = data.pending_reports || [];
  const total = works.length + scheduled.length + reports.length;

  return (
    <>
      <Card>
        <PanelHead icon={<AlertTriangle size={17} />} title="待处理合计" count={total}>
          <RefreshButton onClick={load} busy={busy} />
        </PanelHead>
        <Note>待审稿件、定时发布稿件、待处理举报三块合并在一屏，每块可跳到对应面板做批量处理。</Note>
      </Card>

      <Card>
        <PanelHead icon={<Palette size={17} />} title="待审稿件" count={works.length}>
          <OutlinedButton onClick={() => setTab('works-review')}>去稿件审核</OutlinedButton>
        </PanelHead>
        {works.length === 0 ? <Note>暂无待处理</Note> : works.map((w) => (
          <Row key={w.id} leading={<Avatar user={w.author} />}
               title={<><b>{s(w.title) || `#${w.id}`}</b> {statusBadge(w.status)}</>}
               meta={<>{authorOf(w)} - {T(w.created_at)}</>}
               actions={<>
                 <FilledButton disabled={busy} onClick={() => act(() => api.reviewWork(w.id, { decision: 'approve' }), 'ok')}>通过</FilledButton>
                 <OutlinedButton disabled={busy} onClick={async () => { if (await confirm('驳回该稿件？')) act(() => api.reviewWork(w.id, { decision: 'reject', reason: '不符合投稿要求' }), 'ok'); }}>驳回</OutlinedButton>
               </>} />
        ))}
      </Card>

      <Card>
        <PanelHead icon={<Clock size={17} />} title="定时发布" count={scheduled.length} />
        {scheduled.length === 0 ? <Note>暂无定时稿件</Note> : scheduled.map((w) => (
          <Row key={w.id} title={<b>{s(w.title) || `#${w.id}`}</b>} meta={<>定时：{T(w.scheduled_at)} - {authorOf(w)}</>} />
        ))}
      </Card>

      <Card>
        <PanelHead icon={<Flag size={17} />} title="待处理举报" count={reports.length}>
          <OutlinedButton onClick={() => setTab('reports')}>去举报处理</OutlinedButton>
        </PanelHead>
        {reports.length === 0 ? <Note>暂无待处理</Note> : reports.map((r) => (
          <Row key={r.id}
               title={<>
                 <b>{s(r.target_type) || '举报'} #{s(r.target_id)}</b>
                 {r.target_preview ? (
                   <span className="muted" style={{ fontSize: 13 }}>
                     {s(r.target_preview.title) || s(r.target_preview.content) || ''}
                     {r.target_preview.author ? `（${s(r.target_preview.author)}）` : ''}
                   </span>
                 ) : null}
               </>}
               meta={<>
                 {s(r.reason) || '无理由'} - {T(r.created_at)}
                 {typeof r.target_total === 'number' ? ` - 该内容共被举报 ${r.target_total} 次` : ''}
               </>}
               actions={<FilledButton disabled={busy} onClick={() => act(() => api.handleReport(r.id, { status: 'handled', note: '队列内处理' }), 'ok')}>标记已处理</FilledButton>} />
        ))}
      </Card>
    </>
  );
}

/* ============================================================ 帖子 / 评论 */
export function PostsAndComments() {
  const [which, setWhich] = useState('posts');
  return (
    <>
      <Card style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>内容管理</b>
        <OutlinedButton onClick={() => setWhich('posts')} disabled={which === 'posts'}>帖子</OutlinedButton>
        <OutlinedButton onClick={() => setWhich('comments')} disabled={which === 'comments'}>评论</OutlinedButton>
        <span className="muted" style={{ fontSize: 12.5 }}>{which === 'posts' ? '帖子可编辑、加精、置顶、删除、批量操作' : '评论可单条删除与批量删除'}</span>
      </Card>
      {which === 'posts' ? <Posts /> : <Comments />}
    </>
  );
}

function Posts() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [cat, setCat] = useState('all');
  const [sel, setSel] = useState([]);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const params = { q: query || undefined, status: status === 'all' ? undefined : status, category: cat === 'all' ? undefined : cat };
  const L = useList(api.listPosts, { mode: 'server', keys: ['posts'], params });
  const confirm = useConfirm();

  const openEdit = (p) => {
    setForm({
      title: s(p.title), content: s(p.content), category: s(p.category) || '讨论',
      topics: Array.isArray(p.topics) ? p.topics.join(' ') : s(p.topics), status: s(p.status) || 'published',
      is_pinned: !!p.is_pinned, is_featured: !!p.is_featured,
    });
    setEdit(p);
  };

  const saveEdit = () => L.run(async () => {
    await api.editPost(edit.id, {
      title: form.title.trim(), content: form.content, category: form.category,
      topics: form.topics.trim() ? form.topics.trim().split(/\s+/) : [],
      status: form.status, is_pinned: !!form.is_pinned, is_featured: !!form.is_featured,
    });
    setEdit(null);
  }, '已保存');

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索标题 / 作者" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }} options={STATUS_POST} />
        <SelectField label="版块" value={cat} onChange={(v) => { setCat(v); L.setPage(1); }} options={CATS_POST} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}><span slot="icon"><Search size={16} /></span>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {sel.length > 0 && (
        <BatchBar count={sel.length} onClear={() => setSel([])}
                  actions={<>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchPosts(sel, 'hide'); setSel([]); }, '已批量下架')}>批量下架</OutlinedButton>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchPosts(sel, 'restore'); setSel([]); }, '已批量上架')}>批量重新上架</OutlinedButton>
                    <OutlinedButton disabled={busy} onClick={async () => { if (await confirm(`删除选中的 ${sel.length} 个帖子？`)) L.run(async () => { await api.batchPosts(sel, 'delete'); setSel([]); }, '已批量删除'); }}>批量删除</OutlinedButton>
                  </>} />
      )}

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="forum" title="没有符合条件的帖子" /></Card> : (
        <Card style={{ padding: 12 }}>
          <SelectAllRow checked={L.rows.length > 0 && sel.length === L.rows.length}
                        onChange={() => setSel(sel.length === L.rows.length ? [] : L.rows.map((p) => p.id))} />
          {L.rows.map((p) => (
            <Row key={p.id}
                 leading={<>
                   <Checkbox checked={sel.includes(p.id)}
                             onChange={() => setSel((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))} />
                   <Avatar user={p.author} />
                 </>}
                 title={<>
                   <b>{s(p.title) || '(无标题)'}</b>
                   {statusBadge(p.status)}
                   {p.is_featured && <Badge><Sparkles size={12} /> 加精</Badge>}
                   {p.is_pinned && <Badge><Pin size={12} /> 置顶</Badge>}
                   {s(p.category) && <Badge>{s(p.category)}</Badge>}
                 </>}
                 meta={<>#{p.id} - {authorOf(p)} - <Eye size={13} /> {num(p.views)} - <Star size={13} /> {num(p.like_count)} - <MessageSquare size={13} /> {num(p.comment_count)} - {T(p.created_at)}</>}
                 body={s(p.content) ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.7 }}>{s(p.content).slice(0, 110)}</div> : null}
                 actions={<>
                   <TextButton disabled={busy} onClick={() => L.run(() => api.postFlag(p.id, 'feature', !p.is_featured), p.is_featured ? '已取消加精' : '已加精')}>
                     <Sparkles size={14} /> {p.is_featured ? '取消加精' : '加精'}
                   </TextButton>
                   <TextButton disabled={busy} onClick={() => L.run(() => api.postFlag(p.id, 'pin', !p.is_pinned), p.is_pinned ? '已取消置顶' : '已置顶')}>
                     <Pin size={14} /> {p.is_pinned ? '取消置顶' : '置顶'}
                   </TextButton>
                   <TextButton onClick={() => openEdit(p)}>编辑</TextButton>
                   <TextButton disabled={busy} onClick={async () => { if (await confirm(`删除帖子「${s(p.title)}」？`)) L.run(() => api.deletePost(p.id), '已删除'); }}>
                     <Trash2 size={14} /> 删除
                   </TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}

      <Modal open={!!edit} title={`编辑帖子 #${edit ? edit.id : ''}`} onClose={() => setEdit(null)} onSubmit={saveEdit}
             width={420} busy={busy} disabled={!form.title || !form.title.trim()}>
        <OutlinedTextField label="标题" value={form.title || ''} onInput={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <OutlinedTextField label="正文（Markdown）" value={form.content || ''} onInput={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={6} />
        <SelectField label="版块" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={CATS_POST.filter(([v]) => v !== 'all')} />
        <OutlinedTextField label="话题标签（空格分隔）" value={form.topics || ''} onInput={(e) => setForm((f) => ({ ...f, topics: e.target.value }))} />
        <SelectField label="状态" value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} options={STATUS_POST.filter(([v]) => v !== 'all')} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>置顶</span>
          <Switch selected={!!form.is_pinned} onChange={(e) => setForm((f) => ({ ...f, is_pinned: e.target.selected }))} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>加精</span>
          <Switch selected={!!form.is_featured} onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.selected }))} />
        </div>
      </Modal>
    </>
  );
}

function Comments() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const TYPES = [['all', '全部'], ['work', '稿件评论'], ['post', '帖子评论']];
  const params = { q: query || undefined, target_type: type === 'all' ? undefined : type };
  const L = useList(api.listComments, { mode: 'server', keys: ['comments'], params });
  const confirm = useConfirm();

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索评论内容 / 作者" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="来源" value={type} onChange={(v) => { setType(v); L.setPage(1); }} options={TYPES} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}><span slot="icon"><Search size={16} /></span>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {sel.length > 0 && (
        <BatchBar count={sel.length} onClear={() => setSel([])}
                  actions={<OutlinedButton disabled={busy} onClick={async () => { if (await confirm(`删除选中的 ${sel.length} 条评论？`)) L.run(async () => { await api.batchComments(sel); setSel([]); }, '已批量删除'); }}>批量删除</OutlinedButton>} />
      )}

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="chat" title="没有评论" /></Card> : (
        <Card style={{ padding: 12 }}>
          <SelectAllRow checked={L.rows.length > 0 && sel.length === L.rows.length}
                        onChange={() => setSel(sel.length === L.rows.length ? [] : L.rows.map((c) => c.id))} />
          {L.rows.map((c) => (
            <Row key={c.id}
                 leading={<Checkbox checked={sel.includes(c.id)}
                                   onChange={() => setSel((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))} />}
                 title={<b>{s(c.content) || '(空评论)'}</b>}
                 meta={<>#{c.id} - {s(c.nickname || c.username) || '—'} - 来源 {s(c.target_type) || '—'} #{s(c.target_id)} - {T(c.created_at)}</>}
                 actions={<TextButton disabled={busy} onClick={async () => { if (await confirm('删除这条评论？')) L.run(() => api.deleteComment(c.id), '已删除'); }}>
                   <Trash2 size={14} /> 删除
                 </TextButton>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}
    </>
  );
}

/* ============================================================ 举报 */
export function Reports() {
  const [status, setStatus] = useState('pending');
  const [sel, setSel] = useState([]);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const STATUSES = [['pending', '待处理'], ['handled', '已处理'], ['dismissed', '已驳回'], ['all', '全部']];
  const params = { status: status === 'all' ? undefined : status };
  const L = useList(api.listReports, { mode: 'client', keys: ['reports', 'items'], params });

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={L.total != null ? `共 ${L.total} 条 - 第 ${L.page} / ${L.pages} 页` : `第 ${L.page} 页`}>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }} options={STATUSES} />
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {sel.length > 0 && (
        <BatchBar count={sel.length} onClear={() => setSel([])}
                  actions={<>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchReports({ ids: sel, status: 'handled', note }); setSel([]); }, '已批量处理')}>批量标记已处理</OutlinedButton>
                    <OutlinedButton disabled={busy} onClick={() => L.run(async () => { await api.batchReports({ ids: sel, status: 'dismissed', note }); setSel([]); }, '已批量驳回')}>批量驳回</OutlinedButton>
                  </>} />
      )}

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="flag" title="没有举报" /></Card> : (
        <Card style={{ padding: 12 }}>
          <SelectAllRow checked={L.rows.length > 0 && sel.length === L.rows.length}
                        onChange={() => setSel(sel.length === L.rows.length ? [] : L.rows.map((r) => r.id))} />
          {L.rows.map((r) => (
            <Row key={r.id}
                 leading={<Checkbox checked={sel.includes(r.id)}
                                   onChange={() => setSel((prev) => (prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]))} />}
                 title={<>
                   <b>{s(r.target_type) || '举报'} #{s(r.target_id)}</b>
                   <Badge tone={s(r.status) === 'pending' ? 'error' : 'plain'}>{s(r.status) || '—'}</Badge>
                   {/* 被举报内容的实际内容：后端 target_preview 早就返回了，之前只是没渲染，
                       导致管理员只能看到"work_comment #514"这种编号、无从判断。 */}
                   {r.target_preview ? (
                     <span className="muted" style={{ fontSize: 13 }}>
                       {s(r.target_preview.title) || s(r.target_preview.content) || ''}
                       {r.target_preview.author ? `（${s(r.target_preview.author)}）` : ''}
                     </span>
                   ) : (
                     <span className="muted" style={{ fontSize: 13 }}>（内容已被删除，看不到原文）</span>
                   )}
                   {(['post', 'work'].includes(s(r.target_type)) && r.target_id) ? (
                     <a href={(s(r.target_type) === 'post' ? '/posts/' : '/works/') + s(r.target_id)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>查看原文</a>
                   ) : null}
                 </>}
                 meta={<>
                   {s(r.reason) || '无理由'} - 举报人 {s(r.reporter_nickname || r.nickname) || '—'} - {T(r.created_at)}
                   {typeof r.target_total === 'number' ? ` - 该内容共被举报 ${r.target_total} 次（待处理 ${r.target_pending ?? 0}）` : ''}
                   {typeof r.reporter_total === 'number' ? ` - 举报人历史举报 ${r.reporter_total} 次（已驳回 ${r.reporter_dismissed ?? 0}）` : ''}
                   {s(r.note) ? ` - 处理备注：${s(r.note)}` : ''}
                 </>}
                 actions={<>
                   <FilledButton disabled={busy} onClick={() => L.run(() => api.handleReport(r.id, { status: 'handled', note }), '已处理')}>标记已处理</FilledButton>
                   <OutlinedButton disabled={busy} onClick={() => L.run(() => api.handleReport(r.id, { status: 'dismissed', note }), '已驳回')}>驳回</OutlinedButton>
                   <TextButton onClick={() => setTarget(r)}>填写备注</TextButton>
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}

      <Modal open={!!target} title={`处理举报 #${target ? target.id : ''}`} onClose={() => setTarget(null)} width={380}
             onSubmit={() => L.run(async () => { await api.handleReport(target.id, { status: 'handled', note }); setTarget(null); }, '已处理')}
             submitLabel="标记已处理">
        <OutlinedTextField label="处理备注（会记录进后台日志）" value={note} onInput={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}

/* ============================================================ 敏感词与处罚 */
export function Sensitive() {
  const [tab, setTab] = useState('review');
  return (
    <>
      <Card style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>敏感词与处罚</b>
        <OutlinedButton onClick={() => setTab('review')} disabled={tab === 'review'}>待审队列</OutlinedButton>
        <OutlinedButton onClick={() => setTab('words')} disabled={tab === 'words'}>敏感词表</OutlinedButton>
        <OutlinedButton onClick={() => setTab('stats')} disabled={tab === 'stats'}>统计</OutlinedButton>
      </Card>
      {tab === 'review' ? <SensitiveReviews /> : tab === 'words' ? <SensitiveWords /> : <SensitiveStats />}
    </>
  );
}

function SensitiveReviews() {
  const [status, setStatus] = useState('pending');
  const [source, setSource] = useState('all');
  const [reject, setReject] = useState(null);
  const [form, setForm] = useState({ reason: '', penalty: 'none', amount: 0, days: 0 });
  const [busy, setBusy] = useState(false);
  const SOURCES = [['all', '全部'], ['work', '稿件'], ['post', '帖子'], ['comment', '评论'], ['user', '用户资料']];
  const params = { status: status === 'all' ? undefined : status, source: source === 'all' ? undefined : source };
  const L = useList(api.listSensitiveReviews, { mode: 'server', keys: ['reviews', 'items'], params });
  const confirm = useConfirm();

  const doReject = () => L.run(async () => {
    await api.rejectSensitive(reject.id, {
      reason: form.reason.trim(),
      penalty: form.penalty,
      amount: Number(form.amount) || 0,
      days: Number(form.days) || 0,
    });
    setReject(null);
  }, '已处罚');

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <SelectField label="状态" value={status} onChange={(v) => { setStatus(v); L.setPage(1); }}
                     options={[['pending', '待审'], ['approved', '已放行'], ['rejected', '已处罚'], ['all', '全部']]} />
        <SelectField label="来源" value={source} onChange={(v) => { setSource(v); L.setPage(1); }} options={SOURCES} />
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="shield" title="没有待审内容" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((r) => (
            <Row key={r.id}
                 title={<>
                   <b>{SENSITIVE_TYPE[s(r.target_type)] || s(r.target_type) || '内容'} #{s(r.target_id)}</b>
                   <Badge tone={s(r.status) === 'pending' ? 'error' : 'plain'}>
                     {s(r.status) === 'pending' ? '待审' : s(r.status) === 'approved' ? '已放行' : '已处罚'}
                   </Badge>
                   {wordsOf(r).map((w) => <Badge key={w}>命中「{w}」</Badge>)}
                 </>}
                 meta={<>
                   {s(r.target && r.target.title) ? `《${s(r.target.title)}》 - ` : ''}
                   作者 {s(r.target && r.target.author_name) || '—'}
                   {s(r.target && r.target.author_id) ? `（ID ${s(r.target.author_id)}）` : ''}
                   {' - '}{T(r.created_at)}
                   {s(r.penalty) ? ` - 已处罚：${SENSITIVE_PENALTY[s(r.penalty)] || s(r.penalty)}${s(r.penalty_detail) ? `（${s(r.penalty_detail)}）` : ''}` : ''}
                   {s(r.reviewer_note) ? ` - 备注：${s(r.reviewer_note)}` : ''}
                 </>}
                 body={s(r.target && r.target.preview) ? (
                   <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.7 }}>
                     命中内容：{s(r.target.preview).slice(0, 160)}{s(r.target.preview).length > 160 ? '…' : ''}
                   </div>
                 ) : null}
                 actions={<>
                   {s(r.status) === 'pending' ? (
                     <>
                       <FilledButton disabled={busy} onClick={() => L.run(() => api.approveSensitive(r.id), '已放行（内容恢复展示）')}>放行</FilledButton>
                       <OutlinedButton disabled={busy} onClick={() => { setReject(r); setForm({ reason: '', penalty: '', amount: 100, days: 1 }); }}>处罚 / 驳回</OutlinedButton>
                     </>
                   ) : (
                     <span className="muted" style={{ fontSize: 12.5 }}>
                       {s(r.resolved_by) ? `处理人 ${s(r.resolved_by)}` : '已处理'}
                       {r.handled_at ? ` - ${T(r.handled_at)}` : ''}
                     </span>
                   )}
                 </>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}

      {/* 处罚：字段与 POST /admin/sensitive-reviews/{id}/reject 一致
          后端支持的 penalty：'' 仅隐藏 / warn 警告 / mute 禁言N天 / ban 永久封禁 / xp 扣N经验 */}
      <Modal open={!!reject} title={`处罚 / 驳回 ${reject ? (SENSITIVE_TYPE[s(reject.target_type)] || '') + ' #' + s(reject.target_id) : ''}`}
             onClose={() => setReject(null)} onSubmit={doReject} width={420} busy={busy} submitLabel="确认处罚">
        {reject && s(reject.target && reject.target.preview) && (
          <Note>命中内容：{s(reject.target.preview).slice(0, 120)}</Note>
        )}
        <SelectField label="处罚方式" value={form.penalty} onChange={(v) => setForm((f) => ({ ...f, penalty: v }))}
                     options={[['', '仅驳回内容（不追加处罚）'], ['warn', '警告一次'], ['mute', '禁言 N 天'], ['ban', '永久封禁账号'], ['xp', '扣除 N 经验']]} />
        {form.penalty === 'mute' && (
          <OutlinedTextField label="禁言天数" type="number" value={String(form.days)}
                             onInput={(e) => setForm((f) => ({ ...f, days: e.target.value }))} supportingText="默认 1 天" />
        )}
        {form.penalty === 'xp' && (
          <OutlinedTextField label="扣除经验数量" type="number" value={String(form.amount)}
                             onInput={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} supportingText="默认 100" />
        )}
        <OutlinedTextField label="理由（会连同处罚一起通知作者）" value={form.reason}
                           onInput={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        <Note>
          作品与帖子会被置为「已驳回」（作者可见可申诉），评论会被删除。
        </Note>
      </Modal>
    </>
  );
}

function SensitiveWords() {
  const L = useList(api.listSensitiveWords, { mode: 'client', keys: ['words', 'items'] });
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={L.total != null ? `共 ${L.total} 个词 - 第 ${L.page} / ${L.pages} 页` : ''}>
        <div className="adm-filter-search">
          <SearchInput label="新增敏感词" value={word} onChange={setWord} onSubmit={() => word.trim() && L.run(async () => { await api.addSensitiveWord(word.trim()); setWord(''); }, '已添加')} />
        </div>
        <FilledButton disabled={busy || !word.trim()} onClick={() => L.run(async () => { await api.addSensitiveWord(word.trim()); setWord(''); }, '已添加')}>添加</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="shield" title="敏感词表是空的" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((w) => (
            <Row key={w.id || w.word}
                 title={<b>{s(w.word)}</b>}
                 meta={<>{w.id ? `#${w.id}` : ''} {w.created_at ? ` - ${T(w.created_at)}` : ''} {w.hits != null ? ` - 命中 ${w.hits} 次` : ''}</>}
                 actions={<TextButton disabled={busy} onClick={async () => { if (await confirm(`删除敏感词「${s(w.word)}」？`)) L.run(() => api.deleteSensitiveWord(w.id), '已删除'); }}>
                   <Trash2 size={14} /> 删除
                 </TextButton>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}
    </>
  );
}

function SensitiveStats() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.sensitiveStats().then((r) => setData(r.data)).catch((e) => setErr(detail(e))); }, []);
  if (err) return <Note tone="error">{err}</Note>;
  if (!data) return <Loading />;
  const entries = Object.entries(data).filter(([, v]) => typeof v !== 'object');
  const queue = data.queue_counts || {};
  return (
    <Card>
      <PanelHead icon={<ShieldAlert size={17} />} title="敏感词统计" />
      {entries.map(([k, v]) => (
        <div key={k} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
          <span className="muted">{k}</span><b>{String(v)}</b>
        </div>
      ))}
      {Object.keys(queue).length > 0 && (
        <>
          <div style={{ marginTop: 12, fontWeight: 700, fontSize: 13 }}>待审分布</div>
          {Object.entries(queue).map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '6px 0' }}>
              <span className="muted">{k}</span><b>{String(v)}</b>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

/* ============================================================ 回收站 */
export function RecycleBin() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [busy, setBusy] = useState(false);
  const TYPES = [['all', '全部'], ['work', '稿件'], ['post', '帖子'], ['comment', '评论']];
  const params = { q: query || undefined, target_type: type === 'all' ? undefined : type };
  const L = useList(api.listRecycle, { mode: 'server', keys: ['items'], params });
  const confirm = useConfirm();

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索已删除内容" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <SelectField label="类型" value={type} onChange={(v) => { setType(v); L.setPage(1); }} options={TYPES} />
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}><span slot="icon"><Search size={16} /></span>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="delete" title="回收站是空的" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((r) => (
            <Row key={r.id}
                 title={<><b>{s(r.title) || `#${r.id}`}</b> {s(r.target_type) && <Badge>{s(r.target_type)}</Badge>}</>}
                 meta={<>#{r.id} - 删除时间 {T(r.deleted_at || r.created_at)}{s(r.deleted_by) ? ` - 操作者 ${s(r.deleted_by)}` : ''}</>}
                 actions={<TextButton disabled={busy} onClick={async () => { if (await confirm('恢复这条内容？')) L.run(() => api.restoreRecycle(r.id), '已恢复'); }}>
                   <RotateCcw size={14} /> 恢复
                 </TextButton>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}
    </>
  );
}

/* ============================================================ 官方精选 */
export function FeaturedWorks() {
  const L = useList(api.listFeatured, { mode: 'client', keys: ['works'] });
  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={L.total != null ? `共 ${L.total} 件 - 第 ${L.page} / ${L.pages} 页` : ''}>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>
      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="star" title="还没有精选内容" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((w) => (
            <Row key={w.id} leading={<Avatar user={w.author} />}
                 title={<><b>{s(w.title) || `#${w.id}`}</b> {s(w.category) && <Badge>{s(w.category)}</Badge>}</>}
                 meta={<>#{w.id} - {authorOf(w)} - 播放 {num(w.views)} - {T(w.created_at)}</>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="client" />
        </Card>
      )}
    </>
  );
}
