/**
 * 本站等级徽章（LV1~LV7）：**纯 SVG，不再用 /level/LV{N}.png 那套图片**。
 *
 * 设计经过（站长 2026-09-30）：
 *   「不要用我那套图片了，丑死了，你好好设计一下」→ 我先做了胶囊令牌/盾牌几个方向 →
 *   「设计简洁易读点」→ 极简圆角方块 → 「你这个丑爆了，参考B站的」→ **本版：B站那枚六边形宝石**。
 *
 * 形制（参考 B 站等级标识的做法，图形与配色都是我们自己画的）：
 * - **尖角朝上的六边形**，是「等级宝石」最容易被认出来的形状；
 * - **切面明暗**：左半边压深、右半边用主色，再叠一块顶面高光 —— B 站那枚看着「有凹凸」就是靠这个；
 * - **白/深色粗体数字**居中，字号 20 / viewBox 30 ≈ 徽章高的 2/3：15px 下约 10px，正常视距读得清
 *    （早先版本字号只占 1/3，15px 下不到 6px，等于没写）；
 * - 一圈比底色更深的描边，让徽章在浅色卡片与深色底上都立得住；LV7 换成金边（对应「红金」这一级）。
 *
 * 配色沿用后端 `serializers.LEVEL_META` 定死的色系（蓝→绿→青→紫→橙→金→红金），不另起一套；
 * 橙/金两级底色偏亮，数字用深棕保证对比度。颜色写死在本文件 —— 等级标识不该被用户自定义主题色改掉。
 * 无外部字体（继承页面系统字体栈）、无 emoji、无网络请求、可无损缩放。
 */
export default function LevelBadge({ level = 0, name, size = 'sm', onClick, title }) {
  if (!level || level < 1 || level > 7) return null;
  const s = STYLE[level];

  const h = size === 'lg' ? 26 : 15;
  const label = name || `LV${level}`;

  return (
    <svg
      className={`lv-badge lv-badge--${size}${onClick ? ' is-clickable' : ''}`}
      width={h}
      height={h}
      viewBox="0 0 30 30"
      role="img"
      aria-label={label}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <title>{title || label}</title>
      {/* 左半边（暗） + 右半边（主色） + 顶面高光 = 宝石切面 */}
      <path d={LEFT} fill={s.deep} />
      <path d={RIGHT} fill={s.base} />
      <path d={TOP} fill="#FFFFFF" fillOpacity="0.16" />
      <path d={HEX} fill="none" stroke={s.gold || s.deep} strokeWidth={s.gold ? 1.3 : 1.1} strokeLinejoin="round" />
      <text
        x="15"
        y="15.1"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="20"
        fontWeight="800"
        fill={s.on}
        style={{ fontFamily: 'inherit' }}
      >
        {level}
      </text>
    </svg>
  );
}

// 尖角朝上的六边形（viewBox 30x30）
const HEX = 'M15 1.4 L27.2 8.6 V21.4 L15 28.6 L2.8 21.4 V8.6 Z';
const LEFT = 'M15 1.4 L2.8 8.6 V21.4 L15 28.6 Z';
const RIGHT = 'M15 1.4 L27.2 8.6 V21.4 L15 28.6 Z';
const TOP = 'M15 1.4 L27.2 8.6 L15 15.6 L2.8 8.6 Z';

// 每级：主色 / 亮色（本版未用，留作以后微调）/ 暗色（左切面与描边）/ 数字色 / 金边（仅 LV7）
const STYLE = {
  1: { base: '#3B82E8', light: '#6EA8F5', deep: '#24549C', on: '#FFFFFF', gold: null },
  2: { base: '#2FA85C', light: '#5FC684', deep: '#1B7040', on: '#FFFFFF', gold: null },
  3: { base: '#14A79C', light: '#48C7BE', deep: '#0A6E67', on: '#FFFFFF', gold: null },
  4: { base: '#7B4DE0', light: '#A17DF0', deep: '#5230A0', on: '#FFFFFF', gold: null },
  5: { base: '#EF8018', light: '#FFA44C', deep: '#A8560A', on: '#FFFFFF', gold: null },
  6: { base: '#E5AE1B', light: '#FFD156', deep: '#9E7408', on: '#3A2600', gold: null },
  7: { base: '#DC3B33', light: '#F2706A', deep: '#8E1F19', on: '#FFFFFF', gold: '#F0C24A' },
};
