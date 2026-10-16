/**
 * 信息区：未上架提示 → 标题 → 作者行 → 标签 → 描述 → 原作 / 改编自。
 * 版面与改动前保持一致（标题里带徽章、作者行 34px 头像、描述是裸段落不套卡片）。
 */
import { Link } from 'react-router-dom';
import { TextButton } from '../../ui';
import UserAvatar from '../../components/Avatar';
import CodemaoLogo from '../../components/CodemaoLogo';
import CollapsibleText from '../../components/CollapsibleText';
import EditorChip from '../../components/EditorChip';
import UserBadge from '../../components/UserBadge';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { displayName, formatTime } from '../../utils';

export default function Info({ work, derivedWork, onAppeal }) {
  const { t } = useI18n();
  const author = work.author || {};
  const notPublished = work.status !== 'published';

  return (
    <>
      {notPublished && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-tertiary-container)', color: 'var(--md-sys-color-on-tertiary-container)', marginBottom: 12, fontWeight: 600, fontSize: 14 }}>
          {work.status === 'pending' ? t('work.statusPending') : t('work.statusRejected')}
          <span>
            {' '}
            <TextButton style={{ fontSize: 12, color: 'inherit' }} onClick={onAppeal}>{t('work.appeal')}</TextButton>
          </span>
        </div>
      )}

      <h1 style={{ margin: '16px 0 0', fontSize: 24, fontWeight: 800 }}>
        {work.is_pinned && <span className="m3-badge m3-badge--error" style={{ marginRight: 6 }}>{t('card.pinned')}</span>}
        {work.is_featured && (
          <span className="m3-badge m3-badge--primary" style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <MsIcon name="star" size={14} /> {t('work.featured')}
          </span>
        )}
        {/* 编辑器胶囊（Kitten4 / KittenN / Kitten3 / Coco / NEMO / Scratch），带图标 */}
        <EditorChip work={work} className="editor-chip--lg" />
        {work.is_repost && <span className="m3-badge m3-badge--error" style={{ marginRight: 6 }}>{t('work.repost')}</span>}
        {work.title}
      </h1>

      <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <UserAvatar user={author} size={34} />
        <Link to={`/users/${author.uid}`} style={{ fontWeight: 700 }}>{displayName(author)}</Link>
        {/* 统一走 UserBadge：按作者选的徽章（编程猫 / 本站 / 不展示）渲染，别处不要再自己判断 */}
        <UserBadge user={author} />
        <span className="muted" style={{ fontSize: 13 }}> - {formatTime(work.created_at)}</span>
        {/* 投稿时的 IP 属地（快照，不随作者之后搬地方而变） */}
        {author.ip_region && (
          <span className="muted row" style={{ fontSize: 12.5, gap: 3, alignItems: 'center' }}> - <MsIcon name="location_on" size={13} /> {t('profile.ipRegion', { region: author.ip_region })}
          </span>
        )}
        {work.edited_at && <span className="muted" style={{ fontSize: 12 }}> - {t('card.edited')}</span>}
        <span className="m3-badge m3-badge--primary">{work.category}</span>
      </div>

      {work.tags?.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }} aria-label={t('work.tags')}>
          {work.tags.map((tag) => (
            <Link key={tag} to={`/discover?tag=${encodeURIComponent(tag)}`} className="m3-badge" style={{ textDecoration: 'none', cursor: 'pointer' }}>
              # {tag}
            </Link>
          ))}
        </div>
      )}

      {/* 稿件描述：太长就折叠（超过 6 行才出现「展开」，见 components/CollapsibleText.jsx） */}
      <CollapsibleText
        text={work.description || t('work.noDescription')}
        maxLines={6}
        style={{ marginTop: 16 }}
      />

      {work.is_repost && work.original_url && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <MsIcon name="link" size={15} style={{ color: 'var(--md-sys-color-primary)' }} /> {t('work.originalLink')}
          <a href={work.original_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600, overflowWrap: 'anywhere' }}>{work.original_url}</a>
        </div>
      )}

      {derivedWork && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container)', fontSize: 13 }}>
          {t('work.adaptedFrom')}
          <Link to={`/works/${derivedWork.id}`} style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600, marginLeft: 4 }}>
            {t('work.adaptedTitle', { title: derivedWork.title })}
          </Link>
          <span className="muted" style={{ marginLeft: 6 }}>by {displayName(derivedWork.author)}</span>
        </div>
      )}
    </>
  );
}
