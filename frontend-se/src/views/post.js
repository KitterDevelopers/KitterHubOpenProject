/* 帖子详情：/api/posts/{id} + /api/posts/{id}/comments（数组） */

import { h, link, kv } from '../dom.js';
import { pic } from '../img.js';
import { get } from '../api.js';
import { md } from '../md.js';
import { reactions, commentForm } from './interact.js';

function when(s) {
  return s ? String(s).replace('T', ' ').substring(0, 16) : '';
}

function comments(items, depth) {
  var ul = h('ul', { 'class': 'list' });
  for (var i = 0; i < items.length; i++) {
    var c = items[i];
    var u = c.user || {};
    var body = h('li', null, [
      h('div', { 'class': 'meta', text: (u.display_name || u.nickname || u.username || '用户') + ' · ' + when(c.created_at) + (c.pinned ? ' · 置顶' : '') }),
      md(c.content),
      c.image_url ? pic(c.image_url, '评论图片', 200, 150) : null
    ]);
    if (depth === 0) { body.style.paddingLeft = '0'; } else { body.style.paddingLeft = '16px'; }
    ul.appendChild(body);
  }
  return ul;
}

export function render(params, query, paint) {
  var id = params.id;
  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  get('/posts/' + id, null, function (e, p) {
    if (e) {
      paint(h('div', null, [
        h('h1', { text: '帖子' }),
        h('div', { 'class': 'err', text: (e.status === 404 ? '这个帖子不存在，或者正在审议中、已被隐藏。' : e.message) }),
        h('p', null, link('#/forum', '返回论坛'))
      ]));
      return;
    }
    var a = p.author || {};
    var head = h('div', null, [
      h('h1', { text: p.title || '(无标题)' }),
      kv([
        ['作者', link('#/user/' + (a.uid || ''), a.display_name || a.nickname || a.username || '未知')],
        ['分类', p.category || '—'],
        ['时间', when(p.created_at)],
        ['浏览', String(p.views || 0) + ' · 点赞 ' + (p.like_count || 0) + ' · 评论 ' + (p.comment_count || 0)]
      ]),
      p.image_url ? pic(p.image_url, '帖子图片', 320, 240) : null,
      h('h2', { text: '正文' }),
      md(p.content),
      reactions('post', p.id, p)
    ]);

    get('/posts/' + id + '/comments', null, function (e2, cs) {
      var list = (cs && cs.length) ? cs : [];
      paint(h('div', null, [
        head,
        h('h2', { text: '评论（' + list.length + '）' }),
        list.length ? comments(list, 0) : h('p', { 'class': 'meta', text: '还没有评论' }),
        commentForm('post', id, function () { get('/posts/' + id + '/comments', null, function (e3, cs2) { render(params, query, paint); }); }),
        h('p', null, link('#/forum', '返回论坛'))
      ]));
    });
  });
}
