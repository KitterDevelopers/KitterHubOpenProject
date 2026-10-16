import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Pencil, Trash2, Gamepad2, Users, Newspaper, Ban,
  Pin, MessageCircle, Settings as SettingsIcon, UserPlus, Check, X, Link2,
} from 'lucide-react';
import {
  OutlinedTextField, OutlinedSelect, SelectOption, FilledButton, OutlinedButton,
  TextButton, Dialog, CircularProgress, Tabs, PrimaryTab, Switch, FilterChip,
} from '../ui';
import ImageUpload from '../components/ImageUpload';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import ReportButton from '../components/ReportButton';
import MsIcon from '../components/MsIcon';
import { toast } from '../components/Toast';
import { displayName, formatTime } from '../utils';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import { useCreationLocked } from '../components/CreationGate';

const CATEGORIES = ['综合', '游戏', '美术', '音乐'];
// 分类值同时用于接口提交，所以这里只把「显示文案」映射到词条
const CAT_KEYS = {
  '综合': 'studio.catGeneral',
  '游戏': 'studio.catGame',
  '美术': 'studio.catArt',
  '音乐': 'studio.catMusic',
};
const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
const WALL_PAGE = 12;

function RoleBadge({ role }) {
  const { t } = useI18n();
  if (role === 'owner') {
    return (
      <span className="m3-badge m3-badge--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <MsIcon name="workspace_premium" size={13} /> {t('studio.owner')}
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className="m3-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <MsIcon name="shield" size={13} /> {t('common.admin')}
      </span>
    );
  }
  return null;
}

function Stat({ icon, label, value, title }) {
  return (
    <div className="sd-stat" title={title || label}>
      <span className="sd-stat-value">{value}</span>
      <span className="sd-stat-label"><MsIcon name={icon} size={13} />{label}</span>
    </div>
  );
}

// 工作室详情（重构版）
export default function StudioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, setLang } = useI18n();
  const errText = useErr();
  const { locked: creationLocked } = useCreationLocked();

  const [studio, setStudio] = useState(null);
  const [works, setWorks] = useState([]);
  const [workTotal, setWorkTotal] = useState(0);
  const [workPage, setWorkPage] = useState(0);
  const [pendingWorks, setPendingWorks] = useState([]);
  const [myWorks, setMyWorks] = useState([]);
  const [tab, setTab] = useState('works');
  const [err, setErr] = useState('');
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState('');
  const [addId, setAddId] = useState('');

  // 弹窗
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyNote, setApplyNote] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [transferTarget, setTransferTarget] = useState(null);

  // 设置表单
  const [form, setForm] = useState({
    name: '', description: '', announcement: '', category: '综合',
    avatar_url: '', cover_url: '', join_mode: 'open',
    min_level: 0, multi_studio_only: false, apply_required: false,
  });
  const [formInit, setFormInit] = useState(null);

  const fillForm = (s) => {
    const v = {
      name: s.name || '',
      description: s.description || '',
      announcement: s.announcement || '',
      category: s.category || '综合',
      avatar_url: s.avatar_url || '',
      cover_url: s.cover_url || '',
      join_mode: s.join_mode || 'open',
      min_level: s.min_level ?? s.entry_rules?.min_level ?? 0,
      multi_studio_only: !!(s.multi_studio_only ?? s.entry_rules?.multi_studio_only),
      apply_required: !!(s.apply_required ?? s.entry_rules?.apply_required),
    };
    setForm(v);
    setFormInit(v);
  };

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      const s = await client.get(`/studios/${id}`).then((r) => r.data);
      setStudio(s);
      setFatal('');
      setFormInit((prev) => {
        if (prev === null) fillForm(s);
        return prev === null ? prev : prev;
      });
      const isMgr = s.can_manage || s.my_role === 'owner' || s.my_role === 'admin';
      if (isMgr) {
        client.get(`/studios/${id}/works`, { params: { status: 'pending' } })
          .then((r) => setPendingWorks(r.data || []))
          .catch(() => setPendingWorks([]));
      }
    } catch (e) {
      setFatal(errText(e));
      return;
    }
    try {
      const w = await client.get(`/studios/${id}/works`, { params: { skip: workPage * WALL_PAGE, limit: WALL_PAGE, with_total: 1 } });
      setWorks(w.data?.items || []);
      setWorkTotal(w.data?.total || 0);
    } catch {
      setWorks([]);
    }
    if (!silent) setErr('');
  }, [id, workPage]);

  useEffect(() => { load(); }, [load]);

  // 切工作室时重置
  useEffect(() => {
    setStudio(null); setFormInit(null); setTab('works'); setWorkPage(0); setFatal(''); setErr('');
  }, [id]);

  // 拉「我的稿件」用于加入作品墙
  useEffect(() => {
    if (!user) return;
    client.get(`/works/user/${user.uid}`).then((r) => setMyWorks(r.data || [])).catch(() => {});
  }, [user]);

  // 首次拿到工作室数据时填一次表单
  useEffect(() => {
    if (studio && formInit === null) fillForm(studio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio, formInit]);

  const canManage = !!studio?.can_manage || studio?.my_role === 'owner' || studio?.my_role === 'admin';
  const isOwner = !!studio?.is_owner || studio?.my_role === 'owner';
  const isMember = studio?.my_status === 'active';
  const readOnly = studio?.status !== 'active';
  const dirty = useMemo(() => formInit && JSON.stringify(form) !== JSON.stringify(formInit), [form, formInit]);

  /** 统一动作包装：busy 名 + 错误 toast + 自动重载 */
  const run = async (name, fn, { reload = true, okMsg = '' } = {}) => {
    if (busy) return;
    setBusy(name);
    setErr('');
    try {
      await fn();
      if (okMsg) toast(okMsg);
      if (reload) await load({ silent: true });
    } catch (e) {
      const m = errText(e);
      setErr(m);
      toast(m, 'error');
    } finally {
      setBusy('');
    }
  };

  // ---- 加入 / 退出 / 关注 ----
  const doJoin = (inviteCode) => run('join', async () => {
    const body = {};
    if (inviteCode) body.invite_code = inviteCode;
    if (studio.apply_required && !inviteCode) body.apply_note = applyNote.trim();
    const r = await client.post(`/studios/${id}/join`, body);
    if (r.data?.status === 'pending') toast(t('studio.applySubmitted'));
    else if (r.data?.already) toast(t('studio.alreadyIn'));
    else toast(t('studio.joinSuccess'));
  });

  const onJoinClick = () => {
    if (!user) { navigate('/login'); return; }
    if (studio.apply_required) { setApplyNote(''); setApplyOpen(true); return; }
    doJoin();
  };

  const leave = () => {
    if (!window.confirm(t('studio.leaveConfirm'))) return;
    run('leave', () => client.post(`/studios/${id}/leave`), { okMsg: t('studio.leftDone') });
  };

  // 关注做乐观更新，避免整页重拉
  const onToggleFollow = async () => {
    if (busy) return;
    setBusy('follow');
    try {
      if (studio.is_followed) await client.delete(`/studios/${id}/follow`);
      else await client.post(`/studios/${id}/follow`);
      setStudio((s) => ({ ...s, is_followed: !s.is_followed, follow_count: Math.max(0, s.follow_count + (s.is_followed ? -1 : 1)) }));
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy('');
    }
  };

  // ---- 作品墙 ----
  const addWork = (e) => {
    e.preventDefault();
    if (!addId) return;
    run('addWork', async () => {
      const r = await client.post(`/studios/${id}/works`, { work_id: Number(addId) });
      if (r.data?.status === 'pending') toast(t('studio.workSubmitted'));
      else if (r.data?.already) toast(t('studio.workAlready'));
      else toast(t('studio.workAdded'));
      setAddId('');
    });
  };

  const approveWork = (wid) => run(`aw${wid}`, () => client.post(`/studios/${id}/works/${wid}/approve`), { okMsg: t('studio.approved') });
  const pinWork = (wid) => run(`pin${wid}`, () => client.post(`/studios/${id}/works/${wid}/pin`));
  const removeWork = (wid) => {
    if (!window.confirm(t('studio.removeWorkConfirm'))) return;
    run(`rm${wid}`, () => client.delete(`/studios/${id}/works/${wid}`), { okMsg: t('studio.removed') });
  };
  const submitReject = () => {
    const wid = rejectTarget;
    setRejectTarget(null);
    run(`rw${wid}`, () => client.post(`/studios/${id}/works/${wid}/reject`, { reason: rejectReason.trim() }), { okMsg: t('studio.rejected') });
    setRejectReason('');
  };

  // ---- 成员 ----
  const approveMember = (uid, name) => run(`am${uid}`, () => client.post(`/studios/${id}/members/${uid}/approve`), { okMsg: t('studio.memberApproved', { name }) });
  const rejectMember = (uid, name) => {
    if (!window.confirm(t('studio.rejectMemberConfirm', { name }))) return;
    // 后端这条路由是 **POST** /studios/{id}/members/{uid}/reject（返回 204）。
    // 这里原来写成 client.delete，线上就是「工作室 → 驳回申请」点了报 Method Not Allowed。
    run(`rm2${uid}`, () => client.post(`/studios/${id}/members/${uid}/reject`), { okMsg: t('studio.memberRejected') });
  };
  const setRole = (uid, role) => run(`role${uid}`, () => client.post(`/studios/${id}/members/${uid}/role`, { role }), { okMsg: role === 'admin' ? t('studio.setAdmin') : t('studio.unsetAdmin') });
  const muteMember = (uid, muted) => run(`mute${uid}`, () => client.post(`/studios/${id}/members/${uid}/mute`, { muted }), { okMsg: muted ? t('studio.muted') : t('studio.unmuted') });
  const kick = (uid, name) => {
    if (!window.confirm(t('studio.kickConfirm', { name }))) return;
    run(`kick${uid}`, () => client.delete(`/studios/${id}/members/${uid}`), { okMsg: t('studio.kicked') });
  };
  const blacklist = (uid, name) => {
    if (!window.confirm(t('studio.blacklistConfirm', { name }))) return;
    run(`bl${uid}`, () => client.post(`/studios/${id}/blacklist`, { user_id: uid }), { okMsg: t('studio.blacklisted') });
  };
  const unblacklist = (uid) => run(`ubl${uid}`, () => client.delete(`/studios/${id}/blacklist/${uid}`), { okMsg: t('studio.unblacklisted') });
  const doTransfer = () => {
    const uid = transferTarget;
    setTransferTarget(null);
    run(`tr${uid}`, () => client.post(`/studios/${id}/transfer`, { member_id: uid }), { okMsg: t('studio.transferSent') });
  };
  const acceptTransfer = () => run('acceptTransfer', () => client.post(`/studios/${id}/accept_transfer`), { okMsg: t('studio.becameOwner') });
  const disband = () => {
    if (!window.confirm(t('studio.disbandConfirm1'))) return;
    if (!window.confirm(t('studio.disbandConfirm2'))) return;
    run('disband', () => client.post(`/studios/${id}/disband`)).then(() => navigate('/studios'));
  };

  // ---- 设置 ----
  const saveSettings = () => run('save', async () => {
    const payload = {
      name: form.name,
      description: form.description,
      announcement: form.announcement,
      category: form.category,
      join_mode: form.join_mode,
      entry_rules: {
        min_level: Number(form.min_level) || 0,
        multi_studio_only: form.multi_studio_only,
        apply_required: form.join_mode === 'approval' ? form.apply_required : false,
      },
    };
    // 图片只在改动时提交，避免未改却被校验
    if (form.avatar_url !== (studio.avatar_url || '')) payload.avatar_url = form.avatar_url || '';
    if (form.cover_url !== (studio.cover_url || '')) payload.cover_url = form.cover_url || '';
    await client.patch(`/studios/${id}`, payload);
    setFormInit(form);
    toast(t('studio.saved'));
  });

  const regenInvite = () => run('invite', () => client.post(`/studios/${id}/invite`), { okMsg: t('studio.inviteReset') });
  const muteAllRoom = (rid, next) => run('muteAll', () => client.post(`/studios/${id}/rooms/${rid}/${next ? 'mute_all' : 'unmute_all'}`), { okMsg: next ? t('studio.muteAllOn') : t('studio.muteAllOff') });
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(studio.invite_code);
      toast(t('studio.inviteCopied'));
    } catch {
      toast(t('studio.inviteCopyFailed'), 'error');
    }
  };

  if (fatal) {
    return (
      <div className="page-pad">
        <EmptyState msIcon="error" title={fatal} subtitle={t('studio.fatalDesc')} />
        <div className="row" style={{ justifyContent: 'center' }}>
          <FilledButton onClick={() => navigate('/studios')}>{t('studio.backToList')}</FilledButton>
        </div>
      </div>
    );
  }
  if (!studio) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><CircularProgress indeterminate /></div>;
  }

  const wallPages = Math.max(1, Math.ceil(workTotal / WALL_PAGE));
  const pendingMembers = (studio.members || []).filter((m) => m.status === 'pending');
  const activeMembers = (studio.members || []).filter((m) => m.status === 'active');
  const room = studio.rooms?.[0];
  const ruleHints = [];
  if (studio.min_level > 0) ruleHints.push(`Lv.${studio.min_level}+`);
  if (studio.multi_studio_only) ruleHints.push(t('studio.noMultiStudio'));
  if (studio.apply_required) ruleHints.push(t('studio.ruleNeedNote'));

  return (
    <div className="page-pad">
      {/* 状态横幅 */}
      {studio.status === 'frozen' && (
        <div className="sd-banner sd-banner--warn">
          <MsIcon name="warning" size={18} />
          <span>{t('studio.adminPrefix')}<b>{t('studio.frozenWord')}</b>{t('studio.frozenSuffix')}</span>
        </div>
      )}
      {studio.status === 'banned' && (
        <div className="sd-banner sd-banner--bad">
          <MsIcon name="block" size={18} />
          <span>{t('studio.adminPrefix')}<b>{t('studio.bannedWord')}</b>{t('studio.bannedSuffix')}</span>
        </div>
      )}
      {studio.pending_owner_id === user?.id && (
        <div className="sd-banner sd-banner--info">
          <MsIcon name="workspace_premium" size={18} />
          <span>{t('studio.transferInvitePre')}{studio.name}{t('studio.transferInvitePost')}</span>
          <span className="spacer" />
          {creationLocked ? (
            <TextButton onClick={() => setLang('zh')}>{t('lock.switchToChinese')}</TextButton>
          ) : (
            <FilledButton onClick={acceptTransfer} disabled={busy === 'acceptTransfer'}>
              {busy === 'acceptTransfer' ? t('studio.processing') : t('studio.acceptTransfer')}
            </FilledButton>
          )}
        </div>
      )}
      {studio.my_status === 'pending' && (
        <div className="sd-banner sd-banner--info">
          <MsIcon name="hourglass_top" size={18} />
          <span>{t('studio.pendingJoinNotice')}</span>
        </div>
      )}

      {/* 头部 */}
      <section className="m3-card m3-card--filled" style={{ marginBottom: 16, overflow: 'hidden' }}>
        {studio.cover_url && (
          <img src={studio.cover_url} alt="" style={{ width: '100%', height: 156, objectFit: 'cover', display: 'block' }} />
        )}
        <div style={{ padding: 20 }}>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {studio.avatar_url ? (
              <img src={studio.avatar_url} alt="" style={{ width: 96, height: 96, borderRadius: 'var(--avatar-radius)', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <span
                style={{
                  width: 96, height: 96, borderRadius: 'var(--avatar-radius)', flexShrink: 0,
                  background: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 800,
                }}
              >
                {studio.name.charAt(0)}
              </span>
            )}

            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{studio.name}</h1>
                <span className="m3-badge">{studio.category}</span>
                {studio.join_mode === 'approval' && <span className="m3-badge">{t('studio.needApprovalJoin')}</span>}
                {studio.my_muted && <span className="m3-badge m3-badge--error">{t('studio.youAreMuted')}</span>}
                {studio.is_full && <span className="m3-badge m3-badge--error">{t('studio.full')}</span>}
              </div>
              <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.6 }}>
                {studio.description || t('studio.noDescription')}
              </p>
              <div className="row" style={{ gap: 12, marginTop: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <span className="muted">
                  {t('studio.ownerLabel')}
                  {studio.owner ? <Link to={`/users/${studio.owner.uid}`} style={{ fontWeight: 600 }}>{displayName(studio.owner)}</Link> : '—'}
                </span>
                <span className="row muted" style={{ gap: 4, alignItems: 'center' }}>
                  <MsIcon name="calendar_today" size={14} /> {t('studio.createdAt', { time: formatTime(studio.created_at) })}
                </span>
                {user && <span className="muted">{t('studio.myStudios', { n: studio.my_studio_count, total: studio.max_studios })}</span>}
              </div>

              <div className="sd-stats">
                <Stat icon="group" label={t('studio.members')} value={`${studio.member_count}/${studio.member_limit}`} />
                <Stat icon="palette" label={t('studio.works')} value={studio.work_count} />
                <Stat icon="visibility" label={t('studio.totalViews')} value={studio.total_views} />
                <Stat icon="star" label={t('common.follow')} value={studio.follow_count} />
                {canManage && <Stat icon="hourglass_top" label={t('studio.pendingStat')} value={(studio.pending_count || 0) + (studio.pending_work_count || 0)} title={t('studio.pendingStatTitle')} />}
              </div>

              {ruleHints.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>{t('studio.joinRules')}</span>
                  {ruleHints.map((h) => <span key={h} className="m3-badge" style={{ fontSize: 12 }}>{h}</span>)}
                </div>
              )}

              {studio.member_preview?.length > 0 && (
                <div className="row" style={{ gap: -6, marginTop: 10, alignItems: 'center' }}>
                  {studio.member_preview.slice(0, 8).map((u, i) => (
                    <span key={u.id} style={{ marginLeft: i === 0 ? 0 : -8, display: 'inline-flex' }}>
                      <UserAvatar user={u} size={26} showVerify={false} />
                    </span>
                  ))}
                  {studio.member_count > 8 && <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{t('studio.moreMembers', { n: studio.member_count })}</span>}
                </div>
              )}
            </div>

            <div className="stack" style={{ gap: 8, minWidth: 190 }}>
              {creationLocked && (
                <div className="muted" style={{ fontSize: 12, textAlign: 'right', lineHeight: 1.5 }}>
                  {t('lock.creationTitle')}{' '}
                  <TextButton onClick={() => setLang('zh')} style={{ fontSize: 12, minWidth: 0 }}>{t('lock.switchToChinese')}</TextButton>
                </div>
              )}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {canManage && !creationLocked && (
                  <OutlinedButton onClick={() => setTab('settings')}>
                    <span slot="icon">{isOwner ? <Pencil size={15} /> : <SettingsIcon size={15} />}</span>
                    {isOwner ? t('common.edit') : t('studio.manage')}
                  </OutlinedButton>
                )}
                {user && (
                  <OutlinedButton onClick={onToggleFollow} disabled={busy === 'follow'}>
                    {studio.is_followed ? t('common.unfollow') : t('common.follow')}
                  </OutlinedButton>
                )}
                {isMember ? (
                  <OutlinedButton onClick={leave} disabled={busy === 'leave'}>{t('studio.leave')}</OutlinedButton>
                ) : creationLocked ? null : studio.my_status === 'pending' ? (
                  <FilledButton disabled>{t('studio.applied')}</FilledButton>
                ) : (
                  <FilledButton onClick={onJoinClick} disabled={!user || readOnly || studio.is_full || busy === 'join'}>
                    <span slot="icon"><UserPlus size={16} /></span>{t('studio.join')}
                  </FilledButton>
                )}
                {isMember && room && (
                  <FilledButton onClick={() => navigate(`/chat?thread=${room.id}`)}>
                    <span slot="icon"><MessageCircle size={16} /></span>{t('studio.enterChat')}
                  </FilledButton>
                )}
              </div>
              {canManage && !creationLocked && studio.invite_code && (
                <div className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span className="m3-badge" style={{ fontSize: 12 }}>{t('studio.inviteCode')} <b style={{ letterSpacing: 1 }}>{studio.invite_code}</b></span>
                  <TextButton onClick={copyInvite} style={{ fontSize: 12 }}><Link2 size={14} /> {t('common.copy')}</TextButton>
                </div>
              )}
              {user && !isMember && <div className="row" style={{ justifyContent: 'flex-end' }}><ReportButton targetType="studio" targetId={studio.id} /></div>}
            </div>
          </div>

          {studio.announcement && (
            <div className="sd-announce">
              <MsIcon name="campaign" size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{studio.announcement}</span>
            </div>
          )}
        </div>
      </section>

      {err && (
        <div className="m3-badge m3-badge--error" style={{ marginBottom: 14, padding: '10px 14px', display: 'block', whiteSpace: 'normal' }}>{err}</div>
      )}

      <Tabs>
        <PrimaryTab selected={tab === 'works'} onClick={() => setTab('works')}>
          <span className="row" style={{ gap: 4, alignItems: 'center' }}><Gamepad2 size={15} /> {t('studio.tabWorks', { n: workTotal })}</span>
        </PrimaryTab>
        <PrimaryTab selected={tab === 'members'} onClick={() => setTab('members')}>
          <span className="row" style={{ gap: 4, alignItems: 'center' }}>
            <Users size={15} /> {t('studio.tabMembers', { n: studio.member_count })}
            {canManage && pendingMembers.length > 0 && <span className="m3-badge m3-badge--error" style={{ fontSize: 11 }}>{pendingMembers.length}</span>}
          </span>
        </PrimaryTab>
        <PrimaryTab selected={tab === 'feed'} onClick={() => setTab('feed')}>
          <span className="row" style={{ gap: 4, alignItems: 'center' }}><Newspaper size={15} /> {t('studio.tabFeed')}</span>
        </PrimaryTab>
        {canManage && !creationLocked && (
          <PrimaryTab selected={tab === 'settings'} onClick={() => setTab('settings')}>
            <span className="row" style={{ gap: 4, alignItems: 'center' }}><SettingsIcon size={15} /> {t('common.settings')}</span>
          </PrimaryTab>
        )}
      </Tabs>

      <div style={{ marginTop: 16 }}>
        {/* ============ 作品墙 ============ */}
        {tab === 'works' && (
          <>
            {canManage && !creationLocked && pendingWorks.length > 0 && (
              <div className="m3-card" style={{ padding: 14, marginBottom: 14 }}>
                <div className="edit-side-title" style={{ marginBottom: 8 }}>
                  <MsIcon name="hourglass_top" size={16} /> {t('studio.pendingWorks', { n: pendingWorks.length })}
                </div>
                {pendingWorks.map((w) => (
                  <div key={w.id} className="sd-row">
                    {w.cover_url
                      ? <img src={w.cover_url} alt="" style={{ width: 56, height: 42, objectFit: 'cover', borderRadius: 'var(--radius)', flexShrink: 0 }} />
                      : <span className="sd-row-ph"><MsIcon name="extension" size={18} /></span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/works/${w.id}`} style={{ fontWeight: 600 }}>{w.title}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {displayName(w.author)} - {t('studio.submittedAt', { time: formatTime(w.created_at) })}
                      </div>
                    </div>
                    <FilledButton onClick={() => approveWork(w.id)} disabled={busy === `aw${w.id}`}>
                      <span slot="icon"><Check size={16} /></span>{t('studio.approve')}
                    </FilledButton>
                    <OutlinedButton onClick={() => { setRejectTarget(w.id); setRejectReason(''); }}>{t('studio.reject')}</OutlinedButton>
                  </div>
                ))}
              </div>
            )}

            {isMember && !readOnly && !creationLocked && (
              <div className="m3-card m3-card--filled" style={{ padding: 14, marginBottom: 14 }}>
                <form onSubmit={addWork} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div className="edit-side-label" style={{ marginBottom: 6 }}>{t('studio.addWorkTitle')}</div>
                    <OutlinedSelect label={t('studio.selectWork')} value={addId} onChange={(e) => setAddId(e.target.value)} style={{ width: '100%' }}>
                      <SelectOption value="" headline={t('studio.selectWorkPlaceholder')} />
                      {myWorks.map((w) => <SelectOption key={w.id} value={String(w.id)} headline={w.title} />)}
                    </OutlinedSelect>
                  </div>
                  <FilledButton type="submit" disabled={!addId || busy === 'addWork'}>
                    {busy === 'addWork' ? t('studio.submitting') : t('studio.addToWall')}
                  </FilledButton>
                </form>
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {canManage ? t('studio.adminAddHint') : t('studio.memberAddHint')}
                </div>
              </div>
            )}

            {works.length === 0 ? (
              <EmptyState msIcon="palette" title={t('studio.wallEmptyTitle')} subtitle={isMember ? t('studio.wallEmptyMine') : t('studio.wallEmptyGuest')} />
            ) : (
              <>
                <div className="grid-works">
                  {works.map((w) => (
                    <div key={w.id} style={{ position: 'relative' }}>
                      <WorkCard work={w} />
                      {canManage && !creationLocked && (
                        <div className="sd-wall-actions">
                          <TextButton onClick={() => pinWork(w.id)} disabled={busy === `pin${w.id}`} title={t('studio.pinTitle')}>
                            <Pin size={14} /> {w.is_pinned ? t('studio.unpin') : t('studio.pin')}
                          </TextButton>
                          <TextButton onClick={() => removeWork(w.id)} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>
                            {t('studio.removeWork')}
                          </TextButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {wallPages > 1 && (
                  <div className="pager">
                    <button type="button" className="pager-btn" disabled={workPage <= 0} onClick={() => setWorkPage((p) => p - 1)}>{t('studio.prevPage')}</button>
                    <span className="muted" style={{ fontSize: 13 }}>{t('studio.wallPager', { page: workPage + 1, pages: wallPages, total: workTotal })}</span>
                    <button type="button" className="pager-btn" disabled={workPage >= wallPages - 1} onClick={() => setWorkPage((p) => p + 1)}>{t('studio.nextPage')}</button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ============ 成员 ============ */}
        {tab === 'members' && (
          <>
            {canManage && !creationLocked && pendingMembers.length > 0 && (
              <div className="m3-card" style={{ padding: 14, marginBottom: 14 }}>
                <div className="edit-side-title" style={{ marginBottom: 8 }}>
                  <MsIcon name="person_add" size={16} /> {t('studio.pendingMembers', { n: pendingMembers.length })}
                </div>
                {pendingMembers.map((m) => (
                  <div key={m.id} className="sd-row">
                    <UserAvatar user={m.user} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link to={`/users/${m.user.uid}`} style={{ fontWeight: 700 }}>{displayName(m.user)}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{t('studio.appliedAt', { time: formatTime(m.joined_at) })}</div>
                      {m.apply_note && (
                        <div className="sd-quote">{m.apply_note}</div>
                      )}
                    </div>
                    <FilledButton onClick={() => approveMember(m.user.id, displayName(m.user))} disabled={busy === `am${m.user.id}`}>
                      <span slot="icon"><Check size={16} /></span>{t('studio.approve')}
                    </FilledButton>
                    <OutlinedButton onClick={() => rejectMember(m.user.id, displayName(m.user))}>
                      <span slot="icon"><X size={16} /></span>{t('studio.rejectMember')}
                    </OutlinedButton>
                  </div>
                ))}
              </div>
            )}

            {room && (
              <div className="m3-card row" style={{ gap: 12, padding: 14, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="sd-row-ph" style={{ width: 40, height: 40 }}><MsIcon name="forum" size={20} /></span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700 }}>{t('studio.chatTitle')}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {t('studio.chatMeta', { n: room.member_count })}
                    {room.mute_all_until && t('studio.chatMutedSuffix')}
                  </div>
                </div>
                {isMember && (
                  <FilledButton onClick={() => navigate(`/chat?thread=${room.id}`)}>
                    <span slot="icon"><MessageCircle size={15} /></span>{t('studio.enter')}
                  </FilledButton>
                )}
                {canManage && !creationLocked && (
                  <OutlinedButton onClick={() => muteAllRoom(room.id, !room.mute_all_until)} disabled={busy === 'muteAll'}>
                    {room.mute_all_until ? t('studio.unmuteAll') : t('studio.muteAll')}
                  </OutlinedButton>
                )}
              </div>
            )}

            {activeMembers.length === 0 ? (
              <EmptyState msIcon="group" title={t('studio.noMembers')} />
            ) : (
              <div className="m3-card" style={{ padding: 8 }}>
                {activeMembers.map((m) => {
                  const isSelf = user && m.user.uid === user.uid;
                  const canAct = canManage && !isSelf && m.role !== 'owner';
                  const canOwnerAct = isOwner && !isSelf && m.role !== 'owner';
                  return (
                    <div key={m.id} className="sd-row" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                      <UserAvatar user={m.user} size={36} />
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <Link to={`/users/${m.user.uid}`} style={{ fontWeight: 700 }}>{displayName(m.user)}</Link>
                          <RoleBadge role={m.role} />
                          {m.muted && <span className="m3-badge m3-badge--error">{t('studio.mutedBadge')}</span>}
                          {isSelf && <span className="muted" style={{ fontSize: 12 }}>{t('studio.meSuffix')}</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>{t('studio.joinedAt', { time: formatTime(m.joined_at) })}</div>
                      </div>
                      {canAct && !creationLocked && (
                        <div className="row" style={{ gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {canOwnerAct && m.role === 'member' && <TextButton onClick={() => setRole(m.user.id, 'admin')}>{t('studio.makeAdmin')}</TextButton>}
                          {canOwnerAct && m.role === 'admin' && <TextButton onClick={() => setRole(m.user.id, 'member')}>{t('studio.removeAdmin')}</TextButton>}
                          {canOwnerAct && <TextButton onClick={() => setTransferTarget(m.user.id)}>{t('studio.transferOwner')}</TextButton>}
                          <TextButton onClick={() => muteMember(m.user.id, !m.muted)}>{m.muted ? t('studio.unmute') : t('studio.mute')}</TextButton>
                          <TextButton onClick={() => kick(m.user.id, displayName(m.user))}>{t('studio.kick')}</TextButton>
                          <TextButton onClick={() => blacklist(m.user.id, displayName(m.user))} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('studio.blacklist')}</TextButton>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ============ 动态 ============ */}
        {tab === 'feed' && (
          (studio.activity || []).length === 0 ? (
            <EmptyState msIcon="campaign" title={t('studio.noActivity')} subtitle={t('studio.noActivityDesc')} />
          ) : (
            <div className="m3-card" style={{ padding: 8 }}>
              {(studio.activity || []).map((a, i) => (
                <div key={i} className="sd-row" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  {a.member ? <UserAvatar user={a.member} size={32} showVerify={false} /> : <span className="sd-row-ph" style={{ width: 32, height: 32 }}><MsIcon name="campaign" size={16} /></span>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                      {a.member && <Link to={`/users/${a.member.uid}`} style={{ fontWeight: 700 }}>{displayName(a.member)}</Link>}{' '}
                      <span className="muted">{a.text}</span>{' '}
                      {a.work && <Link to={`/works/${a.work.id}`} style={{ color: 'var(--md-sys-color-primary)' }}>{t('studio.workTitle', { name: a.work.title })}</Link>}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{formatTime(a.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ============ 设置 ============ */}
        {tab === 'settings' && canManage && !creationLocked && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="m3-card" style={{ padding: 20 }}>
              <div className="edit-side-title" style={{ marginBottom: 12 }}><SettingsIcon size={16} /> {t('studio.basicInfo')}</div>
              <div className="stack" style={{ gap: 12 }}>
                <OutlinedTextField label={t('studio.nameLabel')} value={form.name} onInput={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} style={{ width: '100%' }} />
                <OutlinedSelect label={t('studio.categoryLabel')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ width: '100%' }}>
                  {CATEGORIES.map((c) => <SelectOption key={c} value={c} headline={t(CAT_KEYS[c])} />)}
                </OutlinedSelect>
                <OutlinedTextField label={t('studio.descLabel')} type="textarea" rows={3} value={form.description} onInput={(e) => setForm({ ...form, description: e.target.value })} style={{ width: '100%' }} />
                <OutlinedTextField
                  label={t('studio.announcementLabel')}
                  type="textarea"
                  rows={2}
                  value={form.announcement}
                  onInput={(e) => setForm({ ...form, announcement: e.target.value })}
                  style={{ width: '100%' }}
                  supportingText={t('studio.announcementHint')}
                />
              </div>
            </div>

            <div className="m3-card" style={{ padding: 20 }}>
              <div className="edit-side-title" style={{ marginBottom: 12 }}><MsIcon name="image" size={16} /> {t('studio.appearance')}</div>
              <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div className="edit-side-label">{t('studio.avatar')}</div>
                  <ImageUpload value={form.avatar_url} onChange={(v) => setForm({ ...form, avatar_url: v })} label={t('studio.uploadAvatar')} previewSize={64} />
                </div>
                <div>
                  <div className="edit-side-label">{t('studio.cover')}</div>
                  <ImageUpload value={form.cover_url} onChange={(v) => setForm({ ...form, cover_url: v })} label={t('studio.uploadCover')} previewSize={64} />
                </div>
              </div>
            </div>

            <div className="m3-card" style={{ padding: 20 }}>
              <div className="edit-side-title" style={{ marginBottom: 12 }}><MsIcon name="group" size={16} /> {t('studio.joinSettings')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <FilterChip label={t('studio.joinOpen')} selected={form.join_mode === 'open'} onClick={() => setForm({ ...form, join_mode: 'open' })} />
                <FilterChip label={t('studio.joinApproval')} selected={form.join_mode === 'approval'} onClick={() => setForm({ ...form, join_mode: 'approval' })} />
              </div>
              <div style={{ marginTop: 14 }}>
                <OutlinedSelect label={t('studio.minLevel')} value={String(form.min_level)} onChange={(e) => setForm({ ...form, min_level: Number(e.target.value) })} style={{ width: '100%' }}>
                  {LEVEL_OPTIONS.map((lv) => <SelectOption key={lv} value={String(lv)} headline={lv === 0 ? t('studio.levelAny') : t('studio.levelAtLeast', { n: lv })} />)}
                </OutlinedSelect>
              </div>
              <div className="sc-switch-row">
                <Switch selected={form.multi_studio_only} onChange={(e) => setForm({ ...form, multi_studio_only: e.target.selected })} />
                <span><b>{t('studio.noMultiStudio')}</b><span className="muted" style={{ fontSize: 12, display: 'block' }}>{t('studio.noMultiStudioDesc')}</span></span>
              </div>
              <div className={`sc-switch-row${form.join_mode === 'approval' ? '' : ' is-off'}`}>
                <Switch
                  selected={form.apply_required && form.join_mode === 'approval'}
                  disabled={form.join_mode !== 'approval'}
                  onChange={(e) => setForm({ ...form, apply_required: e.target.selected })}
                />
                <span><b>{t('studio.requireNote')}</b><span className="muted" style={{ fontSize: 12, display: 'block' }}>{form.join_mode === 'approval' ? t('studio.requireNoteDesc') : t('studio.requireNoteOff')}</span></span>
              </div>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <FilledButton onClick={saveSettings} disabled={busy === 'save' || !form.name.trim()}>
                {busy === 'save' ? t('studio.saving') : t('studio.saveSettings')}
              </FilledButton>
              {dirty && <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{t('studio.unsaved')}</span>}
            </div>

            <div className="m3-card" style={{ padding: 20 }}>
              <div className="edit-side-title" style={{ marginBottom: 12 }}><MsIcon name="key" size={16} /> {t('studio.inviteCode')}</div>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="m3-badge" style={{ fontSize: 14 }}>{studio.invite_code || '—'}</span>
                <TextButton onClick={copyInvite}><Link2 size={14} /> {t('common.copy')}</TextButton>
                <OutlinedButton onClick={regenInvite} disabled={busy === 'invite' || !isOwner}>{t('studio.resetInvite')}</OutlinedButton>
                {!isOwner && <span className="muted" style={{ fontSize: 12 }}>{t('studio.onlyOwnerReset')}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {t('studio.inviteHint')}
              </div>
            </div>

            <div className="m3-card" style={{ padding: 20 }}>
              <div className="edit-side-title" style={{ marginBottom: 12 }}><Ban size={16} /> {t('studio.blacklistTitle', { n: (studio.blacklist || []).length })}</div>
              {(studio.blacklist || []).length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>{t('studio.blacklistEmpty')}</div>
              ) : (
                (studio.blacklist || []).map((u) => (
                  <div key={u.id} className="sd-row" style={{ borderBottom: '1px solid var(--border-soft)' }}>
                    <UserAvatar user={u} size={32} showVerify={false} />
                    <Link to={`/users/${u.uid}`} style={{ fontWeight: 600, flex: 1 }}>{displayName(u)}</Link>
                    <OutlinedButton onClick={() => unblacklist(u.id)} disabled={busy === `ubl${u.id}`}>{t('studio.unblacklist')}</OutlinedButton>
                  </div>
                ))
              )}
            </div>

            {isOwner && (
              <div className="m3-card" style={{ padding: 20, borderColor: 'var(--md-sys-color-error)' }}>
                <div className="edit-side-title" style={{ marginBottom: 8, color: 'var(--md-sys-color-error)' }}>
                  <Trash2 size={16} /> {t('studio.dangerZone')}
                </div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 12 }}>
                  {t('studio.disbandWarnBefore')}<b>{t('studio.disbandWarnWord')}</b>{t('studio.disbandWarnAfter')}
                </div>
                <OutlinedButton onClick={disband} disabled={busy === 'disband'} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>
                  <span slot="icon"><Trash2 size={16} /></span>{busy === 'disband' ? t('studio.disbanding') : t('studio.disband')}
                </OutlinedButton>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 申请加入（需要留言） */}
      <Dialog open={applyOpen} onClose={() => setApplyOpen(false)} onCancel={() => setApplyOpen(false)}>
        <div slot="headline">{t('studio.applyTitle', { name: studio.name })}</div>
        <div slot="content" className="stack">
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {t('studio.applyDesc')}
          </div>
          <OutlinedTextField
            label={t('studio.applyNote')}
            type="textarea"
            rows={3}
            value={applyNote}
            onInput={(e) => setApplyNote(e.target.value)}
            maxLength={200}
            style={{ width: '100%' }}
            supportingText={`${applyNote.length}/200`}
          />
          {studio.min_level > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('studio.minLevelHint', { n: studio.min_level })}</div>}
        </div>
        <div slot="actions">
          <TextButton onClick={() => setApplyOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={() => { setApplyOpen(false); doJoin(); }} disabled={!applyNote.trim()}>{t('studio.submitApply')}</FilledButton>
        </div>
      </Dialog>

      {/* 驳回投稿 */}
      <Dialog open={rejectTarget !== null} onClose={() => setRejectTarget(null)} onCancel={() => setRejectTarget(null)}>
        <div slot="headline">{t('studio.rejectTitle')}</div>
        <div slot="content" className="stack">
          <div className="muted" style={{ fontSize: 13 }}>{t('studio.rejectDesc')}</div>
          <OutlinedTextField label={t('studio.rejectReason')} value={rejectReason} onInput={(e) => setRejectReason(e.target.value)} maxLength={200} style={{ width: '100%' }} />
        </div>
        <div slot="actions">
          <TextButton onClick={() => setRejectTarget(null)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={submitReject} style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('studio.confirmReject')}</FilledButton>
        </div>
      </Dialog>

      {/* 转让室长确认 */}
      <Dialog open={transferTarget !== null} onClose={() => setTransferTarget(null)} onCancel={() => setTransferTarget(null)}>
        <div slot="headline">{t('studio.transferTitle')}</div>
        <div slot="content" className="stack">
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            {t('studio.transferWarnBefore')}<b>{t('studio.transferWarnWord')}</b>{t('studio.transferWarnAfter')}
          </div>
        </div>
        <div slot="actions">
          <TextButton onClick={() => setTransferTarget(null)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={doTransfer}>{t('studio.sendInvite')}</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
