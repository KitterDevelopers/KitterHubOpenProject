/**
 * 作品卡片上的「编辑器胶囊」：哪个作品用哪个编辑器，就挂哪一枚，带图标。
 *
 * 站长 2026-09-26 明确要求：**别只给 Scratch 挂**，首页 / 发现 / 个人主页 / 搜索 / 收藏……
 * 所有出现作品卡片的地方都要一致 —— Kitten4、KittenN、Kitten3、Coco、NEMO、Scratch 各一枚。
 *
 * 编辑器名字是品牌名，不翻译；图标走 EditorLogo（本地图、透明底、不圆成球）。
 */
import EditorLogo from './EditorLogo';

export const EDITOR_CHIP = {
  kitten4: { label: 'Kitten4' },
  KN: { label: 'KittenN' },
  kitten3: { label: 'Kitten3' },
  coco: { label: 'Coco' },
  nemo: { label: 'NEMO' },
  scratch: { label: 'Scratch' },
};

/** 从作品数据里取出该显示哪个编辑器胶囊；外链作品（work_type=url）没有编辑器，返回 null。 */
export function editorCodeOf(work) {
  if (!work) return null;
  if (work.work_type === 'scratch' || work.is_scratch) return 'scratch';
  return work.editor_code && EDITOR_CHIP[work.editor_code] ? work.editor_code : null;
}

export default function EditorChip({ work, size = 12, className = '' }) {
  const code = editorCodeOf(work);
  if (!code) return null;
  return (
    <span className={`m3-badge editor-chip${className ? ' ' + className : ''}`}>
      <EditorLogo code={code} size={size} />
      {EDITOR_CHIP[code].label}
    </span>
  );
}
