import { useEffect, useState } from 'react';
import { Dialog, OutlinedTextField, TextButton } from '../../ui';
import MsIcon from '../MsIcon';
import { resolveUploadUrl } from '../Avatar';
import { useI18n } from '../../i18n';
import { fmtChina } from '../../utils';

// 聊天图片墙
export function MediaDialog({ open, onClose, onLoad, onPreview }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    onLoad()
      .then((list) => setItems(list || []))
      .finally(() => setLoading(false));
  }, [open, onLoad]);

  return (
    <Dialog open={open} onClosed={onClose}>
      <div slot="headline" style={{ fontWeight: 800 }}>
        {t('chat.media')}
      </div>
      <div slot="content" style={{ minWidth: 320, maxWidth: '86vw' }}>
        {loading && <div className="chat-empty-hint">{t('common.loading')}</div>}
        {!loading && items.length === 0 && <div className="chat-empty-hint">{t('chat.noMedia')}</div>}
        <div className="chat-media-grid">
          {items.map((m) => (
            <button key={m.id} type="button" onClick={() => onPreview(resolveUploadUrl(m.image_url))} title={fmtChina(m.created_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}>
              <img src={resolveUploadUrl(m.image_url)} alt={t('chat.media')} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
      </div>
    </Dialog>
  );
}

// 会话内消息搜索
export function SearchDialog({ open, onClose, onSearch, onJump }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [result, setResult] = useState({ messages: [], total: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQ('');
      setResult({ messages: [], total: 0 });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) {
      setResult({ messages: [], total: 0 });
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      const r = await onSearch(q);
      setResult(r);
      setLoading(false);
    }, 240);
    return () => clearTimeout(timer);
  }, [open, q, onSearch]);

  const highlight = (text) => {
    const key = q.trim();
    if (!key || !text) return text;
    const idx = text.toLowerCase().indexOf(key.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="chat-hit">{text.slice(idx, idx + key.length)}</mark>
        {text.slice(idx + key.length)}
      </>
    );
  };

  return (
    <Dialog open={open} onClosed={onClose}>
      <div slot="headline" style={{ fontWeight: 800 }}>
        {t('chat.searchMessages')}
      </div>
      <div slot="content" style={{ minWidth: 320, maxWidth: '86vw' }}>
        <OutlinedTextField
          label={t('chat.keyword')}
          value={q}
          onInput={(e) => setQ(e.target.value)}
          style={{ width: '100%' }}
        >
          <MsIcon slot="leading-icon" name="search" size={20} />
        </OutlinedTextField>
        <div style={{ marginTop: 10, fontSize: 12 }} className="muted">
          {q.trim() ? (loading ? t('chat.searching') : t('chat.searchResult', { total: result.total, shown: result.messages.length })) : t('chat.searchHint')}
        </div>
        <div className="chat-pick-list">
          {result.messages.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chat-pick"
              onClick={() => {
                onJump(m.id);
                onClose();
              }}
            >
              <span className="chat-pick-main">
                <b>{m.sender?.display_name || m.sender?.username || t('chat.anonymous')}</b>
                <small>{highlight(m.content)}</small>
              </span>
              <small className="muted">
                {fmtChina(m.created_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
      </div>
    </Dialog>
  );
}
