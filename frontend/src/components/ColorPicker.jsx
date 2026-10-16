/* 颜色选择：一排预设色块 + 自定义取色。
 *
 * 用于管理后台设置轮播底色。预设里第一项是「深蓝」，其余是几个常用底色；
 * 最后留一个原生取色器，预设不够用时可以自己调。
 * 选中色块上的对勾颜色由 readableOn() 算出来，浅色块上不会出现看不见的白勾。
 */
import { Check } from 'lucide-react';
import { readableOn } from '../utils';

// 底色备选：第一个就是站长要的深蓝；「默认」表示跟随站点主题色
export const COLOR_PRESETS = [
  { name: '深蓝', value: '#0b2e4f' },
  { name: '藏青', value: '#13315c' },
  { name: '品牌蓝', value: '#0061a4' },
  { name: '墨绿', value: '#1b5e4a' },
  { name: '紫罗兰', value: '#4a3f8f' },
  { name: '砖红', value: '#8f3527' },
  { name: '琥珀', value: '#9a5b06' },
  { name: '石墨', value: '#37474f' },
];

export default function ColorPicker({ value, onChange, label, hint }) {
  const cur = (value || '').toLowerCase();
  return (
    <div>
      {label && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{label}</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="color-swatch color-swatch--auto"
          title="跟随站点主题色"
          aria-label="默认颜色"
          aria-pressed={!cur}
          onClick={() => onChange('')}
        >
          <span>默认</span>
        </button>

        {COLOR_PRESETS.map((p) => {
          const on = cur === p.value.toLowerCase();
          return (
            <button
              key={p.value}
              type="button"
              className="color-swatch"
              title={p.name}
              aria-label={p.name}
              aria-pressed={on}
              onClick={() => onChange(p.value)}
              style={{ background: p.value, color: readableOn(p.value) }}
            >
              {on && <Check size={14} />}
            </button>
          );
        })}

        <label className="color-custom" title="自定义颜色">
          <input
            type="color"
            aria-label="自定义颜色"
            value={cur || '#0b2e4f'}
            onChange={(e) => onChange(e.target.value)}
          />
          <span>自定义</span>
        </label>
      </div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
