import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilledButton, OutlinedButton, CircularProgress, OutlinedTextField } from '../ui';
import KitterLogo from '../components/KitterLogo';
import MsIcon from '../components/MsIcon';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import client from '../api/client';

// 护照图片大小上限：和后端 config.PASSPORT_MAX_SIZE 保持一致（8MB）。
// 前端先拦一道，别让用户白等一次上传再收到 413 / 「图片太大」。
const PASSPORT_MAX_MB = 8;
const PASSPORT_MAX_BYTES = PASSPORT_MAX_MB * 1024 * 1024;

const STATE_KEY = {
  awaiting_passport: 'verify.stateAwait',
  pending_review: 'verify.statePending',
  rejected: 'verify.stateRejected',
  ok: 'verify.stateOk',
};

const STATE_TONE = {
  awaiting_passport: { bg: 'var(--md-sys-color-tertiary-container)', fg: 'var(--md-sys-color-on-tertiary-container)' },
  pending_review: { bg: 'var(--md-sys-color-secondary-container)', fg: 'var(--md-sys-color-on-secondary-container)' },
  rejected: { bg: 'var(--md-sys-color-error-container)', fg: 'var(--md-sys-color-on-error-container)' },
  ok: { bg: 'var(--md-sys-color-primary-container)', fg: 'var(--md-sys-color-on-primary-container)' },
};

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export default function Verify() {
  const { user, refresh, logout } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  // 另一条激活路径：绑定编程猫账号（验证通过立即激活，不用等管理员）
  const [cmIdentity, setCmIdentity] = useState('');
  const [cmPassword, setCmPassword] = useState('');
  const [cmBusy, setCmBusy] = useState(false);
  const [cmErr, setCmErr] = useState('');

  const load = async () => {
    try {
      const res = await client.get('/verify/status');
      setStatus(res.data);
    } catch (ex) {
      setError(err(ex));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    // 超限就地报错，不发请求（手机拍的证件照经常 2~5MB，但偶尔会更大）
    if (f.size > PASSPORT_MAX_BYTES) {
      setError(t('verify.tooLarge', { mb: PASSPORT_MAX_MB }));
      setInfo('');
      e.target.value = '';
      return;
    }
    setFile(f);
    setError('');
    setInfo('');
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) {
      setError(t('verify.needFile'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await client.post('/verify/passport', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      if (preview) URL.revokeObjectURL(preview);
      setPreview('');
      setInfo(t('verify.uploaded'));
      await load();
      if (refresh) await refresh();
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  /** 绑定编程猫账号 —— 这条路是「立即激活」，不需要管理员审核 */
  const bindCodemao = async (e) => {
    e.preventDefault();
    setCmErr('');
    setCmBusy(true);
    try {
      await client.post('/users/me/bind-codemao', { identity: cmIdentity, password: cmPassword });
      setCmIdentity(''); setCmPassword('');
      setInfo(t('verify.cmActivated'));
      await load();
      if (refresh) await refresh();
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (ex) {
      setCmErr(err(ex));
    } finally {
      setCmBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
        <CircularProgress indeterminate />
      </div>
    );
  }

  const state = (status && status.state) || (user && user.verify_state) || 'awaiting_passport';
  const tone = STATE_TONE[state] || STATE_TONE.awaiting_passport;
  const canUpload = state === 'awaiting_passport' || state === 'rejected';
  const locked = state !== 'ok';
  // 还没绑编程猫时才给绑定表单（已绑定就不可能还停在这个页面了）
  const canBindCodemao = locked && !(status && status.codemao_bound);

  let desc = t('verify.awaitDesc');
  if (state === 'pending_review') desc = t('verify.pendingDesc');
  else if (state === 'rejected') desc = t('verify.rejectedDesc');
  else if (state === 'ok') desc = t('verify.okDesc');

  return (
    <div className="page-pad" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={{ padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <KitterLogo size={56} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, textAlign: 'center' }}>{t('verify.title')}</h2>
        <p className="muted" style={{ margin: '6px 0 18px', textAlign: 'center' }}>{t('verify.subtitle')}</p>

        <div
          className="row"
          style={{
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 14px',
            borderRadius: 'var(--radius-pill)',
            background: tone.bg,
            color: tone.fg,
            fontWeight: 700,
            fontSize: 13,
            width: 'fit-content',
            margin: '0 auto 18px',
          }}
        >
          <MsIcon name={state === 'ok' ? 'verified_user' : state === 'rejected' ? 'error' : 'pending'} size={16} />
          {t(STATE_KEY[state] || 'verify.stateAwait')}
        </div>

        <p style={{ lineHeight: 1.8, margin: '0 0 14px' }}>{desc}</p>

        {state === 'rejected' && status && status.note && (
          <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 14, borderRadius: 'var(--radius)' }}>
            <b>{t('verify.rejectReason')}：</b>{status.note}
          </div>
        )}

        {state !== 'ok' && (
          <div className="m3-badge" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 16, borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container-high)' }}>
            <MsIcon name="info" size={14} /> {t('verify.lockedNotice')}
          </div>
        )}

        {error && <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 14, borderRadius: 'var(--radius)' }}>{error}</div>}
        {info && <div className="m3-badge" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginBottom: 14, borderRadius: 'var(--radius)', background: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)' }}>{info}</div>}

        {/* 激活路线①：绑定编程猫账号（立即生效，不用等审核） */}
        {canBindCodemao && (
          <div className="m3-card" style={{ padding: 16, marginBottom: 16, background: 'var(--md-sys-color-surface-container-low)' }}>
            <div className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 800, marginBottom: 6 }}>
              <MsIcon name="link" size={16} /> {t('verify.optCodemaoTitle')}
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>{t('verify.optCodemaoDesc')}</div>
            <form onSubmit={bindCodemao} className="stack">
              <OutlinedTextField autocomplete="off" label={t('auth.codemaoIdentity')} value={cmIdentity} onInput={(e) => setCmIdentity(e.target.value)} />
              <OutlinedTextField autocomplete="off" label={t('auth.codemaoPassword')} type="password" value={cmPassword} onInput={(e) => setCmPassword(e.target.value)} />
              {cmErr && <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{cmErr}</div>}
              <FilledButton type="submit" disabled={cmBusy || !cmIdentity.trim() || !cmPassword} style={{ width: '100%' }}>
                {cmBusy ? t('auth.verifying') : t('verify.cmActivate')}
              </FilledButton>
            </form>
          </div>
        )}

        {/* 两条路之间的「或」 */}
        {canBindCodemao && canUpload && (
          <div className="row" style={{ gap: 10, alignItems: 'center', margin: '0 0 14px' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
            <span className="muted" style={{ fontSize: 12 }}>{t('verify.orText')}</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
          </div>
        )}

        {canUpload && (
          <div className="stack">
            <div className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 800 }}>
              <MsIcon name="upload_file" size={16} /> {t('verify.optPassportTitle')}
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('verify.optPassportDesc')}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={pick}
              style={{ display: 'none' }}
            />
            <div
              style={{
                border: '1px dashed var(--border-dashed)',
                borderRadius: 'var(--radius)',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                background: 'var(--md-sys-color-surface-container-low)',
              }}
            >
              {preview ? (
                <img src={preview} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 'var(--radius)' }} />
              ) : (
                <MsIcon name="upload_file" size={40} />
              )}
              <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                {file ? file.name : t('verify.noFile')}
              </div>
              <OutlinedButton onClick={() => fileRef.current && fileRef.current.click()}>
                <span slot="icon"><MsIcon name="photo_camera" size={18} /></span>
                {file ? t('verify.replace') : t('verify.chooseFile')}
              </OutlinedButton>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('verify.rules')}</div>
            <FilledButton onClick={submit} disabled={busy || !file} style={{ width: '100%' }}>
              {busy ? t('verify.uploading') : t('verify.submit')}
            </FilledButton>
          </div>
        )}

        {state === 'pending_review' && (
          <div className="column" style={{ gap: 10 }}>
            {status && status.uploaded_at && (
              <div className="muted" style={{ fontSize: 12 }}>
                {t('verify.uploadedAt', { time: fmt(status.uploaded_at) })}
              </div>
            )}
            <OutlinedButton onClick={load}>
              <span slot="icon"><MsIcon name="refresh" size={18} /></span>
              {t('verify.refreshStatus')}
            </OutlinedButton>
          </div>
        )}

        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 16 }}>
          <MsIcon name="lock" size={13} /> {t('verify.privacy')}
        </div>

        <div className="row" style={{ gap: 10, marginTop: 20, justifyContent: 'center' }}>
          <FilledButton onClick={() => navigate('/')}>{t('verify.backHome')}</FilledButton>
          <OutlinedButton onClick={() => { logout(); navigate('/login'); }}>{t('common.logout')}</OutlinedButton>
        </div>
      </div>
    </div>
  );
}
