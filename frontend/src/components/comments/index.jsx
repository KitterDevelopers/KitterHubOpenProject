/**
 * 评论区（稿件详情 / 论坛帖子共用）。
 *
 * 调用方只传「怎么取、怎么提交」这些回调，其余（排序、只看楼主、楼中楼、@ 联想、
 * 图片、引用、点赞乐观更新、置顶、灯箱）都在内部处理。
 *
 * ⚠️ 已按要求**删掉快捷回复**；旧版的自实现窗口 / 共享回复态 / span 点击也一并重做。
 */
import { useMemo, useState } from 'react';
import { MessageSquare, Flame, Clock, UserRound } from 'lucide-react';
import Lightbox from '../Lightbox';
import MsIcon from '../MsIcon';
import Composer from './Composer';
import CommentItem from './CommentItem';
import useComments from './useComments';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n';

/** 排序 / 只看楼主：真正的 button（可键盘操作 + aria-pressed），不是 span onClick */
function FilterButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`wd-chip${active ? ' is-on' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="row" style={{ gap: 4, alignItems: 'center' }}>{children}</span>
    </button>
  );
}

export default function CommentSection({
  getComments,
  onSubmit,
  onDelete,
  onLikeComment,
  onPinComment,
  commentTarget,
  authorUid,
  emptyIcon = 'forum',
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [imgOpen, setImgOpen] = useState('');

  const c = useComments({ getComments, onSubmit, onDelete, onLikeComment, onPinComment });
  const authorOnly = c.onlyAuthor && authorUid;

  // 一次遍历建好父子索引，递归渲染时不再反复 filter
  const kidsByParent = useMemo(() => {
    const map = new Map();
    for (const item of c.comments) {
      if (!item.parent_id) continue;
      if (authorOnly && item.user?.uid !== authorUid) continue;
      const arr = map.get(item.parent_id);
      if (arr) arr.push(item);
      else map.set(item.parent_id, [item]);
    }
    return map;
  }, [c.comments, authorOnly, authorUid]);

  const topLevel = useMemo(
    () => c.comments.filter((x) => !x.parent_id && (!authorOnly || x.user?.uid === authorUid)),
    [c.comments, authorOnly, authorUid]
  );

  const actions = {
    submit: c.submit,
    remove: c.remove,
    pin: onPinComment ? c.pin : null,
    like: onLikeComment ? c.like : null,
    onDelete: onDelete || null,
    onPin: onPinComment || null,
    onImgOpen: setImgOpen,
  };

  return (
    <div>
      <Composer user={user} onSubmit={async (content, imageUrl) => c.submit(content, null, imageUrl)} />

      <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterButton active={c.sort === 'hot'} onClick={() => c.switchSort('hot')}>
          <Flame size={14} /> {t('comment.hot')}
        </FilterButton>
        <FilterButton active={c.sort === 'new'} onClick={() => c.switchSort('new')}>
          <Clock size={14} /> {t('comment.newest')}
        </FilterButton>
        {authorUid && (
          <FilterButton active={c.onlyAuthor} onClick={c.toggleOnlyAuthor}>
            <UserRound size={14} /> {t('comment.authorOnly')}
          </FilterButton>
        )}
      </div>

      <div style={{ marginTop: 4 }}>
        {c.loading ? (
          <div className="muted" style={{ marginTop: 16 }}>{t('comment.loading')}</div>
        ) : c.comments.length === 0 ? (
          <div className="muted row" style={{ marginTop: 16, gap: 6, alignItems: 'center' }}>
            <MsIcon name={emptyIcon} size={16} /> {t('comment.empty')}
          </div>
        ) : topLevel.length === 0 ? (
          <div className="muted row" style={{ marginTop: 16, gap: 6, alignItems: 'center' }}>
            <MessageSquare size={16} /> {t('comment.authorEmpty')}
          </div>
        ) : (
          topLevel.map((item, i) => (
            <CommentItem
              key={item.id}
              comment={item}
              kidsByParent={kidsByParent}
              user={user}
              depth={0}
              floor={i + 1}
              target={commentTarget}
              actions={actions}
            />
          ))
        )}
      </div>

      <Lightbox src={imgOpen} onClose={() => setImgOpen('')} />
    </div>
  );
}
