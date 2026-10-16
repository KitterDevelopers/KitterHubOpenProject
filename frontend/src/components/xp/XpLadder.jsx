/**
 * 等级与权益：**横向阶梯** + 当前/下一级详情 +（折叠的）完整说明。
 *
 * 版面大改前这是右边一窄列里的纵向时间线：8 级一路往下排，1000px 出头的高度里
 * 每级都摊着「需要多少经验 / 每日几个鱼 / 权益描述」，页面被它一个人撑到两屏，
 * 而用户真正看的只有「我在哪、下一级是什么」。
 *
 * 现在：一条横着的 0→7 轨道（走过的、当前的、没到的三种状态一眼分得开），
 * 下面只展开**当前级**和**下一级**两行，8 级的完整说明收进折叠，需要时再看。
 * 窄屏轨道折成两行四列（不做横向滚动 —— 站里不许出现横向滚动条）。
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import MsIcon from '../MsIcon';
import LevelBadge from '../LevelBadge';

export default function XpLadder({ levels, current, t }) {
  const [openAll, setOpenAll] = useState(false);
  const now = levels.find((l) => l.level === current) || null;
  const next = levels.find((l) => l.level === current + 1) || null;

  // 窄屏也放得下的短标签：LV0/LV1 是动作，之后是累计经验门槛
  const nodeLabel = (lv) =>
    lv.level === 0 ? t('xp.nodeRegister') : lv.level === 1 ? t('xp.nodeTreaty') : String(lv.threshold);

  const needOf = (lv) =>
    lv.level === 0
      ? t('xp.lvNeedRegister')
      : lv.level === 1
        ? t('xp.lvNeedTreaty')
        : t('xp.lvNeedXp', { n: lv.threshold });

  const stateOf = (lv) => (lv.level < current ? 'is-past' : lv.level === current ? 'is-now' : '');

  return (
    <section className="m3-card xp-card">
      <div className="xp-card-head">
        <MsIcon name="trophy" size={18} style={{ color: 'var(--md-sys-color-primary)' }} />
        <b className="xp-card-title">{t('xp.levelsTitle')}</b>
        <span className="m3-badge m3-badge--primary xp-card-badge">LV{current}</span>
      </div>

      {/* 0 → 7 的横向轨道 */}
      <ol className="xp-track">
        {levels.map((lv) => (
          <li
            key={lv.level}
            className={`xp-track-item ${stateOf(lv)}`}
            aria-current={lv.level === current ? 'step' : undefined}
          >
            <span className="xp-track-dot">{lv.level}</span>
            <span className="xp-track-label">{nodeLabel(lv)}</span>
          </li>
        ))}
      </ol>

      {/* 只把当前级和下一级的细节摊开 */}
      <div className="xp-level-now">
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 徽章本身就是等级（六边形里是数字），旁边再写一遍「LV7」是重复的，去掉 */}
          <LevelBadge level={current} size="lg" />
          <span className="m3-badge m3-badge--primary">{t('xp.current')}</span>
        </div>
        <div className="muted xp-level-desc">{t(`profile.lv${current}Desc`)}</div>
        <div className="muted xp-level-meta">{t('xp.lvDailyFish', { n: now ? now.daily_fish : 0 })}</div>
      </div>

      <div className="xp-level-next">
        {next ? (
          <>
            <div className="xp-level-next-title">{t('xp.nextLevel', { level: next.level })}</div>
            <div className="muted xp-level-meta">
              {needOf(next)} - {t('xp.lvDailyFish', { n: next.daily_fish })}
            </div>
            <div className="muted xp-level-desc">{t(`profile.lv${next.level}Desc`)}</div>
          </>
        ) : (
          <div className="muted xp-level-desc">{t('xp.maxLevel')}</div>
        )}
      </div>

      <div className="xp-sub">
        <button type="button" className="xp-fold-head" aria-expanded={openAll} onClick={() => setOpenAll((v) => !v)}>
          <MsIcon name="format_list_numbered" size={15} />
          {t('xp.ladderAll')}
          <ChevronDown size={16} className="xp-fold-arrow" />
        </button>
        {openAll && (
          <ol className="xp-level-list">
            {levels.map((lv) => (
              <li key={lv.level} className={`xp-level-item ${stateOf(lv)}`}>
                <span className="xp-level-item-lv">LV{lv.level}</span>
                <span className="xp-level-item-main">
                  <span className="xp-level-item-meta muted">
                    {needOf(lv)} - {t('xp.lvDailyFish', { n: lv.daily_fish })}
                  </span>
                  <span className="muted xp-level-item-desc">{t(`profile.lv${lv.level}Desc`)}</span>
                </span>
                {lv.level < current && (
                  <MsIcon name="check_circle" size={15} style={{ color: 'var(--md-sys-color-primary)', flexShrink: 0 }} />
                )}
                {lv.level === current && (
                  <span className="m3-badge m3-badge--primary" style={{ flexShrink: 0 }}>{t('xp.current')}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
