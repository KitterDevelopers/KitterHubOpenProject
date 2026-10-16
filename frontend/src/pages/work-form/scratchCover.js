/**
 * 从 .sb3 里取一张能当封面的图（Scratch 的 .sb3 就是个 zip）。
 *
 * 为什么要这么做：.sb3 内部**不含缩略图**（Scratch 官网的缩略图是它服务端渲染的），
 * 而 TurboWarp 播放器是跨域 iframe，浏览器根本拿不到里面的画面，
 * 服务器上跑无头浏览器又不现实（2 vCPU / 1.7G 内存）。所以：
 * 在**用户自己的浏览器**里解开 zip、取舞台当前背景图、画进 canvas 转成 PNG。
 *
 * 这是「舞台背景」，不是带角色的运行首帧 —— 文案上也如实这么写。
 * 取不到就抛错，前端提示用户自己传一张封面。
 */
import { unzipSync, strFromU8 } from 'fflate';

export const COVER_W = 480;
export const COVER_H = 360;

function extMime(format) {
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  return 'image/png';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/** 读取 .sb3，返回 { blob, width, height }；失败抛 Error（调用方转成提示文案）。 */
export async function makeCoverFromSb3(file) {
  const buf = new Uint8Array(await file.arrayBuffer());

  // 第一遍只看 project.json，避免把整个包（可能几十 MB）都解压到内存里
  const meta = unzipSync(buf, { filter: (f) => f.name === 'project.json' });
  if (!meta['project.json']) throw new Error('no-project-json');
  const proj = JSON.parse(strFromU8(meta['project.json']));

  const targets = proj.targets || [];
  const stage = targets.find((t) => t.isStage) || targets[0];
  const costumes = (stage && stage.costumes) || [];
  const cur = costumes[stage && stage.currentCostume != null ? stage.currentCostume : 0] || costumes[0];
  if (!cur) throw new Error('no-costume');
  const asset = cur.md5ext || `${cur.assetId}.${cur.dataFormat}`;

  // 第二遍只解压这一张图
  const one = unzipSync(buf, { filter: (f) => f.name === asset });
  const bytes = one[asset];
  if (!bytes) throw new Error('asset-missing');

  const url = URL.createObjectURL(new Blob([bytes], { type: extMime(cur.dataFormat) }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = COVER_W;
    canvas.height = COVER_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, COVER_W, COVER_H);
    // 背景图本身就该是 480×360；万一尺寸不对，按 contain 居中放进去，不裁切
    const iw = img.naturalWidth || img.width || COVER_W;
    const ih = img.naturalHeight || img.height || COVER_H;
    const scale = Math.min(COVER_W / iw, COVER_H / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.drawImage(img, (COVER_W - w) / 2, (COVER_H - h) / 2, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('toBlob failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
