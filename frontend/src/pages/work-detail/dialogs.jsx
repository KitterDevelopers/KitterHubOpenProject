/**
 * 作品详情页的弹窗集合。
 *
 * 都是纯展示 + 回调，状态由页面容器持有（弹窗只在自己「打开」时才有意义，
 * 拆成独立组件是为了让容器不用被七段 JSX 撑长）。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, Star } from 'lucide-react';
import {
  Dialog, TextButton, FilledButton, OutlinedButton, OutlinedTextField, CircularProgress,
} from '../../ui';
import UserAvatar from '../../components/Avatar';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { displayName } from '../../utils';
import { POSTER_THEMES } from './poster';

/** 收藏到哪个收藏夹 */
export function FavoriteDialog({ open, onClose, folders, onPick }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} onCancel={onClose}>
      <div slot="headline">{t('work.favWhere')}</div>
      <div slot="content" className="stack" style={{ gap: 8, minWidth: 260 }}>
        {folders.length === 0 && <div className="muted" style={{ fontSize: 14 }}>{t('work.noFolders')}</div>}
        {folders.map((f) => (
          <OutlinedButton key={f.id} onClick={() => onPick(f.id)} style={{ width: '100%', justifyContent: 'flex-start' }}>
            <span slot="icon"><MsIcon name="folder" size={16} /></span>
            {f.name} ({f.count})
          </OutlinedButton>
        ))}
        <OutlinedButton onClick={() => onPick(null)} style={{ width: '100%', justifyContent: 'flex-start' }}>
          <span slot="icon"><Star size={16} /></span>
          {t('work.defaultFolder')}
        </OutlinedButton>
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.cancel')}</TextButton>
      </div>
    </Dialog>
  );
}

/** 提审未通过 → 申诉 */
export function AppealDialog({ open, onClose, title, onSubmit }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} onCancel={onClose}>
      <div slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}>
        <MsIcon name="volunteer_activism" size={18} /> {t('work.submitAppeal')}
      </div>
      <div slot="content" className="stack" style={{ minWidth: 300 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>{t('work.appealDesc', { title })}</div>
        <OutlinedTextField
          label={t('work.appealReason')}
          type="textarea"
          rows={4}
          value={text}
          onInput={(e) => setText(e.target.value)}
        />
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
        <FilledButton
          disabled={!text.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(text);
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('work.submitAppeal')}
        </FilledButton>
      </div>
    </Dialog>
  );
}

/** 谁赞了 */
export function LikesDialog({ open, onClose, users, loading }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} onCancel={onClose}>
      <div slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}>
        <MsIcon name="favorite" size={18} /> {t('work.whoLiked', { n: users.length })}
      </div>
      <div slot="content" className="stack" style={{ minWidth: 260, maxHeight: '50vh', overflowY: 'auto' }}>
        {loading && <div style={{ textAlign: 'center', padding: 12 }}><CircularProgress indeterminate /></div>}
        {!loading && users.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('work.noLikes')}</div>}
        {users.map((u) => (
          <Link
            key={u.uid}
            to={`/users/${u.uid}`}
            onClick={onClose}
            className="row"
            style={{ gap: 10, padding: '6px 4px', textDecoration: 'none', color: 'inherit' }}
          >
            <UserAvatar user={u} size={32} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{displayName(u)}</span>
          </Link>
        ))}
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
      </div>
    </Dialog>
  );
}

/** 作者可见的稿件数据 */
export function StatsDialog({ open, onClose, stats }) {
  const { t } = useI18n();
  const trend = stats?.views_trend_7d || [];
  const peak = Math.max(1, ...trend);
  const cells = stats ? [
    ['work.statTotalViews', stats.views_total],
    ['work.stat7d', stats.views_7d],
    ['work.stat30d', stats.views_30d],
    ['common.like', stats.likes],
    ['work.favorite', stats.favorites],
    ['common.comment', stats.comments],
    ['work.statRating', stats.rating_avg ? t('work.ratingValue', { avg: stats.rating_avg, n: stats.rating_count }) : '—'],
  ] : [];

  return (
    <Dialog open={open} onClose={onClose} onCancel={onClose}>
      <div slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}>
        <BarChart3 size={18} /> {t('work.workStats')}
      </div>
      <div slot="content" style={{ minWidth: 320 }}>
        {!stats ? (
          <div style={{ textAlign: 'center', padding: 16 }}><CircularProgress indeterminate /></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {cells.map(([lk, v]) => (
              <div key={lk} className="m3-card m3-card--filled" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>{t(lk)}</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--md-sys-color-primary)' }}>{v}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('work.trend7d')}</div>
              <div className="row" style={{ gap: 4, alignItems: 'flex-end', height: 60 }}>
                {trend.map((n, i) => (
                  <div
                    key={i}
                    title={t('work.times', { n })}
                    style={{
                      flex: 1,
                      height: Math.max(4, (n / peak) * 56),
                      background: 'var(--md-sys-color-primary)',
                      borderRadius: 'var(--radius) var(--radius) 0 0',
                      minWidth: 10,
                    }}
                  />
                ))}
              </div>
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

/**
 * 分享海报。海报内容固定是「封面 + 作品信息 + 作者信息 + 二维码 + KitterHub LOGO」，
 * 能改的只有背景主题：下面一排色块，点了就回页面重新出一张（换主题瞬间完成，不用关弹窗）。
 */
export function PosterDialog({ open, onClose, poster, filename, theme, onTheme }) {
  const { t } = useI18n();
  return (
    // md-dialog 默认 max-height 是 min(560px, 100% - 48px)：装不下「海报预览 + 主题色块」，
    // 色块会被挤进弹窗内部的滚动区里（看得见图、看不见色块）。这里单独放开高度。
    <Dialog open={open} onClose={onClose} onCancel={onClose}
      style={{ maxHeight: 'min(880px, calc(100% - 48px))' }}>
      <div slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}>
        <Download size={18} /> {t('work.sharePoster')}
      </div>
      <div slot="content" style={{ textAlign: 'center' }}>
        {poster ? (
          <img src={poster} alt={t('work.posterAlt')} style={{ maxWidth: '100%', maxHeight: '52vh', borderRadius: 'var(--radius)' }} />
        ) : (
          <div style={{ padding: 24 }}><CircularProgress indeterminate /></div>
        )}

        <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>{t('work.posterTheme')}</div>
        <div className="row" role="radiogroup" aria-label={t('work.posterTheme')}
          style={{ gap: 10, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {POSTER_THEMES.map((th) => {
            const active = th.key === theme;
            const name = t(`work.posterTheme.${th.key}`);
            return (
              <button
                key={th.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={name}
                title={name}
                data-theme={th.key}
                onClick={() => onTheme(th.key)}
                style={{
                  width: 34, height: 34, padding: 0, cursor: 'pointer', borderRadius: '50%',
                  background: `linear-gradient(135deg, ${th.stops[0]}, ${th.swatch} 55%, ${th.stops[2]})`,
                  border: active ? '2px solid var(--md-sys-color-on-surface)' : '1px solid var(--md-sys-color-outline-variant)',
                  outline: active ? '2px solid var(--md-sys-color-surface)' : 'none',
                  outlineOffset: -4,
                }}
              />
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t('work.posterHint')}</div>
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
        <FilledButton disabled={!poster} onClick={() => {
          const a = document.createElement('a');
          a.href = poster;
          a.download = filename;
          a.click();
        }}>
          <span slot="icon"><Download size={16} /></span>
          {t('work.downloadImage')}
        </FilledButton>
      </div>
    </Dialog>
  );
}
