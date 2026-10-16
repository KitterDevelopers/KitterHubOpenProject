// 编辑器图标：按 code 显示对应图片。
// 图片全部托管在 public 下（不引任何外部域名）——scratch.mit.edu 在大陆打不开，
// 所以 Scratch 那张是站长提供的本地图，不是从官网取的。
//
// ⚠️ 两点是站长明确要求的（2026-09-26）：
//   1. **不要白底**：图标一律透明，别给它垫一层白色方块；
//   2. **不要圆角圆成圆形**：圆角必须跟尺寸成比例 —— 以前写死 `var(--radius)`（12px），
//      在 12~16px 的小图标上等于直接变成圆，套进胶囊里非常难看。
import { useState } from 'react';
import { Puzzle } from 'lucide-react';

const MAP = {
  kitten4: '/kitten4.png',
  KN: '/kittenn.ico',
  kitten3: '/kitten3.png',
  coco: '/coco.png',
  nemo: '/nemo.png',
  scratch: '/scratch.png',
};

/** 图标圆角：跟尺寸成比例（12px 图标 ≈ 3px），上限 6px，看起来像个小方块而不是圆点 */
function radiusFor(size, rounded) {
  if (rounded) return 'var(--radius-circle)';
  return `${Math.min(6, Math.max(2, Math.round(size * 0.22)))}px`;
}

export default function EditorLogo({ code, size = 16, rounded = false, style }) {
  const [err, setErr] = useState(false);
  const src = MAP[code];
  if (!src || err) return <Puzzle size={Math.round(size * 0.9)} style={{ verticalAlign: -2, flexShrink: 0, ...style }} />;
  return (
    <img
      src={src}
      alt={code}
      onError={() => setErr(true)}
      style={{
        width: size,
        height: size,
        borderRadius: radiusFor(size, rounded),
        objectFit: 'contain',
        verticalAlign: -2,
        display: 'inline-block',
        flexShrink: 0,
        background: 'transparent',
        ...style,
      }}
    />
  );
}
