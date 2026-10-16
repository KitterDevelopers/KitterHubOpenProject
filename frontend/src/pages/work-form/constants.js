/** 投稿表单的常量：分类、标签上限、来源模式。 */

export const CATEGORIES = ['游戏', '动画', '故事', '音乐', '绘画', '数学', '科学', '其他'];

// 分类的中文原值会原样提交给后端，这里只把展示文案换成词条
export const CATEGORY_KEYS = {
  游戏: 'form.catGame',
  动画: 'form.catAnimation',
  故事: 'form.catStory',
  音乐: 'form.catMusic',
  绘画: 'form.catDrawing',
  数学: 'form.catMath',
  科学: 'form.catScience',
  其他: 'form.catOther',
};

export const MAX_TAGS = 5;
export const HTTP_RE = /^https?:\/\//i;

/**
 * 作品从哪来 —— 四条路都会落到同一个「编辑器 + 编号」、「内嵌网址」或「本站 sb3 文件」上：
 *   codemao  从编程猫导入（主路径：选一个作品就自动填好编辑器/编号/标题/简介/封面）
 *   manual   手动填写编号（别的编辑器，或编程猫接口读不到时兜底）
 *   url      内嵌网址（需要 LV4，走审核）
 *   scratch  上传 .sb3 文件（LV1 即可，但**必须过审**；播放交给 TurboWarp）
 */
export const SOURCE_CODEMAO = 'codemao';
export const SOURCE_MANUAL = 'manual';
export const SOURCE_URL = 'url';
export const SOURCE_SCRATCH = 'scratch';

export const SOURCES = [SOURCE_CODEMAO, SOURCE_MANUAL, SOURCE_URL, SOURCE_SCRATCH];

/** 来源 -> 提交给后端的 work_type */
export const workTypeOf = (source) => {
  if (source === SOURCE_URL) return 'url';
  if (source === SOURCE_SCRATCH) return 'scratch';
  return 'editor';
};
