/**
 * 二维码：只做「文本 → 模块矩阵」这一件事，怎么画由调用方决定（海报用 canvas 画方块）。
 *
 * 为什么用 qrcode-generator 而不是自己撸一个：QR 的 RS 纠错、掩码罚分、版本容量表
 * 只要写错一个数，结果就是「看着像二维码、怎么扫都扫不出来」——这种错肉眼验收根本发现不了。
 * 用成熟库（无依赖 / MIT / 十几年老库）之外，再用 jsQR 解码做单测双保险
 * （见 .forensics/verify/poster_qr.mjs）。
 *
 * 依赖：qrcode-generator ^2，dist 里同时提供 CJS 与 ESM，Vite 直接吃。
 */
import qrcode from 'qrcode-generator';

/** 静区（四周留白）模块数：规范要求 ≥4，少于 4 扫码器容易认不出。 */
export const QR_QUIET = 4;

/**
 * 生成模块矩阵（纯数据、无 DOM，所以能在 Node 里单测）。
 * @param {string} text 要编码的内容（作品链接，正常是纯 ASCII）
 * @param {'L'|'M'|'Q'|'H'} ec 纠错级别；M ≈15%，适合「发到聊天里会被压一道」的图片
 * @returns {{ count: number, isDark: (row: number, col: number) => boolean }}
 */
export function qrMatrix(text, ec = 'M') {
  const qr = qrcode(0, ec); // 0 = 按内容长度自动挑版本
  const data = String(text ?? '');
  // 命中非 Latin-1 字符时才切到 UTF-8 字节表（作品链接是纯 ASCII，正常走不到）
  const utf8 = qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8'];
  if (utf8 && /[^\x00-\xff]/.test(data)) qrcode.stringToBytes = utf8;
  qr.addData(data);
  qr.make();
  const count = qr.getModuleCount();
  return { count, isDark: (row, col) => qr.isDark(row, col) };
}

/**
 * 排版：模块边长取整（半像素会把方块画糊、也可能扫不出来），四周留 quiet 个模块的静区。
 * @param {number} count 模块数（qrMatrix().count）
 * @param {number} boxSize 可用边长
 * @returns {{ cell: number, size: number }} size = 含静区的正方形边长，保证 ≤ boxSize
 */
export function qrGeometry(count, boxSize, quiet = QR_QUIET) {
  const cell = Math.max(2, Math.floor(boxSize / (count + quiet * 2)));
  return { cell, size: cell * (count + quiet * 2) };
}

/** 作品分享链接（海报二维码扫出来的就是这个地址） */
export function workShareUrl(id, origin) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/works/${id}`;
}
