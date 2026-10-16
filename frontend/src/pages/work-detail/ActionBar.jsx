/**
 * 操作行：点赞 / 收藏 / 投喂（或作者的 编辑 - 数据 - 删除）+ 更多菜单。
 * 版面与改动前一致 —— 独立一行 `.work-actions`。
 *
 * 收藏与投喂改成和点赞同一种「图标 + 数字」外观，去掉文字说明：
 * 一行里混着带文字的大按钮和纯图标按钮会很吵，统一之后这一行明显安静了。
 * 含义交给 title / aria-label。
 */
import { Star, Fish, Pencil, MoreHorizontal, Share2, Clock3, Sparkles, Download, Heart, Flag, Trash2, BarChart3 } from 'lucide-react';
import { FilledTonalButton, OutlinedButton, IconButton, Menu, MenuItem, Divider } from '../../ui';
import LikeButton from '../../components/LikeButton';
import IconCountButton from '../../components/IconCountButton';
import { useI18n } from '../../i18n';

export default function ActionBar({ work, user, isOwner, isLater, creationLocked, menuOpen, setMenuOpen, on }) {
  const { t } = useI18n();

  return (
    <div className="work-actions" style={{ marginTop: 12 }}>
      <LikeButton liked={work.liked} count={work.like_count} onToggle={on.like} disabled={!user} />

      {isOwner ? (
        <>
          {!creationLocked && (
            <FilledTonalButton onClick={on.edit} style={{ marginLeft: 4 }}>
              <span slot="icon"><Pencil size={16} /></span>
              {t('common.edit')}
            </FilledTonalButton>
          )}
          <OutlinedButton onClick={on.stats} style={{ marginLeft: 4 }}>
            <span slot="icon"><BarChart3 size={16} /></span>
            {t('work.stats')}
          </OutlinedButton>
          <OutlinedButton onClick={on.del} style={{ marginLeft: 4, '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>
            <span slot="icon"><Trash2 size={16} /></span>
            {t('common.delete')}
          </OutlinedButton>
        </>
      ) : (
        <>
          <IconCountButton
            icon={Star}
            count={work.favorite_count}
            active={Boolean(work.favorited)}
            activeColor="var(--md-sys-color-primary)"
            onClick={on.favorite}
            disabled={!user}
            label={work.favorited ? t('work.favorited') : t('work.favorite')}
            title={!user ? t('card.loginFirst') : (work.favorited ? t('work.favorited') : t('work.favorite'))}
          />
          <IconCountButton
            icon={Fish}
            count={work.feed_count}
            onClick={on.feed}
            disabled={!user || (user?.fish_count || 0) < 1}
            label={t('work.feed')}
            title={t('work.feedHint', { n: user?.fish_count || 0 })}
            fillWhenActive={false}
          />
        </>
      )}

      <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 4 }}>
        <IconButton id="work-more-anchor" onClick={() => setMenuOpen((v) => !v)} aria-label={t('work.moreActions')} title={t('common.more')}>
          <MoreHorizontal size={22} />
        </IconButton>
        <Menu anchor="work-more-anchor" open={menuOpen} onClosed={() => setMenuOpen(false)}>
          {!isOwner && user && (
            <MenuItem onClick={() => { setMenuOpen(false); on.triple(); }}>
              <span className="row" style={{ gap: 10 }}><Sparkles size={18} /> {t('work.triple')}</span>
            </MenuItem>
          )}
          <MenuItem onClick={() => { setMenuOpen(false); on.share(); }}>
            <span className="row" style={{ gap: 10 }}><Share2 size={18} /> {t('common.share')}</span>
          </MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); on.later(); }}>
            <span className="row" style={{ gap: 10 }}><Clock3 size={18} /> {isLater ? t('work.removeLater') : t('work.watchLater')}</span>
          </MenuItem>
          <MenuItem onClick={() => { setMenuOpen(false); on.poster(); }}>
            <span className="row" style={{ gap: 10 }}><Download size={18} /> {t('work.makePoster')}</span>
          </MenuItem>
          {work.like_count > 0 && (
            <MenuItem onClick={() => { setMenuOpen(false); on.likes(); }}>
              <span className="row" style={{ gap: 10 }}><Heart size={18} /> {t('work.whoLiked', { n: work.like_count })}</span>
            </MenuItem>
          )}
          {!isOwner && (
            <>
              <Divider />
              <MenuItem onClick={() => { setMenuOpen(false); on.report(); }}>
                <span className="row" style={{ gap: 10 }}><Flag size={18} /> {t('common.report')}</span>
              </MenuItem>
            </>
          )}
        </Menu>
      </span>
    </div>
  );
}
