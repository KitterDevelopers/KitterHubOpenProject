/**
 * 限时活动页（/event/<key>）：目前是「9 月 30 日登录送 300 经验 + 100 小鱼干」。
 *
 * 为什么单独做一页而不是只在公告里写一行：
 * - 公告只有一行字，说不清「怎么领 / 什么时候 / 领没领到」；
 * - 活动页能把状态讲清楚：未开始（还有几天）/ 今天进行中 / 已结束，登录后还能看到自己领没领。
 *
 * 数据一律来自 `/api/events/<key>`（活动定义在后端 app/events.py，和发放逻辑同一份，
 * 不会出现「页面写 300、实际发 200」这种错位）；文案走 i18n，页面不写死数字。
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PartyPopper, CalendarDays, Gift, Fish, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { FilledButton, OutlinedButton, CircularProgress } from '../ui';
import MsIcon from '../components/MsIcon';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import client from '../api/client';

/** 距活动当天 00:00（北京时间）还有多久。 */
function countdown(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+08:00`).getTime();
  const ms = start - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return { days, hours, mins, secs };
}

export default function Event() {
  const { key } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(null);

  useEffect(() => {
    setData(null);
    setError('');
    client.get(`/events/${key}`)
      .then((r) => setData(r.data))
      .catch(() => setError(t('event.notFound')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 倒计时（只在「未开始」时跑）
  useEffect(() => {
    if (!data || data.status !== 'upcoming') return undefined;
    const tick = () => setLeft(countdown(data.date));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data]);

  if (error) {
    return (
      <div className="page-pad ev-shell">
        <EmptyState msIcon="search" title={t('event.notFound')} subtitle={t('event.notFoundDesc')}>
          <Link to="/"><FilledButton>{t('event.backHome')}</FilledButton></Link>
        </EmptyState>
      </div>
    );
  }
  if (!data) {
    return <div style={{ textAlign: 'center', padding: '64px 0' }}><CircularProgress indeterminate /></div>;
  }

  const statusText = data.status === 'upcoming' ? t('event.statusUpcoming')
    : data.status === 'today' ? t('event.statusToday') : t('event.statusEnded');
  // 日期用 {y}/{m}/{d} 插值而不是正则 ：这样能把「09 月」写成「9 月」，中英都好排版
  const [dy, dm, dd] = data.date.split('-');
  const dateText = t('event.dateFormat', { y: dy, m: Number(dm), d: Number(dd) });

  return (
    <div className="page-pad ev-shell">
      {/* ---- 头部：活动标题 + 状态 ---- */}
      <section className="m3-card m3-card--filled ev-hero">
        <div className="ev-hero-top">
          <span className={`ev-status ev-status--${data.status}`}>
            <MsIcon name={data.status === 'today' ? 'bolt' : 'schedule'} size={14} />
            {statusText}
          </span>
          <span className="ev-date"><CalendarDays size={14} /> {dateText}</span>
        </div>
        <h1 className="ev-title">
          <PartyPopper size={24} /> {t('event.title')}
        </h1>
        <p className="ev-sub">{t('event.subtitle')}</p>

        {/* ---- 奖励两个大数字（数字来自后端） ---- */}
        <div className="ev-rewards">
          <div className="ev-reward">
            <span className="ev-reward-label"><MsIcon name="workspace_premium" size={16} /> {t('event.xpLabel')}</span>
            <b className="ev-reward-value">+{data.xp}</b>
          </div>
          <div className="ev-reward">
            <span className="ev-reward-label"><Fish size={16} /> {t('event.fishLabel')}</span>
            <b className="ev-reward-value">+{data.fish}</b>
          </div>
        </div>

        {/* ---- 倒计时 / 今天 / 已结束 ---- */}
        {data.status === 'upcoming' && left && (
          <div className="ev-countdown">
            <div className="ev-cd-title">{t('event.countdownTitle')}</div>
            <div className="ev-cd-row">
              {[['days', left.days], ['hours', left.hours], ['mins', left.mins], ['secs', left.secs]].map(([unit, n]) => (
                <span key={unit} className="ev-cd-cell">
                  <b>{String(n).padStart(2, '0')}</b>
                  <i>{t(`event.unit_${unit}`)}</i>
                </span>
              ))}
            </div>
          </div>
        )}
        {data.status === 'today' && (
          <div className="ev-live">
            <MsIcon name="bolt" size={16} />
            {t('event.liveHint')}
          </div>
        )}
        {data.status === 'ended' && (
          <div className="ev-ended">
            <MsIcon name="schedule" size={16} />
            {t('event.endedHint')}
          </div>
        )}

        {/* ---- 我的状态 ---- */}
        {data.claimed ? (
          <div className="ev-claimed">
            <CheckCircle2 size={16} />
            {t('event.claimedMine', { xp: data.xp, fish: data.fish })}
            <Link to="/xp" className="ev-inline-link">{t('event.goXp')}</Link>
          </div>
        ) : data.status === 'today' ? (
          <div className="ev-hint-row">
            <AlertCircle size={15} />
            {user ? t('event.todayNotYet') : t('event.todayLoginFirst')}
          </div>
        ) : null}

        <div className="ev-cta">
          {!user && <Link to="/login"><FilledButton>{t('event.loginNow')}</FilledButton></Link>}
          <Link to="/discover"><OutlinedButton>{t('event.goDiscover')}</OutlinedButton></Link>
          <Link to="/xp"><OutlinedButton>{t('event.goXp')}</OutlinedButton></Link>
        </div>
      </section>

      {/* ---- 怎么领 ---- */}
      <section className="m3-card ev-block">
        <div className="ev-block-head"><MsIcon name="help" size={17} /><b>{t('event.howTitle')}</b></div>
        <ol className="ev-steps">
          <li>
            <span className="ev-step-n">1</span>
            <div>
              <b>{t('event.step1Title')}</b>
              <div className="muted ev-step-desc">{t('event.step1Desc', { date: dateText })}</div>
            </div>
          </li>
          <li>
            <span className="ev-step-n">2</span>
            <div>
              <b>{t('event.step2Title')}</b>
              <div className="muted ev-step-desc">{t('event.step2Desc', { xp: data.xp, fish: data.fish })}</div>
            </div>
          </li>
          <li>
            <span className="ev-step-n">3</span>
            <div>
              <b>{t('event.step3Title')}</b>
              <div className="muted ev-step-desc">{t('event.step3Desc')}</div>
            </div>
          </li>
        </ol>
      </section>

      {/* ---- 常见问题 ---- */}
      <section className="m3-card ev-block">
        <div className="ev-block-head"><MsIcon name="help" size={17} /><b>{t('event.faqTitle')}</b></div>
        <div className="ev-faq">
          {['faq1', 'faq2', 'faq3', 'faq4'].map((k) => (
            <div key={k} className="ev-faq-item">
              <div className="ev-faq-q"><Gift size={14} /> {t(`event.${k}Q`)}</div>
              <div className="muted ev-faq-a">{t(`event.${k}A`)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="muted ev-foot">
        <Clock size={13} /> {t('event.footNote')}
      </div>
    </div>
  );
}
