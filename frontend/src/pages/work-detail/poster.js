/**
 * 分享海报生成（Canvas 纯矢量绘制）。
 *
 * 版面（720×1080，从上到下）：LOGO + KitterHub 字标 → 封面 → 标题 + 编辑器/数据 →
 * 作者卡片（头像 + 昵称 + 发布时间） | 二维码卡片（扫码看作品）。
 * 背景有 6 套主题色可选（POSTER_THEMES），深色主题白字、浅色主题深字，全套颜色跟着主题走。
 * ⚠️ 不出现任何 emoji —— 全站硬规则是界面不用 emoji，海报也是给用户看的内容。
 *
 * ---- 2026-09-26 修「生成海报有毛病」 ----
 * 病根：封面允许用**外链**（导入编程猫作品时存的就是 creation.bcmcdn.com 的图）。
 * 这种图用 `new Image()` 画进 canvas 后，canvas 会被标记为 **tainted**，
 * 于是 `toDataURL()` 抛 SecurityError —— 而当时没有任何兜底，异常一路冒到调用方，
 * 弹窗就永远停在「转圈」。所以现在：
 *   1. 跨域图片一律加 `crossOrigin='anonymous'`：图床没给 CORS 头就 onerror → 退回纯色块，
 *      **宁可没有封面图，也不能让 canvas 被污染**（实测 creation.bcmcdn.com 与
 *      cdn-community.bcmcdn.com 都返回 `Access-Control-Allow-Origin: *`，所以封面/头像都能画上）；
 *   2. 生成过程整体 try/catch，失败时**去掉封面和头像再画一次**（图挂了也要出海报）；
 *   3. 两次都失败就返回 null，由调用方给一句人话提示，不再无限转圈。
 * 另外修了 `wrapText` 的老毛病：行数**刚好用满**时也会无条件加省略号（标题没被截断却显示「…」）。
 */
// 注意：这两处 import 带 .js 后缀，是为了让 Node 能直接 import 本文件跑单测
// （Vite 两种写法都认，Node 的 ESM 解析器不补后缀）。
import { qrMatrix, qrGeometry, QR_QUIET, workShareUrl } from '../../qr.js';
import { colorFor, getInitial } from '../../utils.js';

const W = 720;
const H = 1080; // 720×1080 = 2:3，手机相册/朋友圈都好看
const PAD = 48;
const BOTTOM = H - PAD;

const HEADER = { h: 70, logoH: 46 };
const COVER = { y: 76, h: 420, r: 18 };
const TITLE = { size: 42, line: 56, max: 2 };
const META = { size: 23, gap: 46 }; // gap = 标题末行基线 → 信息行基线的距离
const AUTHOR_CARD = { h: 140, r: 18, avatar: 72 };
const QR_CARD = { box: 210, r: 16, caption: 22, gap: 24 }; // box 含静区
const QR_Y = BOTTOM - QR_CARD.caption - QR_CARD.gap - QR_CARD.box; // 卡片顶边

const FONT = 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const QR_DARK = '#0f172a';
/** 站标（透明底 PNG，同源资源，不受跨域 CORS 影响） */
export const LOGO_SRC = '/kitter-logo.png';

/** 主题：stops 是背景渐变的三个色标，其余颜色按深浅自动配好，浅色主题文字转深色 */
function mkTheme(key, stops, dark) {
  return {
    key,
    stops,
    dark,
    swatch: stops[1],
    ink: dark ? '#ffffff' : '#12233d',
    sub: dark ? 'rgba(255,255,255,0.72)' : 'rgba(18,35,61,0.66)',
    faint: dark ? 'rgba(255,255,255,0.60)' : 'rgba(18,35,61,0.55)',
    card: dark ? 'rgba(255,255,255,0.10)' : 'rgba(18,35,61,0.05)',
    pill: dark ? 'rgba(255,255,255,0.18)' : 'rgba(18,35,61,0.08)',
    deco: dark ? 'rgba(255,255,255,0.08)' : 'rgba(18,35,61,0.045)',
    stroke: dark ? 'rgba(255,255,255,0.14)' : 'rgba(18,35,61,0.10)',
    coverFallback: dark ? 'rgba(255,255,255,0.10)' : 'rgba(18,35,61,0.06)',
    qrBorder: dark ? '' : 'rgba(18,35,61,0.12)',
  };
}

/** 6 套背景主题；顺序就是弹窗里色块从左到右的顺序 */
export const POSTER_THEMES = [
  mkTheme('brand', ['#0b3a86', '#0d47a1', '#062a63'], true),
  mkTheme('night', ['#151c28', '#1f2937', '#070a10'], true),
  mkTheme('mint', ['#0b4f4a', '#0f766e', '#042b28'], true),
  mkTheme('sunset', ['#7a2e12', '#b45309', '#431a09'], true),
  mkTheme('sakura', ['#7d2b52', '#b03a6a', '#45142c'], true),
  mkTheme('paper', ['#f7f9fc', '#eaf0fa', '#dde7f6'], false),
];

/** 取主题；传未知 key（含 undefined）时回落到第一套（品牌蓝） */
export function posterTheme(key) {
  return POSTER_THEMES.find((t) => t.key === key) || POSTER_THEMES[0];
}

/** 圆角矩形路径（Chrome 支持 ctx.roundRect，兜底手写一遍） */
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function isCrossOrigin(src) {
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function loadImage(src, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    // 超时兜底：图床卡住时 onload/onerror 可能**永远不触发**，那样海报就永远转圈了，
    // 宁可 8 秒后用兜底样式出图，也不能让用户对着转圈干等。
    const timer = setTimeout(() => finish(null), timeoutMs);
    // 外链图片必须走 CORS 模式：拿不到 CORS 头就加载失败（onerror），
    // 这样就不会出现「图能画上去、canvas 却被污染」的半成功状态。
    if (isCrossOrigin(src)) img.crossOrigin = 'anonymous';
    img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = src;
  });
}

/**
 * 按最大宽度折行，最多 maxLines 行；**只有真的被截断**才加省略号。
 * 导出是为了能在 Node 里用假 ctx 单独测折行逻辑（见 .forensics/verify/poster_unit.mjs）。
 */
export function wrapText(ctx, text, maxWidth, maxLines) {
  const src = String(text || '');
  const lines = [];
  let line = '';
  let cut = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\n') {
      lines.push(line);
      line = '';
      if (lines.length >= maxLines) {
        cut = i < src.length - 1;
        break;
      }
      continue;
    }
    if (line && ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) {
        cut = true; // 这个字符已经放不下了，说明后面还有内容
        break;
      }
      continue;
    }
    line += ch;
  }
  if (!cut && line && lines.length < maxLines) lines.push(line);
  if (cut && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** object-fit: cover 的等比裁切，居中画进 (x,y,w,h) */
function drawCoverFit(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 圆形头像：有图就用图，没图用「底色 + 首字母」（与站内默认头像一致） */
function drawAvatar(ctx, img, name, cx, cy, d) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    drawCoverFit(ctx, img, cx - d / 2, cy - d / 2, d, d);
  } else {
    ctx.fillStyle = colorFor(name);
    ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(d * 0.44)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getInitial(name), cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/** 画二维码：白色圆角卡片（静区就由这张卡的留白承担）+ 深色模块 */
function drawQrCard(ctx, text, x, y, box, theme) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, box, box, QR_CARD.r);
  ctx.fill();
  if (theme.qrBorder) {
    ctx.strokeStyle = theme.qrBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, box - 1, box - 1, QR_CARD.r);
    ctx.stroke();
  }

  const m = qrMatrix(text);
  const { cell, size } = qrGeometry(m.count, box - 20);
  const ox = x + (box - size) / 2;
  const oy = y + (box - size) / 2;
  ctx.fillStyle = QR_DARK;
  for (let r = 0; r < m.count; r += 1) {
    for (let c = 0; c < m.count; c += 1) {
      if (m.isDark(r, c)) {
        ctx.fillRect(ox + (QR_QUIET + c) * cell, oy + (QR_QUIET + r) * cell, cell, cell);
      }
    }
  }
  ctx.restore();
}

/**
 * 画整张海报。imgs = { cover, avatar, logo }，封面/头像为 null 时画兜底样式。
 * @param {object} work 作品对象
 * @param {object} copy 已翻译好的文案，见 index.jsx 的 showPoster
 * @param {object} theme 主题（posterTheme(key)）
 */
function drawPoster(ctx, work, copy, imgs, theme) {
  const cover = imgs?.cover || null;
  const avatar = imgs?.avatar || null;
  const logo = imgs?.logo || null;
  const authorName = copy.authorName || '';

  // 底：主题渐变
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, theme.stops[0]);
  bg.addColorStop(0.55, theme.stops[1]);
  bg.addColorStop(1, theme.stops[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 右上角一层极淡的装饰圆，避免大面积纯色发闷
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.deco;
  ctx.beginPath();
  ctx.arc(W - 30, 120, 230, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- 顶部：LOGO + 字标 + 标语 ----
  ctx.textBaseline = 'alphabetic';
  let brandX = PAD;
  if (logo) {
    const lh = HEADER.logoH;
    const lw = Math.round(logo.naturalWidth * (lh / logo.naturalHeight));
    ctx.drawImage(logo, PAD, Math.round((HEADER.h - lh) / 2), lw, lh);
    brandX = PAD + lw + 14;
  }
  ctx.fillStyle = theme.ink;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('KitterHub', brandX, 46);
  if (copy.tagline) {
    ctx.fillStyle = theme.faint;
    ctx.font = `400 17px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(copy.tagline, W - PAD, 44);
    ctx.textAlign = 'left';
  }

  // ---- 封面 ----
  ctx.save();
  roundRect(ctx, PAD, COVER.y, W - PAD * 2, COVER.h, COVER.r);
  ctx.clip();
  if (cover) {
    drawCoverFit(ctx, cover, PAD, COVER.y, W - PAD * 2, COVER.h);
  } else {
    ctx.fillStyle = theme.coverFallback;
    ctx.fillRect(PAD, COVER.y, W - PAD * 2, COVER.h);
    ctx.fillStyle = theme.faint;
    ctx.font = `600 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(copy.placeholder || '', W / 2, COVER.y + COVER.h / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  // 封面描一道极淡的边，浅色封面在同色底上才有轮廓
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = 1;
  roundRect(ctx, PAD + 0.5, COVER.y + 0.5, W - PAD * 2 - 1, COVER.h - 1, COVER.r);
  ctx.stroke();

  // ---- 标题 + 作品信息（在封面与底部卡片之间的空白里居中）----
  const contentW = W - PAD * 2;
  ctx.font = `800 ${TITLE.size}px ${FONT}`;
  const titleLines = wrapText(ctx, work.title, contentW, TITLE.max);

  const blockH = titleLines.length * TITLE.line + META.gap + META.size;
  const midTop = COVER.y + COVER.h + 10;
  const bandTop = QR_Y - 28;
  const blockTop = midTop + Math.max(0, (bandTop - midTop - blockH) / 2);
  let y = blockTop + TITLE.size;

  ctx.fillStyle = theme.ink;
  ctx.font = `800 ${TITLE.size}px ${FONT}`;
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y);
    y += TITLE.line;
  }

  // 作品信息行：编辑器胶囊 + 「N 次浏览 - N 赞 - N 收藏」
  const metaY = blockTop + titleLines.length * TITLE.line + META.gap;
  let metaX = PAD;
  if (copy.editor) {
    ctx.font = `600 20px ${FONT}`;
    const pillW = Math.ceil(ctx.measureText(copy.editor).width) + 28;
    const pillY = metaY - 25;
    ctx.fillStyle = theme.pill;
    roundRect(ctx, metaX, pillY, pillW, 34, 17);
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.fillText(copy.editor, metaX + 14, pillY + 23);
    metaX += pillW + 18;
  }
  if (copy.stats && copy.stats.length) {
    ctx.fillStyle = theme.sub;
    ctx.font = `400 ${META.size}px ${FONT}`;
    ctx.fillText(copy.stats.join(' - '), metaX, metaY);
  }

  // ---- 作者卡片 ----
  const cardW = W - PAD * 2 - QR_CARD.box - 24;
  const cardY = QR_Y + QR_CARD.box - AUTHOR_CARD.h;
  ctx.fillStyle = theme.card;
  roundRect(ctx, PAD, cardY, cardW, AUTHOR_CARD.h, AUTHOR_CARD.r);
  ctx.fill();

  const av = AUTHOR_CARD.avatar;
  const avX = PAD + 30 + av / 2;
  const avY = cardY + AUTHOR_CARD.h / 2;
  drawAvatar(ctx, avatar, authorName, avX, avY, av);

  const textX = PAD + 30 + av + 22;
  const textMax = cardW - (textX - PAD) - 24;
  if (copy.authorLabel) {
    ctx.fillStyle = theme.faint;
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText(copy.authorLabel, textX, avY - 24);
  }
  ctx.fillStyle = theme.ink;
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(wrapText(ctx, authorName, textMax, 1)[0] || '', textX, avY + 8);
  if (copy.published) {
    ctx.fillStyle = theme.sub;
    ctx.font = `400 19px ${FONT}`;
    ctx.fillText(wrapText(ctx, copy.published, textMax, 1)[0] || '', textX, avY + 38);
  }

  // ---- 二维码卡片 ----
  const url = copy.url || workShareUrl(work.id);
  drawQrCard(ctx, url, W - PAD - QR_CARD.box, QR_Y, QR_CARD.box, theme);
  if (copy.scan) {
    ctx.fillStyle = theme.sub;
    ctx.font = `600 ${QR_CARD.caption}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(copy.scan, W - PAD - QR_CARD.box / 2, BOTTOM);
    ctx.textAlign = 'left';
  }
}

/**
 * 生成海报，返回 dataURL；实在生成不出来返回 null（调用方负责提示）。
 * @param {object} work  作品对象
 * @param {object} copy  已翻译好的文案
 *        { authorName, authorLabel, published, editor, stats[], scan, tagline, placeholder, url? }
 * @param {string} themeKey  背景主题 key（见 POSTER_THEMES），未知值回落品牌蓝
 */
export async function makePoster(work, copy, themeKey) {
  const theme = posterTheme(themeKey);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // LOGO 是同源静态资源，跨域那一套兜底与它无关，直接一直画
  const [logo, cover, avatar] = await Promise.all([
    loadImage(LOGO_SRC),
    loadImage(work.cover_url),
    loadImage(work.author?.avatar_url),
  ]);

  // 第一遍：带图；失败（例如某张图仍然污染了 canvas）就去掉封面/头像重画一次
  for (const useImages of [true, false]) {
    try {
      drawPoster(ctx, work, copy, { logo, cover: useImages ? cover : null, avatar: useImages ? avatar : null }, theme);
      return canvas.toDataURL('image/png');
    } catch {
      if (useImages === false) return null;
    }
  }
  return null;
}
