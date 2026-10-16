/* 极简 Markdown 渲染（纯 ES5、无依赖、约 70 行）
   支持：标题 #、粗体 **、斜体 *、行内代码 `、链接 [t](u)、图片 ![a](u)、
        无序/有序列表、引用 >、代码块 ```、分隔线 ---、段落与换行。
   安全：先把整段文本转义，再插入我们自己生成的标签 —— 所以永远不执行用户 HTML。
   图片遵循 SE 的图片开关（关闭时输出 [图片] 占位，不产生 <img>）。 */

import { h } from './dom.js';
import { imgEnabled } from './img.js';

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageTag(alt, src) {
  var s = String(src || '');
  /* 只允许 http(s) 与站内相对路径，挡掉 javascript: 之类 */
  if (!/^(https?:\/\/|\/)/i.test(s)) { return esc('[图片]'); }
  if (!imgEnabled()) { return esc('[图片] ' + (alt || '')); }
  return '<img class="pic" src="' + esc(s) + '" alt="' + esc(alt || '图片') + '">';
}

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, src) { return imageTag(alt, src); });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, href) {
    return '<a href="' + esc(href) + '">' + t + '</a>';
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

export function mdHtml(text) {
  var lines = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  var i = 0;
  var list = '';       /* 'ul' / 'ol' / '' */
  var para = [];

  function flushPara() {
    if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; }
  }
  function closeList() {
    if (list) { out.push('</' + list + '>'); list = ''; }
  }

  for (; i < lines.length; i++) {
    var line = lines[i];

    /* 代码块 */
    if (/^\s*```/.test(line)) {
      flushPara(); closeList();
      var buf = [];
      i++;
      for (; i < lines.length && !/^\s*```/.test(lines[i]); i++) { buf.push(esc(lines[i])); }
      out.push('<pre class="body">' + buf.join('\n') + '</pre>');
      continue;
    }

    /* 标题 */
    var hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      flushPara(); closeList();
      var lv = hm[1].length;
      out.push('<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>');
      continue;
    }

    /* 分隔线 */
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      flushPara(); closeList();
      out.push('<hr>');
      continue;
    }

    /* 引用 */
    var qm = /^\s*>\s?(.*)$/.exec(line);
    if (qm) {
      flushPara(); closeList();
      out.push('<blockquote>' + inline(qm[1]) + '</blockquote>');
      continue;
    }

    /* 列表 */
    var ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    var ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      var want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline(ul ? ul[1] : ol[1]) + '</li>');
      continue;
    }
    closeList();

    /* 空行 = 段落结束 */
    if (/^\s*$/.test(line)) { flushPara(); continue; }

    para.push(inline(line));
  }
  flushPara(); closeList();
  return out.join('\n');
}

/* 返回一个可直接插入页面的节点 */
export function md(text) {
  var el = h('div', { 'class': 'md' });
  el.innerHTML = mdHtml(text);
  return el;
}

/* 列表用的纯文本摘要：去掉 Markdown 记号再截断 —— 列表项里不该出现标题/列表符号 */
export function mdText(text, max) {
  var s = String(text === null || text === undefined ? '' : text);
  s = s.replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  var n = max || 90;
  return s.length > n ? s.substring(0, n) + '…' : s;
}
