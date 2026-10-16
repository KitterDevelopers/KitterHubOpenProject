/**
 * 单条评论（递归渲染自己的回复）。
 *
 * 与旧实现的区别：
 * - 「回复 / 引用」的展开状态**每条评论自己持有**，不再由容器共用一个 replyTo/replyText。
 *     旧做法是全局只有一个回复框，点到别处会串；现在互不干扰。
 * - 缩进层级封顶，深楼中楼在窄屏也不会被挤成一条缝。
 * - 不再出现 window.confirm / alert。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pin } from 'lucide-react';
import { TextButton } from '../../ui';
import UserAvatar from '../Avatar';
import LikeButton from '../LikeButton';
import ReactionBar from '../ReactionBar';
import CommentBody from './CommentBody';
import Composer from './Composer';
import ReportButton from '../ReportButton';
import { useI18n } from '../../i18n';
import { displayName, formatTime } from '../../utils';

const MAX_INDENT_DEPTH = 2;   // 超过这个深度不再继续加内边距
// 可以举报的评论 target（与点赞/表情/敏感词/风纪委员队列同一套类型）
const COMMENT_TARGETS = ['work_comment', 'post_comment'];

export default function CommentItem({ comment, kidsByParent, user, depth = 0, floor = null, target, actions }) {
  const { t } = useI18n();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');

  const kids = kidsByParent.get(comment.id) || [];
  const isMine = Boolean(user && comment.user?.uid === user.uid);

  const openReply = () => { setDraft(''); setReplying(true); };
  const openQuote = () => {
    setDraft(`> ${String(comment.content || '').split('\n').join('\n> ')}\n`);
    setReplying(true);
  };

  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginTop: 16 }}>
      <Link to={`/users/${comment.user.uid}`} aria-label={displayName(comment.user)}>
        <UserAvatar user={comment.user} size={depth > 0 ? 28 : 34} />
      </Link>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {floor && <span className="muted" style={{ fontSize: 11 }}>#{floor}</span>}
          <Link to={`/users/${comment.user.uid}`} style={{ fontWeight: 700, fontSize: 14 }}>{displayName(comment.user)}</Link>
          {comment.pinned && (
            <span className="m3-badge" style={{ fontSize: 10 }}>
              <Pin size={10} style={{ verticalAlign: -1 }} /> {t('comment.pinned')}
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>{formatTime(comment.created_at)}</span>
          {/* IP 属地：只显示属地本身（如「辽宁省」），不写「IP属地：」前缀；
              接口在作者关掉开关后返回空串，这里自然不显示 */}
          {comment.user?.ip_region && (
            <span className="muted" style={{ fontSize: 12 }}>{comment.user.ip_region}</span>
          )}
        </div>

        <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.6, wordBreak: 'break-word' }}>
          {comment.reply_to && (
            <span style={{ color: 'var(--md-sys-color-primary)' }}>
              {t('comment.replyTo', { name: displayName(comment.reply_to) })}
            </span>
          )}
          <CommentBody content={comment.content} />
        </div>

        {comment.image_url && (
          <img
            src={comment.image_url}
            alt={t('comment.imageAlt')}
            onClick={() => actions.onImgOpen(comment.image_url)}
            style={{ marginTop: 6, maxWidth: 220, maxHeight: 160, borderRadius: 'var(--radius)', display: 'block', cursor: 'zoom-in' }}
          />
        )}

        {target && <ReactionBar targetType={target} targetId={comment.id} />}

        {user && (
          <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {actions.onLike && (
              <LikeButton liked={comment.liked} count={comment.like_count} onToggle={() => actions.like(comment.id)} disabled={!user} />
            )}
            <TextButton onClick={() => (replying ? setReplying(false) : openReply())}>
              {replying ? t('common.cancel') : t('comment.reply')}
            </TextButton>
            <TextButton onClick={openQuote}>{t('comment.quote')}</TextButton>
            {isMine && actions.onDelete && (
              <TextButton
                onClick={() => { if (window.confirm(t('comment.confirmDelete'))) actions.remove(comment.id); }}
                style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)' }}
              >
                {t('common.delete')}
              </TextButton>
            )}
            {actions.onPin && (
              <TextButton onClick={() => actions.pin(comment.id)} style={{ fontSize: 12 }}>
                {comment.pinned ? t('comment.unpin') : t('comment.pin')}
              </TextButton>
            )}
            {/* 举报评论（站长 2026-10-01：「评论加上举报功能」）。
                target 就是评论的精确类型（work_comment / post_comment），
                和点赞、表情、敏感词、风纪委员队列用的是同一套，举报才能进得了风纪委员的巡逻队列。
                自己的评论不显示举报。 */}
            {!isMine && COMMENT_TARGETS.includes(target) && (
              <ReportButton targetType={target} targetId={comment.id} variant="text" />
            )}
          </span>
        )}

        {replying && (
          <Composer
            user={user}
            variant="reply"
            autoFocus
            initialText={draft}
            label={t('comment.replyToUser', { name: displayName(comment.user) })}
            onSubmit={async (content) => { await actions.submit(content, comment.id); setReplying(false); }}
            onCancel={() => setReplying(false)}
          />
        )}

        {kids.length > 0 && (
          <div style={{ paddingLeft: depth < MAX_INDENT_DEPTH ? 16 : 0, borderLeft: depth < MAX_INDENT_DEPTH ? '2px solid var(--border-soft)' : 'none' }}>
            {kids.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                kidsByParent={kidsByParent}
                user={user}
                depth={depth + 1}
                target={target}
                actions={actions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
