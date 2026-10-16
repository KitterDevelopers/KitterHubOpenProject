/**
 * KitterHub Pages —— 用户静态项目托管（站长 2026-10-03）。
 *
 * 每个项目一个地址：https://pages.example.com/<slug>/
 * 上传物是 zip（根目录必须有 index.html），占用计入账号存储空间。
 *
 * 后端：backend/app/pages_sites.py
 *   GET    /api/pages/sites                 我的项目 + 占用
 *   POST   /api/pages/sites                 新建（slug 规则 + 保留字在服务端校验）
 *   POST   /api/pages/sites/{id}/deploy     上传 zip 部署（可覆盖，按净增量算配额）
 *   PATCH  /api/pages/sites/{id}            改名
 *   DELETE /api/pages/sites/{id}            删除并回收空间
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Flag, FolderPlus, Globe, History, RefreshCw, Trash2, Undo2, Upload } from 'lucide-react';
import { CircularProgress, FilledButton, OutlinedButton, OutlinedTextField, TextButton } from '../ui';
import client from '../api/client';
import { useI18n } from '../i18n';

const PAGES_DOMAIN = import.meta.env.VITE_PAGES_DOMAIN || 'pages.example.com';

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

export default function Pages() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [used, setUsed] = useState(0);
  const [sites, setSites] = useState([]);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState(0);   // 正在上传的项目 id
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(0);
  const [vers, setVers] = useState({});
  const inputs = useRef({});                        // siteId -> <input type=file>

  const load = async () => {
    try {
      const r = await client.get('/pages/sites');
      setSites(r.data.sites || []);
      setUsed(r.data.used_bytes || 0);
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.loadFail'));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const loadVersions = async (site) => {
    try {
      const r = await client.get(`/pages/sites/${site.id}/versions`);
      setVers((v) => ({ ...v, [site.id]: r.data }));
    } catch (e) { /* 忽略 */ }
  };

  const toggleHistory = async (site) => {
    const id = openId === site.id ? 0 : site.id;
    setOpenId(id);
    if (id && !vers[site.id]) await loadVersions(site);
  };

  const rollback = async (site) => {
    if (!window.confirm(t('pages.rollbackConfirm'))) return;
    setErr(''); setMsg('');
    try {
      await client.post(`/pages/sites/${site.id}/rollback`);
      setMsg(t('pages.rollbackOk'));
      await load();
      await loadVersions(site);
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.opFail'));
    }
  };

  const create = async () => {
    setErr(''); setMsg('');
    if (!slug.trim()) { setErr(t('pages.needSlug')); return; }
    setBusy(true);
    try {
      await client.post('/pages/sites', { slug: slug.trim().toLowerCase(), name: name.trim() });
      setSlug(''); setName('');
      setMsg(t('pages.created'));
      await load();
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.createFail'));
    } finally { setBusy(false); }
  };

  const upload = async (site, file) => {
    if (!file) return;
    setErr(''); setMsg('');
    setDeploying(site.id); setProgress(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await client.post(`/pages/sites/${site.id}/deploy`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => { if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100)); },
      });
      setMsg(t('pages.deployed', { url: r.data.url }));
      await load();
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.deployFail'));
    } finally { setDeploying(0); setProgress(0); }
  };

  const rename = async (site) => {
    const next = window.prompt(t('pages.renamePrompt'), site.name || site.slug);
    if (next == null) return;
    try {
      await client.patch(`/pages/sites/${site.id}`, { name: next });
      await load();
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.opFail'));
    }
  };

  const remove = async (site) => {
    if (!window.confirm(t('pages.deleteConfirm', { slug: site.slug }))) return;
    try {
      await client.delete(`/pages/sites/${site.id}`);
      setMsg(t('pages.deleted'));
      await load();
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pages.opFail'));
    }
  };

  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); setMsg(t('pages.copied')); } catch (e) { setErr(url); }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 860, margin: '0 auto' }}>
      <header className="m3-card m3-card--filled" style={{ padding: 20, marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Globe size={20} />
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800 }}>{t('pages.title')}</h1>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.85 }}>{t('pages.subtitle')}</p>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9, marginTop: 8 }}>
          {t('pages.rules')}
        </div>
        {/* 明确写清：Pages 不看等级（后端也没有任何等级校验，见 pages_sites.py） */}
        <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <span className="m3-badge m3-badge--primary">{t('pages.noLevelBadge')}</span>
          <span className="muted" style={{ fontSize: 12.5 }}>{t('pages.noLevel')}</span>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          {t('pages.usedPrefix')} <b>{fmtBytes(used)}</b>
        </div>
      </header>

      {err && <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: 12 }}>{err}</div>}
      {msg && <div className="m3-badge m3-badge--primary" style={{ display: 'block', whiteSpace: 'normal', padding: '10px 12px', borderRadius: 'var(--radius)', marginBottom: 12 }}>{msg}</div>}

      {/* 新建 */}
      <section className="m3-card m3-card--filled" style={{ padding: 20, marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <FolderPlus size={17} />
          <b>{t('pages.newTitle')}</b>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <OutlinedTextField
            label={t('pages.slugLabel')}
            value={slug}
            onInput={(e) => setSlug(e.target.value)}
            supportingText={t('pages.slugHint', { domain: PAGES_DOMAIN })}
          />
          <OutlinedTextField label={t('pages.nameLabel')} value={name} onInput={(e) => setName(e.target.value)} />
          <div>
            <FilledButton onClick={create} disabled={busy || !slug.trim()}>
              <span slot="icon"><FolderPlus size={16} /></span>
              {busy ? t('common.loading') : t('pages.create')}
            </FilledButton>
          </div>
        </div>
      </section>

      {/* 列表 */}
      {loading ? (
        <div className="row" style={{ justifyContent: 'center', padding: 24 }}><CircularProgress indeterminate /></div>
      ) : sites.length === 0 ? (
        <div className="m3-card" style={{ padding: 20, textAlign: 'center' }}>
          <div className="muted">{t('pages.empty')}</div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {sites.map((s) => (
            <section
              key={s.id}
              className="m3-card m3-card--filled"
              style={{ padding: 18 }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); upload(s, e.dataTransfer.files && e.dataTransfer.files[0]); }}
            >
              <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{s.name || s.slug}</b>
                <span className="m3-badge" style={{ fontSize: 11.5 }}>{s.slug}</span>
                {s.status !== 'published' && <span className="m3-badge m3-badge--error" style={{ fontSize: 11.5 }}>{s.status}</span>}
              </div>
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, display: 'inline-block', margin: '8px 0 4px' }}>{s.url}</a>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {t('pages.meta', { bytes: fmtBytes(s.bytes), files: s.files })}
                {s.deployed_at ? ` - ${t('pages.deployedAt')} ${String(s.deployed_at).replace('T', ' ').slice(0, 16)}` : ` - ${t('pages.notDeployed')}`}
              </div>

              {deploying === s.id && (
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{t('pages.uploading')} {progress}%</div>
              )}

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  ref={(el) => { inputs.current[s.id] = el; }}
                  type="file"
                  accept=".zip,application/zip"
                  style={{ display: 'none' }}
                  onChange={(e) => { upload(s, e.target.files && e.target.files[0]); e.target.value = ''; }}
                />
                <FilledButton onClick={() => inputs.current[s.id] && inputs.current[s.id].click()} disabled={deploying === s.id}>
                  <span slot="icon"><Upload size={16} /></span>
                  {s.files ? t('pages.redeploy') : t('pages.deploy')}
                </FilledButton>
                <OutlinedButton onClick={() => copy(s.url)}>
                  <span slot="icon"><Copy size={16} /></span>
                  {t('pages.copyLink')}
                </OutlinedButton>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <OutlinedButton>
                    <span slot="icon"><ExternalLink size={16} /></span>
                    {t('pages.open')}
                  </OutlinedButton>
                </a>
                <TextButton onClick={() => toggleHistory(s)}><History size={14} /> {t('pages.history')}</TextButton>
                <TextButton onClick={() => rename(s)}><RefreshCw size={14} /> {t('pages.rename')}</TextButton>
                <TextButton onClick={() => remove(s)}><Trash2 size={14} /> {t('pages.delete')}</TextButton>
              </div>

              {openId === s.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)' }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <History size={15} />
                    <b style={{ fontSize: 13.5 }}>{t('pages.historyTitle')}</b>
                  </div>
                  {!vers[s.id] ? (
                    <div className="muted" style={{ fontSize: 12.5 }}>{t('common.loading')}</div>
                  ) : (
                    <>
                      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                        {t('pages.deploysCount', { n: vers[s.id].deploys.length })}
                        {vers[s.id].deploys.slice(0, 5).map((d) => (
                          <div key={d.id}> - {String(d.at).replace('T', ' ').slice(0, 16)} - {fmtBytes(d.bytes)} - {d.files} {t('pages.filesUnit')}</div>
                        ))}
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <OutlinedButton onClick={() => rollback(s)} disabled={!vers[s.id].can_rollback}>
                          <span slot="icon"><Undo2 size={16} /></span>
                          {vers[s.id].can_rollback ? t('pages.rollback') : t('pages.noSnapshot')}
                        </OutlinedButton>
                        <a href="/feedback" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                          <TextButton><Flag size={14} /> {t('pages.report')}</TextButton>
                        </a>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
