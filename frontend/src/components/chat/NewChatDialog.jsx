import { useEffect, useState } from 'react';
import { Dialog, FilledButton, OutlinedTextField, TextButton } from '../../ui';
import MsIcon from '../MsIcon';
import UserAvatar from '../Avatar';
import { useI18n } from '../../i18n';

// 新建会话：找人私聊 / 创建群聊 / 发现并加入群聊
export default function NewChatDialog({ open, onClose, onOpenDm, onCreateGroup, onJoinGroup, searchUsers, discoverGroups }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('dm');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setTab('dm');
      setQ('');
      setUsers([]);
      setGroups([]);
      setName('');
      setDesc('');
      setTouched(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(async () => {
      if (tab === 'dm') setUsers(await searchUsers(q));
      else if (tab === 'discover') setGroups(await discoverGroups(q));
    }, 220);
    return () => clearTimeout(timer);
  }, [open, tab, q, searchUsers, discoverGroups]);

  const submitGroup = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const id = await onCreateGroup(name.trim(), desc.trim());
    setBusy(false);
    if (id) onClose();
  };

  return (
    <Dialog open={open} onClosed={onClose} style={{ '--md-dialog-container-shape': '24px' }}>
      <div slot="headline" style={{ fontWeight: 800 }}>
        {t('chat.newThread')}
      </div>
      <div slot="content" style={{ minWidth: 320, maxWidth: '86vw' }}>
        <div className="chat-tabbar">
          {[
            ['dm', 'chat.tabFindPeople'],
            ['group', 'chat.tabCreateGroup'],
            ['discover', 'chat.tabDiscover'],
          ].map(([k, labelKey]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t(labelKey)}
            </button>
          ))}
        </div>

        {tab !== 'group' && (
          <div style={{ marginTop: 14 }}>
            <OutlinedTextField
              label={tab === 'dm' ? t('chat.searchPeople') : t('chat.searchGroups')}
              value={q}
              onInput={(e) => {
                setQ(e.target.value);
                setTouched(true);
              }}
              style={{ width: '100%' }}
            >
              <MsIcon slot="leading-icon" name="search" size={20} />
            </OutlinedTextField>
          </div>
        )}

        {tab === 'dm' && (
          <div className="chat-pick-list">
            {users.map((u) => (
              <button
                key={u.uid}
                type="button"
                className="chat-pick"
                onClick={async () => {
                  await onOpenDm(u.uid);
                  onClose();
                }}
              >
                <UserAvatar user={u} size={38} />
                <span className="chat-pick-main">
                  <b>{u.display_name || u.username}</b>
                  <small>@{u.username}{u.blocked ? t('chat.blockedSuffix') : ''}</small>
                </span>
                <MsIcon name="chat_bubble" size={18} />
              </button>
            ))}
            {touched && users.length === 0 && <div className="chat-empty-hint">{t('chat.noUsersFound')}</div>}
            {!touched && <div className="chat-empty-hint">{t('chat.searchPeopleHint')}</div>}
          </div>
        )}

        {tab === 'group' && (
          <div className="col" style={{ gap: 12, marginTop: 14 }}>
            <OutlinedTextField
              label={t('chat.groupNameLabel')}
              value={name}
              maxlength={40}
              onInput={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
            />
            <OutlinedTextField
              label={t('chat.announcementLabel')}
              value={desc}
              maxlength={500}
              onInput={(e) => setDesc(e.target.value)}
              style={{ width: '100%' }}
              type="textarea"
              rows={3}
            />
            <span className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
              {t('chat.createGroupHint')}
            </span>
          </div>
        )}

        {tab === 'discover' && (
          <div className="chat-pick-list">
            {groups.map((g) => (
              <div key={g.id} className="chat-pick">
                <span className="chat-group-avatar" style={{ width: 38, height: 38, borderRadius: 'var(--radius)' }}>
                  <MsIcon name="groups" size={21} />
                </span>
                <span className="chat-pick-main">
                  <b>{g.title}</b>
                  <small>
                    {t('chat.memberCount', { n: g.member_count })}{g.announcement ? ` - ${g.announcement.slice(0, 24)}` : ''}
                  </small>
                </span>
                <FilledButton
                  onClick={async () => {
                    const ok = await onJoinGroup(g.id);
                    if (ok) onClose();
                  }}
                >
                  {t('chat.join')}
                </FilledButton>
              </div>
            ))}
            {groups.length === 0 && <div className="chat-empty-hint">{t('chat.noGroups')}</div>}
          </div>
        )}
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.cancel')}</TextButton>
        {tab === 'group' && (
          <FilledButton onClick={submitGroup} disabled={!name.trim() || busy}>
            {t('chat.create')}
          </FilledButton>
        )}
      </div>
    </Dialog>
  );
}
