import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2, Star, Pencil, MessageCircle, BarChart2, Fish, Sparkles, History as HistoryIcon } from 'lucide-react';
import { OutlinedButton, FilledButton, FilledTonalButton, CircularProgress, Dialog, TextButton } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import LikeButton from '../components/LikeButton';
import CommentSection from '../components/comments';
import ReportButton from '../components/ReportButton';
import ReactionBar from '../components/ReactionBar';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import Lightbox from '../components/Lightbox';
import Markdown from '../components/markdown/Markdown';
import PickCatSyncNote from '../pickcat/PickCatSyncNote';
import { toast } from '../components/Toast';
import { formatTime, displayName, fmtChina } from '../utils';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

export default function PostDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const navigate = useNavigate();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');
  const [imgOpen, setImgOpen] = useState('');
  const [versions, setVersions] = useState(null);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const openVersions = async () => {
    try {
      const r = await client.get(`/posts/${id}/versions`);
      setVersions(r.data);
      setVersionsOpen(true);
    } catch (e) {
      toast(err(e), 'error');
    }
  };

  useEffect(() => {
    client.get(`/posts/${id}`).then((r) => setPost(r.data)).catch((e) => setError(err(e)));
  }, [id]);

  if (error) {
    return (
      <div className="page-pad">
        <EmptyState msIcon="sentiment_dissatisfied" title={error}>
          <FilledButton onClick={() => navigate('/forum')}>{t('forum.backToForum')}</FilledButton>
        </EmptyState>
      </div>
    );
  }
  if (!post) return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;

  const isOwner = user && post.author?.uid === user.uid;

  const toggleLike = async () => {
    const res = await client.post(`/posts/${id}/like`);
    setPost({ ...post, liked: res.data.liked, like_count: res.data.like_count });
  };
  const toggleFav = async () => {
    const res = await client.post(`/posts/${id}/favorite`);
    setPost({ ...post, favorited: res.data.favorited });
  };
  // 一键三连：点赞 + 收藏 + 关注作者
  const triple = async () => {
    if (!user) return;
    try {
      await client.post(`/posts/${id}/like`).catch(() => {});
      await client.post(`/posts/${id}/favorite`).catch(() => {});
      if (post.author?.uid && post.author.uid !== user.uid) {
        await client.post(`/users/${post.author.uid}/follow`).catch(() => {});
      }
      setPost({ ...post, liked: true, favorited: true, like_count: (post.like_count || 0) + 1 });
      toast(t('post.tripleDone'));
    } catch { /* ignore */ }
  };
  // 投喂小鱼干（1 或 2 个）：作者获得等量小鱼干 + 每枚 10 经验
  const feedPost = async (count) => {
    if (!user) return;
    if (!window.confirm(t('post.feedConfirm', { n: count }))) return;
    try {
      const res = await client.post(`/posts/${id}/feed`, { count });
      setPost({ ...post, feed_count: res.data.feed_count });
      toast(t('post.feedDone', { n: res.data.my_fish }));
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const vote = async (optionId) => {
    if (!user) return;
    const res = await client.post(`/posts/${id}/poll/vote`, { option_id: optionId });
    setPost({ ...post, poll: res.data.poll });
  };
  const del = async () => {
    if (!window.confirm(t('post.confirmDelete'))) return;
    await client.delete(`/posts/${id}`);
    navigate('/forum');
  };

  const poll = post.poll;
  const pollTotal = poll?.total_votes || 0;

  return (
    <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 只有作者本人能看到：同步状态是本地记录（不含凭据），别人的浏览器里不存在 */}
      {isOwner && (
        <PickCatSyncNote
          ownPostId={post.id}
          title={post.title}
          markdown={post.content}
        />
      )}
      <div className="m3-card m3-card--filled" style={{ padding: 28 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="m3-badge m3-badge--primary">{post.category}</span>
          {post.is_pinned && <span className="m3-badge m3-badge--error">{t('forum.pinned')}</span>}
          {post.is_featured && <span className="m3-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="star" size={14} /> {t('forum.featured')}</span>}
          <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="visibility" size={14} /> {t('post.views', { n: post.views })}</span>
        </div>
        <h1 style={{ margin: '12px 0 0', fontSize: 24, fontWeight: 800 }}>{post.title}</h1>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <UserAvatar user={post.author} size={28} />
          <Link to={`/users/${post.author?.uid}`} style={{ fontWeight: 700 }}>{displayName(post.author)}</Link>
          {/* 发帖时的 IP 属地（快照，不随作者之后搬地方而变） */}
          {post.author?.ip_region && (
            <span className="muted row" style={{ fontSize: 12.5, gap: 3, alignItems: 'center' }}>
              <MsIcon name="location_on" size={13} /> {t('profile.ipRegion', { region: post.author.ip_region })}
            </span>
          )}
          <span className="muted" style={{ fontSize: 13 }}>{formatTime(post.created_at)}</span>
          {post.edited_at && (
            <>
              <span className="muted" style={{ fontSize: 12 }}>{t('post.edited')}</span>
              {isOwner && (
                <TextButton onClick={openVersions} style={{ fontSize: 12, minWidth: 0 }}>
                  <HistoryIcon size={13} style={{ verticalAlign: -2 }} /> {t('post.viewHistory')}
                </TextButton>
              )}
            </>
          )}
        </div>
        {post.topics?.length > 0 && (
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {post.topics.map((topic) => (
              <Link key={topic} to={`/search?q=${encodeURIComponent(topic)}`} className="m3-badge" style={{ textDecoration: 'none' }}># {topic}</Link>
            ))}
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Markdown text={post.content} />
        </div>
        {post.image_url && (
          <img
            src={post.image_url}
            alt={t('post.imageAlt')}
            onClick={() => setImgOpen(post.image_url)}
            style={{ marginTop: 14, maxWidth: '100%', maxHeight: 480, borderRadius: 'var(--radius)', display: 'block', cursor: 'zoom-in' }}
          />
        )}

        {poll && (
          <div className="m3-card" style={{ padding: 16, marginTop: 16 }}>
            <div className="row" style={{ fontWeight: 800, gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <BarChart2 size={17} /> {poll.question}
              {poll.deadline && (
                <span className="m3-badge" style={{ fontSize: 11, background: poll.ended ? 'var(--md-sys-color-surface-container-high)' : 'var(--md-sys-color-tertiary-container)', color: poll.ended ? 'var(--md-sys-color-on-surface-variant)' : 'var(--md-sys-color-on-tertiary-container)' }}>
                  {poll.ended ? t('post.pollEnded') : t('post.pollDeadline', { time: fmtChina(poll.deadline, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
                </span>
              )}
            </div>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {poll.options.map((o) => {
                const pct = pollTotal ? Math.round((o.votes / pollTotal) * 100) : 0;
                const isMine = poll.my_vote === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => vote(o.id)}
                    disabled={!user || poll.ended}
                    style={{
                      position: 'relative', display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                      borderRadius: 'var(--radius)', cursor: (user && !poll.ended) ? 'pointer' : 'default', overflow: 'hidden',
                      border: isMine ? '2px solid var(--md-sys-color-primary)' : '1px solid var(--border-soft)',
                      background: 'var(--md-sys-color-surface-container)',
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'var(--md-sys-color-primary-container)', opacity: 0.5 }} />
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>{isMine ? <MsIcon name="check" size={13} style={{ verticalAlign: -2, marginRight: 3 }} /> : ''}{o.text}</span>
                      <span className="muted">{t('post.pollOptionMeta', { votes: o.votes, pct })}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ fontSize: 12, marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
              <span className="muted">{t('post.pollVoters', { n: pollTotal })}{poll.ended ? t('post.pollClosedSuffix') : (poll.voted && t('post.pollVotedSuffix'))}{!user && t('post.pollLoginSuffix')}</span>
              {poll.voter_avatars?.length > 0 && (
                <span className="row" style={{ gap: 3 }}>
                  {poll.voter_avatars.map((av, i) => (
                    <img key={i} src={av} alt="" style={{ width: 20, height: 20, borderRadius: 'var(--avatar-radius)', objectFit: 'cover', border: '2px solid var(--md-sys-color-surface)' }} title={t('post.anonVoter')} />
                  ))}
                  {poll.total_votes > poll.voter_avatars.length && <span className="muted" style={{ fontSize: 11 }}>{t('post.moreVoters', { n: poll.total_votes })}</span>}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 4, marginTop: 16, flexWrap: 'wrap' }}>
          <LikeButton liked={post.liked} count={post.like_count} onToggle={toggleLike} disabled={!user} />
          <FilledTonalButton onClick={toggleFav} disabled={!user} style={{ marginLeft: 4 }}>
            <span slot="icon"><Star size={18} fill={post.favorited ? 'currentColor' : 'none'} /></span>
            {post.favorited ? t('post.favorited') : t('post.favorite')} {post.favorite_count}
          </FilledTonalButton>
          {!isOwner && user && (
            <FilledTonalButton onClick={triple} style={{ marginLeft: 4 }} title={t('post.tripleTitle')}>
              <span slot="icon"><Sparkles size={18} /></span>
              {t('post.triple')}
            </FilledTonalButton>
          )}
          {!isOwner && user && (
            <FilledTonalButton onClick={() => feedPost(1)} disabled={(user?.fish_count || 0) < 1} style={{ marginLeft: 4 }} title={t('post.myFishTitle', { n: user?.fish_count || 0 })}>
              <span slot="icon"><Fish size={18} /></span>
              {t('post.feedCount', { n: post.feed_count || 0 })}
            </FilledTonalButton>
          )}
          {isOwner && (
            <>
              <OutlinedButton onClick={() => navigate(`/posts/${id}/edit`)} style={{ marginLeft: 4 }}>
                <span slot="icon"><Pencil size={16} /></span>
                {t('common.edit')}
              </OutlinedButton>
              <OutlinedButton onClick={del} style={{ marginLeft: 4, '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>
                <span slot="icon"><Trash2 size={18} /></span>
                {t('common.delete')}
              </OutlinedButton>
            </>
          )}
          {!isOwner && <ReportButton targetType="post" targetId={post.id} />}
        </div>
        <ReactionBar targetType="post" targetId={post.id} size="lg" />
      </div>

      <div className="m3-card m3-card--filled" style={{ padding: 20, marginTop: 16 }}>
        <h3 className="row" style={{ margin: '0 0 12px', fontWeight: 800, gap: 6, alignItems: 'center' }}><MessageCircle size={18} /> {t('post.comments', { n: post.comment_count })}</h3>
        <CommentSection
          getComments={(sort) => client.get(`/posts/${id}/comments`, { params: { sort } }).then((r) => r.data)}
          onSubmit={(content, parentId, imageUrl) => client.post(`/posts/${id}/comments`, { content, parent_id: parentId, image_url: imageUrl })}
          onDelete={(commentId) => client.delete(`/posts/${id}/comments/${commentId}`)}
          onLikeComment={(commentId) => client.post(`/posts/${id}/comments/${commentId}/like`)}
          // 置顶是**楼主专属**的（后端 pin_post_comment：`post.user_id != user.id → 403`）。
          // 原来无条件传，任何人在任何帖子下都看得到「置顶」，点了必然 403。
          onPinComment={isOwner ? (commentId) => client.post(`/posts/${id}/comments/${commentId}/pin`) : undefined}
          commentTarget="post_comment"
          authorUid={post.author?.uid}
        />
      </div>

      <Lightbox src={imgOpen} onClose={() => setImgOpen('')} />

      <Dialog open={versionsOpen} onClose={() => setVersionsOpen(false)} onCancel={() => setVersionsOpen(false)}>
        <div slot="headline" className="row" style={{ gap: 6, alignItems: 'center' }}><HistoryIcon size={18} /> {t('post.editHistory')}</div>
        <div slot="content">
          {!versions ? (
            <div className="muted">{t('common.loading')}</div>
          ) : versions.length === 0 ? (
            <div className="muted">{t('post.noVersions')}</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {versions.map((v) => (
                <div key={v.id} className="m3-card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{v.title}</div>
                  <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{v.content}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{formatTime(v.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div slot="actions">
          <TextButton onClick={() => setVersionsOpen(false)}>{t('common.close')}</TextButton>
        </div>
      </Dialog>
    </div>
  );
}
