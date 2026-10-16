import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircularProgress } from '../../ui';
import client from '../../api/client';
import MsIcon from '../MsIcon';
import StatTile from './StatTile';
import TrendBars from './TrendBars';
import WorkStatusBadge from './WorkStatusBadge';
import { fmtCount, fmtChina } from '../../utils';
import { useI18n } from '../../i18n';

// 本周数据（对应 /users/me/weekly_report 的字段）
const WEEK_STATS = [
  ['new_followers', 'creator.weekNewFollowers', 'person_add'],
  ['likes_received', 'creator.weekLikes', 'thumb_up'],
  ['comments_received', 'creator.weekComments', 'comment'],
  ['works_published', 'creator.weekWorks', 'rocket_launch'],
  ['posts_published', 'creator.weekPosts', 'article'],
  ['viewers', 'creator.weekViewers', 'visibility'],
];

// 趋势图取最近 N 个稿件的 /works/{id}/stats 汇总
const TREND_WORK_LIMIT = 8;

function MiniWorkRow({ work, rank }) {
  return (
    <Link to={`/works/${work.id}`} className="cc-mini-row">
      <span className="cc-mini-rank">{rank}</span>
      <span className="cc-mini-body">
        <span className="cc-mini-title">{work.title}</span>
        <span className="cc-mini-metrics">
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="visibility" size={13} /> {fmtCount(work.views)}</span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="thumb_up" size={13} /> {fmtCount(work.like_count)}</span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="comment" size={13} /> {fmtCount(work.comment_count)}</span>
        </span>
      </span>
      <MsIcon name="arrow_forward" size={16} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />
    </Link>
  );
}

export default function CreatorHome({ profile, works, drafts, onGo }) {
  const { t } = useI18n();
  const [weekly, setWeekly] = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [trend, setTrend] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    client.get('/users/me/weekly_report')
      .then((r) => { if (alive) setWeekly(r.data || null); })
      .catch(() => { if (alive) setWeekly(null); })
      .finally(() => { if (alive) setWeeklyLoading(false); });
    return () => { alive = false; };
  }, []);

  // 只在稿件 id 集合变化时重新拉统计，避免父组件每次渲染都重发请求
  const workKey = (works || []).map((w) => w.id).join(',');
  useEffect(() => {
    const ids = workKey ? workKey.split(',').map(Number).slice(0, TREND_WORK_LIMIT) : [];
    if (ids.length === 0) {
      setTrend(new Array(7).fill(0));
      setTrendLoading(false);
      return undefined;
    }
    let alive = true;
    setTrendLoading(true);
    Promise.all(
      ids.map((id) => client.get(`/works/${id}/stats`).then((r) => r.data?.views_trend_7d || null).catch(() => null))
    ).then((rows) => {
      if (!alive) return;
      const ok = rows.filter((r) => Array.isArray(r) && r.length === 7);
      if (ok.length === 0) {
        setTrend(null);
        return;
      }
      const sum = new Array(7).fill(0);
      ok.forEach((row) => row.forEach((v, i) => { sum[i] += Number(v) || 0; }));
      setTrend(sum);
    }).finally(() => { if (alive) setTrendLoading(false); });
    return () => { alive = false; };
  }, [workKey]);

  const labels = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i -= 1) {
      out.push(fmtChina(Date.now() - i * 86400000, { month: 'numeric', day: 'numeric' }));
    }
    return out;
  }, []);

  const totals = useMemo(() => {
    const list = works || [];
    const sum = (k) => list.reduce((a, w) => a + (Number(w[k]) || 0), 0);
    return { views: sum('views'), likes: sum('like_count'), favorites: sum('favorite_count'), comments: sum('comment_count') };
  }, [works]);

  const hot = useMemo(
    () => [...(works || [])].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 3),
    [works]
  );

  const pending = (works || []).filter((w) => w.status === 'pending');
  const rejected = (works || []).filter((w) => w.status === 'rejected');
  const scheduled = (works || []).filter((w) => w.status === 'scheduled');
  const draftList = drafts || [];

  return (
    <div className="cc-home">
      <section className="cc-section">
        <h2 className="cc-section-head"><MsIcon name="workspace_premium" size={18} /> {t('creator.overview')}</h2>
        <div className="cc-tiles">
          <StatTile icon="videocam" label={t('creator.tileWorks')} value={profile?.works_count} hint={t('creator.tilePendingHint', { n: pending.length })} />
          <StatTile icon="visibility" label={t('creator.tileViews')} value={profile?.views_received} hint={t('creator.tileViewsHint')} />
          <StatTile icon="thumb_up" label={t('creator.tileLikes')} value={profile?.likes_received} hint={t('creator.tileLikesHint')} />
          <StatTile icon="person_add" label={t('creator.tileFollowers')} value={profile?.followers_count} hint={t('creator.tileFollowingHint', { n: fmtCount(profile?.following_count) })} />
          <StatTile icon="bookmark" label={t('creator.tileFavorites')} value={totals.favorites} hint={t('creator.tileFavoritesHint')} />
          <StatTile icon="edit_note" label={t('creator.tileDrafts')} value={draftList.length} hint={draftList.length ? t('creator.tileDraftsHint') : t('creator.tileDraftsEmpty')} />
        </div>
      </section>

      <div className="cc-home-grid">
        <div className="stack cc-home-col">
          <section className="cc-section">
            <h2 className="cc-section-head"><MsIcon name="date_range" size={18} /> {t('creator.weeklyTitle')}</h2>
            {weeklyLoading ? (
              <div style={{ textAlign: 'center', padding: '28px 0' }}><CircularProgress indeterminate /></div>
            ) : !weekly ? (
              <div className="cc-alert">{t('creator.weeklyFailed')}</div>
            ) : (
              <>
                <div className="cc-tiles cc-tiles--compact">
                  {WEEK_STATS.map(([key, labelKey, icon]) => (
                    <StatTile key={key} icon={icon} label={t(labelKey)} value={weekly[key] ?? 0} />
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {t('creator.weekRange', { since: fmtChina(weekly.since, { month: 'numeric', day: 'numeric' }) })}
                </div>
              </>
            )}
          </section>

          <section className="cc-section">
            <h2 className="cc-section-head"><MsIcon name="bar_chart" size={18} /> {t('creator.trendTitle')}</h2>
            {trendLoading ? (
              <div style={{ textAlign: 'center', padding: '28px 0' }}><CircularProgress indeterminate /></div>
            ) : trend ? (
              <>
                <TrendBars values={trend} labels={labels} unit={t('creator.trendUnit')} />
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {t('creator.trendSummary', { n: Math.min((works || []).length, TREND_WORK_LIMIT) })}
                </div>
              </>
            ) : (
              <div className="cc-alert">{t('creator.trendEmpty')}</div>
            )}
          </section>
        </div>

        <div className="stack cc-home-col">
          <section className="cc-section">
            <h2 className="cc-section-head"><MsIcon name="checklist" size={18} /> {t('creator.todoTitle')}</h2>
            {pending.length + rejected.length + scheduled.length + draftList.length === 0 ? (
              <div className="cc-alert cc-alert--ok">
                <MsIcon name="task_alt" size={18} /> {t('creator.todoNone')}
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {pending.length > 0 && (
                  <button type="button" className="cc-todo" onClick={() => onGo('works', 'pending')}>
                    <MsIcon name="pending" size={18} />
                    <span><b>{pending.length}</b> {t('creator.todoPendingTail')}</span>
                    <MsIcon name="arrow_forward" size={16} />
                  </button>
                )}
                {rejected.length > 0 && (
                  <button type="button" className="cc-todo cc-todo--warn" onClick={() => onGo('works', 'rejected')}>
                    <MsIcon name="cancel" size={18} />
                    <span><b>{rejected.length}</b> {t('creator.todoRejectedTail')}</span>
                    <MsIcon name="arrow_forward" size={16} />
                  </button>
                )}
                {scheduled.length > 0 && (
                  <button type="button" className="cc-todo" onClick={() => onGo('works', 'scheduled')}>
                    <MsIcon name="schedule" size={18} />
                    <span><b>{scheduled.length}</b> {t('creator.todoScheduledTail')}</span>
                    <MsIcon name="arrow_forward" size={16} />
                  </button>
                )}
                {draftList.length > 0 && (
                  <button type="button" className="cc-todo" onClick={() => onGo('drafts')}>
                    <MsIcon name="edit_note" size={18} />
                    <span>{t('creator.todoDraftsPre')} <b>{draftList.length}</b> {t('creator.todoDraftsPost')}</span>
                    <MsIcon name="arrow_forward" size={16} />
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="cc-section">
            <h2 className="cc-section-head"><MsIcon name="local_fire_department" size={18} /> {t('creator.hotTitle')}</h2>
            {hot.length === 0 ? (
              <div className="cc-alert">{t('creator.hotEmptyPre')} <Link to="/works/new">{t('creator.hotEmptyLink')}</Link> {t('creator.hotEmptyPost')}</div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {hot.map((w, i) => <MiniWorkRow key={w.id} work={w} rank={i + 1} />)}
              </div>
            )}
          </section>

          {(rejected.length > 0) && (
            <section className="cc-section">
              <h2 className="cc-section-head"><MsIcon name="warning" size={18} /> {t('creator.rejectedTitle')}</h2>
              <div className="stack" style={{ gap: 6 }}>
                {rejected.slice(0, 3).map((w) => (
                  <Link key={w.id} to={`/works/${w.id}/edit`} className="cc-mini-row">
                    <span className="cc-mini-body">
                      <span className="cc-mini-title">{w.title}</span>
                      <span className="cc-mini-metrics">
                        <WorkStatusBadge status={w.status} />
                        <span className="muted">{t('creator.updatedAt', { time: fmtChina(w.edited_at || w.created_at, { month: 'numeric', day: 'numeric' }) })}</span>
                      </span>
                    </span>
                    <MsIcon name="edit" size={16} style={{ color: 'var(--md-sys-color-on-surface-variant)' }} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
