import { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Lightbulb, Send, Inbox, ImagePlus, Video, X, FileVideo, AlertCircle } from 'lucide-react';
import { OutlinedTextField, FilledButton, CircularProgress, TextButton } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import MsIcon from '../components/MsIcon';
import Lightbox from '../components/Lightbox';
import { toast } from '../components/Toast';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import { formatTime, displayName } from '../utils';

const KINDS = [
  ['bug', 'feedback.kindBug'],
  ['suggestion', 'feedback.kindSuggestion'],
  ['other', 'feedback.kindOther'],
];

const MAX_ITEMS = 6;
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_VIDEO = 30 * 1024 * 1024;

function humanSize(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export default function Feedback() {
  const { user } = useAuth();
  const { t } = useI18n();
  const localizeErr = useErr();
  const [kind, setKind] = useState('suggestion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [media, setMedia] = useState([]); // {id,type,url,name,size,progress,uploading}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const [progress, setProgress] = useState(0);

  const imgRef = useRef(null);
  const vidRef = useRef(null);
  const mediaRef = useRef([]);
  mediaRef.current = media;

  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState(null);

  const loadList = useCallback(() => {
    if (!isAdmin) return;
    client.get('/feedback').then((r) => setList(r.data || [])).catch(() => setList([]));
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) loadList();
  }, [isAdmin, loadList]);

  const uploadFiles = async (files) => {
    if (!user) {
      setErr(t('feedback.loginFirst'));
      return;
    }
    const list_ = [...(files || [])].filter((f) => f && (f.type.startsWith('image/') || f.type.startsWith('video/')));
    if (!list_.length) {
      setErr(t('feedback.onlyMedia'));
      return;
    }
    setErr('');
    let room = MAX_ITEMS - mediaRef.current.length;
    if (room <= 0) {
      setErr(t('feedback.maxItems', { n: MAX_ITEMS }));
      return;
    }
    for (const file of list_) {
      if (room <= 0) {
        setErr(t('feedback.maxItemsSkipped', { n: MAX_ITEMS }));
        break;
      }
      const isVideo = file.type.startsWith('video/');
      const limit = isVideo ? MAX_VIDEO : MAX_IMAGE;
      if (file.size > limit) {
        setErr(t('feedback.fileTooLarge', { type: isVideo ? t('feedback.video') : t('feedback.image'), name: file.name, size: humanSize(limit) }));
        continue;
      }
      room -= 1;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setMedia((prev) => [
        ...prev,
        { id, type: isVideo ? 'video' : 'image', url: '', name: file.name, size: file.size, progress: 0, uploading: true },
      ]);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await client.post(isVideo ? '/upload/video' : '/upload', fd, {
          onUploadProgress: (e) => {
            const p = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
            setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, progress: p } : m)));
          },
        });
        setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, url: res.data.url, progress: 100, uploading: false } : m)));
      } catch (e) {
        setMedia((prev) => prev.filter((m) => m.id !== id));
        setErr(t('feedback.uploadFailed', { name: file.name, error: localizeErr(e) }));
      }
    }
  };

  const removeMedia = (id) => setMedia((prev) => prev.filter((m) => m.id !== id));

  const submit = async (e) => {
    e.preventDefault();
    if (!content.trim()) {
      setErr(t('feedback.needContent'));
      return;
    }
    if (media.some((m) => m.uploading)) {
      setErr(t('feedback.uploading'));
      return;
    }
    setErr('');
    setBusy(true);
    setProgress(0);
    try {
      await client.post(
        '/feedback',
        {
          kind,
          title: title.trim(),
          content: content.trim(),
          contact: contact.trim(),
          media: media.filter((m) => m.url).map((m) => ({ type: m.type, url: m.url })),
        },
        { onUploadProgress: (ev) => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : 0) }
      );
      setOkMsg(t('feedback.thanks'));
      setTitle('');
      setContent('');
      setContact('');
      setMedia([]);
      setTimeout(() => setOkMsg(''), 5000);
      if (isAdmin) loadList();
    } catch (ex) {
      setErr(localizeErr(ex));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const toggleStatus = async (f) => {
    try {
      await client.post(`/feedback/${f.id}/close`, { status: f.status === 'done' ? 'open' : 'done' });
      loadList();
    } catch (ex) {
      toast(localizeErr(ex), 'error');
    }
  };

  const uploaded = media.filter((m) => m.url).length;

  return (
    <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 className="row" style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}>
        <Bug size={22} /> {t('feedback.pageTitle')}
      </h1>
      <p className="muted" style={{ margin: '0 0 20px', fontSize: 14 }}>
        {t('feedback.introA')}<b>{t('feedback.introBold')}</b>{t('feedback.introB')}
      </p>

      <form
        onSubmit={submit}
        className="m3-card m3-card--filled"
        style={{ padding: 20, marginBottom: 16 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(e.dataTransfer?.files);
        }}
      >
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {KINDS.map(([k, labelKey]) => (
            <span
              key={k}
              onClick={() => setKind(k)}
              style={{
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                fontWeight: kind === k ? 700 : 400,
                background: kind === k ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-high)',
                color: kind === k ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)',
              }}
            >
              {t(labelKey)}
            </span>
          ))}
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <OutlinedTextField
            label={t('feedback.titleLabel')}
            value={title}
            onInput={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={t('feedback.titlePlaceholder')}
          />
          <OutlinedTextField
            label={t('feedback.content')}
            type="textarea"
            rows={6}
            value={content}
            onInput={(e) => setContent(e.target.value)}
            placeholder={t('feedback.contentPlaceholder')}
            maxLength={5000}
          />
          <OutlinedTextField
            label={t('feedback.contact')}
            value={contact}
            onInput={(e) => setContact(e.target.value)}
            maxLength={200}
            placeholder={t('feedback.contactPlaceholder')}
          />
        </div>

        {/* ---------------- 附件 ---------------- */}
        <div className={`fb-drop${dragging ? ' dragging' : ''}`}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextButton type="button" onClick={() => imgRef.current?.click()} disabled={!user || media.length >= MAX_ITEMS}>
              <ImagePlus slot="icon" size={16} /> {t('feedback.addImage')}
            </TextButton>
            <TextButton type="button" onClick={() => vidRef.current?.click()} disabled={!user || media.length >= MAX_ITEMS}>
              <Video slot="icon" size={16} /> {t('feedback.addVideo')}
            </TextButton>
            <span className="muted" style={{ fontSize: 12 }}>
              {user
                ? t('feedback.dropHint', { n: MAX_ITEMS, m: media.length })
                : t('feedback.loginToUpload')}
            </span>
          </div>

          <input
            ref={imgRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={vidRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            multiple
            hidden
            onChange={(e) => {
              uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {media.length > 0 && (
            <div className="fb-media-grid">
              {media.map((m) => (
                <div key={m.id} className={`fb-item${m.uploading ? ' uploading' : ''}`}>
                  {m.type === 'image' ? (
                    m.url ? (
                      <img src={m.url} alt={m.name} onClick={() => setPreview(m.url)} />
                    ) : (
                      <div className="fb-item-ph"><ImagePlus size={20} /></div>
                    )
                  ) : m.url ? (
                    <video src={m.url} preload="metadata" muted playsInline onClick={(e) => e.currentTarget.play()} />
                  ) : (
                    <div className="fb-item-ph"><FileVideo size={20} /></div>
                  )}
                  {m.uploading && (
                    <div className="fb-item-progress">
                      <i style={{ width: `${m.progress}%` }} />
                      <span>{m.progress}%</span>
                    </div>
                  )}
                  <button type="button" className="fb-item-x" aria-label={t('feedback.removeMedia')} onClick={() => removeMedia(m.id)}>
                    <X size={14} />
                  </button>
                  <div className="fb-item-meta">
                    {m.type === 'video' ? t('feedback.video') : t('feedback.image')} - {humanSize(m.size)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="row" style={{ gap: 6, marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-error-container)', color: 'var(--md-sys-color-on-error-container)', fontSize: 13 }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} /> <span>{err}</span>
          </div>
        )}
        {okMsg && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-secondary-container)', color: 'var(--md-sys-color-on-secondary-container)', fontSize: 13 }}>
            {okMsg}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {user ? t('feedback.from', { name: displayName(user) }) : t('feedback.guestHint')}
          </span>
          <span className="row" style={{ gap: 10 }}>
            {busy && progress > 0 && progress < 100 && <span className="muted" style={{ fontSize: 12 }}>{t('feedback.submitting', { p: progress })}</span>}
            <FilledButton type="submit" disabled={busy || !content.trim() || media.some((m) => m.uploading)}>
              <Send slot="icon" size={16} /> {busy ? t('feedback.submittingShort') : t('feedback.submit')}
            </FilledButton>
          </span>
        </div>
        {uploaded > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('feedback.attached', { n: uploaded })}</div>}
      </form>

      {isAdmin && (
        <div>
          <h2 className="row" style={{ margin: '0 0 10px', fontWeight: 800, fontSize: 18, gap: 6, alignItems: 'center' }}>
            <Inbox size={17} /> {t('feedback.adminList', { n: list ? list.length : '…' })}
          </h2>
          {list === null ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <CircularProgress indeterminate />
            </div>
          ) : list.length === 0 ? (
            <div className="m3-card" style={{ padding: 20, textAlign: 'center', color: 'var(--md-sys-color-on-surface-variant)' }}>{t('feedback.adminEmpty')}</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {list.map((f) => (
                <div key={f.id} className="m3-card" style={{ padding: 14, opacity: f.status === 'done' ? 0.6 : 1 }}>
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    {f.user ? (
                      <UserAvatar user={f.user} size={30} />
                    ) : (
                      <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--md-sys-color-on-surface-variant)' }}>
                        <MsIcon name="shield" size={20} />
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <b style={{ fontSize: 14 }}>{f.user ? displayName(f.user) : t('feedback.guest')}</b>
                        <span className="m3-badge">{f.kind_label}</span>
                        {f.status === 'done' && <span className="m3-badge m3-badge--primary">{t('feedback.done')}</span>}
                        {f.media?.length > 0 && (
                          <span className="m3-badge">
                            <ImagePlus size={12} /> {f.media.length}
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{formatTime(f.created_at)}</span>
                      </div>
                      {f.title && <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>{f.title}</div>}
                      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 4, lineHeight: 1.6 }}>{f.content}</div>
                      {f.contact && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('feedback.contactLine', { contact: f.contact })}</div>}

                      {f.media?.length > 0 && (
                        <div className="fb-media-grid" style={{ marginTop: 10 }}>
                          {f.media.map((m, i) =>
                            m.type === 'image' ? (
                              <button key={i} type="button" className="fb-admin-img" onClick={() => setPreview(m.url)}>
                                <img src={m.url} alt={t('feedback.imageAlt')} loading="lazy" />
                              </button>
                            ) : (
                              <video key={i} className="fb-admin-video" src={m.url} controls preload="metadata" playsInline />
                            )
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 8 }}>
                        <TextButton
                          style={{ fontSize: 12, '--md-sys-color-primary': f.status === 'done' ? 'var(--md-sys-color-on-surface-variant)' : 'var(--md-sys-color-primary)' }}
                          onClick={() => toggleStatus(f)}
                        >
                          {f.status === 'done' ? t('feedback.reopen') : t('feedback.markDone')}
                        </TextButton>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isAdmin && (
        <div className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'center', color: 'var(--md-sys-color-on-surface-variant)', fontSize: 13, padding: '8px 0' }}>
          <Lightbulb size={15} /> {t('feedback.footerNote')}
        </div>
      )}

      <Lightbox src={preview} onClose={() => setPreview('')} />
    </div>
  );
}
