import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OutlinedTextField, FilledButton, OutlinedButton, TextButton, Dialog, Checkbox } from '../ui';
import AutofillBridge from '../components/AutofillBridge';
import CodemaoLogo from '../components/CodemaoLogo';
import KitterLogo from '../components/KitterLogo';
import MsIcon from '../components/MsIcon';
import { Github } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n, ghErrorKey } from '../i18n';
import { useErr } from '../i18n/server';
import client from '../api/client';

const cardStyle = { padding: 32 };
const errStyle = { padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' };
const infoStyle = {
  ...errStyle,
  background: 'var(--md-sys-color-primary-container)',
  color: 'var(--md-sys-color-on-primary-container)',
};
// 免密码验证：校验码要显眼、可整段选中，方便复制到编程猫主页
const codeBoxStyle = {
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: 3,
  textAlign: 'center',
  padding: '14px 10px',
  borderRadius: 'var(--radius)',
  background: 'var(--md-sys-color-primary-container)',
  color: 'var(--md-sys-color-on-primary-container)',
  wordBreak: 'break-all',
  userSelect: 'all',
};
// 复制到剪贴板（非安全上下文下 navigator.clipboard 不可用时退回 execCommand）
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** MD3 分段切换：高亮块随选中项滑动，和顶栏 .m3-nav 同一套观感（样式见 global.css 的 .login-tabs）。
 *
 *  为什么不用 @material/web/labs 的 segmented button：那个组件是「选中段各自变色」，
 *  没有滑动过程，而站长要的正是顶栏那种滑动。所以几何与动画自己实现，只用 MD3 的 token。
 *  size="sm" 是小号场景（语言切换）；测量时按容器实际 padding 算偏移，两种尺寸共用一套逻辑。
 */
function SegmentedControl({ items, value, onChange, size = 'md', ariaLabel }) {
  const boxRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, visible: false });
  const shape = items.map((i) => i.id + i.label).join('|');

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const measure = () => {
      const active = box.querySelector('.login-tab.is-on');
      if (!active) return;
      const boxRect = box.getBoundingClientRect();
      const elRect = active.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(box).paddingLeft) || 0;
      setSlider({ left: elRect.left - boxRect.left - pad, width: elRect.width, visible: true });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, shape]);

  const sm = size === 'sm';
  return (
    <div ref={boxRef} className={`login-tabs${sm ? ' login-tabs--sm' : ''}`} role="tablist" aria-label={ariaLabel}>
      <span
        className="login-tabs__slider"
        style={{ transform: `translateX(${slider.left}px)`, width: slider.width, opacity: slider.visible ? 1 : 0 }}
      />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          className={`login-tab${value === it.id ? ' is-on' : ''}${sm ? ' login-tab--sm' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 顶部「语言 / Language」切换行：英文入口就在登录卡片里，第一眼能看到。 */
function LangRow() {
  const { lang, setLang } = useI18n();
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span className="muted" style={{ fontSize: 12, letterSpacing: 0.3 }}>语言 / Language</span>
      <SegmentedControl
        size="sm"
        ariaLabel="语言 / Language"
        value={lang}
        onChange={setLang}
        items={[{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]}
      />
    </div>
  );
}

export default function Login() {
  const { user, login, loginCodemao, registerEmail, sendEmailCode, githubAuthorize, githubClaim, setUser } = useAuth();
  const { t, isEn } = useI18n();
  const err = useErr();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // GitHub OAuth 回跳（GitHub 注册的回调地址是后端 /api/auth/github/callback，
  // 后端处理完带一次性票据 302 回本页 ?gh=...）
  const [ghBusy, setGhBusy] = useState(false);
  const [ghErr, setGhErr] = useState('');

  // 中文模式：编程猫优先、账号密码备选；英文模式：登录 / 邮箱注册
  const [tab, setTab] = useState(params.get('mode') === 'signup' ? 'signup' : isEn ? 'signin' : 'codemao');
  useEffect(() => {
    setTab((cur) => {
      if (isEn) return cur === 'signup' ? 'signup' : 'signin';
      // 中文有三个页签，切语言时保住当前选择（原来只认 account，会把 signup 顶掉）
      return ['codemao', 'account', 'signup'].includes(cur) ? cur : 'codemao';
    });
  }, [isEn]);

  // 页签换了 / 语言换了（文字宽度会变）/ 窗口缩放，滑块由 SegmentedControl 自己重新量

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 账号登录
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // 编程猫登录
  const [cmIdentity, setCmIdentity] = useState('');
  const [cmPassword, setCmPassword] = useState('');
  const [cmBusy, setCmBusy] = useState(false);
  const [cmErr, setCmErr] = useState('');

  // 邮箱注册
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suCode, setSuCode] = useState('');
  const [suPwd, setSuPwd] = useState('');
  const [suPwd2, setSuPwd2] = useState('');
  const [suInvite, setSuInvite] = useState('');
  // 注册必须先勾选同意《用户协议》《隐私政策》《社区发言守则》（站长 2026-10-02）
  const [suAgree, setSuAgree] = useState(false);
  const [suErr, setSuErr] = useState('');
  const [suInfo, setSuInfo] = useState('');
  const [suBusy, setSuBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // 找回密码
  const [fgOpen, setFgOpen] = useState(false);
  const [fgAccount, setFgAccount] = useState('');
  const [fgCode, setFgCode] = useState('');
  const [fgPwd, setFgPwd] = useState('');
  const [fgStep, setFgStep] = useState(0);
  const [fgBusy, setFgBusy] = useState(false);
  const [fgErr, setFgErr] = useState('');
  const [fgInfo, setFgInfo] = useState('');

  // ---- 编程猫「免密码验证」登录（不输入密码，用校验码证明账号归属）----
  const [npOpen, setNpOpen] = useState(false);
  const [npStep, setNpStep] = useState(0); // 0=填编号 1=填校验码 2=成功&提示改回签名
  const [npUid, setNpUid] = useState('');
  const [npBusy, setNpBusy] = useState(false);
  const [npErr, setNpErr] = useState('');
  const [npData, setNpData] = useState(null);
  const [npLeft, setNpLeft] = useState(0);
  const [npPrev, setNpPrev] = useState('');

  // 校验码有效期倒计时（公开字段，只有 120 秒）
  useEffect(() => {
    if (!npOpen || npStep !== 1 || npLeft <= 0) return undefined;
    const id = setTimeout(() => setNpLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [npOpen, npStep, npLeft]);

  const openNoPass = () => {
    setNpOpen(true);
    setNpStep(0);
    setNpErr('');
    setNpData(null);
    setNpPrev('');
  };

  const copySnippet = async (text) => {
    const ok = await copyText(text);
    if (!ok) setNpErr(t('auth.npFail'));
  };

  const startNoPass = async (e) => {
    e.preventDefault();
    const uid = npUid.replace(/[^0-9]/g, '');
    if (!uid) {
      setNpErr(t('auth.npNeedUid'));
      return;
    }
    setNpBusy(true);
    setNpErr('');
    try {
      const res = await client.post('/auth/codemao/code', { codemao_uid: uid });
      setNpData(res.data);
      setNpLeft(res.data.expires_in || 120);
      setNpStep(1);
    } catch (ex) {
      setNpErr(err(ex) || t('auth.npFail'));
    } finally {
      setNpBusy(false);
    }
  };

  const verifyNoPass = async () => {
    if (!npData) return;
    setNpBusy(true);
    setNpErr('');
    try {
      const res = await client.post('/auth/codemao/verify', {
        codemao_uid: npData.uid,
        session_token: npData.session_token,
      });
      localStorage.setItem('nimao_token', res.data.access_token);
      setUser(res.data.user);
      setNpPrev(res.data.prev_doing || '');
      setNpStep(2);
    } catch (ex) {
      setNpErr(err(ex) || t('auth.npFail'));
    } finally {
      setNpBusy(false);
    }
  };

  // 已经在登录态的待实名用户，直接送到验证页
  useEffect(() => {
    if (user && user.verify_state && user.verify_state !== 'ok') navigate('/verify', { replace: true });
  }, [user, navigate]);

  // GitHub 回跳：拿票据换登录态；失败则按短码显示对应的中/英文案
  useEffect(() => {
    const ticket = params.get('gh');
    const errCode = params.get('gh_error');
    if (!ticket && !errCode) return;
    // 把票据/错误码从地址栏抹掉，避免刷新时重复提交（票据本来就是一次性的）
    try { window.history.replaceState({}, '', '/login'); } catch (e) { /* 忽略 */ }
    if (errCode) {
      setGhErr(t(ghErrorKey(errCode)));
      return;
    }
    setGhBusy(true);
    setGhErr('');
    githubClaim(ticket)
      .then((d) => {
        const u = d && d.user;
        // GitHub 新注册的账号是「待激活」：送去 /verify 选一条激活路径
        // （绑定编程猫账号立即激活，或上传护照等管理员审核）
        if (u && u.verify_state && u.verify_state !== 'ok') { navigate('/verify', { replace: true }); return; }
        navigate(u && u.is_banned ? '/banned' : '/', { replace: true });
      })
      .catch((e) => setGhErr(err(e)))
      .finally(() => setGhBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGithub = async () => {
    setGhErr('');
    setGhBusy(true);
    try {
      window.location.href = await githubAuthorize('login');
    } catch (e) {
      setGhErr(err(e));
      setGhBusy(false);
    }
  };

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const submitAccount = async (e) => {
    e.preventDefault();
    if (!account.trim() || !password) {
      setError(t('auth.needAccount'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const u = await login(account, password);
      window.location.assign(u && u.is_banned ? '/banned' : '/');
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  const submitCodemao = async (e) => {
    e.preventDefault();
    setCmErr('');
    if (!cmIdentity.trim() || !cmPassword) {
      setCmErr(t('auth.needCodemao'));
      return;
    }
    setCmBusy(true);
    try {
      const u = await loginCodemao(cmIdentity, cmPassword);
      window.location.assign(u && u.is_banned ? '/banned' : '/');
    } catch (ex) {
      setCmErr(err(ex));
    } finally {
      setCmBusy(false);
    }
  };

  const requestCode = async () => {
    setSuErr('');
    setSuInfo('');
    const email = suEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSuErr(t('auth.badEmail'));
      return;
    }
    setCodeBusy(true);
    try {
      const res = await sendEmailCode(email, 'register');
      setCooldown(res && res.cooldown ? res.cooldown : 60);
      setSuInfo(t('auth.codeSent', { email }));
      if (res && res.dev_code) setSuCode(res.dev_code); // 仅联调模式（EMAIL_CODE_ECHO=1）才有
    } catch (ex) {
      setSuErr(err(ex));
    } finally {
      setCodeBusy(false);
    }
  };

  const submitSignup = async (e) => {
    e.preventDefault();
    setSuErr('');
    setSuInfo('');
    const name = suName.trim();
    const email = suEmail.trim();
    if (!name) return setSuErr(t('auth.needUsername'));
    if (!email) return setSuErr(t('auth.needEmail'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setSuErr(t('auth.badEmail'));
    if (!suCode.trim()) return setSuErr(t('auth.needCode'));
    if (!suPwd) return setSuErr(t('auth.needPassword'));
    if (suPwd.length < 6) return setSuErr(t('auth.passwordShort'));
    if (suPwd !== suPwd2) return setSuErr(t('auth.passwordMismatch'));
    if (!suAgree) return setSuErr(t('legal.agreeRequired'));

    setSuBusy(true);
    try {
      await registerEmail({ username: name, email, code: suCode.trim(), password: suPwd, inviteCode: suInvite.trim(), agree: true });
      navigate('/verify', { replace: true });
    } catch (ex) {
      setSuErr(err(ex));
    } finally {
      setSuBusy(false);
    }
    return undefined;
  };

  const sendForgot = async (e) => {
    e.preventDefault();
    setFgErr('');
    setFgBusy(true);
    try {
      const res = await client.post('/auth/forgot', { account: fgAccount.trim(), lang: isEn ? 'en' : 'zh' });
      setFgStep(1);
      setFgInfo(t('auth.codeSent', { email: (res.data && res.data.email) || fgAccount.trim() }));
      if (res.data && res.data.dev_code) setFgCode(res.data.dev_code);
    } catch (ex) {
      setFgErr(err(ex));
    } finally {
      setFgBusy(false);
    }
  };

  const doReset = async (e) => {
    e.preventDefault();
    setFgErr('');
    setFgBusy(true);
    try {
      await client.post('/auth/reset_password', { account: fgAccount.trim(), code: fgCode.trim(), password: fgPwd });
      setFgOpen(false);
      setFgStep(0);
      setFgAccount('');
      setFgCode('');
      setFgPwd('');
      setFgInfo('');
      setError(t('auth.resetDone'));
    } catch (ex) {
      setFgErr(err(ex));
    } finally {
      setFgBusy(false);
    }
  };

  // 中文：编程猫登录 / 账号登录；英文：登录 / 注册
  // 中文的「注册」不占页签，而是下面和 GitHub 并排的一个按钮（站长要求），
  // 所以进到注册视图时把分段切换整条收起来。
  const tabs = isEn
    ? [
        { id: 'signin', label: t('auth.tabSignin') },
        { id: 'signup', label: t('auth.tabSignup') },
      ]
    : [
        { id: 'codemao', label: t('auth.tabCodemao') },
        { id: 'account', label: t('auth.tabAccount') },
      ];
  const showTabs = isEn || tab !== 'signup';

  const title = tab === 'signup' ? t('auth.signupTitle') : t('auth.welcomeBack');
  const subtitle = tab === 'signup' ? t('auth.signupSubtitle') : t('auth.loginSubtitle');

  const pickTab = (id) => {
    setTab(id);
    setError('');
    setSuErr('');
    setSuInfo('');
  };

  return (
    // 卡片宽度沿用最初的 420（内容区 356px）。之前试过放宽到 520 / 460，
    // 但站长最后还是让「回到调整宽度之前」——注册已经不在分段切换里占一格，
    // 两个页签在 356px 下并不挤了。手机上容器仍会自动收缩到可用宽度。
    <div className="page-pad" style={{ maxWidth: 420, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={cardStyle}>
        <LangRow />

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <KitterLogo size={72} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, textAlign: 'center' }}>{title}</h2>
        <p className="muted" style={{ margin: '6px 0 20px', textAlign: 'center' }}>{subtitle}</p>

        {/* 分段切换：高亮块随选中项滑动，和顶栏 .m3-nav 同一套观感。
            中文的「注册」不在这里——它是下面和 GitHub 并排的一个按钮，
            所以进到注册视图时这一条整体收起来。 */}
        {showTabs && (
          <div style={{ marginBottom: 20 }}>
            <SegmentedControl
              ariaLabel={t('auth.tabCodemao')}
              value={tab}
              onChange={pickTab}
              items={tabs.map((it) => ({ ...it, icon: it.id === 'codemao' ? <CodemaoLogo size={16} /> : null }))}
            />
          </div>
        )}

        {tab === 'codemao' && (
          <>
            {cmErr && <div className="m3-badge m3-badge--error" style={{ marginBottom: 16, ...errStyle }}>{cmErr}</div>}
            <form onSubmit={submitCodemao} className="stack">
              <OutlinedTextField autocomplete="username" label={t('auth.codemaoIdentity')} value={cmIdentity} onInput={(e) => setCmIdentity(e.target.value)} />
              <OutlinedTextField autocomplete="current-password" label={t('auth.codemaoPassword')} type="password" value={cmPassword} onInput={(e) => setCmPassword(e.target.value)} />
              <AutofillBridge prefix="codemao" username={cmIdentity} password={cmPassword} onUsername={setCmIdentity} onPassword={setCmPassword} />
              <div className="muted" style={{ fontSize: 12 }}>{t('auth.codemaoHint')}</div>
              <FilledButton type="submit" disabled={cmBusy || !cmIdentity.trim() || !cmPassword} style={{ width: '100%' }}>
                {cmBusy ? t('auth.verifying') : t('auth.tabCodemao')}
              </FilledButton>
            </form>
            {/* 不突出显示：给不敢在本站输入编程猫密码的用户留的另一条路 */}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <TextButton
                onClick={openNoPass}
                style={{ fontSize: 12.5, color: 'var(--md-sys-color-on-surface-variant)' }}
              >
                {t('auth.npEntry')}
              </TextButton>
            </div>
          </>
        )}

        {(tab === 'signin' || tab === 'account') && (
          <>
            {error && <div className="m3-badge m3-badge--error" style={{ marginBottom: 16, ...errStyle }}>{error}</div>}
            <form onSubmit={submitAccount} className="stack">
              <OutlinedTextField autocomplete="username" label={t('auth.account')} value={account} onInput={(e) => setAccount(e.target.value)} />
              <OutlinedTextField autocomplete="current-password" label={t('auth.password')} type="password" value={password} onInput={(e) => setPassword(e.target.value)} />
              <AutofillBridge prefix="signin" username={account} password={password} onUsername={setAccount} onPassword={setPassword} />
              <FilledButton type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? t('auth.loggingIn') : t('common.login')}
              </FilledButton>
            </form>
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <TextButton onClick={() => { setFgOpen(true); setFgStep(0); setFgErr(''); setFgInfo(''); }}>
                {t('auth.forgot')}
              </TextButton>
            </div>
            {/* 中文的注册入口就是这一行提示（站长定的：不要再放一个按钮） */}
            {!isEn && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                {t('auth.noAccount')}{' '}
                <Link to="/login?mode=signup" onClick={() => setTab('signup')} style={{ color: 'var(--md-sys-color-primary)' }}>
                  {t('auth.tabSignup')}
                </Link>
              </div>
            )}
            {isEn && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                {t('auth.haveAccount')}{' '}
                <Link to="/login?mode=signup" onClick={() => setTab('signup')} style={{ color: 'var(--md-sys-color-primary)' }}>
                  {t('auth.tabSignup')}
                </Link>
              </div>
            )}
          </>
        )}

        {tab === 'signup' && (
          <>
            {suErr && <div className="m3-badge m3-badge--error" style={{ marginBottom: 12, ...errStyle }}>{suErr}</div>}
            {suInfo && <div className="m3-badge" style={{ marginBottom: 12, ...infoStyle }}>{suInfo}</div>}
            <form onSubmit={submitSignup} className="stack">
              <OutlinedTextField autocomplete="username" label={t('auth.username')} value={suName} onInput={(e) => setSuName(e.target.value)} />
              <OutlinedTextField autocomplete="email" label={t('auth.email')} type="email" value={suEmail} onInput={(e) => setSuEmail(e.target.value)} />
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <OutlinedTextField autocomplete="one-time-code" label={t('auth.emailCode')} value={suCode} onInput={(e) => setSuCode(e.target.value)} />
                </div>
                <TextButton onClick={requestCode} disabled={codeBusy || cooldown > 0} style={{ whiteSpace: 'nowrap' }}>
                  {cooldown > 0 ? t('auth.resendIn', { s: cooldown }) : t('auth.sendCode')}
                </TextButton>
              </div>
              <OutlinedTextField autocomplete="new-password" label={t('auth.password')} type="password" value={suPwd} onInput={(e) => setSuPwd(e.target.value)} />
              <OutlinedTextField autocomplete="new-password" label={t('auth.passwordConfirm')} type="password" value={suPwd2} onInput={(e) => setSuPwd2(e.target.value)} />
              <AutofillBridge prefix="signup" username={suName} password={suPwd} onUsername={setSuName} onPassword={setSuPwd} passwordAuto="new-password" />
              <OutlinedTextField autocomplete="off" label={`${t('auth.inviteCode')} (${t('common.optional')})`} value={suInvite} onInput={(e) => setSuInvite(e.target.value)} />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('auth.signupHint')}</div>
              {/* 必须先勾选同意条款（站长 2026-10-02）。条款在新标签打开，避免丢失已填内容；
                  服务端也会校验 agree_terms，绕过前端同样无法注册。 */}
              <label className="legal-agree">
                <Checkbox checked={suAgree} onChange={(e) => setSuAgree(!!(e.target && e.target.checked))} />
                <span className="legal-agree-text">
                  {t('legal.agreeLead')}
                  <a href="/rules/terms" target="_blank" rel="noopener noreferrer">{t('legal.title.terms')}</a>
                  {t('legal.agreeAnd')}
                  <a href="/rules/privacy" target="_blank" rel="noopener noreferrer">{t('legal.title.privacy')}</a>
                  {t('legal.agreeAnd')}
                  <a href="/rules/conduct" target="_blank" rel="noopener noreferrer">{t('legal.title.conduct')}</a>
                  {t('legal.agreeTail')}
                </span>
              </label>
              <FilledButton type="submit" disabled={suBusy || !suAgree} style={{ width: '100%' }}>
                <span slot="icon"><MsIcon name="how_to_reg" size={18} /></span>
                {suBusy ? t('auth.signingUp') : t('auth.signupSubmit')}
              </FilledButton>
            </form>
            {/* 中文的注册视图没有页签，所以这里给一条回登录的提示（英文那边直接点页签就行） */}
            {!isEn && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
                {t('auth.haveAccount')}{' '}
                <Link to="/login" onClick={() => setTab('account')} style={{ color: 'var(--md-sys-color-primary)' }}>
                  {t('common.login')}
                </Link>
              </div>
            )}
          </>
        )}

        {/* GitHub 登录：中文模式也开放（2026-09-24 站长要求取消原来「仅英文模式」的限制）。
            注册的新账号是「待激活」状态，需要绑定编程猫账号或通过护照审核。 */}
        <>
          <div className="row" style={{ gap: 10, alignItems: 'center', margin: '22px 0 14px' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
            <span className="muted" style={{ fontSize: 12 }}>{t('auth.githubOr')}</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
          </div>
          <OutlinedButton onClick={startGithub} disabled={ghBusy} style={{ width: '100%' }}>
            <span slot="icon"><Github size={18} /></span>
            {ghBusy ? t('auth.githubBusy') : t('auth.githubLogin')}
          </OutlinedButton>
          <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>{t('auth.githubHint')}</div>

          {ghErr && <div className="m3-badge m3-badge--error" style={{ marginTop: 12, ...errStyle }}>{ghErr}</div>}
          {ghErr && !ghBusy && (
            // 临时性失败（GitHub 抽风 / 线路抖动）给一个一键重试：GitHub 记得授权，
            // 再点一次不会有确认页，等于无缝重来一遍。
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <TextButton onClick={startGithub}>{t('auth.githubRetry')}</TextButton>
            </div>
          )}
        </>
      </div>

      {/* 找回密码 */}
      <Dialog open={fgOpen} onClose={() => setFgOpen(false)} onCancel={() => setFgOpen(false)}>
        <div slot="headline">{t('auth.forgotTitle')}</div>
        <div slot="content">
          {fgErr && <div className="m3-badge m3-badge--error" style={{ marginBottom: 12, ...errStyle }}>{fgErr}</div>}
          {fgInfo && <div className="m3-badge" style={{ marginBottom: 12, ...infoStyle }}>{fgInfo}</div>}
          {fgStep === 0 ? (
            <form onSubmit={sendForgot} className="stack">
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>{t('auth.forgotDesc')}</div>
              <OutlinedTextField autocomplete="username" label={t('auth.account')} value={fgAccount} onInput={(e) => setFgAccount(e.target.value)} />
              <FilledButton type="submit" disabled={fgBusy}>{fgBusy ? t('common.loading') : t('auth.forgotSend')}</FilledButton>
            </form>
          ) : (
            <form onSubmit={doReset} className="stack">
              <OutlinedTextField autocomplete="one-time-code" label={t('auth.emailCode')} value={fgCode} onInput={(e) => setFgCode(e.target.value)} />
              <OutlinedTextField autocomplete="new-password" label={t('auth.forgotNewPwd')} type="password" value={fgPwd} onInput={(e) => setFgPwd(e.target.value)} />
              <FilledButton type="submit" disabled={fgBusy || !fgCode.trim() || fgPwd.length < 6}>{t('auth.forgotReset')}</FilledButton>
            </form>
          )}
        </div>
      </Dialog>

      {/* 编程猫「免密码验证」登录 */}
      <Dialog open={npOpen} onClose={() => setNpOpen(false)} onCancel={() => setNpOpen(false)}>
        <div slot="headline">{t('auth.npTitle')}</div>
        <div slot="content" style={{ minWidth: 'min(420px, 78vw)' }}>
          {npErr && <div className="m3-badge m3-badge--error" style={{ marginBottom: 12, ...errStyle }}>{npErr}</div>}

          {npStep === 0 && (
            <form onSubmit={startNoPass} className="stack">
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.75 }}>{t('auth.npIntro')}</div>
              <OutlinedTextField
                label={t('auth.npUidLabel')}
                value={npUid}
                onInput={(e) => setNpUid(e.target.value)}
              />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{t('auth.npUidHint')}</div>
              <FilledButton type="submit" disabled={npBusy || !npUid.trim()}>
                {npBusy ? t('auth.npSending') : t('auth.npSend')}
              </FilledButton>
            </form>
          )}

          {npStep === 1 && npData && (
            <div className="stack">
              <div className="muted" style={{ fontSize: 12.5 }}>{t('auth.npIsThisYou')}</div>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                {npData.avatar && (
                  <img
                    src={npData.avatar}
                    alt=""
                    style={{ width: 42, height: 42, borderRadius: 'var(--radius)', objectFit: 'cover' }}
                  />
                )}
                <b>{npData.nickname || npData.uid}</b>
              </div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                {t('auth.npYourDoing')}：
                {npData.current_doing ? `「${npData.current_doing}」` : t('auth.npEmptyDoing')}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.75, marginTop: 2 }}>{t('auth.npStep2')}</div>
              <div style={codeBoxStyle}>{npData.code}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <OutlinedButton onClick={() => copySnippet(npData.code)}>{t('auth.npCopy')}</OutlinedButton>
                <OutlinedButton onClick={() => window.open(npData.profile_url, '_blank', 'noopener')}>
                  {t('auth.npOpenProfile')}
                </OutlinedButton>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{t('auth.npLeft', { s: Math.max(npLeft, 0) })}</div>
              <FilledButton onClick={verifyNoPass} disabled={npBusy || npLeft <= 0}>
                {npBusy ? t('auth.npVerifying') : t('auth.npVerify')}
              </FilledButton>
            </div>
          )}

          {npStep === 2 && (
            <div className="stack">
              <div style={{ fontSize: 15, fontWeight: 700 }}>{t('auth.npDoneTitle')}</div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.75 }}>{t('auth.npRestoreHint')}</div>
              <div style={{ ...codeBoxStyle, fontSize: 14, fontWeight: 600, letterSpacing: 0, textAlign: 'left' }}>
                {npPrev || t('auth.npRestoreEmpty')}
              </div>
              {!!npPrev && (
                <OutlinedButton onClick={() => copySnippet(npPrev)}>{t('auth.npCopyOld')}</OutlinedButton>
              )}
              <FilledButton onClick={() => { setNpOpen(false); navigate('/'); }}>
                {t('auth.npEnter')}
              </FilledButton>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
