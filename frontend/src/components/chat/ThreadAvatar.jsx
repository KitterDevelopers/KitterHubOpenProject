import UserAvatar from '../Avatar';
import MsIcon from '../MsIcon';
import { resolveUploadUrl } from '../Avatar';
import { useI18n } from '../../i18n';

// 会话头像：私聊显示对方头像，群聊显示群头像或统一的群组图标。
export default function ThreadAvatar({ thread, size = 44 }) {
  const { t } = useI18n();
  if (!thread) return null;
  if (thread.kind === 'dm') {
    return <UserAvatar user={thread.peer || { display_name: thread.title }} size={size} />;
  }
  if (thread.avatar_url) {
    return (
      <img
        src={resolveUploadUrl(thread.avatar_url)}
        alt={thread.title || t('chat.group')}
        style={{ width: size, height: size, borderRadius: 'var(--radius)', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      className="chat-group-avatar"
      style={{ width: size, height: size, borderRadius: 'var(--radius)', fontSize: size * 0.5 }}
      aria-hidden="true"
    >
      <MsIcon name="groups" size={size * 0.56} />
    </span>
  );
}
