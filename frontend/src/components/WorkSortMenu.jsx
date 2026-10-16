/**
 * 作品排序菜单：发现页与个人主页共用。
 *
 * 站长 2026-09-27：「发现页加上作品排序方式：按时间、热度等，个人主页作品也加上排序」。
 * 两处口径要一致，所以抽成一个组件 + 一份取值（后端同样一份：app/work_sort.py）：
 *   new 最新 / hot 综合热度 / likes 喜欢最多 / favs 收藏最多 / views 浏览最多
 *
 * 用全站自绘的下拉（ui/Menu）而不是原生 select，也不是 md-select：
 * 全站只有自绘这套在无头浏览器 / 各浏览器里定位都稳（见 ui/index.js 的注释）。
 */
import { useState } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { Menu, MenuItem } from '../ui';
import MsIcon from './MsIcon';
import { useI18n } from '../i18n';

export const WORK_SORTS = [
  { value: 'new', key: 'sort.new', icon: 'schedule' },
  { value: 'hot', key: 'sort.hot', icon: 'local_fire_department' },
  { value: 'likes', key: 'sort.likes', icon: 'favorite' },
  { value: 'favs', key: 'sort.favs', icon: 'star' },
  { value: 'views', key: 'sort.views', icon: 'visibility' },
];

export default function WorkSortMenu({ value = 'new', onChange, anchorId = 'work-sort-menu' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = WORK_SORTS.find((s) => s.value === value) || WORK_SORTS[0];

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        id={anchorId}
        type="button"
        className={`sort-btn${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-label={t('sort.label')}
        title={t('sort.label')}
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpDown size={14} />
        {t(cur.key)}
        <ChevronDown size={15} className="sort-btn-arrow" />
      </button>
      <Menu anchor={anchorId} open={open} onClosed={() => setOpen(false)}>
        {WORK_SORTS.map((s) => (
          <MenuItem key={s.value} onClick={() => { setOpen(false); onChange(s.value); }}>
            <span className="row" style={{ gap: 10, alignItems: 'center', width: '100%' }}>
              <MsIcon name={s.icon} size={18} />
              {t(s.key)}
              {s.value === value && <MsIcon name="check" size={16} style={{ marginLeft: 'auto' }} />}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}
