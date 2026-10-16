/* 图片开关：默认关闭（老机器省流量优先），状态存 Cookie，一年有效
   关闭时根本不产生 <img> 元素，只输出 [图片] 文本占位 */

import { h } from './dom.js';

var KEY = 'se_img';

function cookie(name) {
  var parts = document.cookie ? document.cookie.split('; ') : [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var eq = p.indexOf('=');
    if (eq > -1 && p.substring(0, eq) === name) { return decodeURIComponent(p.substring(eq + 1)); }
  }
  return '';
}

export function imgEnabled() {
  return cookie(KEY) === '1';   /* 没设过就是关 */
}

export function setImg(on) {
  document.cookie = KEY + '=' + (on ? '1' : '0') + ';path=/;max-age=31536000';
}

/* 返回 <img> 或占位文本 */
export function pic(src, alt, w, h2) {
  if (!src) { return null; }
  if (!imgEnabled()) {
    return h('span', { 'class': 'ph', text: '[图片] ' + (alt || '') });
  }
  var attrs = { src: src, alt: alt || '图片', 'class': 'pic' };
  if (w) { attrs.width = w; }
  if (h2) { attrs.height = h2; }
  return h('img', attrs);
}
