import MsIcon from '../MsIcon';
import { fmtCount } from '../../utils';

// 创作中心统计瓦片：图标 + 数值 + 标签（可选补充说明）
export default function StatTile({ icon, value, label, hint, tone = 'default' }) {
  return (
    <div className={`cc-tile${tone === 'accent' ? ' cc-tile--accent' : ''}`}>
      <span className="cc-tile-label">
        {icon && <MsIcon name={icon} size={15} />}
        {label}
      </span>
      <span className="cc-tile-value">{value == null ? '—' : fmtCount(value)}</span>
      {hint && <span className="cc-tile-hint">{hint}</span>}
    </div>
  );
}
