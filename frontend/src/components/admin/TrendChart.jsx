import { useEffect, useMemo, useRef, useState } from 'react';

// 近 7 日趋势（注册 / 投稿 / 发帖 / 评论）
// 纯 SVG，无外部依赖。重写要点：
// - 旧版把宽度写死成 520，7 天时每组只有 (520-60)/7 ≈ 65.7px，
//     而 4 根柱子要 4*18+3*6 = 90px —— 组与组互相重叠，最后一组还被 viewBox 裁掉。
//     现在宽度由容器实测决定，柱宽按可用空间反算，永不重叠。
// - 旧版图例是塞在 SVG 里的 <text>，位置靠 W-20-n*66 这种魔法算式贴着右上角；
//     改成正常的 HTML 图例。
// - 补 Y 轴刻度与网格线（旧版没有任何刻度，看不出量级）。
// - 补悬停高亮 + 提示（当天 4 项明细与合计），旧版只能一根根数柱子上的数字。

const SERIES = [
  { key: 'users', label: '注册', color: '#4c6ef5' },
  { key: 'works', label: '投稿', color: '#40c057' },
  { key: 'posts', label: '发帖', color: '#f59f00' },
  { key: 'comments', label: '评论', color: '#e64980' },
];

const PAD = { l: 30, r: 8, t: 14, b: 22 };
const PLOT_H = 140;
const BAR_GAP = 2;      // 同一天相邻柱子的间距
const MIN_SLOT_PAD = 0.18;  // 组间留白占组宽的比例

/** 把最大值抬到 1/2/5×10^k 这种好读的刻度 */
function niceCeil(v) {
  if (v <= 5) return Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

export default function TrendChart({ series, height = PLOT_H }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(-1);

  // 宽度跟随容器（旧版是固定 520 + 横向滚动）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = series?.days || [];
  const data = useMemo(
    () => SERIES.map((s) => ({ ...s, values: (series?.[s.key] || []).map((n) => Number(n) || 0) })),
    [series]
  );

  const { max, total, allZero } = useMemo(() => {
    const flat = data.flatMap((s) => s.values);
    const raw = Math.max(0, ...flat);
    const sum = flat.reduce((a, b) => a + b, 0);
    return { max: niceCeil(raw), total: sum, allZero: raw === 0 };
  }, [data]);

  const W = Math.max(240, width || 640);
  const innerW = Math.max(80, W - PAD.l - PAD.r);
  const slot = days.length > 0 ? innerW / days.length : innerW;
  const slotPad = Math.min(16, slot * MIN_SLOT_PAD);
  const usable = Math.max(8, slot - slotPad);
  const barW = Math.max(2, (usable - BAR_GAP * (SERIES.length - 1)) / SERIES.length);
  const H = PAD.t + height + PAD.b;
  const plotTop = PAD.t;
  const plotBottom = PAD.t + height;

  const yOf = (v) => plotBottom - (max > 0 ? (v / max) * height : 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  const summary = days
    .map((d, i) => `${d}: ${SERIES.map((s) => `${s.label} ${data.find((x) => x.key === s.key)?.values[i] || 0}`).join('，')}`)
    .join('；');

  return (
    <div className="tc-wrap" ref={wrapRef}>
      <div className="tc-legend">
        {SERIES.map((s) => (
          <span key={s.key} className="tc-legend-item">
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12 }}>近 7 日合计 {total}</span>
      </div>

      <div className="tc-canvas">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 7 日趋势：${summary}`} style={{ display: 'block' }}>
          {/* 网格线 + Y 轴刻度 */}
          {ticks.map((t, i) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yOf(t)} y2={yOf(t)}
                stroke="var(--border-soft)" strokeWidth={1} strokeDasharray={i === 0 ? '0' : '3 4'} />
              <text x={PAD.l - 6} y={yOf(t) + 3.5} fontSize={10} textAnchor="end"
                fill="var(--md-sys-color-on-surface-variant)">{t}</text>
            </g>
          ))}

          {days.map((d, i) => {
            const gx = PAD.l + i * slot + slotPad / 2;
            const isHover = hover === i;
            return (
              <g key={d}>
                {/* 悬停高亮带 */}
                <rect x={PAD.l + i * slot} y={plotTop} width={slot} height={height}
                  fill="var(--md-sys-color-on-surface)" opacity={isHover ? 0.06 : 0}
                  style={{ pointerEvents: 'none' }} />
                {data.map((s, gi) => {
                  const v = s.values[i] || 0;
                  const h = v > 0 ? Math.max(2, (v / max) * height) : 0;
                  if (h <= 0) return null;
                  return (
                    <rect key={s.key} x={gx + gi * (barW + BAR_GAP)} y={plotBottom - h}
                      width={barW} height={h} rx={2.5} fill={s.color}
                      opacity={isHover ? 1 : 0.85}>
                      <title>{`${d} ${s.label} ${v}`}</title>
                    </rect>
                  );
                })}
                <text x={PAD.l + i * slot + slot / 2} y={H - 6} fontSize={10.5} textAnchor="middle"
                  fill="var(--md-sys-color-on-surface-variant)">{d}</text>
                {/* 透明命中区：整个组，方便悬停 */}
                <rect x={PAD.l + i * slot} y={plotTop} width={slot} height={height}
                  fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} />
              </g>
            );
          })}
        </svg>

        {hover >= 0 && days[hover] && (
          <div className="tc-tip" style={{ left: `${((PAD.l + hover * slot + slot / 2) / W) * 100}%` }}>
            <div className="tc-tip-day">{days[hover]}</div>
            {data.map((s) => (
              <div key={s.key} className="tc-tip-row">
                <i style={{ background: s.color }} />
                <span>{s.label}</span>
                <b>{s.values[hover] || 0}</b>
              </div>
            ))}
            <div className="tc-tip-total">
              合计 <b>{data.reduce((a, s) => a + (s.values[hover] || 0), 0)}</b>
            </div>
          </div>
        )}
      </div>

      {allZero && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>近 7 日没有新增数据</div>
      )}
    </div>
  );
}
