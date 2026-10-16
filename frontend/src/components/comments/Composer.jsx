/**
 * 评论输入框（顶层评论 / 内联回复共用）。
 *
 * 支持：@ 联想、图片附件、引用填充。
 * ⚠️ 已按要求**去掉快捷回复**（那一排「太棒了 / 学到了 …」），输入框下面不再挂任何预设短语。
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { OutlinedTextField, FilledButton, TextButton, IconButton } from '../../ui';
import client from '../../api/client';
import UserAvatar from '../Avatar';
import { toast } from '../Toast';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';
import { displayName } from '../../utils';

export default function Composer({
  user,
  variant = 'top',
  label,
  submitLabel,
  autoFocus = false,
  initialText = '',
  onSubmit,
  onCancel,
}) {
  const { t } = useI18n();
  const errOf = useErr();
  const [text, setText] = useState(initialText);
  const [imageUrl, setImageUrl] = useState('');
  const [mentionList, setMentionList] = useState([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const fieldRef = useRef(null);
  const mentionTimer = useRef(null);

  // 引用 / 回复内容由外部塞进来时同步一次
  useEffect(() => { setText(initialText); }, [initialText]);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => {
      const input = fieldRef.current?.querySelector('textarea, input');
      if (input && input.focus) input.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => () => clearTimeout(mentionTimer.current), []);

  const isReply = variant === 'reply';

  /** @ 联想：只在词首（行首或空格后）触发，避免邮箱里的 @ 也弹列表 */
  const handleInput = (val) => {
    setText(val);
    const idx = val.lastIndexOf('@');
    const atWordStart = idx >= 0 && (idx === 0 || val[idx - 1] === ' ' || val[idx - 1] === '\n');
    if (atWordStart) {
      const m = val.slice(idx + 1).match(/^[^\s@]{1,20}/);
      if (m) {
        clearTimeout(mentionTimer.current);
        mentionTimer.current = setTimeout(() => {
          client.get('/search/users', { params: { q: m[0] } })
            .then((r) => { setMentionList(r.data || []); setMentionOpen(true); })
            .catch(() => { setMentionList([]); setMentionOpen(false); });
        }, 200);
        return;
      }
    }
    setMentionList([]);
    setMentionOpen(false);
  };

  const pickMention = (u) => {
    const idx = text.lastIndexOf('@');
    setText(`${idx > 0 ? text.slice(0, idx) : ''}@${u.username} `);
    setMentionList([]);
    setMentionOpen(false);
  };

  const uploadImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await client.post('/upload', fd);
      setImageUrl(res.data.url);
    } catch (ex) {
      toast(errOf(ex), 'error');
    }
  };

  const reset = () => {
    setText('');
    setImageUrl('');
    setMentionList([]);
    setMentionOpen(false);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await onSubmit(content, imageUrl || undefined);
      reset();
    } catch (ex) {
      toast(errOf(ex), 'error');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    <div style={{ flex: 1, minWidth: 0, position: 'relative' }} ref={fieldRef}>
      <OutlinedTextField
        type="textarea"
        rows={isReply ? 1 : 2}
        label={label || (user ? t('comment.placeholder') : t('comment.loginToComment'))}
        value={text}
        onInput={(e) => handleInput(e.target.value)}
        disabled={!user}
        style={{ width: '100%' }}
      />

      {mentionOpen && mentionList.length > 0 && user && (
        <div
          className="m3-card"
          role="listbox"
          style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, padding: 6, maxHeight: 220, overflowY: 'auto' }}
        >
          {mentionList.map((u) => (
            <button
              key={u.uid}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => pickMention(u)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius)', cursor: 'pointer', width: '100%', border: 0, background: 'transparent', font: 'inherit', textAlign: 'left', color: 'inherit' }}
            >
              <UserAvatar user={u} size={22} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName(u)}</span>
              <span className="muted" style={{ fontSize: 11 }}>@{u.username}</span>
            </button>
          ))}
        </div>
      )}

      {imageUrl && (
        <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
          <img src={imageUrl} alt={t('comment.imageAlt')} style={{ width: 64, height: 48, borderRadius: 'var(--radius)', objectFit: 'cover' }} />
          <TextButton onClick={() => setImageUrl('')} style={{ fontSize: 12 }}>{t('comment.removeImage')}</TextButton>
        </div>
      )}
    </div>
  );

  // 内联回复：一行输入框 + 发送 / 取消
  if (isReply) {
    return (
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
        {field}
        <FilledButton onClick={send} disabled={!user || !text.trim() || busy}>{submitLabel || t('common.send')}</FilledButton>
        {onCancel && <TextButton onClick={onCancel}>{t('common.cancel')}</TextButton>}
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
      <UserAvatar user={user} size={36} />
      {field}
      <div className="stack" style={{ gap: 6 }}>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadImage} />
        <IconButton type="button" onClick={() => fileRef.current && fileRef.current.click()} aria-label={t('comment.sendImage')} title={t('comment.sendImage')} disabled={!user}>
          <ImagePlus size={20} />
        </IconButton>
        <FilledButton onClick={send} disabled={!user || !text.trim() || busy}>
          {busy ? t('common.loading') : (submitLabel || t('common.send'))}
        </FilledButton>
      </div>
    </div>
  );
}
