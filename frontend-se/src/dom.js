/* 极简 DOM 构造（ES5，兼容 IE11）
   用法：h('div', {class:'x', text:'内容'}, [子节点]) */

export function text(s) {
  return document.createTextNode(s === null || s === undefined ? '' : String(s));
}

export function clear(el) {
  while (el.firstChild) { el.removeChild(el.firstChild); }
}

function push(parent, child) {
  if (child === null || child === undefined || child === false) { return; }
  if (Object.prototype.toString.call(child) === '[object Array]') {
    for (var i = 0; i < child.length; i++) { push(parent, child[i]); }
    return;
  }
  parent.appendChild(typeof child === 'object' && child.nodeType ? child : text(child));
}

export function h(tag, attrs, children) {
  var el = document.createElement(tag);
  var k;
  if (attrs) {
    for (k in attrs) {
      if (!attrs.hasOwnProperty(k)) { continue; }
      var v = attrs[k];
      if (v === null || v === undefined || v === false) { continue; }
      if (k === 'text') { el.appendChild(text(v)); } else { el.setAttribute(k, String(v)); }
    }
  }
  if (children) { push(el, children); }
  return el;
}

/* 一张 key-value 表（IE 下最稳的版式） */
export function kv(rows) {
  var table = h('table', { 'class': 'kv' });
  for (var i = 0; i < rows.length; i++) {
    table.appendChild(h('tr', null, [
      h('td', { 'class': 'k', text: rows[i][0] }),
      h('td', { text: rows[i][1] })
    ]));
  }
  return table;
}

export function link(href, label) {
  return h('a', { href: href, text: label });
}

/* 正文：保留换行、按纯文本显示（不信任 HTML，直接 textContent） */
export function pre(content) {
  return h('pre', { 'class': 'body', text: content || '' });
}
