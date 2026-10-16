/* SE 版偏好设置（localStorage，IE11 可用）
   se_preview: embed（直接内嵌播放，默认）| click（点击后加载）| off（不显示）
   se_pagesize: 论坛每页条数 */

function read(k, d) {
  try {
    var v = window.localStorage ? window.localStorage.getItem(k) : '';
    return v === null || v === '' ? d : v;
  } catch (e) { return d; }
}

function write(k, v) {
  try { if (window.localStorage) { window.localStorage.setItem(k, v); } } catch (e) { /* 忽略 */ }
}

export function previewMode() {
  var v = read('se_preview', 'embed');
  return (v === 'embed' || v === 'click' || v === 'off') ? v : 'embed';
}
export function setPreviewMode(v) { write('se_preview', v); }

export function pageSize() {
  var n = parseInt(read('se_pagesize', '20'), 10);
  return (n >= 5 && n <= 50) ? n : 20;
}
export function setPageSize(n) { write('se_pagesize', String(n)); }
