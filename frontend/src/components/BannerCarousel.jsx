import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pause, Play, Timer } from 'lucide-react';
import { useI18n } from '../i18n';
import { readableOn } from '../utils';

// 首页轮播：进度条式指示器（当前项按时间填充）+ 悬停暂停 + 手动切换 + 手机滑动 +
// 可调播放速度 + 切到后台自动暂停 + 支持 prefers-reduced-motion。
const SPEEDS = [3000, 5000, 8000];
const SPEED_KEY = 'nimao_banner_speed';

function targetHref(b) {
  if (b.target_type === 'work' && b.target_id) return `/works/${b.target_id}`;
  if (b.target_type === 'post' && b.target_id) return `/posts/${b.target_id}`;
  if (b.target_type === 'url' && b.target_url) return b.target_url;
  return null;
}

export default function BannerCarousel({ banners = [] }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const count = banners.length;

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);   // 用户手动暂停
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(false);   // 标签页切到后台
  const [speed, setSpeed] = useState(() => {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(v) ? v : 5000;
  });
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );

  const barRef = useRef(null);
  const remainingRef = useRef(speed);   // 本次停留还剩多少毫秒
  const startedAtRef = useRef(0);
  const pausedFlagRef = useRef(false);
  const touchXRef = useRef(null);

  const autoPlay = count > 1 && !paused && !hovering && !hidden && !reduceMotion;

  useEffect(() => {
    localStorage.setItem(SPEED_KEY, String(speed));
  }, [speed]);

  // 预加载所有 banner 图：轮播只挂当前一张 <img>，切换时才请求会有闪白
  useEffect(() => {
    banners.forEach((it) => {
      if (it?.image_url) {
        const img = new Image();
        img.src = it.image_url;
      }
    });
  }, [banners]);

  // 切到后台就暂停，回来继续（避免回来一次跳好几张）
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const goTo = useCallback(
    (next) => {
      remainingRef.current = speed; // 手动切换后重新计时
      setIdx(((next % count) + count) % count);
    },
    [count, speed]
  );

  // 自动前进（暂停时结算已用时间，恢复时接着走）
  useEffect(() => {
    if (count <= 1) return undefined;
    if (!autoPlay) {
      if (!pausedFlagRef.current) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        pausedFlagRef.current = true;
      }
      return undefined;
    }
    pausedFlagRef.current = false;
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => {
      remainingRef.current = speed;
      setIdx((i) => (i + 1) % count);
    }, remainingRef.current);
    return () => clearTimeout(timer);
  }, [idx, autoPlay, speed, count]);

  // 进度条：用 rAF 直接改样式，不走 state（避免每帧重渲染）
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    if (!autoPlay) return undefined;
    const elapsed = Math.max(0, speed - remainingRef.current);
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const ms = elapsed + (t - t0);
      bar.style.transform = `scaleX(${Math.min(1, ms / speed)})`;
      if (ms < speed) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx, autoPlay, speed]);

  // 只有一个 banner 时不显示指示器与自动播放
  if (count === 0) return null;

  const b = banners[Math.min(idx, count - 1)] || banners[0];
  const href = targetHref(b);
  const isExternal = /^https?:\/\//i.test(href || '');
  // 没配图时才由底色决定外观：有图的话颜色被图盖住，
  // 这时文字压在照片上，保持白字 + 描边阴影更稳（不能按底色挑字色）。
  const flat = !b.image_url && b.color
    ? { background: b.color, color: readableOn(b.color) }
    : undefined;
  // 底部圆点直接压在轮播底色/底图上（不像暂停/翻页那样有自己的药丸底），
  // 所以不能跟浮层控件共用 --banner-ctl-fg（那个是页面 on-surface，亮色主题下是深色，
  // 压在深色 Banner 上就看不见了）。有图 → 白点；纯色 → 按底色明暗取黑白。
  const dotFg = b.image_url ? '#ffffff' : (b.color ? readableOn(b.color) : null);

  const open = () => {
    if (!href) return;
    if (isExternal) window.open(href, '_blank', 'noopener,noreferrer');
    else navigate(href);
  };

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
    remainingRef.current = next;
    startedAtRef.current = Date.now();
  };

  const onKeyDown = (e) => {
    if (count <= 1) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(idx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(idx + 1);
    } else if (e.key === ' ') {
      e.preventDefault();
      setPaused((p) => !p);
    }
  };

  return (
    <div
      className="banner"
      style={dotFg ? { '--banner-dot-fg': dotFg } : undefined}
      role="region"
      aria-label={t('home.bannerRegion')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      onTouchStart={(e) => {
        touchXRef.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const x0 = touchXRef.current;
        touchXRef.current = null;
        if (x0 == null || count <= 1) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) goTo(dx < 0 ? idx + 1 : idx - 1);
      }}
    >
      <div
        className={`banner-slide${href ? ' clickable' : ''}${b.image_url ? ' has-image' : ''}`}
        style={flat}
        onClick={open}
        role={href ? 'link' : undefined}
        aria-label={href ? t('home.bannerView', { title: b.title }) : b.title}
      >
        {b.image_url && <img className="banner-img" src={b.image_url} alt="" loading="eager" decoding="async" />}
        <div className="banner-text">
          <div className="banner-title">{b.title}</div>
          {href && (
            <div className="banner-more">
              {t('home.bannerMore')} <ChevronRight size={16} />
            </div>
          )}
        </div>
        {count > 1 && (
          <div className="banner-count">
            {idx + 1} / {count}
          </div>
        )}
      </div>

      {count > 1 && (
        <>
          <button type="button" className="banner-arrow left" aria-label={t('home.bannerPrev')} onClick={(e) => { e.stopPropagation(); goTo(idx - 1); }}>
            <ChevronLeft size={22} />
          </button>
          <button type="button" className="banner-arrow right" aria-label={t('home.bannerNext')} onClick={(e) => { e.stopPropagation(); goTo(idx + 1); }}>
            <ChevronRight size={22} />
          </button>

          <div className="banner-bar" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="banner-ctrl"
              aria-label={paused ? t('home.bannerPlay') : t('home.bannerPause')}
              title={paused ? t('home.bannerPlay') : t('home.bannerPause')}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>

            <div className="banner-dots">
              {banners.map((item, i) => (
                <button
                  key={item.id ?? i}
                  type="button"
                  className={`banner-dot${i === idx ? ' active' : ''}`}
                  aria-label={t('home.bannerDot', { n: i + 1, title: item.title })}
                  aria-current={i === idx ? 'true' : undefined}
                  onClick={() => goTo(i)}
                >
                  {i === idx ? <i ref={barRef} className="banner-dot-fill" /> : null}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="banner-speed"
              title={t('home.bannerSpeedTitle')}
              aria-label={t('home.bannerSpeed', { s: speed / 1000 })}
              onClick={cycleSpeed}
            >
              <Timer size={13} /> {speed / 1000}s
            </button>
          </div>
        </>
      )}
    </div>
  );
}
