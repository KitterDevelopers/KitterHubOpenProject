import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../ui';
import MsIcon from '../MsIcon';
import { toast } from '../Toast';
import { useI18n } from '../../i18n';
import { displayName } from '../../utils';

// 输入区：Enter 发送 / Shift+Enter 换行；支持图片、回复引用、@ 快捷插入。
export default function Composer({ thread, myUid, replyTo, onCancelReply, onSendText, onSendImage, onTyping }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const mentionUsers = (thread?.members || []).filter((m) => m.user_id !== myUid);
  const [mentionOpen, setMentionOpen] = useState(false);

  useEffect(() => {
    setText('');
  }, [thread?.id]);

  useEffect(() => {
    if (replyTo) taRef.current?.focus();
  }, [replyTo]);

  const submit = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    const ok = await onSendText(v);
    if (ok) setText('');
    setSending(false);
    taRef.current?.focus();
  };

  const insertMention = (name) => {
    setMentionOpen(false);
    setText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${name} `);
    taRef.current?.focus();
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast(t('chat.imageOnly'), 'error');
      return;
    }
    setSending(true);
    await onSendImage(file, replyTo?.id);
    setSending(false);
  };

  const canSend = Boolean(text.trim());

  return (
    <div className="chat-composer">
      {replyTo && (
        <div className="chat-reply-bar">
          <MsIcon name="comment" size={16} />
          <span className="chat-reply-text">
            {t('chat.replyPrefix')}<b>{replyTo.sender_name || displayName(replyTo.sender) || t('chat.peer')}</b>{t('chat.replyColon')}
            {replyTo.preview || (replyTo.content || '').slice(0, 40)}
          </span>
          <IconButton onClick={onCancelReply} aria-label={t('chat.cancelReply')}>
            <MsIcon name="close" size={16} />
          </IconButton>
        </div>
      )}
      <div className="chat-input-row">
        <IconButton onClick={() => fileRef.current?.click()} aria-label={t('chat.sendImage')} title={t('chat.sendImage')} disabled={sending}>
          <MsIcon name="image" size={22} />
        </IconButton>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={pickFile} />
        {thread?.kind === 'group' && (
          <span style={{ position: 'relative' }}>
            <IconButton onClick={() => setMentionOpen((v) => !v)} aria-label={t('chat.mention')} title={t('chat.mention')}>
              <MsIcon name="person_add" size={22} />
            </IconButton>
            {mentionOpen && (
              <div className="chat-mention-pop">
                <button type="button" onClick={() => insertMention(t('chat.everyoneMention'))}>
                  <MsIcon name="campaign" size={16} /> {t('chat.everyone')}
                </button>
                {mentionUsers.slice(0, 30).map((m) => (
                  <button key={m.uid} type="button" onClick={() => insertMention(m.name || m.uid)}>
                    <MsIcon name="person" size={16} /> {m.name || m.uid}
                  </button>
                ))}
                {mentionUsers.length === 0 && <div className="muted" style={{ padding: 8, fontSize: 13 }}>{t('chat.noMembersToMention')}</div>}
              </div>
            )}
          </span>
        )}
        <textarea
          ref={taRef}
          className="chat-input"
          rows={1}
          value={text}
          placeholder={t('chat.inputPlaceholder')}
          onChange={(e) => {
            setText(e.target.value);
            onTyping();
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <IconButton
          className="chat-send"
          onClick={submit}
          aria-label={t('common.send')}
          title={t('common.send')}
          disabled={!canSend || sending}
        >
          <MsIcon name="send" size={22} />
        </IconButton>
      </div>
    </div>
  );
}
