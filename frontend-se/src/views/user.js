/* 用户页：/api/users/{uid}（返回里有作品/帖子时一并列出，没有就只显示资料） */

import { h, link, kv } from '../dom.js';
import { pic } from '../img.js';
import { get } from '../api.js';

function listOf(title, items, render) {
  if (!items || !items.length) { return null; }
  var ul = h('ul', { 'class': 'list' });
  for (var i = 0; i < items.length && i < 30; i++) { ul.appendChild(render(items[i])); }
  return h('div', null, [h('h2', { text: title + '（' + items.length + '）' }), ul]);
}

export function render(params, query, paint) {
  var uid = params.uid;
  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  get('/users/' + uid, null, function (e, u) {
    if (e) {
      paint(h('div', null, [
        h('h1', { text: '用户' }),
        h('div', { 'class': 'err', text: (e.status === 404 ? '找不到这个用户。' : e.message) }),
        h('p', null, link('#/', '返回首页'))
      ]));
      return;
    }
    var name = u.display_name || u.nickname || u.username || ('用户 ' + uid);

    paint(h('div', null, [
      h('h1', { text: name }),
      u.avatar_url ? pic(u.avatar_url, name, 64, 64) : null,
      kv([
        ['账号', '@' + (u.username || '—')],
        ['UID', String(u.uid || uid)],
        ['认证', u.verification_title || '—'],
        ['简介', u.bio || '（没有填写简介）']
      ]),
      listOf('作品', u.works, function (w) {
        return h('li', null, [
          h('span', { 'class': 't' }, link('#/work/' + w.id, w.title || '(无标题)')),
          w.cover_url ? pic(w.cover_url, w.title, 100, 75) : null
        ]);
      }),
      listOf('帖子', u.posts, function (p) {
        return h('li', null, h('span', { 'class': 't' }, link('#/post/' + p.id, p.title || '(无标题)')));
      }),
      listOf('合集', u.collections, function (c) {
        return h('li', null, h('span', { 'class': 't', text: c.name || c.title || '' }));
      }),
      h('p', null, link('#/', '返回首页'))
    ]));
  });
}
