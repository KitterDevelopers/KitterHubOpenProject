/* 界面设置里「只影响本机」的几项偏好：字号、高对比度、导航栏样式、自定义主题色、页面背景图。
 *
 * 全部存本机（主题色/字号等用 localStorage，背景图用 IndexedDB —— 见 bgstore.js），换台设备就回到默认。
 * 背景图**绝不上传服务器**（站长 2026-09-27 的要求）。
 *
 * ⚠️ 为什么要有这个文件：字号与高对比度原来**只在设置页点选的那一瞬间**写进 DOM，
 *    没有任何「启动时读回来」的逻辑，所以刷新一次就全丢 —— 设置看着保存了、其实没生效。
 *    这里统一收口：读 + 应用都在一处，main.jsx 启动时调一次 applyAppearance()。
 */
import { bgClear, bgGet, bgSet } from './bgstore';

export const FONT_SCALE_KEY = 'nimao_font_scale';
export const CONTRAST_KEY = 'nimao_high_contrast';
export const NAV_STYLE_KEY = 'nimao_nav_style';
/** 打开作品时新建标签页（默认关，见文件末尾的 installWorkLinkInterceptor） */
export const OPEN_WORK_NEW_TAB_KEY = 'nimao_work_new_tab';
/** 标签页标题里带不带页面名（默认不带，见 TitleManager） */
export const PAGE_TITLE_NAME_KEY = 'nimao_page_title_name';
/** 外观偏好变化的广播事件：设置页一改，TitleManager 之类的地方立刻跟上 */
export const APPEARANCE_EVENT = 'nimao-appearance';

export const FONT_SCALES = [1, 1.1, 1.25];
/** 导航栏样式：float = 悬浮圆角条（默认）；normal = 贴顶通栏 */
export const NAV_STYLES = ['float', 'normal'];
export const DEFAULT_NAV_STYLE = 'float';

export const BASE_FONT_PX = 16;

export function readFontScale() {
  const n = Number(localStorage.getItem(FONT_SCALE_KEY));
  return FONT_SCALES.includes(n) ? n : 1;
}

export function readHighContrast() {
  return localStorage.getItem(CONTRAST_KEY) === '1';
}

export function readNavStyle() {
  const v = localStorage.getItem(NAV_STYLE_KEY);
  return NAV_STYLES.includes(v) ? v : DEFAULT_NAV_STYLE;
}

export function applyFontScale(scale) {
  const s = FONT_SCALES.includes(scale) ? scale : 1;
  document.documentElement.style.fontSize = `${s * BASE_FONT_PX}px`;
}

export function applyHighContrast(on) {
  document.documentElement.setAttribute('data-contrast', on ? 'high' : '');
}

export function applyNavStyle(style) {
  document.documentElement.setAttribute('data-nav', NAV_STYLES.includes(style) ? style : DEFAULT_NAV_STYLE);
}

export function setFontScale(scale) {
  localStorage.setItem(FONT_SCALE_KEY, String(scale));
  applyFontScale(scale);
}

export function setHighContrast(on) {
  localStorage.setItem(CONTRAST_KEY, on ? '1' : '');
  applyHighContrast(on);
}

export function setNavStyle(style) {
  localStorage.setItem(NAV_STYLE_KEY, style);
  applyNavStyle(style);
}

/** 启动时调用：把本机偏好一次性应用到 <html>。 */
export function applyAppearance() {
  applyFontScale(readFontScale());
  applyHighContrast(readHighContrast());
  applyNavStyle(readNavStyle());
  applyThemeColor(readThemeColor());
  applyUiAlpha();
  applyCardOptions();
  applyBgVars();
  installMaterialSurfaceFrost();
  // 背景图在 IndexedDB 里，是异步的 —— 启动时先把变量/属性摆好，图片到了再换上
  loadBackgroundImage().catch(() => {});
}


/**
 * 一键恢复界面设置为默认。
 * 只清本机偏好（localStorage）与背景图（IndexedDB），**不动任何账号数据**；
 * 清完立刻按默认值重新应用一遍，所以调用方不需要自己回调每个 apply*。
 */
export async function resetAppearance() {
  for (const k of APPEARANCE_KEYS) {
    try { localStorage.removeItem(k); } catch { /* 隐私模式下可能抛错，忽略 */ }
  }
  try { await removeBackgroundImage(); } catch { /* 本来就没背景图也无所谓 */ }
  applyAppearance();
  return true;
}

/* ===========================================================================
   Material 组件的「磨砂面」（站长 2026-10-01：弹窗、发现页筛选框没套上模糊效果）
   ---------------------------------------------------------------------------
   本站自己的面板（卡片 / 自绘菜单 / 数据条）都在 global.css 里用 ::before 上了磨砂层，
   但 Material 的弹窗/下拉是 **Web Component**，面在它的 shadow root 里： - md-dialog  → `.container::before` 才是那块背景（宿主是 display:contents，外面套不上） - md-menu    → `.items` 才是那块背景（输入框/下拉的弹出菜单）
   而 MWC 既没暴露 `part=`，也没有 backdrop-filter 的 token，所以这里**往 shadow root 里注入一条
   样式**，只用现成的 `--ui-card-filter`（由外观设置算出来），这样弹窗/下拉就跟卡片是同一套磨砂——
   设置里关掉模糊，它们也一起关。

   ⚠️ 注入的类名是 MWC 内部实现（`.container::before` / `.items`），所以： - 找不到元素就直接跳过（不会因为升级报错）； - 用 MutationObserver 兜住「后来才渲染出来」的弹窗/菜单（弹窗是按需挂载的）。
   =========================================================================== */
const FROST_STYLE_ID = 'kh-surface-frost';
let frostObserver = null;

function injectFrost(el) {
  const sr = el && el.shadowRoot;
  if (!sr || sr.querySelector(`style[data-kh="${FROST_STYLE_ID}"]`)) return;
  if (!sr.querySelector('.container, .items')) return;   // MWC 结构变了就不动它
  const style = document.createElement('style');
  style.setAttribute('data-kh', FROST_STYLE_ID);
  style.textContent = `
    .container::before, .items {
      backdrop-filter: var(--ui-card-filter, none);
      -webkit-backdrop-filter: var(--ui-card-filter, none);
    }
  `;
  sr.appendChild(style);
}

export function installMaterialSurfaceFrost() {
  if (typeof document === 'undefined') return;
  // ⚠️ md-select 的菜单是**嵌在它自己 shadow root 里**的 md-menu（document.querySelectorAll 找不到），
  //    所以这里除了扫文档，还要下探一层这些宿主的 shadow。
  const HOSTS = 'md-dialog, md-menu, md-select, md-filled-select, md-outlined-select';
  const scan = () => {
    document.querySelectorAll(HOSTS).forEach((el) => {
      injectFrost(el);
      const sr = el.shadowRoot;
      if (sr) sr.querySelectorAll('md-menu, md-dialog').forEach(injectFrost);
    });
  };
  scan();
  if (frostObserver) return;
  // 弹窗/菜单是按需渲染的，加载时不一定存在 → 盯着 body 的子树变化
  let timer = 0;
  frostObserver = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(scan, 80);
  });
  frostObserver.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(scan, 600);   // 首屏 Material 组件挂载完再补一次
}

/* ===========================================================================
   界面元素透明度（卡片 / 顶栏 / 面板那层「面」的透明度）
   ---------------------------------------------------------------------------
   站长 2026-09-27：「界面元素可以调节透明度」。
   做法：不动任何组件的 CSS，而是在**主题 token 这一层**动手 ——
   把 surface 那一族（surface / surface-container-* / surface-variant / background）
   包成 `color-mix(in srgb, <主题原值> X%, transparent)` 再写到 <html> 的行内样式上。
   因为全站的卡片、顶栏、面板、页脚读的都是这些 token，所以一处生效、处处生效。
   ⚠️ 必须先把上一轮的覆盖 removeProperty 掉再读原值，否则会读到自己的 color-mix（越套越淡）。
   100% = 完全不透明，这时直接不写行内覆盖，回到样式表原样（默认值）。
   =========================================================================== */
export const UI_ALPHA_KEY = 'nimao_ui_alpha';
export const DEFAULT_UI_ALPHA = 100;
export const UI_ALPHA_MIN = 30;

const SURFACE_TOKENS = [
  '--md-sys-color-background',
  '--md-sys-color-surface',
  '--md-sys-color-surface-variant',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
];

export function readUiAlpha() {
  const raw = localStorage.getItem(UI_ALPHA_KEY);
  if (raw === null || raw === '') return DEFAULT_UI_ALPHA;
  const n = Number(raw);
  return Number.isFinite(n) && n >= UI_ALPHA_MIN && n <= 100 ? n : DEFAULT_UI_ALPHA;
}

/** 把「原始不透明值」也留一份（--ui-opaque-surface-container-low 这种），
 *  下面三个「文字相关」开关要用它把某些面还原成不透明 —— 令牌本身已经被改成 color-mix 了。 */
const opaqueKey = (token) => `--ui-opaque-${token.replace('--md-sys-color-', '')}`;

export function applyUiAlpha() {
  const root = document.documentElement;
  // 先撤掉上一轮的覆盖，保证读到的是「当前主题的原始 token 值」
  SURFACE_TOKENS.forEach((k) => {
    root.style.removeProperty(k);
    root.style.removeProperty(opaqueKey(k));
  });
  const alpha = readUiAlpha();
  // 给 CSS 一个挂钩：透明度 < 100 时启用「透明档可读性」那组规则
  //（半透明后卡片轮廓、封面上的按钮、透明头像都需要额外兜一下，见 global.css 同名注释）
  root.setAttribute('data-ui-alpha', alpha < 100 ? 'on' : '');
  if (alpha >= 100) return;
  const pct = `${alpha}%`;
  const base = {};
  const cs = getComputedStyle(root);
  SURFACE_TOKENS.forEach((k) => { base[k] = cs.getPropertyValue(k).trim(); });
  SURFACE_TOKENS.forEach((k) => {
    if (!base[k]) return;
    root.style.setProperty(k, `color-mix(in srgb, ${base[k]} ${pct}, transparent)`);
    root.style.setProperty(opaqueKey(k), base[k]);
  });
}

export function setUiAlpha(v) {
  const n = Math.max(UI_ALPHA_MIN, Math.min(100, Math.round(Number(v) || DEFAULT_UI_ALPHA)));
  if (n >= 100) localStorage.removeItem(UI_ALPHA_KEY);
  else localStorage.setItem(UI_ALPHA_KEY, String(n));
  applyUiAlpha();
}

/* ---------------------------------------------------------------------------
   跟透明度配套的「卡片背景」一组可选项（站长：可选项多一点 —— 全部独立、可选可不选）
     1. 背景模糊  cardBlur   0–24px   卡片背后那层背景做模糊（backdrop blur）
     2. 磨砂质感  cardFrost  开关      在模糊之外再加一点饱和/亮度，玻璃感更明显
     3. 背景覆盖  cardScrim  0–60%    卡片里叠一层 on-surface 半透明色，压暗背景提高文字对比
     4. 小控件不透明 smallSolid 开关  徽章/分页按钮/输入框这些带字的小面恢复不透明
     5. 大面不透明   textSolid  开关  卡片/面板/页脚这些文字大面恢复不透明
   实现：前三个决定一个 --ui-card-filter（完整的 filter 函数串）+ --ui-card-scrim，
   由 CSS 里的 ::before 磨砂层消费；后两个是 <html> 上的 data-* 开关。
   --------------------------------------------------------------------------- */
export const CARD_BLUR_KEY = 'nimao_card_blur';
export const CARD_SCRIM_KEY = 'nimao_card_scrim';
export const CARD_FROST_KEY = 'nimao_card_frost';
export const SMALL_SOLID_KEY = 'nimao_small_solid';
export const TEXT_SOLID_KEY = 'nimao_text_solid';

export const CARD_BLUR_MAX = 24;
export const CARD_SCRIM_MAX = 60;

const readFlag = (key) => localStorage.getItem(key) === '1';

export function readCardBlur() {
  return readNumberInRange(CARD_BLUR_KEY, 0, CARD_BLUR_MAX, 0);
}

export function readCardScrim() {
  return readNumberInRange(CARD_SCRIM_KEY, 0, CARD_SCRIM_MAX, 0);
}

export const readCardFrost = () => readFlag(CARD_FROST_KEY);
export const readSmallSolid = () => readFlag(SMALL_SOLID_KEY);
export const readTextSolid = () => readFlag(TEXT_SOLID_KEY);

export function applyCardOptions() {
  const root = document.documentElement;
  const blur = readCardBlur();
  const scrim = readCardScrim();
  const frost = readCardFrost();

  // 把整条 backdrop-filter 在 JS 里拼好，CSS 只消费一个变量（省得在 CSS 里做条件拼接）
  const parts = [];
  if (blur > 0) parts.push(`blur(${blur}px)`);
  if (frost) parts.push('saturate(1.18)', 'brightness(1.04)');
  const filter = parts.length ? parts.join(' ') : 'none';
  root.style.setProperty('--ui-card-filter', filter);
  root.style.setProperty('--ui-card-scrim', `${scrim}%`);
  root.setAttribute('data-card-effect', filter !== 'none' || scrim > 0 ? 'on' : '');
  root.setAttribute('data-card-frost', frost ? 'on' : '');
  root.setAttribute('data-small-solid', readSmallSolid() ? 'on' : '');
  root.setAttribute('data-text-solid', readTextSolid() ? 'on' : '');
}

const setFlag = (key, on) => {
  if (on) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
  applyCardOptions();
};

export function setCardBlur(v) {
  const n = Math.max(0, Math.min(CARD_BLUR_MAX, Math.round(Number(v) || 0)));
  if (n === 0) localStorage.removeItem(CARD_BLUR_KEY);
  else localStorage.setItem(CARD_BLUR_KEY, String(n));
  applyCardOptions();
}

export function setCardScrim(v) {
  const n = Math.max(0, Math.min(CARD_SCRIM_MAX, Math.round(Number(v) || 0)));
  if (n === 0) localStorage.removeItem(CARD_SCRIM_KEY);
  else localStorage.setItem(CARD_SCRIM_KEY, String(n));
  applyCardOptions();
}

export const setCardFrost = (on) => setFlag(CARD_FROST_KEY, on);
export const setSmallSolid = (on) => setFlag(SMALL_SOLID_KEY, on);
export const setTextSolid = (on) => setFlag(TEXT_SOLID_KEY, on);

/* ===========================================================================
   自定义主题色（seed 色）
   ---------------------------------------------------------------------------
   做法：给一个 seed 颜色，按它算出一小撮 MD3 accent token 覆盖到 <html> 的行内样式上
   （行内样式优先级高于 :root 与 [data-theme="dark"]，所以明暗两套都能盖住）。
   「默认」= 把行内样式全部 removeProperty，token 回到样式表里的原值。
   只覆盖 accent（primary/secondary 两族 + surface-tint），surface 底色不动 ——
   整站 surface 也跟着染色（Material You 那种）会牵动每一个 color-mix，风险太大、收益很小。
   =========================================================================== */
export const THEME_COLOR_KEY = 'nimao_theme_color';

/** 预设色：都是中等明度、饱和度不太高的颜色，做按钮/链接都耐看 */
export const PRESET_COLORS = [
  '#1a73e8', // 蓝
  '#00897b', // 青绿
  '#2e7d32', // 绿
  '#6a1b9a', // 紫
  '#c2185b', // 玫红
  '#e65100', // 橙
  '#c62828', // 红
  '#455a64', // 蓝灰
];

const TOKEN_KEYS = [
  '--md-sys-color-primary',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-surface-tint',
];

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s, l };
}

const col = (h, s, l) => `hsl(${h}, ${Math.round(Math.max(0, Math.min(1, s)) * 100)}%, ${Math.round(Math.max(0, Math.min(1, l)) * 100)}%)`;

/** seed -> 当前明暗模式下的 token 覆盖表 */
export function themeTokensFor(hex, dark) {
  const hsl = hexToHsl(hex);
  if (!hsl) return {};
  const { h, s } = hsl;
  const S = Math.max(0.42, s);       // 太灰的 seed 做不出有辨识度的主色，兜个底
  if (dark) {
    return {
      '--md-sys-color-primary': col(h, Math.min(S, 0.72), 0.8),
      '--md-sys-color-on-primary': col(h, Math.min(S, 0.8), 0.16),
      '--md-sys-color-primary-container': col(h, Math.min(S, 0.62), 0.3),
      '--md-sys-color-on-primary-container': col(h, Math.min(S, 0.5), 0.9),
      '--md-sys-color-secondary': col(h, Math.min(S * 0.6, 0.4), 0.78),
      '--md-sys-color-on-secondary': col(h, Math.min(S * 0.6, 0.4), 0.2),
      '--md-sys-color-secondary-container': col(h, Math.min(S * 0.5, 0.34), 0.3),
      '--md-sys-color-on-secondary-container': col(h, Math.min(S * 0.5, 0.34), 0.9),
      '--md-sys-color-surface-tint': col(h, Math.min(S, 0.72), 0.8),
    };
  }
  return {
    '--md-sys-color-primary': col(h, Math.min(S, 0.85), 0.4),
    '--md-sys-color-on-primary': '#ffffff',
    '--md-sys-color-primary-container': col(h, Math.min(S, 0.6), 0.88),
    '--md-sys-color-on-primary-container': col(h, Math.min(S, 0.7), 0.2),
    '--md-sys-color-secondary': col(h, Math.min(S * 0.8, 0.7), 0.42),
    '--md-sys-color-on-secondary': '#ffffff',
    '--md-sys-color-secondary-container': col(h, Math.min(S * 0.5, 0.45), 0.9),
    '--md-sys-color-on-secondary-container': col(h, Math.min(S * 0.6, 0.6), 0.22),
    '--md-sys-color-surface-tint': col(h, Math.min(S, 0.85), 0.4),
  };
}

export function readThemeColor() {
  const v = (localStorage.getItem(THEME_COLOR_KEY) || '').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '';
}

export function applyThemeColor(hex) {
  const root = document.documentElement;
  const clean = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : '';
  // 站标（内联 SVG）据此切换配色：只有选了自定义主题色才跟着主题走，默认保持原品牌色
  // （取值规则见 global.css 里的 html[data-brand='custom'] .kitter-logo）
  root.setAttribute('data-brand', clean ? 'custom' : '');
  if (!clean) {
    TOKEN_KEYS.forEach((k) => root.style.removeProperty(k));
    root.style.removeProperty('--brand-deep');
    root.style.removeProperty('--brand-deep-on');
    return;
  }
  const dark = root.getAttribute('data-theme') === 'dark';
  const tokens = themeTokensFor(clean, dark);
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  // 「品牌深色」：深色模式下给实心按钮用（站长：「按钮的颜色可以深一点」），与站标上面那块同一档。
  // 直接在 <html> 上写变量，global.css 里只让实心按钮读它 —— 不动 --md-sys-color-primary 本身，
  // 免得整站暗色主题的 chip/链接/进度条一起变色。
  const rgb = cssColorToRgb(clean);
  if (rgb && dark) {
    const { h, s } = rgbToHsl(rgb);
    // 按钮的「品牌深色」与站标上面那块同档（站长：「按钮的颜色可以深一点」→「还是太浅了」）
    root.style.setProperty('--brand-deep', hslCss(h, s * 0.6, 0.38));
    root.style.setProperty('--brand-deep-on', '#ffffff');
  } else {
    root.style.removeProperty('--brand-deep');
    root.style.removeProperty('--brand-deep-on');
  }
}

export function setThemeColor(hex) {
  const clean = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? hex : '';
  if (clean) localStorage.setItem(THEME_COLOR_KEY, clean);
  else localStorage.removeItem(THEME_COLOR_KEY);
  applyThemeColor(clean);
}

/* ---------------------------------------------------------------------------
 * 站标配色（站长 2026-10-01：站点 LOGO 要跟着自定义主题色）
 *
 * ⚠️ 第一版是「CSS 变量 + html[data-brand='custom'] + 相对颜色语法」做的，
 *    结果站长那边页脚已经是新版（v1.3）却看不到变化，而且我这边复现不出来 ——
 *    说明它还悄悄依赖了「那个标记一定被打上」「浏览器一定支持 hsl(from ...)」这些前提。
 *    现在改成：**组件自己去读页面上真正生效的 `--md-sys-color-primary`**（不管它是谁设的），
 *    第二个颜色用 JS 做 HSL 运算算出来（不依赖任何新 CSS 语法），只依赖「读到一个颜色」。
 *
 * 现在的规则（历经站长几轮校准，别再改回旧口径）：
 * - 基色 = **用户在设置里选的那个颜色**（`nimao_theme_color`）。不要用深色主题那个被提亮的
 *     token 当基色：站长 2026-10-01 先嫌「太浅」（跟着 token 走发白），又嫌「太鲜艳」
 *     （我给深色模式提纯过饱和度），最后定成「就用取的那个颜色深点就行」。
 * - 上面那块 = 基色亮度 −0.05（略深）；下面那块 = 色相 −20°、亮度 +0.08（偏冷、略浅）。
 *     方向不能反：站长明确「上面的那个深一点比下面的」；原图也是上深下浅。
 * - 顶栏「KitterHub」文字与站标共用这两个色里的**上面那档**（见 components/useBrandColors.js）。
 * - 没存过自定义主题色 → 原始品牌蓝/青，文字不动（站点默认外观完全不变）。
 */
const BRAND_A = '#3b8afd';
const BRAND_B = '#17c7ff';
const DEFAULT_PRIMARY_LIGHT = '#0061a4';
const DEFAULT_PRIMARY_DARK = '#a6c8ff';

function cssColorToRgb(value) {
  if (!value || typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = '';
  probe.style.color = value;
  if (!probe.style.color) return null;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed || '');
  if (!m) return null;
  return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255 };
}

function rgbToHsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hslCss = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(clamp01(s) * 100)}%, ${Math.round(clamp01(l) * 100)}%)`;

/** 站标两个形状该用什么颜色（读当前生效的主题色）。
 *  返回 `{ a, b, text }`：a = 上面那块、b = 下面那块、text = 顶栏「KitterHub」文字该用的色
 *  （没设自定义主题色时 `text` 为 null，表示不动它，继续用站点默认的 primary）。
 */
export function logoColors(el) {
  const fallback = { a: BRAND_A, b: BRAND_B, text: null };
  if (typeof document === 'undefined') return fallback;
  // ⚠️ 从**站标元素自身**读，而不是只读 <html>：CSS 变量会继承，所以主题色不管被写在
  //    html / body / 某个容器上，这里都能读到最近的那份定义（只读 html 时，一旦主题色被
  //    写在别的层级上就会读不到 —— 这正是「我这边好、站长那边不变」这类差异最可能的来源）。
  const target = el || document.documentElement;
  let primary = '';
  try {
    primary = (getComputedStyle(target).getPropertyValue('--md-sys-color-primary') || '').trim();
  } catch { /* 读不到就走原始品牌色 */ }
  if (!primary && document.body) {
    try {
      primary = (getComputedStyle(document.body).getPropertyValue('--md-sys-color-primary') || '').trim();
    } catch { /* 同上 */ }
  }
  const themeEl = (el && el.closest && el.closest('[data-theme]')) || document.documentElement;
  const dark = (themeEl && themeEl.getAttribute('data-theme')) === 'dark';
  const isSiteDefault = !primary || primary.toLowerCase() === (dark ? DEFAULT_PRIMARY_DARK : DEFAULT_PRIMARY_LIGHT);
  // 两个信号只要有一个说「用户设过主题色」就跟着走：localStorage 有值，或主色不是站点默认值
  if (!readThemeColor() && isSiteDefault) return fallback;
  const rgb = cssColorToRgb(primary);
  if (!rgb) return fallback;
  // 站长 2026-10-01：「太鲜艳了，再深点，**就用取的那个颜色深点就行**」——
  // 所以基色取「用户在设置里选的那个颜色」（`nimao_theme_color`），而不是深色主题里那个
  // 被提亮成 l=0.8 的浅色调（跟着它走会发白；再提纯则会「太鲜艳」）。
  // 深浅只做小幅偏移：上面 = 取的色再深 0.05，下面 = 同色系偏冷 20°、略浅 0.08（上深下浅）。
  // 没存过自定义色（用的是站点默认配色）时保持原样：原始品牌蓝/青，文字不动。
  const stored = cssColorToRgb(readThemeColor());
  const base = stored || rgb;
  const { h, s, l } = rgbToHsl(base);
  if (dark) {
    // 深色模式单独定档（站长 2026-10-01 连着三轮校准）：
    //   「深色模式下优化一下」→「深色还是太鲜艳了」→「而且还是太浅了」。
    // 结论：**饱和度要低**（×0.6），但**亮度要更暗**（0.38 / 0.50，一开始是 0.48/0.62）。
    // 色相仍完全来自用户选的颜色，「用取的那个颜色」这条没变。
    const S = s * 0.6;
    return { a: hslCss(h, S, 0.38), b: hslCss(h - 20, S, 0.5), text: hslCss(h, S, 0.38) };
  }
  const a = hslCss(h, s, l - 0.05);
  return { a, b: hslCss(h - 20, s, l + 0.08), text: a };
}

/* ===========================================================================
   页面背景图（存本机 IndexedDB）+ 遮罩强度 / 模糊
   =========================================================================== */
export const BG_DIM_KEY = 'nimao_bg_dim';
export const BG_BLUR_KEY = 'nimao_bg_blur';

/** 所有外观相关的本机键：「恢复默认」要清的清单，和设置页里的项一一对应 */
export const APPEARANCE_KEYS = [
  FONT_SCALE_KEY, CONTRAST_KEY, NAV_STYLE_KEY, OPEN_WORK_NEW_TAB_KEY, PAGE_TITLE_NAME_KEY,
  UI_ALPHA_KEY, CARD_BLUR_KEY, CARD_SCRIM_KEY, CARD_FROST_KEY,
  SMALL_SOLID_KEY, TEXT_SOLID_KEY, THEME_COLOR_KEY, BG_DIM_KEY, BG_BLUR_KEY,
];
export const DEFAULT_BG_DIM = 74;    // 遮罩强度 %
export const DEFAULT_BG_BLUR = 4;    // 模糊 px

/* ⚠️ 必须先把「没存过」和「存了 0」区分开：Number(null) === 0，
   直接 `Number(localStorage.getItem(k))` 会让没设置过的用户读到 0（遮罩强度 0 = 背景图不打码、文字糊）
   —— 第一次就是这么写的，被测试逮住了。 */
function readNumberInRange(key, min, max, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function readBgDim() {
  return readNumberInRange(BG_DIM_KEY, 0, 95, DEFAULT_BG_DIM);
}

export function readBgBlur() {
  return readNumberInRange(BG_BLUR_KEY, 0, 24, DEFAULT_BG_BLUR);
}

export function applyBgVars() {
  const root = document.documentElement;
  root.style.setProperty('--app-bg-dim', String(readBgDim() / 100));
  root.style.setProperty('--app-bg-blur', `${readBgBlur()}px`);
}

export function setBgDim(v) {
  localStorage.setItem(BG_DIM_KEY, String(Math.max(0, Math.min(95, Number(v) || 0))));
  applyBgVars();
}

export function setBgBlur(v) {
  localStorage.setItem(BG_BLUR_KEY, String(Math.max(0, Math.min(24, Number(v) || 0))));
  applyBgVars();
}

let bgObjectUrl = null;

/** 当前背景图的 object URL（没设置就是 ''），设置页拿它做预览 */
export function currentBackgroundUrl() {
  return bgObjectUrl || '';
}

/** 从 IndexedDB 读出来挂到 <html> 上；返回是否真的有背景图 */
export async function loadBackgroundImage() {
  const root = document.documentElement;
  let blob = null;
  try {
    blob = await bgGet();
  } catch {
    blob = null;
  }
  if (bgObjectUrl) {
    URL.revokeObjectURL(bgObjectUrl);
    bgObjectUrl = null;
  }
  if (!blob) {
    root.removeAttribute('data-bg');
    root.style.removeProperty('--app-bg-image');
    root.style.removeProperty('--app-bg-gutter');
    return false;
  }
  bgObjectUrl = URL.createObjectURL(blob);
  root.style.setProperty('--app-bg-image', `url("${bgObjectUrl}")`);
  root.setAttribute('data-bg', 'on');
  // ⚠️ 曾经这里会采样「图的右边缘颜色」当画布底色，用来伪装 Windows 那条滚动条槽。
  //    后来改成隐藏原生滚动条 + 自绘浮层指示条（components/OverlayScrollbar.jsx），槽没了，
  //    这个采样就只剩副作用：它取的是图的右边缘（你那张图右边偏亮）→ 一旦图有透明区/没盖到，
  //    就会透出一条浅色带（站长 2026-10-01：「顶部那条白印还在」）。所以删掉，画布只用主题底色。
  root.style.removeProperty('--app-bg-gutter');
  return true;
}

export async function saveBackgroundImage(fileOrBlob) {
  await bgSet(fileOrBlob);
  return loadBackgroundImage();
}

export async function removeBackgroundImage() {
  await bgClear();
  return loadBackgroundImage();
}

/* ---------------------------------------------------------------------------
 * 「打开作品时新建标签页」（站长 2026-09-30：可选项，界面设置里调，默认关）
 *
 * 为什么在 document 上做一次事件委托，而不是去改每个作品链接：
 *   站内能点开作品的地方太多（发现页卡片、个人主页作品网格、首页精选、搜索、收藏、
 *   历史、稍后再看、系列、工作室作品墙、相关作品、通知…），逐个改成 target="_blank"
 *   既会漏、又要区分「是不是作品链接」。这里统一拦一次：只要是普通左键点在工作链接上
 *   （href 形如 /works/<数字>），就把默认跳转换成开新标签页。
 *
 * 不拦的情况（交给浏览器，保持原生习惯）：
 * - 已经写了 target="_blank" 的链接；
 * - 按住 Ctrl / Cmd / Shift / Alt 点（浏览器本来就会新开，我拦了反而重复开两个）；
 * - 中键 / 右键（button !== 0）；
 * - 目标是 /works/new（投稿页，属于「去创建」不是「看作品」）。
 * ------------------------------------------------------------------------- */
export function readOpenWorkNewTab() {
  return localStorage.getItem(OPEN_WORK_NEW_TAB_KEY) === '1';
}

export function readPageTitleName() {
  return localStorage.getItem(PAGE_TITLE_NAME_KEY) === '1';
}

export function setPageTitleName(on) {
  if (on) localStorage.setItem(PAGE_TITLE_NAME_KEY, '1');
  else localStorage.removeItem(PAGE_TITLE_NAME_KEY);
  notifyAppearance();
}

/** 广播外观变化（TitleManager 等监听它即时更新） */
export function notifyAppearance() {
  try {
    window.dispatchEvent(new Event(APPEARANCE_EVENT));
  } catch (e) { /* 忽略 */ }
}

export function setOpenWorkNewTab(on) {
  if (on) localStorage.setItem(OPEN_WORK_NEW_TAB_KEY, '1');
  else localStorage.removeItem(OPEN_WORK_NEW_TAB_KEY);
}

/** 这个 href 算不算「作品详情页」 */
export function isWorkHref(href) {
  if (!href) return false;
  // 允许 http(s)://host/works/123 与 /works/123（可能带 query/hash），排除 /works/new
  const m = /\/works\/(\d+)(?:[/?#]|$)/.exec(href);
  return Boolean(m);
}

let workLinkInstalled = false;

/** 装全局拦截（幂等，可重复调用）。每次点击时才读偏好，所以设置里一改立刻生效。 */
export function installWorkLinkInterceptor() {
  if (workLinkInstalled || typeof document === 'undefined') return;
  workLinkInstalled = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!readOpenWorkNewTab()) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      const href = a.getAttribute('href') || '';
      if (!isWorkHref(href)) return;
      if (/\/works\/new/.test(href)) return;
      e.preventDefault();
      // noopener：不让新页面通过 window.opener 反控本站
      const win = window.open(a.href, '_blank', 'noopener');
      if (win) win.opener = null;
    },
    true            // 捕获阶段：赶在 react-router 的 Link 处理之前
  );
}

installWorkLinkInterceptor();
