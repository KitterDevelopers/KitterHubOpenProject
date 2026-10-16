/**
 * 经验来源：环形图 + 前三项 +（折叠的）全部明细。
 *
 * 版面大改前这里是一条占比条 + 图例 + 9 行明细（其中一半是 0），
 * 明细把左列撑得很长，「我这份经验主要来自哪」反而要先读九行才看得出来。
 * 现在环形图直接给结构，右边只列**贡献最多的三项**，其余（含 0）收进折叠。
 *
 * 颜色全部用 token 或 token 的 color-mix 派生（不写死 hex）——站里有深色模式，
 * 写死颜色在深色下会瞎。色板刻意只用 primary/tertiary/secondary 三色系的三档深浅。
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MsIcon from '../MsIcon';

const SOURCE_ICONS = {
  signin: 'calendar_today',
  feed_given: 'volunteer_activism',
  feed_received: 'redeem',
  invite: 'person_add',
  event: 'celebration',
  codemao: 'military_tech',
  bind: 'link',
  other: 'workspace_premium',
};

/** 每一档颜色：第 1 档最饱和，往后依次变浅，深浅色模式各自成立。 */
const SOURCE_COLORS = {
  signin: 'var(--md-sys-color-primary)',
  feed_given: 'var(--md-sys-color-tertiary)',
  feed_received: 'var(--md-sys-color-secondary)',
  invite: 'color-mix(in srgb, var(--md-sys-color-primary) 62%, var(--md-sys-color-surface))',
  event: 'color-mix(in srgb, var(--md-sys-color-tertiary) 62%, var(--md-sys-color-surface))',
  codemao: 'color-mix(in srgb, var(--md-sys-color-secondary) 62%, var(--md-sys-color-surface))',
  bind: 'color-mix(in srgb, var(--md-sys-color-primary) 36%, var(--md-sys-color-surface))',
  other: 'color-mix(in srgb, var(--md-sys-color-on-surface-variant) 45%, var(--md-sys-color-surface))',
};

const colorOf = (key) => SOURCE_COLORS[key] || 'var(--md-sys-color-outline)';

const R = 42;
const CIRC = 2 * Math.PI * R;

export default function XpSources({ detail, total, feedToday, feedCap, t }) {
  const [openAll, setOpenAll] = useState(false);
  // 按贡献从多到少排（原来固定顺序，看不出主次）；0 经验的排最后
  const rows = [...detail].sort((a, b) => (b.total || 0) - (a.total || 0));
  const positive = rows.filter((d) => (d.total || 0) > 0);
  const sum = positive.reduce((n, d) => n + d.total, 0);
  const top3 = positive.slice(0, 3);

  const descOf = (d) => {
    if (d.key === 'codemao') return d.count > 0 ? t('xp.cmClaimed', { level: d.count + 1 }) : t('xp.cmTitle');
    if (d.key === 'bind') return d.count > 0 ? t('xp.bindClaimedCount', { n: d.count }) : t('xp.bindTitle');
    if (d.key === 'event') return d.count > 0 ? t('xp.eventGot', { n: d.count }) : t('xp.eventNone');
    return t('xp.perUnit', { count: d.count, each: d.each });
  };
  const pctOf = (d) => (sum > 0 ? Math.round((d.total / sum) * 100) : 0);

  // 环形图：每段一个 circle，用 dasharray/dashoffset 排出扇形，起点转到 12 点方向
  let acc = 0;
  const ring = positive.map((d) => {
    const frac = sum > 0 ? d.total / sum : 0;
    const seg = (
      <circle
        key={d.key}
        cx="50"
        cy="50"
        r={R}
        fill="none"
        stroke={colorOf(d.key)}
        strokeWidth="13"
        strokeDasharray={`${frac * CIRC} ${CIRC}`}
        strokeDashoffset={-acc * CIRC}
        transform="rotate(-90 50 50)"
      />
    );
    acc += frac;
    return seg;
  });

  return (
    <section className="m3-card xp-card">
      <div className="xp-card-head">
        <MsIcon name="bar_chart" size={18} style={{ color: 'var(--md-sys-color-primary)' }} />
        <b className="xp-card-title">{t('xp.detailTitle')}</b>
      </div>

      {positive.length === 0 ? (
        <p className="muted xp-card-hint" style={{ margin: 0 }}>{t('xp.sourceEmpty')}</p>
      ) : (
        <div className="xp-src-top">
          <div className="xp-donut" role="img" aria-label={t('xp.sourceHint', { xp: total, n: positive.length })}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r={R} fill="none" stroke="var(--md-sys-color-surface-container-highest)" strokeWidth="13" />
              {ring}
            </svg>
            <div className="xp-donut-center">
              <span className="xp-donut-num xp-num">{total}</span>
              <span className="muted xp-donut-label">{t('xp.total')}</span>
            </div>
          </div>

          <ul className="xp-src-legend">
            {top3.map((d) => (
              <li key={d.key} className="xp-src-legend-row">
                <i style={{ background: colorOf(d.key) }} />
                <span className="xp-src-legend-name">{t(`xp.src_${d.key}`)}</span>
                <span className="muted xp-num xp-src-legend-pct">{pctOf(d)}%</span>
                <span className="xp-gain">+{d.total}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {positive.length > 3 && (
        <div className="xp-sub">
          <button type="button" className="xp-fold-head" aria-expanded={openAll} onClick={() => setOpenAll((v) => !v)}>
            <MsIcon name="list" size={15} />
            {openAll ? t('xp.sourcesLess') : t('xp.sourcesAll', { n: rows.length })}
            <ChevronDown size={16} className="xp-fold-arrow" />
          </button>
        </div>
      )}

      {/* 展开后是完整的来源明细（含 0 的），一条不少 */}
      {(openAll || positive.length <= 3) && (
        <div className="xp-src-detail">
          {rows.map((d) => (
            <div key={d.key} className="xp-src-row">
              <MsIcon name={SOURCE_ICONS[d.key] || 'workspace_premium'} size={17} style={{ color: colorOf(d.key), flexShrink: 0 }} />
              <div className="xp-row-main">
                <div className="xp-src-name">{t(`xp.src_${d.key}`)}</div>
                <div className="muted xp-claim-desc">{descOf(d)}</div>
                {d.key === 'feed_given' && (
                  <div className="muted xp-claim-desc">{t('xp.feedTodayProgress', { n: feedToday, cap: feedCap })}</div>
                )}
              </div>
              <span className="xp-gain">+{d.total}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
