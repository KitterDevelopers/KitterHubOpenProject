import { useState } from 'react';
import { IconButton } from '../../ui';
import MsIcon from '../MsIcon';
import UserAvatar from '../Avatar';
import { resolveUploadUrl } from '../Avatar';
import { useI18n } from '../../i18n';
import { displayName, fmtChina } from '../../utils';

// 文本里的 @提及 高亮
function renderText(text, highlight) {
  if (!text) return null;
  const parts = String(text).split(/(@[^\s@#]{1,20})/g);
  return parts.map((p, i) => {
    if (p.startsWith('@') && p.length > 1) {
      return (
        <span key={i} className="chat-mention">
          {p}
        </span>
      );
    }
    if (highlight && p.toLowerCase().includes(highlight.toLowerCase())) {
      const idx = p.toLowerCase().indexOf(highlight.toLowerCase());
      return (
        <span key={i}>
          {p.slice(0, idx)}
          <mark className="chat-hit">{p.slice(idx, idx + highlight.length)}</mark>
          {p.slice(idx + highlight.length)}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export default function MessageItem({
  msg,
  mine,
  isGroup,
  grouped,
  canManage,
  recallable,
  highlight,
  peerRead,
  onReply,
  onRecall,
  onDelete,
  onPreviewImage,
  onMentionClick,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const sender = msg.sender || {};
  const name = displayName(sender) || t('chat.anonymous');
  const time = fmtChina(msg.created_at, { hour: '2-digit', minute: '2-digit', hour12: false });

  if (msg.recalled) {
    return (
      <div className="chat-sys">
        <span>
          {t('chat.recalled', { name: mine ? t('chat.you') : name })}
        </span>
      </div>
    );
  }

  // 已删除：后端是软删（行还在、内容清空），列表接口已经不再返回它们了；
  // 这里再兜一层 —— 万一有残留（socket 里已经队列好的旧消息、或将来改了读接口），
  // 也要显示「消息已删除」而不是一个空气泡。撤回留痕、删除不显示，两者语义不同。
  if (msg.deleted) {
    return (
      <div className={`chat-row${mine ? ' mine' : ''}`}>
        <div className="chat-col">
          <div className="chat-bubble-wrap">
            <div className="chat-bubble is-deleted">
              <MsIcon name="delete" size={14} /> {t('chat.deleted')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const actionBtn = (icon, label, fn) => (
    <IconButton key={label} onClick={fn} aria-label={label} title={label} className="chat-act">
      <MsIcon name={icon} size={18} />
    </IconButton>
  );

  return (
    <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
      {isGroup && !mine && (
        <span className="chat-row-avatar">
          {!grouped && <UserAvatar user={sender} size={34} onClick={onMentionClick} />}
        </span>
      )}
      <div className="chat-col">
        {isGroup && !mine && !grouped && (
          <button type="button" className="chat-name" onClick={onMentionClick}>
            {name}
          </button>
        )}
        <div className={`chat-bubble-wrap${mine ? ' mine' : ''}`} onClick={() => setOpen((v) => !v)}>
          <div className="chat-bubble">
            {msg.reply_to && (
              <div className="chat-quote">
                <b>{msg.reply_to.sender_name || t('chat.peer')}</b>
                <span>{msg.reply_to.preview || ''}</span>
              </div>
            )}
            {msg.image_url && (
              <img
                className="chat-img"
                src={resolveUploadUrl(msg.image_url)}
                alt={t('chat.imageMessage')}
                loading="lazy"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreviewImage(resolveUploadUrl(msg.image_url));
                }}
              />
            )}
            {msg.content ? <div className="chat-text">{renderText(msg.content, highlight)}</div> : null}
          </div>
          <div className={`chat-acts${open ? ' open' : ''}`}>
            {actionBtn('comment', t('chat.reply'), onReply)}
            {mine && recallable && actionBtn('refresh', t('chat.recall'), onRecall)}
            {(mine || canManage) && actionBtn('delete', t('common.delete'), onDelete)}
          </div>
        </div>
        {!grouped && (
          <div className={`chat-meta${mine ? ' mine' : ''}`}>
            <span>{time}</span>
            {mine && !isGroup && (() => {
              // 已读 = 服务端给的标记 **或** 对方刚通过 socket 推来的已读水位
              // （peerRead 以前只是存着没人用，所以对方在会话里读了你也不会变「已读」，
              //   要刷新页面才看到）。
              const read = Boolean(msg.read) || Boolean(peerRead && Number(msg.id) <= Number(peerRead));
              return (
                <span className={`chat-tick${read ? ' read' : ''}`} title={read ? t('chat.read') : t('chat.delivered')}>
                  <MsIcon name={read ? 'check_circle' : 'check'} size={14} />
                  {read ? t('chat.read') : t('chat.delivered')}
                </span>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
