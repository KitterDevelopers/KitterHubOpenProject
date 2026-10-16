import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  OutlinedButton,
  FilledButton,
  FilledTonalButton,
  TextButton,
  IconButton,
  Tabs,
  PrimaryTab,
  CircularProgress,
  Dialog,
  Menu,
  MenuItem,
  Divider,
} from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import CodemaoLogo from '../components/CodemaoLogo';
import WorkCard from '../components/WorkCard';
import WorkSortMenu from '../components/WorkSortMenu';
import EmptyState from '../components/EmptyState';
import UserBadge from '../components/UserBadge';
import MsIcon from '../components/MsIcon';
import { VerifyChip } from '../components/VerifyBadge';
import { toast } from '../components/Toast';
import { formatTime, displayName, parseTs, levelProgress } from '../utils';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

/**
 * 个人主页（访客视角）。
 *
 * ---------------------------------------------------------------------------
 * 版式（2026-10-12 重构）
 *
 * 改版前实测出来的四个问题（1440 / 390 各截过图）：
 *   1) 资料卡摊到 1120px 宽，却只有左边一小块有内容：头像贴着**等级条**底对齐、
 *      名字/简介在中间、关注/私信被甩到最右边，中间空一大片；等级进度条横跨 400px
 *      像把尺子，「下一级还需 N 经验」飘在条子末端，和等级本身脱节。
 *   2) 一行 12.5px 的灰字里塞了 @账号 / UID / 编程猫 / 性别 / 属地 / 注册时间 / 最近活跃，
 *      **身份标识和资料明细混在一起**，看不出谁重要。
 *   3) 内容区没有标题层级，空态是一个 52px 图标 + 48px 内边距的大坑 ——
 *      新号的主页首屏基本就是一块空白。
 *   4) 手机上作品网格是**两列**（.grid-works 窄屏 160px 起），卡片只有 171px 宽，
 *      标题折三行、同行卡片高度还不一样，像塌了一半的瀑布流。
 *
 * 现在：
 *   - 正文一列，900px 居中（与 /settings 的 .acct-page / .appr-page 同宽同语言），
 *     宽屏不再「内容只占左边、右侧空一片」。
 *   - 身份卡内部分三层：**主角**（头像 / 昵称 / 认证徽章 / 简介）、
 *     **次要**（@账号 + UID、等级与经验）、**最次要**（属地 / 注册时间 / 最近活跃 / 性别）。
 *     主操作（关注 / 私信 / 更多）固定在第一屏右上角，更多菜单里才放复制链接与拉黑。
 *   - 内容区：标题 → 页签（带结果数）+ 排序 → 列表/空态；空态用紧凑版，首屏不再被它占满。
 *   - 手机（≤600px）作品网格改成**单列**，卡片回到正常宽度。
 *
 * ⚠️ 这次是**结构性重排**：接口、参数、分页、排序、关注/拉黑/私信/精选/编辑的
 *    state 与调用**一个都没改**，只重排与重画。
 */

// 最近活跃文案：精确到分钟。
// 只有「不足 1 分钟」才说「刚刚活跃」——原来阈值是 1 小时，导致刚登录过的人
// 在整整一小时内都显示「刚刚活跃」，看起来像没更新。
function lastActiveText(ts, t) {
  if (!ts) return t('profile.activeLongAgo');
  const mins = (Date.now() - parseTs(ts)) / 60000;
  if (mins < 1) return t('profile.activeJustNow');
  if (mins < 60) return t('profile.activeMinutesAgo', { n: Math.floor(mins) });
  const hours = mins / 60;
  if (hours < 24) return t('profile.activeHoursAgo', { n: Math.floor(hours) });
  const days = hours / 24;
  if (days < 30) return t('profile.activeDaysAgo', { n: Math.floor(days) });
  return t('profile.activeLongAgo');
}

// 等级进度阈值与算法见 utils.levelProgress（与后端 500/1000/2000/5000/10000/50000 一致）

// 简介 #话题# 高亮
function renderBio(bio, t) {
  if (!bio) return <span className="muted">{t('profile.emptyBio')}</span>;
  const parts = bio.split(/(#[^#\s]{1,20}#)/g);
  return parts.map((p, i) =>
    p.startsWith('#') && p.endsWith('#') ? (
      <Link key={i} to={`/search?q=${encodeURIComponent(p.slice(1, -1))}`} className="profile-topic">
        {p}
      </Link>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

// 无封面时不再画任何装饰性横幅：用户关掉「展示背景图」就该干干净净。
// 数据条里「粉丝 / 关注」是社交关系数，给主色强调；稿件/帖子/获赞/浏览保持常规字色，
// 这样一屏里能一眼分出「我是谁 > 有多少人关注我 > 其它计数」。
function StatCell({ to, icon, num, label, emphasis }) {
  const cls = `profile-stat${emphasis ? ' profile-stat--em' : ''}`;
  const inner = (
    <>
      <b>{num ?? 0}</b>
      <span>
        <MsIcon name={icon} size={13} />
        {label}
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** 个人主页每页条数：12 能被 2/3/4 列整除，网格不会出现半行 */
const WORKS_PER_PAGE = 12;
const POSTS_PER_PAGE = 10;

/** 列表分页条：作品多的时候必须分页，否则一次性渲染几百张卡片 */
function ProfilePager({ page, hasMore, total, perPage, loading, onChange, prevText, nextText, pageText, totalText }) {
  const pages = total ? Math.max(1, Math.ceil(total / perPage)) : null;
  const canPrev = page > 1 && !loading;
  const canNext = (pages ? page < pages : hasMore) && !loading;
  if (!pages && !hasMore && page === 1) return null;
  return (
    <div className="profile-pager">
      <OutlinedButton disabled={!canPrev} onClick={() => onChange(page - 1)}>
        <MsIcon slot="icon" name="chevron_left" size={18} /> {prevText}
      </OutlinedButton>
      <span className="muted" style={{ fontSize: 13 }}>
        {pages ? pageText.replace('{page}', String(page)).replace('{pages}', String(pages)) : `第 ${page} 页`}
        {total ? ` - ${totalText.replace('{n}', String(total))}` : ''}
      </span>
      <OutlinedButton disabled={!canNext} onClick={() => onChange(page + 1)}>
        {nextText} <MsIcon slot="icon" name="chevron_right" size={18} />
      </OutlinedButton>
    </div>
  );
}

/** 内容区小标题：与「精选稿件」同一个层级语言 */
function SectionTitle({ icon, children, extra }) {
  return (
    <h2 className="profile-section-title">
      <MsIcon name={icon} size={17} /> {children}
      {extra}
    </h2>
  );
}

export default function Profile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { t } = useI18n();
  const errOf = useErr();

  const [profile, setProfile] = useState(null);
  const [works, setWorks] = useState([]);
  const [worksSort, setWorksSort] = useState('new');   // 作品列表排序（站长 2026-09-27：个人主页也要能排序）
  const [posts, setPosts] = useState([]);
  const [tab, setTab] = useState('works');
  const [worksPage, setWorksPage] = useState(1);
  const [worksHasMore, setWorksHasMore] = useState(false);
  const [postsPage, setPostsPage] = useState(1);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [paging, setPaging] = useState(false);   // 翻页时的轻量 loading（不整页白屏）
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [cmInfoOpen, setCmInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 背景图（站长 2026-09-27：封面直接当页面背景、资料浮在上面）。
  // 原来是「先按图片真实宽高比撑一个图块、资料排在图块下面」，要读 naturalWidth/Height 写 CSS 变量，
  // 缓存命中时还得手动补读一次 —— 现在封面就是一个 background 层（object-fit: cover + 渐变压暗），
  // 高度由 hero 自己决定，不需要再读图片尺寸了。

  const isMe = !!me && me.uid === id;

  /**
   * 加载主页数据（作品与帖子都按作者精确拉取，不再拉全站再前端过滤）。
   *
   * 站长 2026-10-04：作品一多（有人 173 件）就一次性拉全量、渲染几百张卡片，又长又慢。
   * 现在两边都分页：多取一条判断「还有没有下一页」，总数用 profile 里的计数。
   */
  const load = useCallback(async (order = 'new', wPage = 1, pPage = 1, quiet = false) => {
    if (quiet) setPaging(true); else setLoading(true);
    try {
      const p = await client.get(`/users/${id}`).then((r) => r.data);
      setProfile(p);
      const [w, ps] = await Promise.all([
        // 个人主页只要**已发布**的稿件：待审/未过审不应该出现在主页上
        //（站长 2026-10-01：「审核未过或者待审的稿件还是会出现在个人主页」）。
        // ⚠️ 必须让后端过滤：本人/管理员看同一个接口时后端原本不过滤状态（那是给创作中心用的）。
        client.get(`/works/user/${id}`, {
          params: { sort: order, status: 'published', limit: WORKS_PER_PAGE + 1, skip: (wPage - 1) * WORKS_PER_PAGE },
        }).then((r) => r.data).catch(() => []),
        client.get('/posts', {
          params: { author: id, limit: POSTS_PER_PAGE + 1, skip: (pPage - 1) * POSTS_PER_PAGE },
        }).then((r) => r.data).catch(() => []),
      ]);
      const wRows = Array.isArray(w) ? w : [];
      const pRows = Array.isArray(ps) ? ps : [];
      setWorks(wRows.slice(0, WORKS_PER_PAGE));
      setWorksHasMore(wRows.length > WORKS_PER_PAGE);
      setWorksPage(wPage);
      setPosts(pRows.slice(0, POSTS_PER_PAGE));
      setPostsHasMore(pRows.length > POSTS_PER_PAGE);
      setPostsPage(pPage);
    } catch (e) {
      setErr(errOf(e));
      setProfile(null);
    } finally {
      setLoading(false);
      setPaging(false);
    }
  }, [id]);

  /** 翻页后把列表顶端滚进视野（不然还在页面底部，看不到新内容） */
  const goPage = (which, page) => {
    load(worksSort, which === 'works' ? page : worksPage, which === 'posts' ? page : postsPage, true);
    const el = document.getElementById(which === 'works' ? 'profile-works-grid' : 'profile-posts-list');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    setProfile(null);
    setWorks([]);
    setPosts([]);
    setErr('');
    setTab('works');
    setWorksSort('new');
    setWorksPage(1);
    setPostsPage(1);
    load('new', 1, 1);
  }, [load]);

  // 升级庆祝（仅自己主页）
  useEffect(() => {
    if (isMe && profile?.level > 0) {
      const prev = Number(localStorage.getItem('nimao_last_level') || 0);
      if (prev > 0 && profile.level > prev) toast(t('profile.levelUp', { name: profile.level_name }));
      localStorage.setItem('nimao_last_level', String(profile.level));
    }
  }, [profile?.level, isMe, profile?.level_name]);

  const feed = useMemo(
    () =>
      [
        ...works.map((w) => ({ kind: 'work', data: w, at: w.created_at })),
        ...posts.map((p) => ({ kind: 'post', data: p, at: p.created_at })),
      ].sort((a, b) => parseTs(b.at) - parseTs(a.at)),
    [works, posts]
  );

  // 等级说明与经验明细都搬到「经验中心」了，自己的主页点等级直接过去
  const openLevelInfo = () => {
    if (isMe) navigate('/xp');
  };

  const toggleFollow = async () => {
    if (!me || busy) return;
    setBusy(true);
    try {
      if (profile.is_following) {
        await client.delete(`/users/${id}/follow`);
        setProfile((p) => ({ ...p, is_following: false, followers_count: Math.max(0, p.followers_count - 1) }));
      } else {
        await client.post(`/users/${id}/follow`);
        setProfile((p) => ({ ...p, is_following: true, followers_count: p.followers_count + 1 }));
      }
    } catch (e) {
      toast(errOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async () => {
    try {
      if (profile.i_blocked) {
        await client.delete(`/users/${id}/block`);
        setProfile((p) => ({ ...p, i_blocked: false }));
        toast(t('profile.unblocked'));
      } else {
        await client.post(`/users/${id}/block`);
        setProfile((p) => ({ ...p, i_blocked: true }));
        toast(t('profile.blockedToast'));
      }
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/users/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('profile.linkCopied'));
    } catch {
      toast(url);
    }
  };

  const toggleUserFeatured = async (w) => {
    const current = (profile.featured_works || []).map((f) => f.id);
    const next = current.includes(w.id) ? current.filter((x) => x !== w.id) : [...current, w.id].slice(0, 3);
    try {
      await client.put('/users/me/featured', { work_ids: next });
      load();
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  const moveFeatured = async (w, dir) => {
    const cur = (profile.featured_works || []).map((f) => f.id);
    const i = cur.indexOf(w.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    try {
      await client.put('/users/me/featured', { work_ids: cur });
      load();
    } catch (e) {
      toast(errOf(e), 'error');
    }
  };

  if (loading && !profile) {
    return (
      <div className="page-pad" style={{ textAlign: 'center', paddingTop: 80 }}>
        <CircularProgress indeterminate />
      </div>
    );
  }

  if (err) {
    return (
      <div className="page-pad">
        <EmptyState msIcon="sentiment_dissatisfied" title={err} subtitle={t('profile.errDesc')}>
          <FilledButton onClick={() => navigate('/discover')}>{t('profile.goDiscover')}</FilledButton>
        </EmptyState>
      </div>
    );
  }

  // 被对方拉黑：占位页
  if (profile?.blocked) {
    return (
      <div className="page-pad" style={{ maxWidth: 480, margin: '0 auto' }}>
        <div className="m3-card m3-card--filled" style={{ padding: 32, textAlign: 'center' }}>
          <MsIcon name="block" size={44} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />
          <h1 style={{ margin: '12px 0 6px', fontWeight: 800 }}>{t('profile.blockedTitle')}</h1>
          <p className="muted">{t('profile.blockedDesc', { name: displayName(profile) })}</p>
          <FilledButton onClick={() => navigate('/')} style={{ marginTop: 16 }}>
            {t('profile.backHome')}
          </FilledButton>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const progress = levelProgress(profile.xp, profile.level);
  const featuredIds = (profile.featured_works || []).map((f) => f.id);
  // 只有「用户明确开启展示背景图」且「确实上传了背景图」时才画横幅，其余情况一律不出现任何背景
  const showBanner = profile.show_cover === true && !!profile.cover_url;
  const banText = profile.ban_until ? t('profile.banUntil', { time: profile.ban_until.slice(0, 16).replace('T', ' ') }) : '';

  return (
    // 站长 2026-09-27：背景图是**资料区那一块**的背景（头像/名字/简介/数据条），资料浮在图上；
    // 不是整页背景，下面的精选稿件与作品列表照旧。
    // 2026-10-12：整页正文收进 .profile-page（900px 单列居中），与设置页同一套版式。
    <div className="page-pad">
      <div className="profile-page">
        {profile.is_banned && (
          <div className="profile-ban">
            <MsIcon name="warning" size={20} />
            <span>{t('profile.bannedPre')}{banText}{t('profile.bannedPost')}</span>
          </div>
        )}

        {/* ---------------- 个人信息卡（封面铺满这一块，资料浮在上面）---------------- */}
        <section className={`m3-card profile-hero${showBanner ? ' has-cover' : ' no-cover'}`}>
          {showBanner && (
            <div className="profile-cover" aria-hidden="true">
              <img src={profile.cover_url} alt="" />
            </div>
          )}
          <div className="profile-hero-body">
            <div className="profile-avatar">
              <UserAvatar user={profile} size={96} />
            </div>

            <div className="profile-main">
              {/* ---- 第一层：主角 = 昵称 + 身份徽章 ---- */}
              <div className="profile-name">
                <h1>{displayName(profile)}</h1>
                {/* 徽章展示位：**只按用户选的哪一种**渲染（编程猫 / 本站 / 不展示），
                    见 components/UserBadge.jsx。站长 2026-09-30：两个徽章只能选一个、默认编程猫，
                    而且「等级」在下面的资料里用**文字**写，不再靠本站徽章表示。 */}
                <UserBadge user={profile} size="lg" onClick={profile.badge_choice === 'site' ? openLevelInfo : undefined} title={t('profile.levelInfoTitle')} />
                {profile.verification_type && (
                  <VerifyChip type={profile.verification_type}>{profile.verification_title || t('profile.official')}</VerifyChip>
                )}
                {profile.role === 'admin' && (
                  <span className="m3-badge">
                    <MsIcon name="admin_panel_settings" size={13} /> {t('common.admin')}
                  </span>
                )}
                {/* 风纪委员（2026-10-12 重做）：在职成员在个人主页带一个标识 */}
                {profile.committee === true && (
                  <span className="m3-badge committee-chip">
                    <MsIcon name="shield_person" size={13} /> {t('committee.title')}
                  </span>
                )}
                {!isMe && profile.followed_me && profile.is_following && (
                  <span className="m3-badge m3-badge--primary">
                    <MsIcon name="task_alt" size={13} /> {t('profile.mutualFollow')}
                  </span>
                )}
                {!isMe && profile.followed_me && !profile.is_following && (
                  <span className="m3-badge m3-badge--primary">{t('profile.followedYou')}</span>
                )}
              </div>

              {/* ---- 账号标识：@账号 + UID（身份，不是资料明细）---- */}
              <div className="profile-id">
                <span>@{profile.username}</span>
                <span className="profile-sep" aria-hidden="true" />
                <span>UID {profile.uid || '—'}</span>
              </div>

              {/* ---- 第一层：主角 = 个人简介 ---- */}
              <p className="profile-bio">{renderBio(profile.bio, t)}</p>

              {profile.interests?.length > 0 && (
                <div className="profile-chips">
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t('profile.skills')}
                  </span>
                  {profile.interests.map((interest) => (
                    <span key={interest} className="m3-badge">
                      {interest}
                    </span>
                  ))}
                </div>
              )}

              {/* ---- 第二层：等级与经验（**用文字写**，不用本站等级徽章表示，站长 2026-09-30）。
                      所以这里不再受「展示哪个徽章」影响 —— 徽章是可选装饰，等级是资料本身。
                      LV7 没有下一级，只写文字不画进度条。 ---- */}
              {profile.level > 0 && (
                <div
                  className="profile-level"
                  onClick={isMe ? () => navigate('/xp') : undefined}
                  style={isMe ? { cursor: 'pointer' } : undefined}
                  title={isMe ? t('xp.title') : undefined}
                >
                  <MsIcon name="military_tech" size={15} />
                  <span className="profile-level-text">
                    {t('profile.levelText', { level: profile.level })}
                    {profile.level < 7 ? ` · ${progress.pct}%` : ''}
                  </span>
                  {profile.level < 7 && (
                    <>
                      <span className="profile-level-bar">
                        <i style={{ width: `${progress.pct}%` }} />
                      </span>
                      <span className="profile-level-hint">
                        {isMe ? t('profile.xpToNextMe', { n: progress.need }) : t('profile.xpToNext', { n: progress.need })}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* ---- 第三层：资料明细（属地 / 注册时间 / 最近活跃 / 性别 / 编程猫绑定）---- */}
              <div className="profile-meta">
                {profile.codemao_uid && (
                  <button type="button" className="profile-cm" onClick={() => setCmInfoOpen(true)}>
                    <CodemaoLogo size={12} /> {t('profile.codemao')} {profile.codemao_uid}
                  </button>
                )}
                {profile.gender && (
                  <span>{profile.gender === 'male' ? t('profile.genderMale') : profile.gender === 'female' ? t('profile.genderFemale') : t('profile.genderSecret')}</span>
                )}
                {/* IP 属地：接口在用户关掉开关后返回空串，这里自然不展示 */}
                {profile.ip_region && (
                  <span>
                    <MsIcon name="location_on" size={13} /> {t('profile.ipRegion', { region: profile.ip_region })}
                  </span>
                )}
                <span>
                  <MsIcon name="calendar_today" size={13} /> {t('profile.joinedAt', { time: formatTime(profile.created_at) })}
                </span>
                <span>
                  <MsIcon name="schedule" size={13} /> {lastActiveText(profile.last_login_at, t)}
                </span>
              </div>
            </div>

            {/* ---- 主操作：第一屏右上角 ---- */}
            <div className="profile-actions">
              {isMe ? (
                // 自己的主页只保留「编辑资料」。原来这里还有一个「创作中心」按钮，
                // 站长要求去掉 —— 顶栏本来就有创作中心入口，主页上再放一个是重复的。
                // 目标页仍是 /settings（账号设置里的「个人资料」），只是按访客视角改名。
                <FilledButton onClick={() => navigate('/settings')}>
                  <MsIcon slot="icon" name="edit" size={18} /> {t('profile.editProfile')}
                </FilledButton>
              ) : (
                <>
                  <FilledButton onClick={toggleFollow} disabled={!me || busy}>
                    <MsIcon slot="icon" name={profile.is_following ? 'check' : 'person_add'} size={18} />
                    {profile.is_following ? t('common.unfollow') : t('common.follow')}
                  </FilledButton>
                  <FilledTonalButton onClick={() => navigate(`/chat?to=${profile.uid}`)} disabled={!me}>
                    <MsIcon slot="icon" name="chat_bubble" size={18} /> {t('profile.message')}
                  </FilledTonalButton>
                  {/* 危险操作（拉黑）只出现在这里，不与关注/私信同级争视线 */}
                  <IconButton id="profile-more-anchor" onClick={() => setMoreOpen((v) => !v)} aria-label={t('profile.moreActions')} title={t('common.more')}>
                    <MsIcon name="more_vert" size={22} />
                  </IconButton>
                  <Menu anchor="profile-more-anchor" align="right" open={moreOpen} onClosed={() => setMoreOpen(false)}>
                    <MenuItem onClick={copyLink}>
                      <span className="row" style={{ gap: 10 }}>
                        <MsIcon name="link" size={18} /> {t('profile.copyLink')}
                      </span>
                    </MenuItem>
                    <Divider />
                    <MenuItem onClick={toggleBlock}>
                      <span className="row profile-danger-item" style={{ gap: 10 }}>
                        <MsIcon name="block" size={18} /> {profile.i_blocked ? t('profile.unblock') : t('profile.block')}
                      </span>
                    </MenuItem>
                  </Menu>
                </>
              )}
            </div>
          </div>

          <div className="profile-stats">
            <StatCell icon="palette" num={profile.works_count} label={t('profile.statWorks')} />
            <StatCell icon="article" num={profile.posts_count} label={t('profile.statPosts')} />
            <StatCell icon="group" num={profile.followers_count} label={t('profile.statFollowers')} to={`/users/${id}/followers`} emphasis />
            <StatCell icon="person" num={profile.following_count} label={t('common.follow')} to={`/users/${id}/following`} emphasis />
            <StatCell icon="favorite" num={profile.likes_received} label={t('profile.statLikes')} />
            <StatCell icon="visibility" num={profile.views_received} label={t('profile.statViews')} />
            {isMe && <StatCell icon="paid" num={profile.fish_count || 0} label={t('profile.statFish')} />}
          </div>
        </section>

        {/* ---------------- 精选稿件 ---------------- */}
        {/* 两个坑都在这块：
            1) 这里**不能**用内联 gridTemplateColumns —— 内联样式优先级高于 CSS 媒体查询，
               会把 .grid-works 在窄屏的单列覆盖掉，手机上精选卡就变成整行 366px，
               而下面的稿件卡只有 175px。直接复用 .grid-works 才是对的。
            2) 原来「精选为空」时整块（连标题和「最多 3 个，可排序」的提示）都不渲染，
               结果没设过精选的人在自己主页上完全看不到有这功能 → 自己的主页空的时候要给引导，别人的主页空的时候才整块藏起来。 */}
        {(profile.featured_works?.length > 0 || isMe) && (
          <section className="profile-featured">
            <SectionTitle icon="star" extra={isMe && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{t('profile.featuredHint')}</span>}>
              {t('profile.featured')}
            </SectionTitle>
            {profile.featured_works?.length > 0 ? (
              <div className="grid-works">
                {profile.featured_works.map((w, wi) => (
                  // 这一格 = 卡片 + 操作行。必须用 flex 列 + 卡片 flex:1，
                  // 不能靠卡片自己的 height:100% —— 那会让操作行溢出格子、压住下面的稿件列表。
                  <div key={w.id} className="grid-cell-with-actions">
                    <WorkCard work={w} fillHeight={false} />
                    {isMe && (
                      <div className="row" style={{ gap: 4, justifyContent: 'center', marginTop: 4 }}>
                        <IconButton disabled={wi === 0} onClick={() => moveFeatured(w, -1)} aria-label={t('profile.moveUp')}>
                          <MsIcon name="arrow_upward" size={18} />
                        </IconButton>
                        <IconButton disabled={wi === profile.featured_works.length - 1} onClick={() => moveFeatured(w, 1)} aria-label={t('profile.moveDown')}>
                          <MsIcon name="arrow_downward" size={18} />
                        </IconButton>
                        <TextButton onClick={() => toggleUserFeatured(w)} style={{ fontSize: 12 }}>
                          {t('profile.unfeature')}
                        </TextButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="m3-card m3-card--filled profile-featured-empty">
                {t('profile.featuredEmpty')}
              </div>
            )}
          </section>
        )}

        {/* ---------------- 内容区：标题 → 页签（带结果数）+ 工具 → 列表/空态 ---------------- */}
        <section className="profile-content">
          <SectionTitle icon="widgets">{t('profile.allContent')}</SectionTitle>

          {/* 标签与工具同一行：原来排序在单独一行，白占一行高度 */}
          <div className="profile-list-head">
            <Tabs>
              <PrimaryTab selected={tab === 'works'} onClick={() => setTab('works')}>
                <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                  <MsIcon name="palette" size={15} />
                  {t('profile.tabWorks', { n: isMe ? works.length : (profile.works_count ?? works.length) })}
                </span>
              </PrimaryTab>
              <PrimaryTab selected={tab === 'posts'} onClick={() => setTab('posts')}>
                <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                  <MsIcon name="article" size={15} />
                  {t('profile.tabPosts', { n: profile.posts_count ?? posts.length })}
                </span>
              </PrimaryTab>
              <PrimaryTab selected={tab === 'feed'} onClick={() => setTab('feed')}>
                <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                  <MsIcon name="newspaper" size={15} /> {t('profile.tabFeed', { n: feed.length })}
                </span>
              </PrimaryTab>
            </Tabs>
            {tab === 'works' && (
              <div className="profile-list-tools">
                {paging && <span className="muted" style={{ fontSize: 12.5 }}>{t('common.loading')}</span>}
                <WorkSortMenu
                  value={worksSort}
                  anchorId="profile-works-sort"
                  onChange={(v) => { setWorksSort(v); load(v, 1, postsPage, true); }}
                />
              </div>
            )}
          </div>

          <div className="profile-content-body">
            {tab === 'works' &&
              (works.length === 0 ? (
                // 加载中不能再喊「暂无作品」（站长反馈）：loading 时先显示中间态
                <EmptyState
                  loading={loading}
                  compact
                  msIcon="palette"
                  title={isMe ? t('profile.noWorks') : t('profile.noWorksOther')}
                  subtitle={isMe ? t('profile.noWorksDesc') : undefined}
                >
                  {isMe && <FilledButton onClick={() => navigate('/works/new')}>{t('profile.goCreate')}</FilledButton>}
                </EmptyState>
              ) : (
                <div className="grid-works" id="profile-works-grid">
                  {/* id 给测试与锚点用：页面顶部还有一个「精选」网格也是 .grid-works，光靠类名分不清 */}
                  {works.map((w) => (
                    // 同精选区：格子 = 卡片 + 下面的「设为精选」按钮，卡片用 flex:1 而不是 height:100%
                    <div key={w.id} className="grid-cell-with-actions">
                      <WorkCard work={w} fillHeight={false} />
                      {isMe && (
                        <TextButton
                          onClick={() => toggleUserFeatured(w)}
                          disabled={!featuredIds.includes(w.id) && featuredIds.length >= 3}
                          style={{ width: '100%', fontSize: 12 }}
                        >
                          <MsIcon slot="icon" name={featuredIds.includes(w.id) ? 'star' : 'star_half'} size={16} />
                          {featuredIds.includes(w.id) ? t('profile.featuredOn') : t('profile.featuredOff')}
                        </TextButton>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            {tab === 'works' && works.length > 0 && (
              <ProfilePager
                page={worksPage} hasMore={worksHasMore} total={profile.works_count} perPage={WORKS_PER_PAGE}
                loading={paging} onChange={(p) => goPage('works', p)}
                prevText={t('profile.pagerPrev')} nextText={t('profile.pagerNext')}
                pageText={t('profile.pagerPage')} totalText={t('profile.pagerTotal')}
              />
            )}

            {tab === 'posts' &&
              (posts.length === 0 ? (
                <EmptyState
                  loading={loading}
                  compact
                  msIcon="article"
                  title={isMe ? t('profile.noPosts') : t('profile.noPostsOther')}
                >
                  {isMe && <FilledButton onClick={() => navigate('/posts/new')}>{t('profile.goPost')}</FilledButton>}
                </EmptyState>
              ) : (
                <div id="profile-posts-list">
                {posts.map((p) => (
                  <Link to={`/posts/${p.id}`} key={p.id} className="m3-card profile-post">
                    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                      <span className="m3-badge m3-badge--primary">{p.category || t('profile.catGeneral')}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {formatTime(p.created_at)}
                      </span>
                    </div>
                    <div className="profile-post-title">{p.title}</div>
                    {p.content && <div className="profile-post-excerpt">{String(p.content).slice(0, 90)}</div>}
                    <div className="profile-post-meta">
                      <span>
                        <MsIcon name="visibility" size={13} /> {p.views}
                      </span>
                      <span>
                        <MsIcon name="favorite" size={13} /> {p.like_count}
                      </span>
                      <span>
                        <MsIcon name="comment" size={13} /> {p.comment_count}
                      </span>
                    </div>
                  </Link>
                ))}
                </div>
              ))}
            {tab === 'posts' && posts.length > 0 && (
              <ProfilePager
                page={postsPage} hasMore={postsHasMore} total={profile.posts_count} perPage={POSTS_PER_PAGE}
                loading={paging} onChange={(p) => goPage('posts', p)}
                prevText={t('profile.pagerPrev')} nextText={t('profile.pagerNext')}
                pageText={t('profile.pagerPage')} totalText={t('profile.pagerTotal')}
              />
            )}

            {tab === 'feed' &&
              (feed.length === 0 ? (
                <EmptyState loading={loading} compact msIcon="newspaper" title={t('profile.noFeed')} />
              ) : (
                <div className="profile-timeline">
                  {feed.map((f) => (
                    <Link
                      key={`${f.kind}-${f.data.id}`}
                      to={f.kind === 'work' ? `/works/${f.data.id}` : `/posts/${f.data.id}`}
                      className="profile-tl-item"
                    >
                      <span className={`profile-tl-dot${f.kind === 'work' ? ' is-work' : ''}`}>
                        <MsIcon name={f.kind === 'work' ? 'palette' : 'edit_note'} size={15} />
                      </span>
                      <span className="profile-tl-body">
                        <span className="profile-tl-head">
                          {f.kind === 'work' ? t('profile.feedWork') : t('profile.feedPost')}
                          <span className="muted">{formatTime(f.data.created_at)}</span>
                        </span>
                        <b>{f.data.title}</b>
                        {f.kind === 'work' && f.data.description && (
                          <span className="muted profile-tl-desc">{String(f.data.description).slice(0, 70)}</span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
          </div>
        </section>

        {/* 等级说明与经验明细已整合进「经验中心」页（/xp），这里不再弹窗 */}

        {/* ---------------- 编程猫账号 ---------------- */}
        <Dialog open={cmInfoOpen} onClose={() => setCmInfoOpen(false)} onCancel={() => setCmInfoOpen(false)}>
          <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}>
            <CodemaoLogo size={20} /> {t('profile.codemaoAccount')}
          </div>
          <div slot="content" className="stack">
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <UserAvatar user={{ ...profile, avatar_url: profile.codemao_avatar }} size={56} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{profile.codemao_nickname || t('profile.codemaoUser')}</div>
                <div className="muted" style={{ fontSize: 13 }}>{t('profile.uidLabel')}{profile.codemao_uid}</div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {t('profile.codemaoBound')}
            </div>
          </div>
          <div slot="actions">
            <TextButton onClick={() => setCmInfoOpen(false)}>{t('common.close')}</TextButton>
            <FilledButton onClick={() => window.open(`https://shequ.codemao.cn/user/${profile.codemao_uid}`, '_blank')}>
              <MsIcon slot="icon" name="link" size={16} /> {t('profile.viewCodemao')}
            </FilledButton>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
