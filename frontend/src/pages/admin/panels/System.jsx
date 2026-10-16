/**
 * 系统类面板：操作日志 / 安全审计 / 站点开关 / 公告与 Banner / 全站通知 / 数据导出
 * 字段照契约：switches PATCH={value} - announcement POST={announcement,scheduled_at}
 *            banners POST/PATCH={title,image_url,color,target_type,target_id,target_url,sort_order,enabled}
 *            notify POST={content}（≤500 字，后端不使用标题）
 */
import { useEffect, useState } from 'react';
import {
  Bell, Download, Image as ImageIcon, ListTree, Plus, Send, Shield, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { FilledButton, OutlinedButton, OutlinedTextField, Switch, TextButton } from '../../../ui';
import * as api from '../client';
import {
  Badge, Card, Empty, Loading, Modal, Note, PanelHead, Pager, RefreshButton, Row, SearchInput,
  SelectField, T, Toolbar, detail, s, useConfirm, useList,
} from '../ui';

/* ============================================================ 操作日志 */
export function Logs() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const params = { q: query || undefined };
  const L = useList(api.listLogs, { mode: 'server', keys: ['logs', 'items'], params });

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <div className="adm-filter-search">
          <SearchInput label="搜索操作 / 对象" value={q} onChange={setQ} onSubmit={() => { setQuery(q); L.setPage(1); }} />
        </div>
        <FilledButton onClick={() => { setQuery(q); L.setPage(1); }}>搜索</FilledButton>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>

      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="history" title="没有日志" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((g, i) => (
            <Row key={g.id || i}
                 title={<><b>{s(g.action) || '操作'}</b>
                   {s(g.target_type) && <Badge>{s(g.target_type)}{g.target_id ? ` #${s(g.target_id)}` : ''}</Badge>}</>}
                 meta={<>{s(g.actor_nickname || g.actor) || '—'} - {T(g.created_at)}{s(g.detail) ? ` - ${s(g.detail)}` : ''}</>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}
    </>
  );
}

/* ============================================================ 安全审计 */
export function AuditLogs() {
  const L = useList(api.listAuditLogs, { mode: 'server', keys: ['logs', 'items'] });
  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}
      <Toolbar footer={`第 ${L.page} 页 - 本页 ${L.rows.length} 条`}>
        <RefreshButton onClick={L.reload} busy={L.loading} />
      </Toolbar>
      {L.loading ? <Loading /> : L.rows.length === 0 ? <Card><Empty icon="shield" title="没有审计记录" /></Card> : (
        <Card style={{ padding: 12 }}>
          {L.rows.map((g, i) => (
            <Row key={g.id || i}
                 title={<b>{s(g.event) || s(g.action) || '事件'}</b>}
                 meta={<>UID {s(g.uid) || '—'}{s(g.ip) ? ` - IP ${s(g.ip)}` : ''}{s(g.detail) ? ` - ${s(g.detail)}` : ''} - {T(g.created_at)}</>} />
          ))}
          <Pager page={L.page} setPage={L.setPage} pages={L.pages} total={L.total} hasMore={L.hasMore} mode="server" />
        </Card>
      )}
    </>
  );
}

/* ============================================================ 站点开关 */
export function Switches() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();          // 统一二次确认（MD3 弹窗，取代 window.confirm）

  const load = async () => {
    setErr('');
    try {
      const r = await api.listSwitches();
      const d = r.data;
      // 后端返回 [{key, value, label, changed, desc}] 或 {key: value/bool}
      const list = Array.isArray(d)
        ? d
        : Object.entries(d || {}).map(([key, v]) => (v && typeof v === 'object'
          ? { key, label: v.label || key, value: v.value, desc: v.desc, changed: v.changed }
          : { key, label: key, value: !!v }));
      setItems(list);
    } catch (e) { setErr(detail(e)); }
  };
  useEffect(() => { load(); }, []);

  const flip = async (it, next) => {
    if (!(await confirm(`把「${it.label || it.key}」改为${next ? '开启' : '关闭'}？会立即影响线上。`))) return;
    setBusy(true); setErr(''); setMsg('');
    try { await api.setSwitch(it.key, next); setMsg('已保存'); await load(); }
    catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  if (err) return <Note tone="error">{err}</Note>;
  if (!items) return <Loading />;

  return (
    <>
      {msg && <Note tone="ok">{msg}</Note>}
      <Card>
        <PanelHead icon={<SlidersHorizontal size={17} />} title="站点开关" count={items.length}>
          <RefreshButton onClick={load} busy={busy} />
        </PanelHead>
        {items.length === 0 ? <Empty icon="tune" title="没有可切换的开关" /> : items.map((it) => (
          <div key={it.key} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {it.label || it.key} {it.changed && <Badge tone="primary">已改动</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{it.key}{it.desc ? ` - ${it.desc}` : ''}</div>
            </div>
            <Switch selected={!!it.value} disabled={busy} onChange={(e) => flip(it, e.target.selected)} />
          </div>
        ))}
      </Card>
    </>
  );
}

/* ============================================================ 公告与 Banner */
export function BannersAndAnnouncement() {
  const L = useList(api.listBanners, { mode: 'client', keys: ['banners', 'items'] });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [ann, setAnn] = useState({ announcement: '', scheduled_at: '' });
  const [annMsg, setAnnMsg] = useState('');
  const [annLoaded, setAnnLoaded] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    api.getAnnouncement()
      .then((r) => {
        const d = r.data || {};
        setAnn({ announcement: s(d.announcement), scheduled_at: s(d.scheduled) || s(d.scheduled_at) });
        setAnnLoaded(true);
      })
      .catch(() => setAnnLoaded(true));
  }, []);

  const openNew = () => {
    setForm({ title: '', image_url: '', color: '', target_type: 'none', target_id: '', target_url: '', sort_order: 0, enabled: true });
    setEdit({});
  };
  const openEdit = (b) => {
    setForm({
      title: s(b.title), image_url: s(b.image_url || b.image), color: s(b.color),
      target_type: s(b.target_type) || 'none', target_id: b.target_id ?? '',
      target_url: s(b.target_url || b.link), sort_order: b.sort_order ?? b.sort ?? 0, enabled: b.enabled !== false,
    });
    setEdit(b);
  };

  const save = () => L.run(async () => {
    const body = {
      title: form.title.trim(),
      image_url: form.image_url.trim(),
      color: form.color.trim(),
      target_type: form.target_type,
      target_id: form.target_type === 'work' || form.target_type === 'post' ? (Number(form.target_id) || null) : null,
      target_url: form.target_type === 'url' ? (form.target_url.trim() || null) : null,
      sort_order: Number(form.sort_order) || 0,
      enabled: !!form.enabled,
    };
    if (edit && edit.id) await api.patchBanner(edit.id, body);
    else await api.createBanner(body);
    setEdit(null);
  }, edit && edit.id ? '已保存' : '已创建');

  const saveAnn = async () => {
    setBusy(true); setAnnMsg('');
    try {
      await api.saveAnnouncement({ announcement: ann.announcement, scheduled_at: ann.scheduled_at || null });
      setAnnMsg('公告已保存');
    } catch (e) { L.setErr(detail(e)); } finally { setBusy(false); }
  };

  return (
    <>
      {(L.err || L.msg) && <Note tone={L.err ? 'error' : 'ok'}>{L.err || L.msg}</Note>}

      <Card>
        <PanelHead icon={<Bell size={17} />} title="站点公告">
          <OutlinedButton onClick={saveAnn} disabled={busy || !annLoaded}>保存公告</OutlinedButton>
        </PanelHead>
        {annMsg && <Note tone="ok">{annMsg}</Note>}
        <OutlinedTextField label="公告内容（留空 = 不显示公告）" value={ann.announcement}
                           onInput={(e) => setAnn((a) => ({ ...a, announcement: e.target.value }))} rows={4} />
        <div style={{ marginTop: 10 }}>
          <OutlinedTextField label="定时展示时间（可留空，ISO 格式）" value={ann.scheduled_at}
                             onInput={(e) => setAnn((a) => ({ ...a, scheduled_at: e.target.value }))}
                             supportingText="例如 2026-10-05T09:00" />
        </div>
      </Card>

      <Card>
        <PanelHead icon={<ImageIcon size={17} />} title="首页 Banner" count={L.rows.length}>
          <FilledButton onClick={openNew}><span slot="icon"><Plus size={16} /></span>新建</FilledButton>
          <RefreshButton onClick={L.reload} busy={L.loading} />
        </PanelHead>
        {L.loading ? <Loading /> : L.rows.length === 0 ? <Empty icon="image" title="还没有 Banner" /> : L.rows.map((b) => (
          <Row key={b.id}
               leading={s(b.image_url || b.image) ? <img src={s(b.image_url || b.image)} alt="" style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 'var(--radius)', flex: 'none' }} /> : null}
               title={<><b>{s(b.title) || `#${b.id}`}</b>
                 <Badge tone={b.enabled !== false ? 'primary' : 'plain'}>{b.enabled !== false ? '启用' : '停用'}</Badge>
                 <Badge>排序 {b.sort_order ?? 0}</Badge>
                 {s(b.target_type) && s(b.target_type) !== 'none' && <Badge>跳转 {s(b.target_type)}</Badge>}</>}
               meta={<>{s(b.target_url || b.link) || (b.target_id ? `目标 #${b.target_id}` : '无跳转')}{s(b.color) ? ` - 底色 ${s(b.color)}` : ''}</>}
               actions={<>
                 <TextButton onClick={() => openEdit(b)}>编辑</TextButton>
                 <TextButton disabled={busy} onClick={async () => { if (await confirm(`删除 Banner「${s(b.title)}」？`)) L.run(() => api.deleteBanner(b.id), '已删除'); }}>
                   <Trash2 size={14} /> 删除
                 </TextButton>
               </>} />
        ))}
      </Card>

      {/* Banner 表单：字段与后端 BannerCreate 一致 */}
      <Modal open={!!edit} title={edit && edit.id ? `编辑 Banner #${edit.id}` : '新建 Banner'} onClose={() => setEdit(null)}
             onSubmit={save} width={420} busy={busy} disabled={!form.title || !form.title.trim()}>
        <OutlinedTextField label="标题（必填，≤100 字）" value={form.title || ''} onInput={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <OutlinedTextField label="图片地址" value={form.image_url || ''} onInput={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} />
        <OutlinedTextField label="轮播底色（可留空，或 #rrggbb）" value={form.color || ''}
                           onInput={(e) => setForm((f) => ({ ...f, color: e.target.value }))} supportingText="留空 = 使用站点品牌色" />
        <SelectField label="跳转类型" value={form.target_type} onChange={(v) => setForm((f) => ({ ...f, target_type: v }))}
                     options={[['none', '不跳转'], ['work', '稿件'], ['post', '帖子'], ['url', '外部链接']]} />
        {(form.target_type === 'work' || form.target_type === 'post') && (
          <OutlinedTextField label="目标 ID" type="number" value={String(form.target_id ?? '')}
                             onInput={(e) => setForm((f) => ({ ...f, target_id: e.target.value }))} />
        )}
        {form.target_type === 'url' && (
          <OutlinedTextField label="外部链接" value={form.target_url || ''} onInput={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))} />
        )}
        <OutlinedTextField label="排序（越小越靠前）" type="number" value={String(form.sort_order ?? 0)}
                           onInput={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14 }}>启用</span>
          <Switch selected={form.enabled !== false} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.selected }))} />
        </div>
      </Modal>
    </>
  );
}

/* ============================================================ 全站通知 */
export function Notify() {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const confirm = useConfirm();

  const send = async () => {
    if (!(await confirm('确认给全站用户发送这条通知？'))) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.notifyAll(content.trim());
      setMsg(`通知已发送给 ${r.data && r.data.sent != null ? r.data.sent : '全体'} 个用户`);
      setContent('');
    } catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  return (
    <>
      {err && <Note tone="error">{err}</Note>}
      {msg && <Note tone="ok">{msg}</Note>}
      <Card>
        <PanelHead icon={<Bell size={17} />} title="发送全站通知" />
        <div className="stack" style={{ gap: 12, maxWidth: 680 }}>
          <OutlinedTextField
            label="通知内容（最多 500 字）" value={content}
            onInput={(e) => setContent(e.target.value.slice(0, 500))} rows={5}
            supportingText={`${content.length} / 500`} error={content.length > 500}
          />
          <Note>
            后端只保存正文（没有标题字段），会排除管理员自己与已停用账号；发出去无法撤回。
          </Note>
          <div>
            <FilledButton onClick={send} disabled={busy || !content.trim()}>
              <span slot="icon"><Send size={16} /></span>{busy ? '发送中…' : '发送'}
            </FilledButton>
          </div>
        </div>
      </Card>
    </>
  );
}

/* ============================================================ 数据导出 */
export function Export() {
  const files = [
    ['users', '用户'], ['works', '稿件'], ['posts', '帖子'],
    ['comments', '评论'], ['reports', '举报'], ['logs', '日志'],
  ];
  return (
    <Card>
      <PanelHead icon={<Download size={17} />} title="数据导出（CSV）" />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {files.map(([name, label]) => (
          <a key={name} href={api.exportCsvUrl(name)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <OutlinedButton><span slot="icon"><Download size={16} /></span>导出{label}</OutlinedButton>
          </a>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Note>文件由服务端生成，导出范围是当前账号权限内的全量数据。</Note>
      </div>
    </Card>
  );
}
