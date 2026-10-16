/**
 * 国庆第二个活动「锦绣山河 - 点亮中国」（/contest/lit-china）。
 *
 * 站长 2026-09-27：「做一个页面上面放上类似管理后台的地图，只要一个省有用户就用红色点亮，
 * 每点亮一省那个页面就提示某某省已点亮，然后领取来自那个省的国庆祝福（两个小鱼干，
 * 所有人都可以领）。用户还可以在这个页面上代表自己的省投出一个作品（国庆题材，发布时间
 * 10.1 日以后），10月12日截止，每省的投稿作品点赞量最多的发50个小鱼干，每省独立分区。」
 *
 * 口径（动手前问过站长，见 app/map_event.py 顶部注释）：
 * - 点亮 = 活动期间（10.1 起）**有该省的人访问过站点**；
 * - 祝福 = 每个已点亮的省，人人可领一次 2 小鱼干，可累计；
 * - 投稿按**发布时的属地快照**分区，一人可投多件、转载不参加；
 * - 每省点赞第一名 50 小鱼干，每省独立。
 *
 * 页面自己**不算名次、也不判断能不能领**：全部来自 `/api/map-event`。
 * 轮询（15 秒）只做一件事：把新点亮的省播报出来（「XX省已点亮」）—— 站长要的「每点亮一省就提示」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, Clock, Fish, Gift, MapPin, Medal, Megaphone, PartyPopper, Sparkles, Trophy, ArrowRight, ListOrdered, Check,
} from 'lucide-react';
import { CircularProgress, FilledButton, OutlinedButton, TextButton } from '../ui';
import EmptyState from '../components/EmptyState';
import ChinaMap from '../components/ChinaMap';
import MsIcon from '../components/MsIcon';
import UserAvatar from '../components/Avatar';
import { toast } from '../components/Toast';
import client from '../api/client';
import { useI18n } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { displayName, fmtChina, formatTime } from '../utils';

/** 把「北京时间字符串」解析成时间戳（后端给的是 "2026-10-01 00:00:00" 这种无时区串） */
function bjTs(s) {
  if (!s) return NaN;
  const [d, t = '00:00:00'] = String(s).split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h - 8, mi, se || 0);   // 北京时间 = UTC+8
}

function useCountdown(targetTs) {
  const [left, setLeft] = useState(() => (Number.isNaN(targetTs) ? null : Math.max(0, targetTs - Date.now())));
  useEffect(() => {
    if (Number.isNaN(targetTs)) { setLeft(null); return undefined; }
    const tick = () => setLeft(Math.max(0, targetTs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetTs]);
  if (left == null) return null;
  return {
    d: Math.floor(left / 86400000),
    h: Math.floor((left / 3600000) % 24),
    m: Math.floor((left / 60000) % 60),
    s: Math.floor((left / 1000) % 60),
  };
}

const POLL_MS = 15000;

/** 省份名 → 去掉后缀的短名（页面里显示「江苏」比「江苏省」紧凑，地图组件也是这个口径） */
function shortName(region) {
  return String(region || '').replace(/(特别行政区|自治区|壮族|回族|维吾尔|省|市)/g, '');
}

export default function MapLighting() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [openRegion, setOpenRegion] = useState('');
  const [detail, setDetail] = useState({});          // {省: 完整榜单}
  const knownLit = useRef(null);                      // 上一次已知的点亮集合（用来 diff 出「新点亮」）

  const load = useCallback(async (silent = false) => {
    try {
      const r = await client.get('/map-event');
      const next = r.data;
      // 新点亮的省 → 播报（首次加载不播报，否则一进页面就刷一堆提示）
      const litSet = new Set((next.lit || []).map((l) => l.region));
      if (knownLit.current) {
        const fresh = (next.lit || []).filter((l) => !knownLit.current.has(l.region));
        if (fresh.length) {
          const last = fresh[fresh.length - 1];
          const by = last.by ? t('maplit.litBy', { name: last.by }) : t('maplit.litByGuest');
          toast(`${t('maplit.litToast', { region: shortName(last.region) })} ${by} - ${t('maplit.litToastSub')}`);
        }
      }
      knownLit.current = litSet;
      setData(next);
      setError('');
    } catch {
      if (!silent) setError(t('maplit.loadFail'));
    }
  }, [t]);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // 倒计时到 0 时刷新一次（状态该从「未开始」变「点亮中」了）
  const status = data?.status;
  const targetTs = useMemo(() => {
    if (!data) return NaN;
    if (status === 'upcoming') return bjTs(data.start);
    if (status === 'open') return bjTs(data.end);
    return NaN;
  }, [data, status]);
  const cd = useCountdown(targetTs);
  useEffect(() => {
    if (cd && cd.d === 0 && cd.h === 0 && cd.m === 0 && cd.s === 0) load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd?.s]);

  const claim = async (region) => {
    if (!user) { toast(t('maplit.loginFirst'), 'error'); return; }
    setBusy(region);
    try {
      const r = await client.post('/map-event/claim', { region });
      if (r.data.already) toast(t('maplit.blessAlready'));
      else toast(t('maplit.blessGot', { region: shortName(region) }));
      await load(true);
    } catch (e) {
      toast(e?.response?.data?.detail || t('maplit.loadFail'), 'error');
    } finally {
      setBusy('');
    }
  };

  const claimAll = async () => {
    if (!user) { toast(t('maplit.loginFirst'), 'error'); return; }
    setBusy('__all__');
    try {
      const r = await client.post('/map-event/claim-all');
      const n = (r.data.granted || []).length;
      if (n) toast(t('maplit.blessGotAll', { n, fish: r.data.fish }));
      else toast(t('maplit.blessAlready'));
      await load(true);
    } catch (e) {
      toast(e?.response?.data?.detail || t('maplit.loadFail'), 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleRegion = async (region) => {
    if (openRegion === region) { setOpenRegion(''); return; }
    setOpenRegion(region);
    if (!detail[region]) {
      try {
        const r = await client.get(`/map-event/province/${encodeURIComponent(region)}`);
        setDetail((d) => ({ ...d, [region]: r.data.works || [] }));
      } catch {
        setDetail((d) => ({ ...d, [region]: [] }));
      }
    }
  };

  if (error) {
    return (
      <div className="page-pad ev-shell ev-shell--festive">
        <EmptyState msIcon="search" title={t('maplit.notFound')} subtitle={t('maplit.notFoundDesc')}>
          <Link to="/"><FilledButton>{t('maplit.backHome')}</FilledButton></Link>
        </EmptyState>
      </div>
    );
  }
  if (!data) {
    return <div style={{ textAlign: 'center', padding: '64px 0' }}><CircularProgress indeterminate /></div>;
  }

  const statusKey = data.awarded ? 'Awarded'
    : status === 'upcoming' ? 'Upcoming'
      : status === 'open' ? 'Open' : 'Ended';
  const lit = data.lit || [];
  const latest = [...lit].reverse().slice(0, 6);
  const mine = data.mine;
  const claimed = new Set(mine?.claimed || []);
  const canClaim = mine?.can_claim || [];
  const provinces = data.provinces || [];

  return (
    <div className="page-pad ev-shell ev-shell--festive">
      {/* ---- 头部 ---- */}
      <section className="m3-card m3-card--filled ev-hero">
        <div className="ev-hero-top">
          <span className={`ev-status ev-status--${status === 'open' ? 'today' : status}`}>
            <MsIcon name={status === 'open' ? 'bolt' : 'schedule'} size={14} />
            {t(`maplit.status${statusKey}`)}
          </span>
          <span className="ev-date"><CalendarDays size={14} /> {t('maplit.period')}</span>
        </div>
        <h1 className="ev-title">
          <MapPin size={24} /> {t('maplit.title')}
        </h1>
        <p className="ev-sub">{t('maplit.subtitle')}</p>

        <div className="ev-rewards">
          <div className="ev-reward">
            <span className="ev-reward-label"><Sparkles size={16} /> {t('maplit.litStat')}</span>
            <span className="ev-reward-value">{data.lit_count}<span style={{ fontSize: 18 }}> / {data.total_provinces}</span></span>
            <span className="muted" style={{ fontSize: 12 }}>{t('maplit.litProgress', { n: data.lit_count, total: data.total_provinces })}</span>
          </div>
          <div className="ev-reward">
            <span className="ev-reward-label"><Gift size={16} /> {t('maplit.blessStat')}</span>
            <span className="ev-reward-value">{mine ? mine.fish : 0}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {mine ? t('maplit.blessMine', { n: mine.claims, fish: mine.fish }) : t('maplit.needLogin')}
            </span>
          </div>
        </div>

        {cd && (
          <div className="ev-countdown">
            <div className="ev-cd-title">{status === 'upcoming' ? t('maplit.countdownTitle') : t('maplit.countdownTitleEnd')}</div>
            <div className="ev-cd-row">
              {[['d', cd.d], ['h', cd.h], ['m', cd.m], ['s', cd.s]].map(([unit, v]) => (
                <span key={unit} className="ev-cd-cell">
                  <b>{String(v).padStart(2, '0')}</b>
                  <i>{t(`maplit.unit.${unit === 'd' ? 'day' : unit === 'h' ? 'hour' : unit === 'm' ? 'min' : 'sec'}`)}</i>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Link to="/works/new"><FilledButton><span slot="icon"><Sparkles size={16} /></span>{t('maplit.goCreate')}</FilledButton></Link>
          <Link to="/discover"><OutlinedButton>{t('maplit.goDiscover')}</OutlinedButton></Link>
        </div>
      </section>

      {/* ---- 地图 ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><MapPin size={17} /><b>{t('maplit.mapTitle')}</b></div>
        <ChinaMap variant="lit" items={lit} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{t('maplit.mapHint')}</div>

        <div style={{ marginTop: 14, borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: 12 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            <Megaphone size={15} /> {t('maplit.latestTitle')}
          </div>
          {latest.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t('maplit.latestEmpty')}</div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {latest.map((l) => (
                <div key={l.region} className="row" style={{ gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
                  <span className="m3-badge m3-badge--primary">{shortName(l.region)}</span>
                  <span style={{ fontWeight: 600 }}>{t('maplit.litToast', { region: shortName(l.region) })}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {l.by ? t('maplit.litBy', { name: l.by }) : t('maplit.litByGuest')}
                    {l.at ? ` - ${formatTime(l.at)}` : ''}
                  </span>
                  {canClaim.includes(l.region) && (
                    <TextButton style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => claim(l.region)}>
                      {t('maplit.goClaim')}
                    </TextButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- 国庆祝福领取 ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><Gift size={17} /><b>{t('maplit.blessTitle')}</b></div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginBottom: 12 }}>{t('maplit.blessDesc')}</div>

        {lit.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t('maplit.blessNone')}</div>
        ) : (
          <>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              {mine && canClaim.length > 0 && (
                <FilledButton onClick={claimAll} disabled={busy === '__all__'}>
                  <span slot="icon"><Gift size={16} /></span>
                  {t('maplit.blessAll', { n: canClaim.length })}
                </FilledButton>
              )}
              <span className="muted" style={{ fontSize: 12.5 }}>
                {mine ? t('maplit.blessMine', { n: mine.claims, fish: mine.fish }) : t('maplit.loginFirst')}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {lit.map((l) => {
                const got = claimed.has(l.region);
                return (
                  <button
                    key={l.region}
                    type="button"
                    onClick={() => (got ? null : claim(l.region))}
                    disabled={got || busy === l.region}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                      borderRadius: 'var(--radius)', border: '1px solid var(--md-sys-color-outline-variant)',
                      background: got ? 'var(--md-sys-color-surface-container-high)' : 'var(--md-sys-color-primary-container)',
                      color: got ? 'var(--md-sys-color-on-surface-variant)' : 'var(--md-sys-color-on-primary-container)',
                      font: 'inherit', fontSize: 13, fontWeight: 700, cursor: got ? 'default' : 'pointer',
                    }}
                  >
                    {got ? <Check size={14} /> : <Gift size={14} />}
                    {shortName(l.region)}
                    <span style={{ fontWeight: 500, fontSize: 12 }}>
                      {got ? t('maplit.blessClaimed') : (busy === l.region ? '…' : '+2')}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ---- 我的参赛作品 ---- */}
      {user && (
        <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <div className="ev-block-head"><Medal size={17} /><b>{t('maplit.myTitle')}</b></div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {mine?.region ? t('maplit.myRegion', { region: mine.region }) : t('maplit.myRegionUnknown')}
          </div>
          {(mine?.works || []).length === 0 ? (
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
              {t('maplit.myEmpty')}
              <div style={{ marginTop: 10 }}>
                <Link to="/works/new"><FilledButton><span slot="icon"><ArrowRight size={16} /></span>{t('maplit.goCreate')}</FilledButton></Link>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {mine.works.map((w) => (
                <div key={w.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <span className="m3-badge">{shortName(w.region)}</span>
                  <Link to={`/works/${w.id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{w.title}</Link>
                  <span className="muted" style={{ fontSize: 12.5 }}>{t('maplit.myRank', { rank: w.rank, count: w.count })}</span>
                  <span className="row" style={{ gap: 3, alignItems: 'center', fontWeight: 700, flexShrink: 0 }}>
                    <MsIcon name="favorite" size={14} /> {w.likes}
                  </span>
                  {w.rank === 1 && <span className="m3-badge m3-badge--primary">{t('maplit.rankLeaderTag')}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---- 各省第一名（发奖名单预览） ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><Trophy size={17} /><b>{t('maplit.leadersTitle')}</b></div>
        {(data.leaders || []).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t('maplit.leadersEmpty')}</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {data.leaders.map((l) => (
              <div key={l.region} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <span className="m3-badge m3-badge--primary">{shortName(l.region)}</span>
                <Link to={`/works/${l.work_id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{l.title}</Link>
                <span className="muted" style={{ fontSize: 12.5 }}>{l.nickname} - {t('maplit.leadersCount', { n: l.count })}</span>
                <span className="row" style={{ gap: 3, alignItems: 'center', fontWeight: 700, flexShrink: 0 }}>
                  <MsIcon name="favorite" size={14} /> {l.likes}
                </span>
                <span className="m3-badge m3-badge--primary">{t('contest.prizeFish', { n: l.fish })}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- 各省榜单（分区，可展开看全部） ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><ListOrdered size={17} /><b>{t('maplit.rankTitle')}</b></div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{t('maplit.rankHint')}</div>
        {provinces.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t('maplit.rankEmpty')}</div>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {provinces.map((p) => {
              const opened = openRegion === p.region;
              const works = opened ? (detail[p.region] || p.top) : (p.top || []).slice(0, 3);
              return (
                <div key={p.region} style={{ borderTop: '1px solid var(--md-sys-color-outline-variant)', paddingTop: 10 }}>
                  <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span className="m3-badge m3-badge--primary">{shortName(p.region)}</span>
                    <b style={{ fontSize: 13.5 }}>{t('maplit.rankProvinceHead', { region: shortName(p.region), n: p.count })}</b>
                    <span className="muted" style={{ fontSize: 12 }}>{t('maplit.rankPrize')}</span>
                    <TextButton style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => toggleRegion(p.region)}>
                      {opened ? t('maplit.rankCollapse') : t('maplit.rankExpand')}
                    </TextButton>
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {works.map((w) => (
                      <div key={w.id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                        <span className="muted" style={{ minWidth: 22, fontWeight: 700, fontSize: 13 }}>{w.rank}</span>
                        <Link to={`/works/${w.id}`} className="work-cover" style={{ width: 60, height: 45, aspectRatio: 'auto', borderRadius: 'var(--radius)', flexShrink: 0 }}>
                          {w.cover_url
                            ? <img src={w.cover_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius)' }} />
                            : <MsIcon name="palette" size={18} />}
                        </Link>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Link to={`/works/${w.id}`} style={{ fontWeight: 700, display: 'block' }}>{w.title}</Link>
                          <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 2 }}>
                            <UserAvatar user={w.author} size={18} />
                            <span className="muted" style={{ fontSize: 12 }}>{displayName(w.author)}</span>
                          </div>
                        </div>
                        <span className="row" style={{ gap: 3, alignItems: 'center', fontWeight: 700, flexShrink: 0 }}>
                          <MsIcon name="favorite" size={14} /> {w.likes}
                        </span>
                        {w.rank === 1 && <span className="m3-badge m3-badge--primary">{t('contest.prizeFish', { n: 50 })}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- 开奖结果 ---- */}
      {data.awarded && (
        <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <div className="ev-block-head"><PartyPopper size={17} /><b>{t('maplit.awardedTitle')}</b></div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {t('maplit.awardedAt', { at: data.awarded.at, n: data.awarded.fish_total })}
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {(data.awarded.winners || []).filter((w) => !w.skipped).map((w) => (
              <div key={w.work_id} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <span className="m3-badge m3-badge--primary">{shortName(w.region)}</span>
                <Link to={`/works/${w.work_id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{w.title}</Link>
                <span className="muted" style={{ fontSize: 12.5 }}>{w.nickname}</span>
                <span className="m3-badge m3-badge--primary">{t('contest.prizeFish', { n: w.fish })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- 奖励说明 ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><Fish size={17} /><b>{t('maplit.prizesTitle')}</b></div>
        <div className="stack" style={{ gap: 8, fontSize: 13.5 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><Gift size={15} /> {t('maplit.prizeBless')}</div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><Trophy size={15} /> {t('maplit.prizeProvince')}</div>
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{t('maplit.prizeNote')}</div>
      </section>

      {/* ---- 规则 ---- */}
      <section className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <div className="ev-block-head"><MsIcon name="help" size={17} /><b>{t('maplit.rulesTitle')}</b></div>
        <ol className="ev-steps">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i}>
              <span className="ev-step-n">{i}</span>
              <span className="ev-step-desc">{t(`maplit.rule${i}`)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="ev-foot muted">
        <Clock size={13} /> {t('maplit.period')}
      </div>
    </div>
  );
}
