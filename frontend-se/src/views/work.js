/* 作品详情：/api/works/{id}
   SE 版不内嵌播放器（那是 JS 应用），改为给一个回主站的链接 —— 老浏览器也能看到作品信息 */

import { h, link, kv } from '../dom.js';
import { pic } from '../img.js';
import { get, SITE_ORIGIN } from '../api.js';
import { md } from '../md.js';
import { reactions, commentForm, workPlayer } from './interact.js';

function when(s) { return s ? String(s).replace('T', ' ').substring(0, 16) : ''; }

/* 作品评论列表（与帖子页同样式） */
function commentNodes(items) {
  var ul = h('ul', { 'class': 'list' });
  for (var i = 0; i < items.length; i++) {
    var c = items[i];
    var u = c.user || {};
    ul.appendChild(h('li', null, [
      h('div', { 'class': 'meta', text: (u.display_name || u.nickname || u.username || '用户') + ' · ' + when(c.created_at) + (c.pinned ? ' · 置顶' : '') }),
      md(c.content),
      c.image_url ? pic(c.image_url, '评论图片', 200, 150) : null
    ]));
  }
  return ul;
}

export function render(params, query, paint) {
  var id = params.id;
  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  get('/works/' + id, null, function (e, w) {
    if (e) {
      paint(h('div', null, [
        h('h1', { text: '作品' }),
        h('div', { 'class': 'err', text: (e.status === 404 ? '这个作品不存在，或者正在审议中、已被隐藏。' : e.message) }),
        h('p', null, link('#/', '返回首页'))
      ]));
      return;
    }
    var a = w.author || {};
    var tags = w.tags ? String(w.tags).split(/[,\s]+/) : [];
    var tagNodes = [];
    for (var i = 0; i < tags.length && i < 12; i++) {
      if (tags[i]) { tagNodes.push(h('span', { 'class': 'tag', text: tags[i] })); }
    }

    /* 作品评论要单独拉一次 */
    get('/works/' + id + '/comments', null, function (ec, cs) {
    var list = (cs && cs.length) ? cs : [];
    paint(h('div', null, [
      h('h1', { text: w.title || '(无标题)' }),
      kv([
        ['作者', link('#/user/' + (a.uid || ''), a.display_name || a.nickname || a.username || '未知')],
        ['分类', w.category || '—'],
        ['浏览', String(w.views || 0)],
        ['类型', w.work_type || '—']
      ]),
      w.cover_url ? pic(w.cover_url, w.title, 320, 240) : null,
      h('h2', { text: '在线试玩' }),
      workPlayer(w),
      h('h2', { text: '作品说明' }),
      md(w.description || '（作者没有写说明）'),
      tagNodes.length ? h('p', null, tagNodes) : null,
      reactions('work', id, w),
      h('p', null, [h('span', { 'class': 'meta', text: '完整页面：' }), link(SITE_ORIGIN + '/works/' + id, '在 KitterHub 打开')]),
      h('h2', { text: '评论（' + list.length + '）' }),
      list.length ? commentNodes(list) : h('p', { 'class': 'meta', text: '还没有评论' }),
      commentForm('work', id, null),
      h('p', null, link('#/', '返回首页'))
    ]));
    });
  });
}
