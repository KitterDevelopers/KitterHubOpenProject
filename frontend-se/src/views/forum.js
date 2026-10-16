/* 论坛列表：/api/posts?limit=20&page=N → 数组 */

import { h, link } from '../dom.js';
import { get } from '../api.js';
import { pageSize } from '../prefs.js';
import { mdText } from '../md.js';

export function render(params, query, paint) {
  var PAGE = pageSize();   /* 每页条数由设置页决定 */
  var page = parseInt(query.page, 10);
  if (!page || page < 1) { page = 1; }
  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  get('/posts', { limit: PAGE, page: page }, function (e, d) {
    if (e) { paint(h('div', { 'class': 'err', text: e.message })); return; }
    var list = d && d.length ? d : (d && d.items ? d.items : []);
    var ul = h('ul', { 'class': 'list' });
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      ul.appendChild(h('li', null, [
        h('span', { 'class': 't' }, link('#/post/' + p.id, p.title || '(无标题)')),
        p.category ? h('span', { 'class': 'tag', text: p.category }) : null,
        p.is_pinned ? h('span', { 'class': 'tag', text: '置顶' }) : null,
        h('div', { 'class': 'meta', text: mdText(p.summary || p.content || '', 100) }),
        h('div', { 'class': 'meta', text: '浏览 ' + (p.views || 0) + (p.created_at ? ' · ' + String(p.created_at).substring(0, 10) : '') })
      ]));
    }

    var pager = h('div', { 'class': 'pager' });
    if (page > 1) { pager.appendChild(link('#/forum?page=' + (page - 1), '上一页')); }
    pager.appendChild(h('span', { 'class': 'meta', text: '第 ' + page + ' 页' + (list.length < PAGE ? '（已到末页）' : '') }));
    if (list.length >= PAGE) { pager.appendChild(link('#/forum?page=' + (page + 1), '下一页')); }

    paint(h('div', null, [
      h('h1', { text: '论坛' }),
      list.length ? ul : h('p', { 'class': 'meta', text: '没有帖子' }),
      pager
    ]));
  });
}
