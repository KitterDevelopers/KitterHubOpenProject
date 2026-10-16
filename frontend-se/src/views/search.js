/* 搜索：/api/search?q= → {works, posts, users, studios} */

import { h, link } from '../dom.js';
import { pic } from '../img.js';
import { get } from '../api.js';

function form(q) {
  var input = h('input', { 'class': 'q', type: 'text', name: 'q', value: q || '' });
  var btn = h('input', { 'class': 'btn', type: 'submit', value: '搜索' });
  var f = h('form', { method: 'get' }, [input, h('span', { text: ' ' }), btn]);
  f.onsubmit = function () {
    var v = input.value;
    location.hash = '#/search?q=' + encodeURIComponent(v);
    return false;
  };
  return f;
}

function group(title, items, render) {
  if (!items || !items.length) { return null; }
  var ul = h('ul', { 'class': 'list' });
  for (var i = 0; i < items.length && i < 20; i++) { ul.appendChild(render(items[i])); }
  return h('div', null, [h('h2', { text: title + '（' + items.length + '）' }), ul]);
}

export function render(params, query, paint) {
  var q = query.q || '';
  paint(h('div', null, [h('h1', { text: '搜索' }), form(q)]));
  if (!q) { return; }

  get('/search', { q: q }, function (e, d) {
    if (e) { paint(h('div', null, [h('h1', { text: '搜索' }), form(q), h('div', { 'class': 'err', text: e.message })])); return; }
    var works = group('作品', d.works, function (w) {
      return h('li', null, [
        h('span', { 'class': 't' }, link('#/work/' + w.id, w.title || '(无标题)')),
        w.category ? h('span', { 'class': 'tag', text: w.category }) : null,
        w.cover_url ? pic(w.cover_url, w.title, 100, 75) : null
      ]);
    });
    var posts = group('帖子', d.posts, function (p) {
      return h('li', null, [
        h('span', { 'class': 't' }, link('#/post/' + p.id, p.title || '(无标题)')),
        h('div', { 'class': 'meta', text: (p.summary || p.content || '').substring(0, 90) })
      ]);
    });
    var users = group('用户', d.users, function (u) {
      return h('li', null, link('#/user/' + (u.uid || u.id), u.nickname || u.display_name || u.username || '用户'));
    });
    var studios = group('工作室', d.studios, function (s) {
      return h('li', null, h('span', { 'class': 't', text: s.name || '' }));
    });

    var any = works || posts || users || studios;
    paint(h('div', null, [
      h('h1', { text: '搜索：' + q }),
      form(q),
      any ? null : h('p', { 'class': 'meta', text: '没有找到相关内容' }),
      works, posts, users, studios
    ]));
  });
}
