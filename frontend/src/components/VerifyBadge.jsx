import { useId } from 'react';
import MsIcon from './MsIcon';
import { useI18n } from '../i18n';

// 官方认证标识（蓝标 / 黄标）
// 原来蓝标黄标散在 5 个文件里各写一套：Avatar 里是手绘 SVG（黄标用的 #b45309
// 是深棕不是金）、Profile 一套背景色、CreateCenter 干脆不分蓝黄、
// Followers 只有个单色图标、Admin 内联硬编码还带 🔵🟡 emoji。
// 现在统一在这里，两种形状：
//   VerifySeal —— 头像右下角的角标（百分比尺寸，随头像缩放）
//   VerifyChip —— 头衔胶囊（个人主页 / 创作中心 / 后台列表）
// 颜色用渐变 + 跟随主题的描边环，暗色模式下也有足够对比。

const BLUE = { from: '#60a5fa', to: '#1d4ed8' };
const GOLD = { from: '#f7d774', to: '#c08a1e' };

/* 词条 key：组件内部用 t(verifyLabelKey(type)) 取本地化文案。
   原本还有一个直接返回中文的 verifyLabel()，只有 Admin 导入了却从未调用，
   属于死代码（英文模式下会漏中文），已删除。 */
function verifyLabelKey(type) {
  return type === 'gold' ? 'level.verifiedGold' : type === 'blue' ? 'level.verifiedBlue' : 'level.unverified';
}

/** 头像角标：圆形渐变底 + 白色对勾，外圈用 surface-container-lowest 描边（亮色白、暗色近黑） */
export function VerifySeal({ type = 'blue', title }) {
  const { t } = useI18n();
  const raw = useId();
  const gid = `vfg-${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
  const c = type === 'gold' ? GOLD : BLUE;
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      role="img"
      aria-label={title || t(verifyLabelKey(type))}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor={c.from} />
          <stop offset="100%" stopColor={c.to} />
        </linearGradient>
      </defs>
      {/* 外圈：跟随主题的底色，形成一圈描边 */}
      <circle cx="12" cy="12" r="11.5" fill="var(--md-sys-color-surface-container-lowest)" />
      <circle cx="12" cy="12" r="10" fill={`url(#${gid})`} />
      <path d="M7.4 12.3l2.9 3.1 6.3-6.8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** 头衔胶囊：淡色底 + 同色描边 + 认证图标 */
export function VerifyChip({ type = 'blue', children, size = 13, title }) {
  const { t } = useI18n();
  const isGold = type === 'gold';
  return (
    <span className={`vf-chip ${isGold ? 'is-gold' : 'is-blue'}`} title={title || t(verifyLabelKey(type))}>
      <MsIcon name="verified" size={size} />
      {children || t('level.official')}
    </span>
  );
}

export default VerifySeal;
