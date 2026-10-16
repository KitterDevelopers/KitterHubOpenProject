// MsIcon：Google Material Symbols（outlined 变体）SVG 图标
// 使用官方 Material Symbols path 数据，currentColor 着色，跟随文字/主题色
import icons from './ms-icons.json';

export default function MsIcon({ name, size = 20, style, filled = false, ...rest }) {
  const path = icons[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}
