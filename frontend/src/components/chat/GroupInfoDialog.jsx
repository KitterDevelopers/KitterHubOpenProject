import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, FilledButton, IconButton, OutlinedTextField, Switch, TextButton } from '../../ui';
import MsIcon from '../MsIcon';
import UserAvatar from '../Avatar';
import { useI18n } from '../../i18n';
import { displayName } from '../../utils';

// 群资料 / 成员管理：改资料、设管理员、禁言、移出、全员禁言、退出、解散、拉黑。
export default function GroupInfoDialog({
  open,
  onClose,
  thread,
  myUid,
  onSaveInfo,
  onMySettings,
  onToggleMuteAll,
  onUpdateMember,
  onKickMember,
  onLeave,
  onDissolve,
  onBlock,
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [tab, setTab] = useState('info');

  useEffect(() => {
    if (open && thread) {
      setTitle(thread.title || '');
      setAnnouncement(thread.announcement || '');
      setTab('info');
    }
  }, [open, thread]);

  if (!thread) return null;
  const isGroup = thread.kind === 'group';
  const canManage = isGroup && (thread.can_manage || thread.is_owner);
  const members = thread.members || [];
  const myMember = members.find((m) => m.user_id === myUid);

  const confirmThen = (text, fn) => {
    if (window.confirm(text)) fn();
  };

  // 打开某人的主页：这个弹窗是受控的，不先关掉会一直留在页面上
  const openProfile = (uid) => {
    if (!uid) return;
    onClose?.();
    navigate(`/users/${uid}`);
  };

  return (
    <Dialog open={open} onClosed={onClose} style={{ '--md-dialog-container-shape': '24px' }}>
      <div slot="headline" style={{ fontWeight: 800 }}>
        {isGroup ? t('chat.groupInfo') : displayName(thread.peer) || t('chat.dm')}
      </div>
      <div slot="content" style={{ minWidth: 320, maxWidth: '86vw' }} className="thin-scroll">
        {isGroup ? (
          <>
            <div className="chat-tabbar">
              <button type="button" className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>
                {t('chat.tabInfo')}
              </button>
              <button type="button" className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>
                {t('chat.tabMembers', { n: members.length })}
              </button>
            </div>

            {tab === 'info' && (
              <div className="col" style={{ gap: 12, marginTop: 12 }}>
                <OutlinedTextField
                  label={t('chat.groupName')}
                  value={title}
                  maxlength={40}
                  disabled={!canManage}
                  onInput={(e) => setTitle(e.target.value)}
                  style={{ width: '100%' }}
                />
                <OutlinedTextField
                  label={t('chat.announcement')}
                  value={announcement}
                  maxlength={500}
                  disabled={!canManage}
                  type="textarea"
                  rows={3}
                  onInput={(e) => setAnnouncement(e.target.value)}
                  style={{ width: '100%' }}
                />
                {canManage && (
                  <FilledButton onClick={() => onSaveInfo({ title: title.trim(), announcement: announcement.trim() })} disabled={!title.trim()}>
                    {t('chat.saveInfo')}
                  </FilledButton>
                )}
                <div className="chat-info-line">
                  <span>{t('chat.owner', { name: thread.owner_id ? members.find((m) => m.user_id === thread.owner_id)?.name || '—' : '—' })}</span>
                  <span>{t('chat.memberCount', { n: thread.member_count })}</span>
                </div>
                <div className="chat-switch-row">
                  <span>{t('chat.muteAllSwitch')}</span>
                  <Switch selected={!!thread.mute_all} disabled={!canManage} onChange={(e) => onToggleMuteAll(e.target.selected)} />
                </div>
                <div className="chat-switch-row">
                  <span>{t('chat.pin')}</span>
                  <Switch selected={!!thread.pinned} onChange={(e) => onMySettings({ pinned: e.target.selected })} />
                </div>
                <div className="chat-switch-row">
                  <span>{t('chat.mute')}</span>
                  <Switch selected={!!thread.notify_off} onChange={(e) => onMySettings({ notify_off: e.target.selected })} />
                </div>
                {thread.studio_id ? (
                  <>
                    <TextButton onClick={() => { onClose?.(); navigate(`/studios/${thread.studio_id}`); }}>
                      <span slot="icon"><MsIcon name="groups" size={18} /></span>
                      {t('chat.enterStudio')}
                    </TextButton>
                    <span className="muted" style={{ fontSize: 12 }}>{t('chat.studioThreadHint')}</span>
                  </>
                ) : thread.is_owner ? (
                  <TextButton
                    style={{ color: 'var(--md-sys-color-error)' }}
                    onClick={() => confirmThen(t('chat.dissolveConfirm'), onDissolve)}
                  >
                    {t('chat.dissolve')}
                  </TextButton>
                ) : (
                  <TextButton
                    style={{ color: 'var(--md-sys-color-error)' }}
                    onClick={() => confirmThen(t('chat.leaveConfirm'), onLeave)}
                  >
                    {t('chat.leave')}
                  </TextButton>
                )}
              </div>
            )}

            {tab === 'members' && (
              <div className="chat-member-list">
                {members.map((m) => {
                  const isOwner = m.user_id === thread.owner_id;
                  const me = m.user_id === myUid;
                  const canKick = canManage && !me && !isOwner && (thread.is_owner || m.role !== 'admin');
                  return (
                    <div key={m.uid} className="chat-member">
                      <UserAvatar user={{ display_name: m.name, avatar_url: m.avatar_url }} size={36} />
                      <span className="chat-member-main">
                        <b>{m.name}{me ? t('chat.meSuffix') : ''}</b>
                        <small>
                          {isOwner ? t('chat.ownerRole') : m.role === 'admin' ? t('common.admin') : t('chat.roleMember')}
                          {m.muted ? t('chat.mutedSuffix') : ''}
                        </small>
                      </span>
                      {!me && (
                        <IconButton
                          title={t('chat.viewProfile')}
                          aria-label={t('chat.viewProfile')}
                          onClick={() => openProfile(m.uid)}
                        >
                          <MsIcon name="person" size={19} />
                        </IconButton>
                      )}
                      {canManage && !me && !isOwner && (
                        <>
                          {thread.is_owner && (
                            <IconButton
                              title={m.role === 'admin' ? t('chat.demoteAdmin') : t('chat.promoteAdmin')}
                              aria-label={t('common.admin')}
                              onClick={() => onUpdateMember(m.uid, { role: m.role === 'admin' ? 'member' : 'admin' })}
                            >
                              <MsIcon name="admin_panel_settings" size={19} />
                            </IconButton>
                          )}
                          <IconButton
                            title={m.muted ? t('chat.unmuteMember') : t('chat.muteMember')}
                            aria-label={t('chat.muteMember')}
                            onClick={() => onUpdateMember(m.uid, { muted: !m.muted })}
                          >
                            <MsIcon name={m.muted ? 'notifications_active' : 'notifications_off'} size={19} />
                          </IconButton>
                          {canKick && (
                            <IconButton
                              title={t('chat.kick')}
                              aria-label={t('chat.kick')}
                              onClick={() => confirmThen(t('chat.kickConfirm', { name: m.name }), () => onKickMember(m.uid))}
                            >
                              <MsIcon name="cancel" size={19} />
                            </IconButton>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="col" style={{ gap: 12, marginTop: 8 }}>
            <div className="row" style={{ gap: 12 }}>
              <UserAvatar user={thread.peer} size={52} />
              <div className="col" style={{ gap: 2 }}>
                <b>{displayName(thread.peer)}</b>
                <span className="muted" style={{ fontSize: 12 }}>@{thread.peer?.username || '—'}</span>
              </div>
            </div>
            <TextButton onClick={() => openProfile(thread.peer?.uid)}>
              <span slot="icon"><MsIcon name="person" size={18} /></span>
              {t('chat.viewProfile')}
            </TextButton>
            <div className="chat-switch-row">
              <span>{t('chat.pin')}</span>
              <Switch selected={!!thread.pinned} onChange={(e) => onMySettings({ pinned: e.target.selected })} />
            </div>
            <div className="chat-switch-row">
              <span>{t('chat.mute')}</span>
              <Switch selected={!!thread.notify_off} onChange={(e) => onMySettings({ notify_off: e.target.selected })} />
            </div>
            <div className="chat-switch-row">
              <span>{thread.blocked ? t('chat.blocked') : t('chat.block')}</span>
              <Switch
                selected={!!thread.blocked}
                onChange={(e) =>
                  confirmThen(e.target.selected ? t('chat.blockConfirm') : t('chat.unblockConfirm'), () =>
                    onBlock(thread.peer?.uid, e.target.selected)
                  )
                }
              />
            </div>
          </div>
        )}
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
      </div>
    </Dialog>
  );
}
