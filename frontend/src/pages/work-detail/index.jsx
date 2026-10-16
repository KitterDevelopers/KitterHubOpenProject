/**
 * 作品详情页。
 *
 * 版面沿用改动前那一版：`.detail-grid` 两栏（左：播放器 → 标题 → 作者 → 标签 → 描述 →
 * 原作/改编 → 操作行 → 表情回应 → 试玩评价 → 评论；右：关于作者 / 稿件数据 / 稿件来源 / 猜你喜欢）。
 *
 * 这次重构只做「不改版面」的整理：
 * - 代码按职责拆成 work-detail/ 下的一组文件（原来 607 行塞在一个组件里）；
 * - 提示统一走全站 toast，不再 window.alert / 自己实现 snackbar；
 * - 写操作一律用服务器返回值更新，不再盲改数字、更不整页 reload；
 * - 去掉界面里的符号字符（原海报的 emoji、相关作品的 🎮、评分的 ★☆ 文本），改用图标；
 * - 星级、标签改成 <button>，键盘可达。
 *
 * ⚠️ 内嵌播放器（/kn/player）不做任何改动，见 Player.jsx 顶部说明。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { FilledButton, CircularProgress } from '../../ui';
import client from '../../api/client';
import CommentSection from '../../components/comments';
import EmptyState from '../../components/EmptyState';
import ReactionBar from '../../components/ReactionBar';
import ReportButton from '../../components/ReportButton';
import { toast } from '../../components/Toast';
import { useCreationLocked } from '../../components/CreationGate';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';
import { displayName, fmtChina, fmtCount } from '../../utils';
import { EDITOR_CHIP, editorCodeOf } from '../../components/EditorChip';
import { makePoster } from './poster';
import useWorkDetail from './useWorkDetail';
import Player from './Player';
import Info from './Info';
import ActionBar from './ActionBar';
import Sidebar from './Sidebar';
import { FavoriteDialog, AppealDialog, LikesDialog, StatsDialog, PosterDialog } from './dialogs';

/** 海报背景主题的选择记在本机（换设备就回默认），key 与其它本地偏好一样用 nimao_ 前缀风格 */
const POSTER_THEME_KEY = 'nimao_poster_theme';
function readPosterTheme() {
  try {
    return localStorage.getItem(POSTER_THEME_KEY) || 'brand';
  } catch {
    return 'brand';
  }
}

export default function WorkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const errOf = useErr();
  const { locked: creationLocked } = useCreationLocked();

  const d = useWorkDetail(id);
  const { work, loading, error, related, isLater, isOwner, user } = d;

  // ---- 播放器 ----
  const playerRef = useRef(null);
  const [playKey, setPlayKey] = useState(0);

  // ---- 原作（改编自）----
  const [derivedWork, setDerivedWork] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!work?.derived_from) {
      setDerivedWork(null);
      return undefined;
    }
    client.get(`/works/${work.derived_from}`)
      .then((r) => { if (alive) setDerivedWork(r.data); })
      .catch(() => { if (alive) setDerivedWork(null); });
    return () => { alive = false; };
  }, [work?.derived_from]);

  // ---- 弹窗 ----
  const [menuOpen, setMenuOpen] = useState(false);
  const [favOpen, setFavOpen] = useState(false);
  const [folders, setFolders] = useState([]);
  const [appealOpen, setAppealOpen] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [likeUsers, setLikeUsers] = useState([]);
  const [likesLoading, setLikesLoading] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [poster, setPoster] = useState(null);
  const [posterTheme, setPosterTheme] = useState(readPosterTheme);

  // ---------------- 操作 ----------------

  const fullscreen = () => {
    const el = playerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => toast(t('work.noFullscreen'), 'error'));
  };

  const openFavorite = async () => {
    if (work.favorited) {
      await d.unfavorite();
      return;
    }
    const r = await client.get('/users/me/folders').catch(() => null);
    setFolders(r?.data || []);
    setFavOpen(true);
  };

  const doFeed = () => {
    if (!window.confirm(t('work.feedConfirm', { n: 1 }))) return;
    d.feed(1);
  };

  const doDelete = async () => {
    if (!window.confirm(t('work.confirmDelete'))) return;
    try {
      await d.remove();
      navigate('/discover');
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  const showLikes = async () => {
    setLikesOpen(true);
    setLikesLoading(true);
    try {
      const r = await client.get(`/works/${id}/likes`);
      setLikeUsers(r.data || []);
    } catch {
      setLikeUsers([]);
    } finally {
      setLikesLoading(false);
    }
  };

  const showStats = async () => {
    setStats(null);
    setStatsOpen(true);
    try {
      const r = await client.get(`/works/${id}/stats`);
      setStats(r.data);
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  /** 海报文案：封面 + 作品信息（标题 / 编辑器 / 数据）+ 作者信息 + 二维码（扫开就是本页）。
   *  全在这里翻好再交给 poster.js，绘制层不碰 i18n。 */
  const posterCopy = () => {
    const editorCode = editorCodeOf(work);
    return {
      authorName: displayName(work.author) || t('common.user'),
      authorLabel: t('work.posterAuthorLabel'),
      published: t('work.posterPublished', {
        date: fmtChina(work.created_at, { year: 'numeric', month: 'long', day: 'numeric' }),
      }),
      editor: editorCode ? EDITOR_CHIP[editorCode].label : '',
      stats: [
        t('work.posterViews', { n: fmtCount(work.views || 0) }),
        t('work.posterLikes', { n: fmtCount(work.like_count || 0) }),
        t('work.posterFavs', { n: fmtCount(work.favorite_count || 0) }),
      ],
      scan: t('work.posterScan'),
      tagline: t('footer.tagline'),
      placeholder: t('work.posterCoverPlaceholder'),
    };
  };

  /** 出一张海报并塞进弹窗；出不来返回 false（调用方负责提示，不能一直转圈） */
  const renderPoster = async (themeKey) => {
    try {
      const url = await makePoster(work, posterCopy(), themeKey);
      if (!url) return false;
      setPoster(url);
      return true;
    } catch {
      return false;
    }
  };

  const showPoster = async () => {
    setPoster(null);
    setPosterOpen(true);
    // makePoster 自己兜底（跨域图片污染 canvas 时会去掉封面/头像重画），
    // 真生成不出来会给 null —— 这时给一句人话并关掉弹窗，不能再让它一直转圈。
    if (!(await renderPoster(posterTheme))) {
      setPosterOpen(false);
      toast(t('work.posterFail'), 'error');
    }
  };

  /** 换背景主题：原地重画一张，顺便记住用户的选择（下次打开还是这个主题） */
  const changePosterTheme = async (key) => {
    if (key === posterTheme) return;
    setPosterTheme(key);
    try {
      localStorage.setItem(POSTER_THEME_KEY, key);
    } catch {
      /* 无痕模式写不了 localStorage，不影响出图 */
    }
    setPoster(null);
    if (!(await renderPoster(key))) toast(t('work.posterFail'), 'error');
  };

  // ---------------- 加载 / 错误 ----------------

  if (error) {
    return (
      <div className="page-pad">
        <EmptyState msIcon="sentiment_dissatisfied" title={error}>
          <FilledButton onClick={() => navigate('/discover')}>{t('work.goDiscover')}</FilledButton>
        </EmptyState>
      </div>
    );
  }

  if (loading || !work) {
    return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  }

  return (
    <div className="page-pad detail-grid">
      <div>
        <Player
          playUrl={work.play_url}
          title={work.title}
          playKey={playKey}
          playerRef={playerRef}
          onReload={() => setPlayKey((k) => k + 1)}
          onFullscreen={fullscreen}
        />

        <Info work={work} derivedWork={derivedWork} onAppeal={() => setAppealOpen(true)} />

        <ActionBar
          work={work}
          user={user}
          isOwner={isOwner}
          isLater={isLater}
          creationLocked={creationLocked}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          on={{
            like: d.toggleLike,
            favorite: openFavorite,
            feed: doFeed,
            triple: d.triple,
            share: d.share,
            later: d.toggleLater,
            poster: showPoster,
            likes: showLikes,
            report: () => setReportOpen(true),
            del: doDelete,
            stats: showStats,
            edit: () => navigate(`/works/${id}/edit`),
          }}
        />

        <ReactionBar targetType="work" targetId={work.id} size="lg" />

        <div className="m3-card m3-card--filled" style={{ padding: 20, marginTop: 20 }}>
          <h3 className="row" style={{ margin: '0 0 12px', fontWeight: 800, gap: 6, alignItems: 'center' }}>
            <MessageCircle size={18} /> {t('common.comment')} ({work.comment_count ?? 0})
          </h3>
          <CommentSection
            key={work.id}
            getComments={(sort) => client.get(`/works/${id}/comments`, { params: { sort } }).then((r) => r.data)}
            onSubmit={(content, parentId, imageUrl) => client.post(`/works/${id}/comments`, { content, parent_id: parentId, image_url: imageUrl })}
            onDelete={(commentId) => client.delete(`/works/${id}/comments/${commentId}`)}
            onLikeComment={(commentId) => client.post(`/works/${id}/comments/${commentId}/like`)}
            // 置顶是**作者专属**的（后端 pin_work_comment 里就是 `work.user_id != user.id → 403`）。
            // 这里原来无条件传，于是任何人在任何作品下都能看到「置顶」，点了必然 403 ——
            // 站长就是这么发现「我为什么能管别人作品评论区的置顶」。
            onPinComment={isOwner ? (commentId) => client.post(`/works/${id}/comments/${commentId}/pin`) : undefined}
            commentTarget="work_comment"
            authorUid={work.author?.uid}
          />
        </div>
      </div>

      {/* 右侧栏：关于作者 / 稿件数据 / 稿件来源 / 猜你喜欢 */}
      <Sidebar work={work} related={related} />

      {/* ---- 弹窗 ---- */}
      <FavoriteDialog
        open={favOpen}
        onClose={() => setFavOpen(false)}
        folders={folders}
        onPick={async (fid) => { await d.favoriteInto(fid); setFavOpen(false); }}
      />
      <AppealDialog open={appealOpen} onClose={() => setAppealOpen(false)} title={work.title} onSubmit={d.appeal} />
      <LikesDialog open={likesOpen} onClose={() => setLikesOpen(false)} users={likeUsers} loading={likesLoading} />
      <StatsDialog open={statsOpen} onClose={() => setStatsOpen(false)} stats={stats} />
      <PosterDialog
        open={posterOpen}
        onClose={() => { setPosterOpen(false); setPoster(null); }}
        poster={poster}
        theme={posterTheme}
        onTheme={changePosterTheme}
        filename={`${work.title || 'kitterhub'}.png`}
      />
      {!isOwner && (
        <ReportButton targetType="work" targetId={work.id} noTrigger open={reportOpen} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}
