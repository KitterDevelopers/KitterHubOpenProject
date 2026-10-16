/* 「同时发布到 pickCat」设置面板（发帖编辑器侧栏用）。
 *
 * 交互口径（站长 2026-10-11）：
 *   · 勾选框**默认不勾**；
 *   · 未绑定 -> 就地给出「绑定 pickCat 账号」入口（在本站域名下登录，会话只存在浏览器里）；
 *   · 会话过期（7 天）-> 明确提示重新登录，并说明 KitterHub 这边不受影响；
 *   · pickCat 挂了 -> 只说「暂时连不上」，不阻止用户在本站发帖。
 *
 * 这里**不做**任何同步动作：真正的同步发生在 KitterHub 发帖成功之后（见 PostCreate），
 * 保证「本站先成功、pickCat 失败不回滚」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Checkbox, FilledButton, OutlinedTextField, TextButton } from '../ui';
import { useI18n } from '../i18n';
import { isDevServer, listTags, login, logout, pcError } from './api';
import { clearHadSession, markHadSession, sessionState } from './sync';

export default function PickCatSyncPanel({ enabled, onEnabledChange, onTagsChange, onBound }) {
  const { t } = useI18n();
  const [state, setState] = useState(isDevServer() ? 'dev' : 'probing');
  const [user, setUser] = useState(null);
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tags, setTags] = useState([]);
  const [tagsErr, setTagsErr] = useState('');
  const [picked, setPicked] = useState([]);

  // 回调放 ref 里，避免父组件每次渲染都触发重新探测
  const tagsCb = useRef(onTagsChange);
  tagsCb.current = onTagsChange;
  const boundCb = useRef(onBound);
  boundCb.current = onBound;

  const probe = useCallback(async () => {
    if (isDevServer()) { setState('dev'); return; }
    setState('probing');
    const s = await sessionState();
    setState(s.state);
    setUser(s.user || null);
  }, []);

  useEffect(() => { probe(); }, [probe]);

  // 主题标签：公开接口，登录与否都能取（pickCat 发主题必须带至少一个 tagId）
  useEffect(() => {
    let alive = true;
    listTags()
      .then((items) => { if (alive) { setTags(items); setTagsErr(''); } })
      .catch((e) => { if (alive) setTagsErr(pcError(e).network ? 'offline' : 'fail'); });
    return () => { alive = false; };
  }, []);

  const tagsSent = useRef('');
  useEffect(() => {
    const sig = picked.join(',');
    if (tagsSent.current === sig) return;
    tagsSent.current = sig;
    if (tagsCb.current) tagsCb.current(picked);
  }, [picked]);

  const doLogin = async () => {
    setErr('');
    if (!name.trim() || !pwd) { setErr(t('pc.needBoth')); return; }
    setBusy(true);
    try {
      await login(name.trim(), pwd);
      markHadSession();
      setPwd('');
      setName('');
      const s = await sessionState();
      setState(s.state);
      setUser(s.user || null);
      if (s.state === 'bound' && boundCb.current) boundCb.current();
    } catch (e) {
      const er = pcError(e);
      if (er.status === 400 || er.status === 401) setErr(t('pc.badCreds'));
      else if (er.network) setErr(t('pc.offline'));
      else if (er.status >= 500) setErr(t('pc.srvDown'));
      else setErr(t('pc.fail'));
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true);
    try {
      await logout();
      clearHadSession();
      setState('unbound');
      setUser(null);
      if (onEnabledChange) onEnabledChange(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleTag = (id) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 本地开发服务器下不提供同步（跨站 Cookie 带不上，避免出现假失败）
  if (state === 'dev') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="post-side-label">{t('pc.title')}</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.devOnly')}</div>
      </div>
    );
  }

  const bound = state === 'bound';
  const needTag = bound && enabled && picked.length === 0;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="post-side-label">{t('pc.title')}</div>

      {state === 'probing' && (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.checking')}</div>
      )}

      {state === 'offline' && (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.offline')}</div>
      )}

      {bound && (
        <>
          <label className="pc-row">
            <Checkbox
              checked={enabled}
              onChange={(e) => {
                const el = e && e.target;
                const on = el && el.nodeName === 'MD-CHECKBOX' ? !!el.checked : !enabled;
                if (onEnabledChange) onEnabledChange(on);
              }}
              style={{ flexShrink: 0 }}
            />
            <span className="pc-row-text">
              <span style={{ fontSize: 14 }}>{t('pc.publishToo')}</span>
              <span className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{t('pc.defaultOff')}</span>
            </span>
          </label>

          <div className="muted pc-line">
            <Link2 size={13} style={{ flexShrink: 0 }} />
            <span>{t('pc.linkedAs', { name: (user && user.username) || '-' })}</span>
            <TextButton type="button" onClick={doLogout} disabled={busy} style={{ fontSize: 12 }}>
              {t('pc.relogin')}
            </TextButton>
          </div>

          {enabled && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.tagsHint')}</div>
              {tagsErr === 'offline' ? (
                <div className="muted" style={{ fontSize: 12 }}>{t('pc.offline')}</div>
              ) : tagsErr ? (
                <div className="muted" style={{ fontSize: 12 }}>{t('pc.fail')}</div>
              ) : (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {tags.map((tg) => {
                    const on = picked.includes(tg.id);
                    return (
                      <button
                        key={tg.id}
                        type="button"
                        onClick={() => toggleTag(tg.id)}
                        aria-pressed={on}
                        className={`pc-tag${on ? ' pc-tag--on' : ''}`}
                      >
                        {on && <Check size={12} />}
                        {tg.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.tagRequiredHint')}</div>
              {needTag && (
                <div className="pc-warn">
                  <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{t('pc.needTag')}</span>
                </div>
              )}
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.khSafe')}</div>
        </>
      )}

      {(state === 'unbound' || state === 'expired') && (
        <>
          {state === 'expired' && (
            <div className="pc-warn">
              <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t('pc.expired')}</span>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            {state === 'expired' ? t('pc.expiredHint') : t('pc.unboundHint')}
          </div>
          <OutlinedTextField
            label={t('pc.username')}
            value={name}
            onInput={(e) => setName(e.target.value)}
            style={{ width: '100%' }}
          />
          <OutlinedTextField
            autocomplete="current-password"
            label={t('pc.password')}
            type="password"
            value={pwd}
            onInput={(e) => setPwd(e.target.value)}
            style={{ width: '100%' }}
          />
          <div className="muted pc-line">
            <ShieldCheck size={13} style={{ flexShrink: 0 }} />
            <span style={{ lineHeight: 1.7 }}>{t('pc.pwdNote')}</span>
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--md-sys-color-error)', lineHeight: 1.7 }}>{err}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <FilledButton type="button" onClick={doLogin} disabled={busy} style={{ minHeight: 44 }}>
              <span slot="icon"><Link2 size={16} /></span>
              {busy ? t('common.loading') : (state === 'expired' ? t('pc.reloginAction') : t('pc.bind'))}
            </FilledButton>
            <TextButton type="button" onClick={probe} disabled={busy} style={{ minHeight: 44 }}>
              <RefreshCw slot="icon" size={14} /> {t('pc.recheck')}
            </TextButton>
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('pc.khSafe')}</div>
        </>
      )}
    </div>
  );
}
