/**
 * PickCat 账号绑定（站长 2026-10-02 起；2026-10-03 定稿交互）。
 *
 * 交互与站内其它绑定一致：
 *   未绑定 -> 用户名 + 密码 + 「绑定」（密码只用于一次性验证，服务端用完即弃、不落库不写日志）
 *   已绑定 -> 「已绑定」胶囊 + 「当前绑定：昵称（UID …）」+ 一个「解绑」按钮
 *
 * 解绑：**不常驻密码框**。点「解绑」后在原位置**就地展开**「当前密码 + 取消 / 确认解绑」。
 * 不用 Dialog —— md-dialog 在这个页面里输入框显示不出来，站长实测点确认时压根没有密码框可填。
 * 没设过本站密码的账号不显示密码框，直接确认即可。
 *
 * 绑定状态由组件自己调 GET /pickcat/me 获取，不读 user.pickcat
 * （该字段在 /users/me 的返回里不一定存在，会导致"已绑定却显示未绑定"）。
 * 图标一律用 lucide 行内 SVG：站内 Material 字体是子集化的，没有 link_off 字形。
 */
import { useEffect, useState } from 'react';
import { Link2, Link2Off, ShieldCheck } from 'lucide-react';
import { FilledButton, OutlinedButton, OutlinedTextField, TextButton } from '../ui';
import client from '../api/client';
import { useI18n } from '../i18n';

export default function PickCatBind({ user }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [unbindOpen, setUnbindOpen] = useState(false);
  const [pc, setPc] = useState({ bound: false });

  const refresh = async () => {
    try {
      const r = await client.get('/pickcat/me');
      setPc(r.data || { bound: false });
    } catch (e) { /* 未登录等情形忽略 */ }
  };
  useEffect(() => { refresh(); }, []);

  const bind = async () => {
    setErr(''); setMsg('');
    if (!name.trim() || !pwd) { setErr(t('pickcat.needBoth')); return; }
    setBusy(true);
    try {
      await client.post('/pickcat/bind', { username: name.trim(), password: pwd });
      await refresh();
      setMsg(t('pickcat.bound'));
      setName(''); setPwd('');
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pickcat.fail'));
    } finally { setBusy(false); }
  };

  const unbind = async () => {
    setErr(''); setMsg('');
    setBusy(true);
    try {
      await client.post('/pickcat/unbind', { password: user?.local_pwd_set ? curPwd : '' });
      setPc({ bound: false });
      setUnbindOpen(false);
      setCurPwd('');
      setMsg(t('pickcat.unbound'));
    } catch (e) {
      setErr((e && e.response && e.response.data && e.response.data.detail) || t('pickcat.fail'));
    } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {err && <div className="m3-badge m3-badge--error" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{err}</div>}
      {msg && <div className="m3-badge m3-badge--primary" style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', borderRadius: 'var(--radius)' }}>{msg}</div>}

      {pc.bound ? (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="m3-badge m3-badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Link2 size={12} /> {t('pickcat.boundBadge')}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.8 }}>
            {t('pickcat.linkedAs')} <b>{pc.nickname || '—'}</b>{pc.uid ? `（UID ${pc.uid}）` : ''}
          </div>

          {!unbindOpen ? (
            <div>
              <OutlinedButton
                onClick={() => { setErr(''); setMsg(''); setCurPwd(''); setUnbindOpen(true); }}
                disabled={busy}
              >
                <span slot="icon"><Link2Off size={18} /></span>
                {t('settings.unbind')}
              </OutlinedButton>
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
                {t('pickcat.pwdWhich')}
              </div>
              {user?.local_pwd_set ? (
                <OutlinedTextField
                  label={t('settings.currentPwd')}
                  type="password"
                  value={curPwd}
                  onInput={(e) => setCurPwd(e.target.value)}
                />
              ) : null}
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>{t('pickcat.unbindHint')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <TextButton onClick={() => { setUnbindOpen(false); setCurPwd(''); }}>{t('pickcat.cancel')}</TextButton>
                <OutlinedButton onClick={unbind} disabled={busy}>
                  <span slot="icon"><Link2Off size={18} /></span>
                  {t('pickcat.unbindConfirm')}
                </OutlinedButton>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <OutlinedTextField label={t('pickcat.username')} value={name} onInput={(e) => setName(e.target.value)} />
          <OutlinedTextField autocomplete="current-password" label={t('pickcat.password')} type="password" value={pwd} onInput={(e) => setPwd(e.target.value)} />
          <div className="muted row" style={{ gap: 6, fontSize: 12, lineHeight: 1.7 }}>
            <ShieldCheck size={13} />
            {t('pickcat.pwdNote')}
          </div>
          <div>
            <FilledButton onClick={bind} disabled={busy}>
              <span slot="icon"><Link2 size={16} /></span>
              {busy ? t('common.loading') : t('pickcat.bind')}
            </FilledButton>
          </div>
        </>
      )}
    </div>
  );
}
