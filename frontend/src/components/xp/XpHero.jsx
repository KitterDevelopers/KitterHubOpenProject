/**
 * 顶部数据带：等级 - 进度 - 小鱼干 - 签到，压成一条横带。
 *
 * 版面大改（站长：整体就是不好看）之前这里是左右两张卡：左边等级 + 进度、右边鱼 + 签到，
 * 占了近 200px 高，而里面真正有用的只有「我在第几级、还差多少、有多少鱼、签没签」四件事。
 * 现在是一条 grid 三段的窄带（左身份 / 中进度 / 右鱼+签到），高度约 88px，一眼横着扫完；
 * 窄屏自动塌成三行。
 *
 * 注意：后端 LEVEL_META 里的 level_name 就是「LV2」这种标签本身，不是「新手上路」那种花名，
 * 所以这里不再重复渲染它 —— 等级由左边的徽章表达。
 */
import { Fish } from 'lucide-react';
import { FilledButton, OutlinedButton } from '../../ui';
import MsIcon from '../MsIcon';
import LevelBadge from '../LevelBadge';

export default function XpHero({ data, busy, onSignin, t }) {
  const p = data.progress || {};
  const maxed = data.level >= 7;
  const nextText = p.need_treaty
    ? t('xp.needTreaty')
    : maxed
      ? t('xp.maxLevel')
      : t('xp.toNext', { level: p.next_level, n: p.remain });

  return (
    <section className="m3-card m3-card--filled xp-bar-card">
      {/* 左：我是谁、多少经验 */}
      <div className="xp-bar-id">
        <LevelBadge level={data.level} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="muted xp-bar-label">{t('xp.myXp')}</div>
          <div className="xp-bar-xp xp-num">{data.xp}</div>
        </div>
      </div>

      {/* 中：升级进度（唯一需要横着读的东西，给它最宽的一栏） */}
      <div className="xp-bar-prog">
        <div className="xp-bar-prog-top">
          <span className="muted">{nextText}</span>
          {!p.need_treaty && !maxed && p.next_xp ? (
            <span className="muted xp-num">{p.cur_xp} / {p.next_xp}</span>
          ) : null}
        </div>
        <div
          className="xp-bar"
          role="progressbar"
          aria-valuenow={Math.round(p.pct || 0)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${p.pct || 0}%` }} />
        </div>
      </div>

      {/* 右：小鱼干 + 签到，动作只留一个主按钮 */}
      <div className="xp-bar-fish">
        <div className="xp-fish-box">
          <Fish size={20} className="xp-fish-icon" />
          <div>
            <div className="muted xp-fish-label">{t('xp.myFish')}</div>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <span className="xp-fish-num xp-num">{data.fish_count}</span>
              {data.signin_days > 0 && (
                <span className="muted xp-fish-days">{t('xp.signinDays', { n: data.signin_days })}</span>
              )}
            </div>
          </div>
        </div>
        {data.signed_today ? (
          <OutlinedButton disabled className="xp-signin-btn">
            <span className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'center' }}>
              <MsIcon name="check_circle" size={16} /> {t('xp.signedToday')}
            </span>
          </OutlinedButton>
        ) : (
          <FilledButton onClick={onSignin} disabled={busy} className="xp-signin-btn">
            <span className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'center' }}>
              <MsIcon name="calendar_today" size={16} /> {busy ? t('xp.signing') : t('xp.signin')}
            </span>
          </FilledButton>
        )}
      </div>
    </section>
  );
}
