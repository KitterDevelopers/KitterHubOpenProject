/**
 * 设置页 - 账号设置（第一个 tab）
 *
 * 判据：**跟着账号走的东西** —— 换台电脑登录，这些设置依然在（存在服务器 / 影响登录 / 影响别人看到什么）。
 *
 * 保存语义（这是「账号设置」这一栏的重点，两种语义必须一眼能分出来）：
 * - 「个人资料」是**表单**：改完要按「保存资料」（昵称/简介这类要一起提交才合理）
 * - 其余全部**即时生效**：拨一下开关、点一下标签就立刻写服务器，并弹提示
 *
 * ---------------------------------------------------------------------------
 * 版式（站长 2026-10-11：「账号设置」这一栏跟界面设置不一样，「重构」）
 *
 * 原来是**八张卡竖着排一条长龙**，每张卡里各写各的排版：有的用 <br> 堆只读信息、
 * 有的把开关和说明分两行漂着、有的把一整张表单塞进卡片，深浅不一。
 * 现在和外观页（AppearanceTab）用**同一套设计语言**：
 *   - 8 张分组卡，卡内一串**设置行**（左「标题 + 说明」、右「控件」），行间 1px --border-soft 分隔线；
 *   - 单列（站长明确不要两列），整列 900px 居中，跟 /settings/appearance 对齐；
 *   - 宽控件（空间进度条、明细、整张表单、绑定表单）另起一行铺满；
 *   - 只读信息用 dl.kv 紧凑排布，不再用 <br> 拼一段。
 *
 * 卡片顺序（我是谁 → 我的空间 → 别人看到什么 → 怎么登录 → 密码 → 通知 → 危险）：
 *   账号概览 → 存储空间 → 个人资料 → 展示与隐私 → 登录方式与绑定 → 密码与安全 → 通知偏好 → 危险区
 *
 * ⚠️ 这次是**结构性重排**：state、setter、API 调用、弹窗与校验逻辑**一个都没改**，只重排与重画。
 *    （弹窗结构原样保留：md-dialog 里换成别的容器实测会出问题。）
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OutlinedTextField, OutlinedSelect, SelectOption, FilledButton, Dialog, TextButton, Switch, OutlinedButton } from '../../ui';
import AutofillBridge from '../../components/AutofillBridge';
import PickCatBind from '../../components/PickCatBind';
import ImageUpload from '../../components/ImageUpload';
import CodemaoLogo from '../../components/CodemaoLogo';
import MsIcon from '../../components/MsIcon';
import { UserRound, Bell, Lock, Mail, AlertTriangle, Tag, ShieldCheck, Github, IdCard, Eye, MessageCircle, Link2, Link2Off, HardDrive } from 'lucide-react';
import client from '../../api/client';
import InviteCodeCard from '../../components/InviteCodeCard';
import { useAuth } from '../../context/AuthContext';
import { useI18n, ghErrorKey } from '../../i18n';
import { useErr } from '../../i18n/server';
import { toast } from '../../components/Toast';
import { fmtChina } from '../../utils';
import { cacheNotifyPrefs } from '../../chat/notifyPrefs';

const PREF_LABELS = [
  ['like', 'settings.prefLike'],
  ['comment', 'settings.prefComment'],
  ['reply', 'settings.prefReply'],
  ['follow', 'settings.prefFollow'],
  ['mention', 'settings.prefMention'],
  ['studio', 'settings.prefStudio'],
];

// [提交给后端的取值, 文案 key] —— 取值保持中文，仅展示跟随语言
const INTERESTS = [
  ['游戏', 'settings.interestGame'],
  ['动画', 'settings.interestAnimation'],
  ['音乐', 'settings.interestMusic'],
  ['绘画', 'settings.interestArt'],
  ['故事', 'settings.interestStory'],
  ['数学', 'settings.interestMath'],
  ['科学', 'settings.interestScience'],
];

/* ---------------------------------------------------------------------------
   积木：分组卡 / 设置行 / 只读信息行 / 二级小标题 / 兴趣标签
   —— 与外观页（AppearanceTab.jsx）同名同形，两个页签看起来是一套系统
   --------------------------------------------------------------------------- */

/** 分组卡：标题（可选说明）下面是一串设置行 */
function GroupCard({ id, tone, icon: Icon, title, hint, children }) {
  return (
    <section
      id={id}
      className={`m3-card m3-card--filled acct-card${tone === 'danger' ? ' acct-card--danger' : ''}`}
    >
      <h3 className="acct-card__head">
        {Icon ? <Icon size={17} /> : null} <span>{title}</span>
      </h3>
      {hint ? <div className="muted acct-card__sub">{hint}</div> : null}
      <div className="acct-rows">{children}</div>
    </section>
  );
}

/**
 * 设置行：左「标题 + 说明」、右「控件」。
 * block=true 时控件比较宽（进度条 / 明细标签 / 整张表单 / 绑定表单），让它另起一行占满整宽。
 */
function SettingRow({ id, title, hint, block, control }) {
  return (
    <div id={id} className={`acct-row${block ? ' acct-row--block' : ''}`}>
      <div className="acct-row__text">
        {title ? <div className="acct-row__title">{title}</div> : null}
        {hint ? <div className="muted acct-row__hint">{hint}</div> : null}
      </div>
      <div className="acct-row__ctl">{control}</div>
    </div>
  );
}

/** 开关设置行 */
function SwitchSetting({ title, hint, checked, onChange }) {
  return (
    <SettingRow
      title={title}
      hint={hint}
      control={<Switch selected={checked} onChange={(e) => onChange(e.target.selected)} aria-label={title} />}
    />
  );
}

/** 只读信息行：左标签、右值（账号概览用，不再用 <br> 拼一段） */
function KVRow({ label, children }) {
  return (
    <dl className="acct-kv">
      <dt className="acct-kv__k">{label}</dt>
      <dd className="acct-kv__v">{children}</dd>
    </dl>
  );
}

/** 卡内的二级分组（通知偏好里的「聊天消息」） */
function SubHead({ title, hint }) {
  return (
    <div className="acct-sub">
      <div className="acct-sub__title">{title}</div>
      {hint ? <div className="muted acct-sub__hint">{hint}</div> : null}
    </div>
  );
}

/**
 * 行内提示条（成功 / 失败 / 中性说明）。
 * 沿用 .m3-badge 的配色令牌，只是让它铺满宽度并且能换行 —— 不另造一套颜色。
 */
function Note({ tone, children }) {
  return (
    <div className={`m3-badge acct-note${tone ? ` acct-note--${tone}` : ''}`} style={{ marginTop: 8 }}>
      {children}
    </div>
  );
}

export default function AccountTab() {
  const { user, setUser, logout, githubAuthorize, githubClaim } = useAuth();
  const { t, isEn } = useI18n();
  const localizeErr = useErr();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // 绑定 / 换绑邮箱（弹窗流程：新邮箱 → 收验证码 → 提交）
  const [emOpen, setEmOpen] = useState(false);
  const [emAddr, setEmAddr] = useState('');
  const [emCode, setEmCode] = useState('');
  const [emPwd, setEmPwd] = useState('');
  const [emErr, setEmErr] = useState('');
  const [emInfo, setEmInfo] = useState('');
  const [emBusy, setEmBusy] = useState(false);
  const [emCooldown, setEmCooldown] = useState(0);
  const [emUnbindOpen, setEmUnbindOpen] = useState(false);
  // GitHub 绑定
  const [ghBusy, setGhBusy] = useState(false);
  const [ghMsg, setGhMsg] = useState('');
  // 注销
  const [deactOpen, setDeactOpen] = useState(false);
  const [deactPwd, setDeactPwd] = useState('');
  const [deactErr, setDeactErr] = useState('');
  // 通知偏好
  const [prefs, setPrefs] = useState(null);
  // 展示与隐私（全部即时生效）
  const [interests, setInterests] = useState([]);
  const [showCover, setShowCover] = useState(false);
  const [badgeChoice, setBadgeChoice] = useState('codemao');
  const [showPersonal, setShowPersonal] = useState(true);
  const [showIpRegion, setShowIpRegion] = useState(true);
  const [ipRegion, setIpRegion] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  // 编程猫绑定
  const [cmIdentity, setCmIdentity] = useState('');
  const [cmPassword, setCmPassword] = useState('');
  const [cmBusy, setCmBusy] = useState(false);
  const [cmErr, setCmErr] = useState('');
  const [cmMsg, setCmMsg] = useState('');
  // 个人资料（表单，按「保存资料」提交）
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profileNick, setProfileNick] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [gender, setGender] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  // 账号存储空间（默认 500MB，含作品源文件与上传的图片等；剩余不足 50MB 时可申请扩容，管理员在后台审批）
  const [quota, setQuota] = useState(null);
  const [quotaNote, setQuotaNote] = useState('');
  const [quotaBusy, setQuotaBusy] = useState(false);

  const loadQuota = async () => {
    try {
      // 账号总存储（作品源文件 + 上传的图片等，默认 500MB）；旧路径 /users/me/scratch-quota 仍可访问
      const r = await client.get('/users/me/storage');
      setQuota(r.data);
    } catch {
      /* 拿不到就不显示这张卡的内容，不影响其它设置 */
    }
  };

  const applyQuota = async () => {
    setQuotaBusy(true);
    try {
      await client.post('/users/me/storage/apply', { message: quotaNote });
      setQuotaNote('');
      toast(t('settings.quotaApplied'), 'ok');
      await loadQuota();
    } catch (e) {
      toast(localizeErr(e), 'error');
    } finally {
      setQuotaBusy(false);
    }
  };

  const verifyLocked = !!(user && user.verify_state && user.verify_state !== 'ok');

  /** 即时生效：PATCH 单个/多个字段，成功弹提示。用于「展示与隐私」整栏。 */
  const autoSave = async (fields) => {
    try {
      const res = await client.patch('/users/me', fields);
      setUser(res.data);
      // 关掉「展示 IP 属地」后接口就不再返回属地值（预览跟着消失），重开立刻回来
      if (typeof res.data?.ip_region === 'string') setIpRegion(res.data.ip_region);
      toast(t('settings.savedAuto'), 'ok');
      return true;
    } catch (e) {
      toast(localizeErr(e), 'error');
      return false;
    }
  };

  const bindCodemao = async (e) => {
    e.preventDefault();
    setCmErr('');
    setCmBusy(true);
    try {
      const res = await client.post('/users/me/bind-codemao', { identity: cmIdentity, password: cmPassword });
      setUser(res.data);
      setCmIdentity(''); setCmPassword('');
      setCmMsg(t('settings.bindOk'));
    } catch (e2) {
      setCmErr(localizeErr(e2));
    } finally {
      setCmBusy(false);
    }
  };

  useEffect(() => {
    client.get('/users/me/notify_prefs').then((r) => { setPrefs(r.data); cacheNotifyPrefs(r.data); }).catch(() => {});
    client.get('/users/me/interests').then((r) => setInterests(r.data.interests || [])).catch(() => {});
    loadQuota();
    if (user) {
      setAvatarUrl(user.avatar_url || '');
      setCoverUrl(user.cover_url || '');
      setShowCover(user.show_cover === true);
      // 展示哪个徽章：编程猫（默认）/ 本站 / 不展示 —— 后端 badge_choice 为准
      setBadgeChoice(user.badge_choice || 'codemao');
      setProfileNick(user.nickname || '');
      setProfileBio(user.bio || '');
      setGender(user.gender || '');
      setShowPersonal(user.show_personal !== false);
      // IP 属地：默认展示（老数据里可能是 null，按「开」处理）
      setShowIpRegion(user.show_ip_region !== false);
      setIpRegion(user.ip_region || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changePwd = async (e) => {
    e.preventDefault();
    setMsg(''); setErr('');
    if (newPwd.length < 6) { setErr(t('settings.newPwdShort')); return; }
    if (newPwd !== confirm) { setErr(t('settings.pwdMismatch')); return; }
    if (user?.local_pwd_set && !oldPwd) { setErr(t('settings.needOldPwd')); return; }
    setBusy(true);
    try {
      await client.post('/users/me/password', { old_password: user?.local_pwd_set ? oldPwd : '', new_password: newPwd });
      setUser({ ...user, local_pwd_set: true });
      setMsg(user?.local_pwd_set ? t('settings.pwdChanged') : t('settings.pwdSet'));
      setOldPwd(''); setNewPwd(''); setConfirm('');
    } catch (e2) {
      setErr(localizeErr(e2));
    } finally {
      setBusy(false);
    }
  };

  // ---- 绑定 / 换绑邮箱 ----
  // 验证码发给「要绑定的新邮箱」；设过本站密码的账号还要验一次当前密码。
  const emailBound = !!(user?.email && !/\.(bind|invalid)$/i.test(user.email) && !user.email.endsWith('@nomail.invalid'));

  const openEmailDialog = () => {
    setEmAddr('');
    setEmCode('');
    setEmPwd('');
    setEmErr('');
    setEmInfo('');
    setEmCooldown(0);
    setEmOpen(true);
  };

  useEffect(() => {
    if (emCooldown <= 0) return undefined;
    const id = setTimeout(() => setEmCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [emCooldown]);

  const sendEmailCode = async () => {
    setEmErr('');
    setEmInfo('');
    const addr = emAddr.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      setEmErr(t('settings.emailBadFormat'));
      return;
    }
    setEmBusy(true);
    try {
      const r = await client.post('/users/me/email/send-code', { email: addr, lang: isEn ? 'en' : 'zh' });
      setEmCooldown((r.data && r.data.cooldown) || 60);
      setEmInfo(t('settings.emailCodeSent', { email: addr }));
    } catch (e2) {
      setEmErr(localizeErr(e2));
    } finally {
      setEmBusy(false);
    }
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    setEmErr('');
    setEmInfo('');
    const addr = emAddr.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return setEmErr(t('settings.emailBadFormat'));
    if (!emCode.trim()) return setEmErr(t('settings.emailNeedCode'));
    setEmBusy(true);
    try {
      const r = await client.post('/users/me/email', {
        email: addr,
        code: emCode.trim(),
        password: emPwd || undefined,
        lang: isEn ? 'en' : 'zh',
      });
      setUser(r.data);
      setEmOpen(false);
      toast(t('settings.emailChanged', { email: r.data.email }), 'ok');
    } catch (e2) {
      setEmErr(localizeErr(e2));
    } finally {
      setEmBusy(false);
    }
    return undefined;
  };

  // ---- 绑定 GitHub ----
  // 点一下先拿授权地址，然后整页跳去 GitHub；回跳到 /login?code=&state=，
  // 由登录页把 code 交给后端换取绑定（intent=bind），成功后自动回到本页。
  const bindGithub = async () => {
    setGhMsg('');
    setGhBusy(true);
    try {
      window.location.href = await githubAuthorize('bind');
    } catch (e2) {
      setGhMsg(localizeErr(e2));
      setGhBusy(false);
    }
  };

  // GitHub 绑定回跳：后端处理完带票据 302 回本页 ?gh=...，在这里换成"已绑定"状态
  useEffect(() => {
    const ticket = params.get('gh');
    const errCode = params.get('gh_error');
    if (!ticket && !errCode) return undefined;
    // 清掉 query 但**必须留在账号设置这一栏**（GitHub 绑定就在这一栏）
    try { window.history.replaceState({}, '', '/settings'); } catch (e) { /* 忽略 */ }
    if (errCode) {
      setGhMsg(t(ghErrorKey(errCode)));
      return undefined;
    }
    setGhBusy(true);
    setGhMsg('');
    githubClaim(ticket)
      .then(() => setGhMsg(t('settings.githubLinkedDone')))
      .catch((e2) => setGhMsg(localizeErr(e2)))
      .finally(() => setGhBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doUnbindEmail = async () => {
    setEmErr('');
    try {
      const r = await client.post('/users/me/email/unbind', { password: emPwd || undefined });
      setUser(r.data);
      setEmUnbindOpen(false);
      setEmPwd('');
      toast(t('settings.emailUnbound'), 'ok');
    } catch (e2) {
      setEmUnbindOpen(false);
      toast(localizeErr(e2), 'error');
    }
  };

  const logoutAll = async () => {
    if (!window.confirm(t('settings.logoutAllConfirm'))) return;
    try {
      await client.post('/users/me/logout_all');
      logout();
      navigate('/login');
    } catch (e2) {
      alert(localizeErr(e2));
    }
  };

  const doDeactivate = async () => {
    setDeactErr('');
    try {
      await client.post('/users/me/deactivate', { password: deactPwd });
      setDeactOpen(false);
      logout();
      navigate('/');
    } catch (e2) {
      setDeactErr(localizeErr(e2));
    }
  };

  const togglePref = async (k, v) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    cacheNotifyPrefs(next);   // 提示音等全局行为读的是这份缓存，改完立刻生效
    const r = await client.put('/users/me/notify_prefs', next).catch(() => null);
    if (r) { setPrefs(r.data); cacheNotifyPrefs(r.data); }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileErr('');
    setProfileBusy(true);
    try {
      const payload = { nickname: profileNick, bio: profileBio, gender: gender };
      // 图片只在重新上传/清除时才提交（空串=清除，不提交=不改）
      if (avatarUrl !== (user.avatar_url || '')) payload.avatar_url = avatarUrl || '';
      const res = await client.patch('/users/me', payload);
      setUser(res.data);
      setProfileMsg(t('settings.profileSaved'));
    } catch (e2) {
      setProfileErr(localizeErr(e2));
    } finally {
      setProfileBusy(false);
    }
  };

  // 账号安全分（基础分 + 绑定项）
  const securityScore = (() => {
    let s = 40;
    if (user.codemao_uid) s += 30;
    if (user.email) s += 30;
    return Math.min(100, s);
  })();

  /** 点一下兴趣标签就存一次（最多 3 个）—— 逻辑与原来完全一致 */
  const toggleInterest = (value) => {
    const cur = interests || [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value].slice(0, 3);
    setInterests(next);
    client.put('/users/me/interests', { interests: next })
      .then(() => toast(t('settings.savedAuto'), 'ok'))
      .catch((e2) => toast(localizeErr(e2), 'error'));
  };

  return (
    <div className="stack acct-page" style={{ gap: 14 }}>
      {/* 未成年/待验证账号的提示：原来是最上面一张 teriary 色的卡，这里保持同样的位置与语气 */}
      {verifyLocked && (
        <div className="acct-notice">
          <div className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 800 }}>
            <MsIcon name="verified_user" size={18} /> {t('lock.verifyTitle')}
          </div>
          <p style={{ margin: '8px 0 12px', fontSize: 13, lineHeight: 1.7 }}>{t('lock.verifyDesc')}</p>
          <FilledButton onClick={() => navigate('/verify')}>{t('lock.goVerify')}</FilledButton>
        </div>
      )}

      {/* ---------- 1. 账号概览（只读，放最前面当「我是谁」的总览） ---------- */}
      <GroupCard icon={IdCard} title={t('settings.overview')} hint={t('settings.overviewHint')}>
        <KVRow label={t('settings.infoAccount')}><b>{user.username}</b></KVRow>
        <KVRow label={t('settings.infoNickname')}><b>{user.display_name}</b></KVRow>
        <KVRow label={t('settings.infoEmail')}>
          <b>{emailBound ? user.email : t('settings.emailNotBound')}</b>
        </KVRow>
        <KVRow label={t('settings.kvUserId')}><b>#{user.id}</b></KVRow>
        <KVRow label={t('settings.infoCreated')}>
          <b>{fmtChina(user.created_at, { year: 'numeric', month: 'long', day: 'numeric' })}</b>
        </KVRow>
        {/* 补填邀请码（站长 2026-10-01：编程猫注册没有填邀请码的地方，注册后 24 小时内可补填一次）。
            组件只在确实还能填时渲染自己，填过 / 过期就什么都不显示，不占版面。
            它自带的是一张卡，这里给它一个内嵌样式（.acct-embed），免得卡中卡两套描边。 */}
        <div className="acct-embed"><InviteCodeCard /></div>
      </GroupCard>

      {/* ---------- 2. 存储空间（站长 2026-09-27：默认 500MB，含作品源文件与上传的图片等，
           剩余不足 50MB 时可申请扩容；旧的「只算 sb3 的 200MB Scratch 容量」已作废） ---------- */}
      <GroupCard icon={HardDrive} title={t('settings.quotaTitle')} hint={t('settings.quotaHint', { def: quota?.default_mb ?? 500, gate: quota?.apply_threshold_mb ?? 50 })}>
        {!quota ? (
          <SettingRow control={<span className="muted" style={{ fontSize: 13 }}>{t('common.loading')}</span>} />
        ) : (
          <>
            <SettingRow
              title={
                <span className="acct-quota__num">
                  <b>{quota.used_mb}</b>
                  <span className="muted"> / {quota.quota_mb} MB</span>
                </span>
              }
              hint={`${t('settings.quotaRemaining', { n: quota.remaining_mb })}${quota.is_custom ? ` · ${t('settings.quotaCustom')}` : ''}`}
              control={<span className="muted" style={{ fontSize: 12 }}>{t('settings.quotaFiles', { n: quota.files ?? 0 })}</span>}
            />
            <SettingRow
              block
              control={
                <div className="acct-bar">
                  <div
                    className="acct-bar__fill"
                    style={{
                      width: `${Math.min(100, Math.round((quota.used_mb / Math.max(1, quota.quota_mb)) * 100))}%`,
                      background: quota.remaining_mb < 0 ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)',
                    }}
                  />
                </div>
              }
            />
            {/* 分类明细：作品源文件 / 图片 / 语音 / 视频 / 其它 */}
            <SettingRow
              block
              control={
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {[
                    ['settings.quotaKindScratch', quota.scratch_mb],
                    ['settings.quotaKindImage', quota.image_mb],
                    ['settings.quotaKindVoice', quota.voice_mb],
                    ['settings.quotaKindVideo', quota.video_mb],
                    ['settings.quotaKindOther', quota.other_mb],
                  ].filter(([, mb]) => Number(mb) > 0).map(([key, mb]) => (
                    <span key={key} className="m3-badge" style={{ fontSize: 11.5 }}>
                      {t(key)} {mb}MB
                    </span>
                  ))}
                </div>
              }
            />
            {quota.pending ? (
              <Note tone="primary">
                {t('settings.quotaPending', { at: fmtChina(quota.pending.created_at, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
                {quota.pending.message ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{quota.pending.message}</div> : null}
              </Note>
            ) : (
              <SettingRow
                block
                control={
                  <div className="stack acct-form" style={{ gap: 8, width: '100%' }}>
                    <OutlinedTextField
                      label={t('settings.quotaNoteLabel')}
                      value={quotaNote}
                      onInput={(e) => setQuotaNote(e.target.value)}
                      supportingText={quota.can_apply ? '' : quota.reason}
                    />
                    <FilledButton
                      disabled={!quota.can_apply || quotaBusy}
                      onClick={applyQuota}
                      style={{ width: '100%' }}
                    >
                      {quotaBusy ? t('settings.quotaApplying') : t('settings.quotaApply')}
                    </FilledButton>
                  </div>
                }
              />
            )}
            {quota.history?.length > 0 && (
              <SettingRow
                block
                control={
                  <div className="stack" style={{ gap: 6, width: '100%' }}>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t('settings.quotaHistory')}</div>
                    {quota.history.map((h) => (
                      <div key={h.id} className="row" style={{ gap: 8, alignItems: 'center', fontSize: 12.5, flexWrap: 'wrap' }}>
                        <span className="m3-badge" style={{ background: h.status === 'approved' ? 'var(--md-sys-color-tertiary-container)' : 'var(--md-sys-color-surface-container-highest)' }}>
                          {h.status === 'approved' ? t('settings.quotaApproved') : t('settings.quotaRejected')}
                        </span>
                        <span className="muted">{fmtChina(h.created_at, { month: 'numeric', day: 'numeric' })}</span>
                        <span>
                          {h.quota_mb}MB
                          {h.status === 'approved' && h.grant_mb ? ` → ${h.grant_mb}MB` : ''}
                        </span>
                        {h.admin_note ? <span className="muted"> - {h.admin_note}</span> : null}
                      </div>
                    ))}
                  </div>
                }
              />
            )}
          </>
        )}
      </GroupCard>

      {/* ---------- 3. 个人资料（表单：改完按「保存资料」） ---------- */}
      <GroupCard icon={UserRound} title={t('settings.profile')}>
        <SettingRow
          block
          control={
            <form onSubmit={saveProfile} className="stack acct-form" style={{ width: '100%' }}>
              {profileMsg && <Note tone="primary">{profileMsg}</Note>}
              {profileErr && <Note tone="error">{profileErr}</Note>}
              <ImageUpload value={avatarUrl} onChange={setAvatarUrl} label={t('settings.uploadAvatar')} previewSize={56} />
              <div className="muted" style={{ fontSize: 12 }}>{t('settings.avatarHint')}</div>
              {/* 「用回编程猫头像」原本长在「账号安全」卡里 —— 它是资料操作，搬到这里 */}
              {user.codemao_avatar && user.codemao_avatar !== user.avatar_url && (
                <OutlinedButton
                  type="button"
                  onClick={async () => {
                    const res = await client.patch('/users/me', { avatar_url: user.codemao_avatar });
                    setUser(res.data);
                    setAvatarUrl(res.data.avatar_url || '');
                    setProfileMsg(t('settings.avatarRestored'));
                  }}
                >
                  <CodemaoLogo size={16} /> {t('settings.useCodemaoAvatar')}
                </OutlinedButton>
              )}
              <OutlinedTextField label={t('settings.nickname')} value={profileNick} onInput={(e) => setProfileNick(e.target.value)} />
              <div className="muted" style={{ fontSize: 12 }}>{t('settings.usernameLocked', { name: user.username })}</div>
              <OutlinedSelect label={t('settings.gender')} value={gender} onChange={(e) => setGender(e.target.value)} style={{ width: '100%' }}>
                <SelectOption value="" headline={t('settings.genderSecret')} />
                <SelectOption value="male" headline={t('settings.genderMale')} />
                <SelectOption value="female" headline={t('settings.genderFemale')} />
              </OutlinedSelect>
              <OutlinedTextField label={t('settings.bio')} type="textarea" rows={3} value={profileBio} onInput={(e) => setProfileBio(e.target.value)} />
              <FilledButton type="submit" disabled={profileBusy} style={{ width: '100%' }}>{profileBusy ? t('settings.saving') : t('settings.saveProfile')}</FilledButton>
            </form>
          }
        />
      </GroupCard>

      {/* ---------- 4. 展示与隐私（全部即时生效） ---------- */}
      <GroupCard icon={Eye} title={t('settings.privacy')} hint={t('settings.privacyHint')}>
        <SettingRow
          title={t('settings.uploadCover')}
          hint={t('settings.coverHint')}
          block
          control={
            <ImageUpload
              value={coverUrl}
              onChange={async (url) => {
                setCoverUrl(url);
                await autoSave({ cover_url: url || '' });
              }}
              label={t('settings.uploadCover')}
              previewSize={132}
              previewRatio={3}
              crop
            />
          }
        />
        <SwitchSetting
          title={t('settings.showCover')}
          hint={t('settings.showCoverHint')}
          checked={showCover}
          onChange={(v) => { setShowCover(v); autoSave({ show_cover: v }); }}
        />
        {/* 徽章展示：两个徽章**只能选一个**（站长 2026-09-30），默认编程猫。
            原来是两个独立开关，可以同时打开或同时关掉，展示位置也不统一。 */}
        <SettingRow
          title={t('settings.badgeChoice')}
          hint={`${t('settings.badgeChoiceHint')}${badgeChoice === 'codemao' && !user?.codemao_uid ? ` ${t('settings.badgeNeedBind')}` : ''}`}
          control={
            <OutlinedSelect
              value={badgeChoice}
              onChange={(e) => { const v = e.target.value; setBadgeChoice(v); autoSave({ badge_choice: v }); }}
              aria-label={t('settings.badgeChoice')}
              style={{ minWidth: 180 }}
            >
              <SelectOption value="codemao" headline={t('settings.badgeCodemao')} />
              <SelectOption value="site" headline={t('settings.badgeSite')} />
              <SelectOption value="none" headline={t('settings.badgeNone')} />
            </OutlinedSelect>
          }
        />
        <SwitchSetting
          title={t('settings.showPersonal')}
          hint={t('settings.showPersonalHint')}
          checked={showPersonal}
          onChange={(v) => { setShowPersonal(v); autoSave({ show_personal: v }); }}
        />
        <SwitchSetting
          title={t('settings.showIpRegion')}
          hint={`${t('settings.showIpRegionHint')}${ipRegion ? ` ${t('settings.showIpRegionNow', { region: ipRegion })}` : ''}`}
          checked={showIpRegion}
          onChange={(v) => { setShowIpRegion(v); autoSave({ show_ip_region: v }); }}
        />
        {/* 领域标签原本甩在页面最底部，其实它是资料的一部分（主页展示 + 推荐） */}
        <SettingRow
          title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><Tag size={16} /> {t('settings.interests')}</span>}
          hint={t('settings.interestsHint')}
          block
          control={
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {INTERESTS.map(([value, labelKey]) => {
                const on = (interests || []).includes(value);
                return (
                  <span
                    key={value}
                    role="button"
                    tabIndex={0}
                    className="acct-chip"
                    aria-pressed={on}
                    onClick={() => toggleInterest(value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleInterest(value); } }}
                    style={{ border: on ? '1px solid var(--md-sys-color-primary)' : '1px solid var(--border-soft)', background: on ? 'var(--md-sys-color-primary-container)' : 'transparent' }}
                  >{t(labelKey)}</span>
                );
              })}
            </div>
          }
        />
      </GroupCard>

      {/* ---------- 5. 登录方式与绑定（邮箱 / 编程猫 / GitHub / PickCat 收进同一栏） ---------- */}
      {/* 深链锚点：整卡 #bind，四个小节各自 #bind-email / #bind-codemao / #bind-github */}
      <GroupCard id="bind" icon={ShieldCheck} title={t('settings.loginMethods')} hint={t('settings.loginMethodsHint')}>
        {/* 邮箱 */}
        <SettingRow
          id="bind-email"
          title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><Mail size={16} /> {t('settings.emailSection')}</span>}
          hint={emailBound ? t('settings.emailBoundHint') : t('settings.emailUnboundHint')}
          control={
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <span
                className="m3-badge"
                style={{
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 11px',
                  background: emailBound ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
                  color: emailBound ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface-variant)',
                }}
              >
                <MsIcon name={emailBound ? 'mark_email_read' : 'mail_off'} size={13} />
                {emailBound ? user.email : t('settings.emailNotBound')}
              </span>
              <FilledButton onClick={openEmailDialog}>
                <span slot="icon"><MsIcon name={emailBound ? 'swap_horiz' : 'add_link'} size={18} /></span>
                {emailBound ? t('settings.emailChange') : t('settings.emailBind')}
              </FilledButton>
              {emailBound && (
                <OutlinedButton onClick={() => { setEmPwd(''); setEmErr(''); setEmUnbindOpen(true); }}>
                  {t('settings.emailUnbind')}
                </OutlinedButton>
              )}
            </div>
          }
        />

        {/* 编程猫 */}
        <SettingRow
          id="bind-codemao"
          title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><CodemaoLogo size={16} /> {t('settings.codemaoSection')}</span>}
          hint={user.codemao_uid
            ? `${t('settings.codemaoLinked')} UID ${user.codemao_uid}${user.codemao_nickname ? `（${user.codemao_nickname}）` : ''}`
            : t('settings.bindHint')}
          block={!user.codemao_uid}
          control={user.codemao_uid ? (
            <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
              <span className="m3-badge m3-badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Link2 size={12} /> {t('settings.bound')}
              </span>
              <OutlinedButton
                onClick={async () => {
                  if (!window.confirm(t('settings.unbindConfirm'))) return;
                  try {
                    // 安全：设过本站密码的账号解绑第三方登录要带当前密码（后端会校验）
                    const res = await client.post('/users/me/unbind-codemao', { password: user?.local_pwd_set ? oldPwd : '' });
                    setUser(res.data);
                    setCmMsg(t('settings.codemaoUnbound'));
                  } catch (e) {
                    alert(localizeErr(e));
                  }
                }}
              ><span slot="icon"><Link2Off size={18} /></span>{t('settings.unbind')}</OutlinedButton>
              {cmMsg && <Note tone="primary">{cmMsg}</Note>}
            </div>
          ) : (
            <form onSubmit={bindCodemao} className="stack acct-form" style={{ width: '100%' }}>
              <OutlinedTextField autocomplete="off" label={t('auth.codemaoIdentity')} value={cmIdentity} onInput={(e) => setCmIdentity(e.target.value)} />
              <OutlinedTextField autocomplete="off" label={t('auth.codemaoPassword')} type="password" value={cmPassword} onInput={(e) => setCmPassword(e.target.value)} />
              <div className="muted" style={{ fontSize: 11 }}>{t('settings.codemaoPwdHint')}</div>
              {cmErr && <Note tone="error">{cmErr}</Note>}
              {cmMsg && <Note tone="primary">{cmMsg}</Note>}
              <FilledButton type="submit" disabled={cmBusy || !cmIdentity.trim() || !cmPassword} style={{ width: '100%' }}>{cmBusy ? t('auth.verifying') : t('settings.bindCodemao')}</FilledButton>
            </form>
          )}
        />

        {/* GitHub */}
        <SettingRow
          id="bind-github"
          title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><Github size={16} /> {t('settings.githubSection')}</span>}
          hint={user?.github_id
            ? `${t('settings.githubLinked')}@${user.github_login || user.github_id}`
            : t('settings.githubBindHint')}
          control={
            <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
              {user?.github_id ? (
                <>
                  <span className="m3-badge m3-badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Link2 size={12} /> {t('settings.bound')}
                  </span>
                  <OutlinedButton
                    onClick={async () => {
                      if (!window.confirm(t('settings.githubUnbindConfirm'))) return;
                      try {
                        const res = await client.post('/users/me/github/unbind');
                        setUser(res.data);
                        setGhMsg(t('settings.githubUnbound'));
                      } catch (e2) { setGhMsg(localizeErr(e2)); }
                    }}
                  ><span slot="icon"><Link2Off size={18} /></span>{t('settings.unbind')}</OutlinedButton>
                </>
              ) : (
                <FilledButton onClick={bindGithub} disabled={ghBusy}>
                  <span slot="icon"><Github size={18} /></span>
                  {ghBusy ? t('auth.githubBusy') : t('settings.githubBind')}
                </FilledButton>
              )}
              {ghMsg && <Note tone="primary">{ghMsg}</Note>}
            </div>
          }
        />

        {/* PickCat（第四个绑定项，站长 2026-10-03）：与邮箱 / 编程猫 / GitHub 同属这一栏。
            绑定状态由组件自己调 /pickcat/me 取，不依赖 user.pickcat（那个字段可能没有）。
            字标本身就是 PICKCAT，所以标题只写「账号」。 */}
        <SettingRow
          title={
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <img src="/pickcat-wordmark-light.png" alt="PickCat" className="pickcat-logo pickcat-logo--light" />
              <img src="/pickcat-wordmark-dark.png" alt="PickCat" className="pickcat-logo pickcat-logo--dark" />
              <span>{t('pickcat.accountLabel')}</span>
            </span>
          }
          block
          control={<div className="acct-form" style={{ width: '100%' }}><PickCatBind user={user} onUser={setUser} /></div>}
        />
      </GroupCard>

      {/* ---------- 6. 密码与安全 ---------- */}
      <GroupCard icon={Lock} title={t('settings.groupPassword')}>
        <SettingRow
          title={user?.local_pwd_set
            ? t('settings.changePwdRow')
            : <span className="row" style={{ gap: 6, alignItems: 'center' }}><Lock size={16} /> {t('settings.setPwd')}</span>}
          hint={!user?.local_pwd_set ? undefined : t('settings.changePwdRowHint')}
          block
          control={
            <div className="stack acct-form" style={{ gap: 10, width: '100%' }}>
              {!user?.local_pwd_set && (
                <div className="acct-note acct-note--info" style={{ marginTop: 0 }}>
                  {t('settings.setPwdHint')}
                </div>
              )}
              {msg && <Note tone="primary">{msg}</Note>}
              {err && <Note tone="error">{err}</Note>}
              <form onSubmit={changePwd} className="stack acct-form" style={{ gap: 14 }}>
                {user?.local_pwd_set && (
                  <OutlinedTextField autocomplete="current-password" label={t('settings.currentPwd')} type="password" value={oldPwd} onInput={(e) => setOldPwd(e.target.value)} />
                )}
                <OutlinedTextField autocomplete="new-password" label={t('settings.newPwd')} type="password" value={newPwd} onInput={(e) => setNewPwd(e.target.value)} />
                <OutlinedTextField autocomplete="new-password" label={t('settings.confirmPwd')} type="password" value={confirm} onInput={(e) => setConfirm(e.target.value)} />
                <AutofillBridge prefix="settings-pwd" password={oldPwd} onPassword={setOldPwd} usernameAuto="off" />
                <FilledButton type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? t('settings.submitting') : (user?.local_pwd_set ? t('settings.changePwd') : t('settings.setPwdBtn'))}</FilledButton>
              </form>
              <div className="muted" style={{ fontSize: 12 }}>{t('settings.forgotHint')}</div>
            </div>
          }
        />

        {/* 安全分：绑定项越多分越高（算法与原来一致：基础 40 + 编程猫 30 + 邮箱 30） */}
        <SettingRow
          title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><ShieldCheck size={16} /> {t('settings.security')}</span>}
          hint={t('settings.securityHint')}
          block
          control={
            <div className="row acct-sec" style={{ gap: 12, alignItems: 'center', width: '100%' }}>
              <div
                className="acct-sec__score"
                style={{ background: securityScore >= 80 ? 'var(--md-sys-color-secondary-container)' : 'var(--md-sys-color-surface-container-high)' }}
              >
                <b style={{ fontSize: 18, color: securityScore >= 80 ? 'var(--md-sys-color-on-secondary-container)' : 'var(--md-sys-color-on-surface-variant)' }}>{securityScore}</b>
                <span className="muted" style={{ fontSize: 10 }}>{t('settings.securityScore')}</span>
              </div>
              <div className="row acct-sec__badges" style={{ gap: 6, flexWrap: 'wrap', flex: 1 }}>
                <span className="m3-badge" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MsIcon name={emailBound ? 'check_circle' : 'warning'} size={12} /> {t('settings.emailLabel')} {emailBound ? t('settings.bound') : t('settings.notBound')}
                </span>
                <span className="m3-badge" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {user.codemao_uid
                    ? <><MsIcon name="check_circle" size={12} /> {t('settings.codemaoBound')}</>
                    : <><MsIcon name="warning" size={12} /> {t('settings.codemaoSuggest')}</>}
                </span>
              </div>
              <OutlinedButton onClick={logoutAll}>{t('settings.logoutAll')}</OutlinedButton>
            </div>
          }
        />
      </GroupCard>

      {/* ---------- 7. 通知偏好（跟着账号走，所以留在账号设置） ---------- */}
      <GroupCard icon={Bell} title={t('settings.notifyPrefs')}>
        {!prefs ? (
          <SettingRow control={<span className="muted">{t('common.loading')}</span>} />
        ) : (
          <>
            {PREF_LABELS.map(([k, labelKey]) => (
              <SwitchSetting
                key={k}
                title={t(labelKey)}
                checked={prefs[k] !== false}
                onChange={(v) => togglePref(k, v)}
              />
            ))}

            {/* 聊天消息：默认开启，群聊与私聊分开控制。
                私聊 = 有人给你发私聊时在通知中心留一条（同一会话 10 分钟内合并成一条）；
                群聊 = 群里有人 @你 / @所有人 时通知你。关掉只是不提醒，消息与未读数都照旧。 */}
            <SubHead title={<span className="row" style={{ gap: 6, alignItems: 'center' }}><MessageCircle size={15} /> {t('settings.chatMsg')}</span>} />
            <SwitchSetting
              title={t('settings.chatDm')}
              hint={t('settings.chatDmHint')}
              checked={prefs.chat_dm !== false}
              onChange={(v) => togglePref('chat_dm', v)}
            />
            <SwitchSetting
              title={t('settings.chatGroup')}
              hint={t('settings.chatGroupHint')}
              checked={prefs.chat_group !== false}
              onChange={(v) => togglePref('chat_group', v)}
            />
            <SwitchSetting
              title={t('settings.chatSound')}
              hint={t('settings.chatSoundHint')}
              checked={prefs.chat_sound !== false}
              onChange={(v) => togglePref('chat_sound', v)}
            />
            <div className="muted acct-note-line">{t('settings.chatMsgDefaultOn')}</div>

            {/* 夜间免打扰：开关 + 起止时间（关着时不显示时间下拉）。
                这里不再单独写二级小标题 —— 开关行的标题就是「夜间免打扰」，写两遍等于重复。 */}
            <SwitchSetting
              title={t('settings.quiet')}
              hint={t('settings.quietHint')}
              checked={!!prefs.quiet?.on}
              onChange={(v) => {
                const q = prefs.quiet || { start: 22, end: 8 };
                setPrefs({ ...prefs, quiet: { ...q, on: v } });
                client.put('/users/me/notify_prefs', { ...prefs, quiet: { ...q, on: v } }).then((r) => setPrefs(r.data)).catch(() => {});
              }}
            />
            {prefs.quiet?.on && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <OutlinedSelect
                  label={t('settings.quietStart')}
                  value={String(prefs.quiet.start ?? 22)}
                  onChange={(e) => {
                    const q = { ...(prefs.quiet || {}), start: Number(e.target.value) };
                    setPrefs({ ...prefs, quiet: q });
                    client.put('/users/me/notify_prefs', { ...prefs, quiet: q }).then((r) => setPrefs(r.data)).catch(() => {});
                  }}
                  style={{ flex: 1, minWidth: 110 }}
                >
                  {[20, 21, 22, 23, 0].map((h) => <SelectOption key={h} value={String(h)} headline={t('settings.hour', { h })} />)}
                </OutlinedSelect>
                <OutlinedSelect
                  label={t('settings.quietEnd')}
                  value={String(prefs.quiet.end ?? 8)}
                  onChange={(e) => {
                    const q = { ...(prefs.quiet || {}), end: Number(e.target.value) };
                    setPrefs({ ...prefs, quiet: q });
                    client.put('/users/me/notify_prefs', { ...prefs, quiet: q }).then((r) => setPrefs(r.data)).catch(() => {});
                  }}
                  style={{ flex: 1, minWidth: 110 }}
                >
                  {[6, 7, 8, 9, 10].map((h) => <SelectOption key={h} value={String(h)} headline={t('settings.hour', { h })} />)}
                </OutlinedSelect>
              </div>
            )}
          </>
        )}
      </GroupCard>

      {/* ---------- 8. 危险区 ---------- */}
      <GroupCard tone="danger" icon={AlertTriangle} title={t('settings.dangerZone')}>
        <SettingRow
          title={t('settings.deactivate')}
          hint={t('settings.deactivateRowHint')}
          control={
            <FilledButton onClick={() => setDeactOpen(true)} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('settings.deactivate')}</FilledButton>
          }
        />
      </GroupCard>

      {/* ================= 弹窗（结构、state、校验一字未改） ================= */}

      {/* 绑定 / 换绑邮箱 */}
      <Dialog open={emOpen} onClose={() => setEmOpen(false)} onCancel={() => setEmOpen(false)}>
        <div slot="headline">{emailBound ? t('settings.emailChange') : t('settings.emailBind')}</div>
        <div slot="content" style={{ minWidth: 300 }}>
          <form onSubmit={submitEmail} className="stack">
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>{t('settings.emailDialogHint')}</div>
            <OutlinedTextField autocomplete="email" label={t('settings.emailNew')} type="email" value={emAddr} onInput={(e) => setEmAddr(e.target.value)} />
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <OutlinedTextField autocomplete="one-time-code" label={t('auth.emailCode')} value={emCode} onInput={(e) => setEmCode(e.target.value)} />
              <AutofillBridge prefix="settings-email" username={emAddr} password={emPwd} onUsername={setEmAddr} onPassword={setEmPwd} usernameAuto="email" />
              </div>
              <TextButton onClick={sendEmailCode} disabled={emBusy || emCooldown > 0} style={{ whiteSpace: 'nowrap' }}>
                {emCooldown > 0 ? t('auth.resendIn', { s: emCooldown }) : t('auth.sendCode')}
              </TextButton>
            </div>
            {user?.local_pwd_set ? (
              <OutlinedTextField autocomplete="current-password" label={t('settings.emailCurrentPwd')} type="password" value={emPwd} onInput={(e) => setEmPwd(e.target.value)} />
            ) : null}
            {emErr && <div className="m3-badge m3-badge--error" style={{ padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>{emErr}</div>}
            {emInfo && <div className="m3-badge" style={{ padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)' }}>{emInfo}</div>}
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <TextButton onClick={() => setEmOpen(false)}>{t('common.cancel')}</TextButton>
              <FilledButton type="submit" disabled={emBusy || !emAddr.trim() || !emCode.trim()}>
                {emBusy ? t('common.loading') : t('common.confirm')}
              </FilledButton>
            </div>
          </form>
        </div>
      </Dialog>

      {/* 解绑邮箱 */}
      <Dialog open={emUnbindOpen} onClose={() => setEmUnbindOpen(false)} onCancel={() => setEmUnbindOpen(false)}>
        <div slot="headline">{t('settings.emailUnbind')}</div>
        <div slot="content" style={{ minWidth: 280 }}>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>{t('settings.emailUnbindHint')}</div>
          {user?.local_pwd_set ? (
            <div style={{ marginTop: 12 }}>
              <OutlinedTextField autocomplete="current-password" label={t('settings.emailCurrentPwd')} type="password" value={emPwd} onInput={(e) => setEmPwd(e.target.value)} style={{ width: '100%' }} />
            </div>
          ) : null}
        </div>
        <div slot="actions">
          <TextButton onClick={() => setEmUnbindOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={doUnbindEmail} disabled={emBusy}><span slot="icon"><Link2Off size={18} /></span>{t('settings.emailUnbindConfirm')}</FilledButton>
        </div>
      </Dialog>

      {/* 注销 */}
      <Dialog open={deactOpen} onClose={() => setDeactOpen(false)} onCancel={() => setDeactOpen(false)}>
        <div slot="headline">{t('settings.deactivateConfirmTitle')}</div>
        <div slot="content" className="stack">
          <div className="muted" style={{ fontSize: 13 }}>{t('settings.deactivateConfirmDesc')}</div>
          {deactErr && <div className="m3-badge m3-badge--error" style={{ padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>{deactErr}</div>}
          <OutlinedTextField autocomplete="current-password" label={t('settings.deactivatePwdLabel')} type="password" value={deactPwd} onInput={(e) => setDeactPwd(e.target.value)} />
        </div>
        <div slot="actions">
          <TextButton onClick={() => setDeactOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={doDeactivate} disabled={!deactPwd} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('settings.deactivateConfirm')}</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
