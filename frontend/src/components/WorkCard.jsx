import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Heart, MessageCircle, Pin, Gamepad2, Palette, Music, BookOpen, Calculator, FlaskConical, Clapperboard, Puzzle, Clock3, Check } from 'lucide-react';
import UserAvatar from './Avatar';
import EditorChip from './EditorChip';
import MsIcon from './MsIcon';
import { useI18n } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { toast } from './Toast';
import client, { errMsg } from '../api/client';
import { formatTime, displayName } from '../utils';

const COVER_ICONS = [Gamepad2, Palette, Music, BookOpen, Calculator, FlaskConical, Clapperboard, Puzzle];

/**
 * 稿件卡片。
 *
 * fillHeight：卡片是否撑满父容器高度（默认 true，让同一行的卡片等高）。
 *   在网格里用 `height: 100%` 实现。⚠️ 如果卡片**下面还有别的内容**（比如个人主页
 *   精选区的「↑ ↓ 取消精选」操作行），这个 100% 会以网格行高为准、把操作行挤出格子，
 *   结果操作行盖到下一个区块上。那种场景传 `fillHeight={false}`，并在父层用
 *   flex 列 + `flex: 1` 让卡片吃剩余高度（见 .grid-cell-with-actions）。
 *
 * quickActions：悬停时在封面右上角浮出「收藏 / 稍后再看」两个快捷按钮（发现页在用）。
 *   整张卡片是一个 <Link>，所以这两个按钮必须 preventDefault，否则点它们会跳进详情页。
 *   「稍后再看」是**纯前端**的（localStorage，和 /later 页同一个 key），收藏走
 *   POST /works/{id}/favorite。
 */
// 注：编辑器胶囊（EditorChip）一律显示，站长要求任何页面的作品卡片都要有，所以不再有 hideCodemao
export default function WorkCard({ work, fillHeight = true, quickActions = false }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const CoverIcon = COVER_ICONS[work.id % COVER_ICONS.length];
  const grad = `grad-${(work.id % 5) + 1}`;
  const [fav, setFav] = useState(Boolean(work.favorited));
  const [busy, setBusy] = useState(false);
  const laterKey = `nimao_later_${user?.uid || 'anon'}`;
  const [later, setLater] = useState(() => {
    if (!quickActions) return false;
    try {
      return JSON.parse(localStorage.getItem(laterKey) || '[]').includes(work.id);
    } catch {
      return false;
    }
  });

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const toggleFav = async (e) => {
    stop(e);
    if (!user) {
      toast(t('card.loginFirst'), 'error');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const r = await client.post(`/works/${work.id}/favorite`);
      setFav(Boolean(r.data.favorited));
      toast(r.data.favorited ? t('card.favAdded') : t('card.favRemoved'), 'ok');
    } catch (err) {
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleLater = (e) => {
    stop(e);
    if (!user) {
      toast(t('card.loginFirst'), 'error');
      return;
    }
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(laterKey) || '[]');
    } catch {
      list = [];
    }
    const has = list.includes(work.id);
    const next = has ? list.filter((x) => x !== work.id) : [work.id, ...list];
    localStorage.setItem(laterKey, JSON.stringify(next));
    setLater(!has);
    toast(has ? t('card.laterRemoved') : t('card.laterAdded'), 'ok');
  };

  return (
    <Link
      to={`/works/${work.id}`}
      className="m3-card work-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(fillHeight ? { height: '100%' } : null),
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
    >
      <div className="work-media">
        {work.cover_url ? (
          <img src={work.cover_url} alt={work.title} loading="lazy" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div className={`work-cover ${grad}`} style={{ fontSize: 40 }}><CoverIcon size={42} strokeWidth={1.6} /></div>
        )}
        {quickActions && (
          <span className="work-quick">
            <span
              role="button"
              tabIndex={0}
              className={`work-quick-btn${fav ? ' is-on' : ''}`}
              title={fav ? t('card.favRemove') : t('card.favAdd')}
              aria-label={fav ? t('card.favRemove') : t('card.favAdd')}
              aria-pressed={fav}
              onClick={toggleFav}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleFav(e); }}
            >
              <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
            </span>
            <span
              role="button"
              tabIndex={0}
              className={`work-quick-btn${later ? ' is-on' : ''}`}
              title={later ? t('card.laterRemove') : t('card.laterAdd')}
              aria-label={later ? t('card.laterRemove') : t('card.laterAdd')}
              aria-pressed={later}
              onClick={toggleLater}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleLater(e); }}
            >
              {later ? <Check size={16} /> : <Clock3 size={16} />}
            </span>
          </span>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>{work.title}</div>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <UserAvatar user={work.author} size={18} />
          <span className="muted" style={{ fontSize: 12 }}>{displayName(work.author)}</span>
          <span className="muted" style={{ fontSize: 12 }}> - {formatTime(work.created_at)}</span>
          {work.edited_at && <span className="muted" style={{ fontSize: 11 }}> - {t('card.edited')}</span>}
        </div>
        <div className="row" style={{ gap: 12, marginTop: 'auto', paddingTop: 10, fontSize: 12, color: 'var(--md-sys-color-on-surface-variant)' }}>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><Play size={12} /> {work.views}</span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><Heart size={12} /> {work.like_count}</span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MessageCircle size={12} /> {work.comment_count}</span>
          {work.feed_count > 0 && <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="set_meal" size={13} /> {work.feed_count}</span>}
          {work.is_pinned && <span className="m3-badge m3-badge--error"><Pin size={11} /> {t('card.pinned')}</span>}
          {/* 编辑器胶囊：Kitten4 / KittenN / Kitten3 / Coco / NEMO / Scratch 各一枚，带图标 */}
          <EditorChip work={work} />
        </div>
      </div>
    </Link>
  );
}
