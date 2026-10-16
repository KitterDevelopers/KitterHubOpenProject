/** 评论正文：支持 `> ` 引用块，超长折叠。 */
import { useState } from 'react';
import { TextButton } from '../../ui';
import { useI18n } from '../../i18n';

const CLAMP_CHARS = 200;

function QuoteBlock({ text }) {
  return (
    <div
      style={{
        borderLeft: '3px solid var(--border-soft)',
        paddingLeft: 8,
        margin: '4px 0',
        color: 'var(--md-sys-color-on-surface-variant)',
        background: 'var(--md-sys-color-surface-container)',
        borderRadius: '0 var(--radius) var(--radius) 0',
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

export default function CommentBody({ content }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!content) return null;

  const truncated = !open && content.length > CLAMP_CHARS;
  const text = truncated ? content.slice(0, CLAMP_CHARS) : content;
  const lines = text.split('\n');

  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {lines.map((line, i) => (
        // 引用块自己占一行；普通行保留换行符
        <span key={i}>
          {line.startsWith('> ') ? <QuoteBlock text={line.slice(2)} /> : <>{line}{i < lines.length - 1 ? '\n' : ''}</>}
        </span>
      ))}
      {content.length > CLAMP_CHARS && (
        <TextButton style={{ fontSize: 12, padding: 0 }} onClick={() => setOpen((v) => !v)}>
          {open ? t('comment.collapse') : t('comment.expand')}
        </TextButton>
      )}
    </div>
  );
}
