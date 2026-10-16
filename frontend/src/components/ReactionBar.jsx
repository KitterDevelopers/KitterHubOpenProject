import { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import MsIcon from './MsIcon';

/* 表态项。
 * ⚠️ 服务端存的**键就是 emoji**（`reactions.emoji`），所以这里只做「显示层映射」：
 *    键照旧用 emoji 收发，画出来的是 Material Symbols 图标 —— 满足
 *    「界面不用 emoji」的规则，又不用迁移任何数据、不影响已有表态。
 *    映射表里没有的键（将来后台加了新表情）会原样显示，不会变成空白。 */
const ICON_OF = {
  '👍': 'thumb_up',
  '❤️': 'favorite',
  '❤': 'favorite',
  '😂': 'sentiment_very_satisfied',
  '👏': 'front_hand',
  '🎉': 'celebration',
  '🌹': 'local_florist',
};

export default function ReactionBar({ targetType, targetId, size = 'sm' }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [reactions, setReactions] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    client.get('/reactions', { params: { target_type: targetType, target_id: targetId } })
      .then((r) => setReactions(r.data))
      .catch(() => setReactions([]));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [targetType, targetId]);

  const toggle = async (emoji) => {
    if (!user) return;
    if (busy) return;
    setBusy(true);
    try {
      const r = await client.post('/reactions', { target_type: targetType, target_id: targetId, emoji });
      setReactions(r.data.reactions);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  if (reactions.length === 0) return null;

  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => toggle(r.emoji)}
          title={user ? t('card.reactHint') : t('card.reactLogin')}
          style={{
            border: r.reacted ? '1px solid var(--md-sys-color-primary)' : '1px solid var(--border-soft)',
            background: r.reacted ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container)',
            borderRadius: 'var(--radius)',
            padding: size === 'lg' ? '5px 12px' : '2px 10px',
            cursor: user ? 'pointer' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: r.reacted ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface)',
          }}
        >
          {ICON_OF[r.emoji]
            ? <MsIcon name={ICON_OF[r.emoji]} size={size === 'lg' ? 16 : 14} />
            : <span style={{ fontSize: size === 'lg' ? 15 : 13 }}>{r.emoji}</span>}
          <span className="muted" style={{ fontSize: size === 'lg' ? 12 : 11 }}>{r.count}</span>
        </button>
      ))}
    </div>
  );
}
