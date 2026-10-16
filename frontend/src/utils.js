// 全局时间工具：后端统一存 UTC（SQLite 读回后是无时区字符串）。
// 为避免被浏览器本地时区误解析（国内机器大多东八区，会差 8 小时），所有解析把
// “无时区字符串”按 UTC 处理，展示统一用 Asia/Shanghai（东八区）。

const CHINA_TZ = 'Asia/Shanghai';

// 把后端时间转成绝对毫秒；缺时区时按 UTC 处理
export function parseTs(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s) return NaN;
  // 已带时区标记（Z / +08:00 / +0800）则直接解析
  const hasTz = /(Z|[+-]\d{2}:?\d{2})\s*$/i.test(s);
  const ms = new Date(hasTz ? s : `${s}Z`).getTime();
  return Number.isNaN(ms) ? new Date(value).getTime() : ms;
}

// 语言相关的格式化：**跟着界面语言走**。utils 是纯函数模块拿不到 React context，
// 所以直接读 LangProvider 写的那个 localStorage key（同一个来源，不会不一致）。
// 时区仍然固定 Asia/Shanghai，只有 locale 变。
function isEn() {
  try {
    return localStorage.getItem('nimao_lang') === 'en';
  } catch (e) {
    return false;
  }
}

function uiLocale() {
  return isEn() ? 'en-US' : 'zh-CN';
}

// 用中国时区格式化时间；opts 同 Intl.DateTimeFormat 参数（不用传 timeZone）
export function fmtChina(value, opts = {}) {
  const ms = parseTs(value);
  if (Number.isNaN(ms)) return '';
  return new Intl.DateTimeFormat(uiLocale(), { timeZone: CHINA_TZ, ...opts }).format(new Date(ms));
}

function chinaParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

export function formatTime(value) {
  const ms = parseTs(value);
  if (Number.isNaN(ms)) return '';
  const en = isEn();
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return en ? 'just now' : '刚刚';
  if (diff < 3600) {
    const n = Math.floor(diff / 60);
    return en ? `${n} min ago` : `${n} 分钟前`;
  }
  if (diff < 86400) {
    const n = Math.floor(diff / 3600);
    return en ? `${n} h ago` : `${n} 小时前`;
  }
  if (diff < 86400 * 30) {
    const n = Math.floor(diff / 86400);
    return en ? `${n} d ago` : `${n} 天前`;
  }
  const { y, mo, d } = chinaParts(ms);
  return `${y}-${mo}-${d}`;
}

// 按中国时区对日期分组：今天 / 昨天 / N 天前 / yyyy年M月d日（英文模式 Today / Yesterday / …）
export function dayLabel(ts) {
  const ms = parseTs(ts);
  if (Number.isNaN(ms)) return '';
  const en = isEn();
  const d = new Date(ms);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  // 以“中国时区的今天”零点为基准
  const chinaNow = new Intl.DateTimeFormat('en-CA', { timeZone: CHINA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  const [cy, cm, cd] = chinaNow.split('-').map(Number);
  const chinaTodayStart = new Date(cy, cm - 1, cd).getTime();
  const diffDays = Math.floor((chinaTodayStart - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return en ? 'Today' : '今天';
  if (diffDays === 1) return en ? 'Yesterday' : '昨天';
  if (diffDays < 7) return en ? `${diffDays} days ago` : `${diffDays} 天前`;
  // ⚠️ 这里必须把日号也解构出来（原名 d）：上面第 78 行那个 `d` 是 **Date 对象**，
  //    7 天前的分支以前只解构了 y/mo，末行却用了 d → `${Number(new Date(ms))}` 直接把毫秒时间戳印出来，
  //    于是聊天页的日期分隔线显示成「2026年9月1789205220550日」。
  const { y, mo, d: dd } = chinaParts(ms);
  if (en) return new Intl.DateTimeFormat('en-US', { timeZone: CHINA_TZ, year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
  return `${y}年${Number(mo)}月${Number(dd)}日`;
}

// 大数字缩写：1000 -> 1k，12345 -> 1.2万，1.2e8 -> 1.2亿
export function fmtCount(n) {
  const v = Math.round(Number(n) || 0);
  const abs = Math.abs(v);
  const trim = (x) => String(Number(x.toFixed(1)));
  if (abs < 1000) return String(v);
  if (abs < 10000) return `${trim(v / 1000)}k`;
  if (abs < 100000000) return `${trim(v / 10000)}万`;
  return `${trim(v / 100000000)}亿`;
}

// 等级进度（与后端阈值一致：LV2 起 200/700/1500/5000/10000/50000，含等号）
export const LV_THRESHOLDS = [0, 0, 200, 700, 1500, 5000, 10000, 50000];
export function levelProgress(xp, level) {
  if (!level || level >= 7) return { pct: 100, need: 0 };
  const cur = LV_THRESHOLDS[level] || 0;
  const next = LV_THRESHOLDS[level + 1] || cur;
  const pct = Math.min(100, Math.max(0, Math.floor(((xp - cur) / Math.max(1, next - cur)) * 100)));
  return { pct, need: Math.max(0, next - xp) };
}

export function getInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

// 显示名：优先昵称，其次用户名
export function displayName(user) {
  if (!user) return '';
  return user.display_name || user.nickname || user.username || '';
}

// 登录账号名（用于展示 @用户名 之类的账号信息）
export function loginName(user) {
  if (!user) return '';
  return user.username || '';
}

// MD3 风格柔和色板：区分度好、饱和度适中，无头像用户的默认底色
const COLORS = ['#4c6ef5', '#ff922b', '#40c057', '#9c36b5', '#e8590c', '#0ca678', '#f59f00', '#3bc9db'];

export function colorFor(name) {
  let sum = 0;
  for (const ch of name || '') sum += ch.charCodeAt(0);
  return COLORS[sum % COLORS.length];
}

// 编程猫编辑器：code -> 展示名（与后端 config.EDITORS 保持一致）
export const EDITOR_LABELS = {
  kitten4: 'Kitten4',
  KN: 'KittenN',
  kitten3: 'Kitten3',
  coco: 'Coco',
};
export const CODEMAO_EDITOR_CODES = Object.keys(EDITOR_LABELS);

/** 在任意底色上挑一个读得清的前景色（深色底给白字，浅色底给近黑字）。
 *
 * 用途：轮播底色由管理员自选，不能再写死白字 —— 选到浅黄、浅青时白字就看不见了。
 * 用 WCAG 的相对亮度公式，阈值 0.45 偏向「亮底用深字」这一侧，避免临界色发灰。
 * 传入非法值时返回白色（与原来的写死行为一致）。
 */
export function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? '#0b1b2b' : '#ffffff';
}

/* ---------------------------------------------------------------------------
 * 卡片里的正文预览：把 Markdown 剥成纯文本（站长 2026-10-01：
 * 「卡片里预览帖子内容时自动去掉 md 相关的标签」）。
 *
 * 规则按站内渲染器（components/markdown/Markdown.jsx）支持的语法来：
 *   代码围栏 / 标题 / 分割线 / 引用 / 列表 / 表格 / 图片 / 链接 / 粗体 / 斜体 / 删除线 /
 *   行内代码 / 裸链接 / #话题# / @提及 / 内联 HTML。
 * 取舍：图片整段去掉（预览里没意义）、链接只留文字、裸链接去掉、话题与提及保留文字当内容。
 * 最后把空白折叠成一行 —— 卡片预览是一行，换行只会让高度跳。
 * ------------------------------------------------------------------------- */
export function mdToPlain(md) {
  let s = String(md == null ? '' : md);
  // 1) 代码围栏：去掉 ``` 行，保留里面的代码文字
  s = s.replace(/^\s*```[^\n]*$/gm, '');
  s = s.replace(/```/g, '');
  // 2) 图片整段去掉（先于链接处理）
  s = s.replace(/!\[[^\]]*\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '');
  // 3) 链接只留文字
  s = s.replace(/\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
  // 4) 裸链接去掉
  s = s.replace(/<?https?:\/\/[^\s<>()（）【】]+>?/g, '');
  // 5) 行内代码的反引号去掉，内容保留
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // 6) 粗体 / 删除线 / 斜体：只去标记
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
  s = s.replace(/__([\s\S]+?)__/g, '$1');
  s = s.replace(/~~([\s\S]+?)~~/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');
  // 7) 标题 / 引用 / 分割线 / 列表标记
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  s = s.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '');
  s = s.replace(/^\s{0,3}(?:[-*+]|\d{1,3}[.)])\s+/gm, '');
  // 8) 表格：去掉竖线与分隔行
  s = s.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '');
  s = s.replace(/\|/g, ' ');
  // 9) #话题# 去掉两侧井号，@提及 原样保留
  s = s.replace(/#([^#\s]{1,30})#/g, '$1');
  // 10) 内联 HTML 去掉
  s = s.replace(/<[^>\n]{1,80}>/g, '');
  // 11) 折叠空白（含换行）成一行
  return s.replace(/\s+/g, ' ').trim();
}

/** 卡片用：剥掉 Markdown 后截断，只有真的截断了才加省略号。 */
export function plainPreview(md, limit = 120) {
  const text = mdToPlain(md);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}
