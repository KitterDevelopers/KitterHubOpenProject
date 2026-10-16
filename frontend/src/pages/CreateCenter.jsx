import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircularProgress } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import UserAvatar from '../components/Avatar';
import MsIcon from '../components/MsIcon';
import { VerifyChip } from '../components/VerifyBadge';
import LevelBadge from '../components/LevelBadge';
import CreatorHome from '../components/creator/CreatorHome';
import CreatorWorks from '../components/creator/CreatorWorks';
import CreatorInteract from '../components/creator/CreatorInteract';
import DraftsPanel from './Drafts';
import { SeriesList } from './Series';
import { displayName, fmtCount, levelProgress } from '../utils';
import { useI18n } from '../i18n';

// 侧栏导航：key 与 ?tab= 一致，count 由汇总数据填充
const NAV = [
  { key: 'overview', label: 'creator.navOverview', icon: 'bar_chart', desc: 'creator.navOverviewDesc' },
  { key: 'works', label: 'creator.navWorks', icon: 'videocam', desc: 'creator.navWorksDesc' },
  { key: 'drafts', label: 'creator.navDrafts', icon: 'edit_note', desc: 'creator.navDraftsDesc' },
  { key: 'series', label: 'creator.navSeries', icon: 'folder', desc: 'creator.navSeriesDesc' },
  { key: 'interact', label: 'creator.navInteract', icon: 'favorite', desc: 'creator.navInteractDesc' },
];

// 旧链接兼容：/create?tab=weekly 曾在用
const TAB_ALIAS = { weekly: 'overview' };

export default function CreateCenter() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawTab = TAB_ALIAS[params.get('tab')] || params.get('tab');
  const [tab, setTab] = useState(NAV.some((n) => n.key === rawTab) ? rawTab : 'overview');
  const [worksFilter, setWorksFilter] = useState('all');

  const [profile, setProfile] = useState(null);
  const [works, setWorks] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (NAV.some((n) => n.key === rawTab)) setTab(rawTab);
  }, [rawTab]);

  const uid = user?.uid;

  const load = useCallback(async () => {
    if (!uid) return undefined;
    let alive = true;
    setLoading(true);
    const [p, w, d, s] = await Promise.all([
      client.get(`/users/${uid}`).then((r) => r.data).catch(() => null),
      client.get(`/works/user/${uid}`).then((r) => r.data).catch(() => []),
      client.get('/drafts').then((r) => r.data).catch(() => []),
      client.get('/works/series/list').then((r) => r.data).catch(() => []),
    ]);
    if (!alive) return undefined;
    setProfile(p);
    setWorks(Array.isArray(w) ? w : []);
    setDrafts(Array.isArray(d) ? d : []);
    setSeries(Array.isArray(s) ? s : []);
    setLoading(false);
    return undefined;
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    works: works.length,
    drafts: drafts.length,
    series: series.length,
  }), [works.length, drafts.length, series.length]);

  const go = (key, filter) => {
    if (filter) setWorksFilter(filter);
    else if (key === 'works') setWorksFilter('all');
    setTab(key);
    navigate(`/create?tab=${key}`, { replace: true });
  };

  const xp = levelProgress(profile?.xp, profile?.level);

  return (
    <div className="page-pad">
      {/* 创作者横幅 */}
      <section className="cc-hero">
        <div className="cc-hero-id">
          <UserAvatar user={user} size={64} />
          <div className="cc-hero-text">
            <div className="cc-hero-name">
              <b>{displayName(user)}</b>
              {profile?.verification_title && (
                <VerifyChip type={profile.verification_type}>{profile.verification_title}</VerifyChip>
              )}
              {profile?.level > 0 && (
                <LevelBadge level={profile.level} name={profile.level_name} size="sm" title={t('creator.levelTitle')} />
              )}
            </div>
            <div className="cc-hero-sub muted">
              @{uid || '—'} - {t('creator.workbench')}
              <Link to={`/users/${uid}`} className="cc-hero-link">{t('creator.viewProfile')}</Link>
            </div>
            {profile?.level > 0 && profile.level < 7 ? (
              <div className="cc-xp">
                <div className="cc-xp-track"><i style={{ width: `${xp.pct}%` }} /></div>
                <span className="cc-xp-text muted">
                  {profile.level_name} - {xp.pct}% - {t('creator.xpNeed', { n: fmtCount(xp.need) })}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="cc-hero-stats">
          <div className="cc-hero-stat"><b>{fmtCount(profile?.works_count ?? works.length)}</b><span>{t('creator.statLabelWorks')}</span></div>
          <div className="cc-hero-stat"><b>{fmtCount(profile?.followers_count)}</b><span>{t('creator.statLabelFollowers')}</span></div>
          <div className="cc-hero-stat"><b>{fmtCount(profile?.likes_received)}</b><span>{t('creator.statLabelLikes')}</span></div>
          <div className="cc-hero-stat"><b>{fmtCount(profile?.views_received)}</b><span>{t('creator.statLabelViews')}</span></div>
        </div>
      </section>

      {/*
        开始创作：把「投稿作品 / 发布帖子」做成两个大卡片单独占一条。
        原来这两个按钮挤在横幅最右侧、4 个统计数字后面 —— 那是整页最不显眼的位置，
        而「创作中心」最该被一眼看到的就是这两个动作。
      */}
      <section className="cc-start" aria-label={t('creator.startTitle')}>
        <button type="button" className="cc-start-card" onClick={() => navigate('/works/new')}>
          <span className="cc-start-icon"><MsIcon name="rocket_launch" size={24} /></span>
          <span className="cc-start-text">
            <b className="cc-start-title">{t('creator.publishWork')}</b>
            <span className="cc-start-desc">{t('creator.startWorkDesc')}</span>
            {drafts.filter((d) => d.draft_type === 'work').length > 0 && (
              <span className="cc-start-note">
                {t('creator.startDrafts', { n: drafts.filter((d) => d.draft_type === 'work').length })}
              </span>
            )}
          </span>
          <MsIcon name="arrow_forward" size={20} className="cc-start-go" />
        </button>

        <button type="button" className="cc-start-card" onClick={() => navigate('/posts/new')}>
          <span className="cc-start-icon cc-start-icon--post"><MsIcon name="edit" size={24} /></span>
          <span className="cc-start-text">
            <b className="cc-start-title">{t('creator.publishPost')}</b>
            <span className="cc-start-desc">{t('creator.startPostDesc')}</span>
          </span>
          <MsIcon name="arrow_forward" size={20} className="cc-start-go" />
        </button>
      </section>

      <div className="cc-shell">
        {/* 桌面端侧栏 */}
        <nav className="cc-nav" aria-label={t('creator.centerNav')}>
          <div className="cc-nav-list">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                className="cc-nav-item"
                aria-current={tab === n.key ? 'true' : undefined}
                onClick={() => go(n.key)}
              >
                <MsIcon name={n.icon} size={19} />
                <span className="cc-nav-text">
                  <span className="cc-nav-label">{t(n.label)}</span>
                  <span className="cc-nav-desc">{t(n.desc)}</span>
                </span>
                {counts[n.key] > 0 && <span className="cc-nav-count">{counts[n.key]}</span>}
              </button>
            ))}
          </div>
        </nav>

        <div className="cc-main">
          {/* 移动端横向导航 */}
          <div className="cc-nav-mobile">
            {NAV.map((n) => (
              <button
                key={n.key}
                type="button"
                className="cc-nav-chip"
                aria-current={tab === n.key ? 'true' : undefined}
                onClick={() => go(n.key)}
              >
                <MsIcon name={n.icon} size={16} />
                {t(n.label)}
                {counts[n.key] > 0 && <span className="cc-nav-chip-count">{counts[n.key]}</span>}
              </button>
            ))}
          </div>

          {loading && !profile ? (
            <div style={{ textAlign: 'center', padding: '64px 0' }}><CircularProgress indeterminate /></div>
          ) : (
            <>
              {tab === 'overview' && <CreatorHome profile={profile} works={works} drafts={drafts} onGo={go} />}
              {tab === 'works' && (
                <CreatorWorks
                  key={worksFilter}
                  works={works}
                  loading={false}
                  initialStatus={worksFilter}
                  onChanged={load}
                />
              )}
              {tab === 'drafts' && <DraftsPanel drafts={drafts} loading={false} onChanged={load} />}
              {tab === 'series' && <SeriesList items={series} onChanged={load} />}
              {tab === 'interact' && <CreatorInteract />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
