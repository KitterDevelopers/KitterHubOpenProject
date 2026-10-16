/* 作品列表：筛选（分类 / 排序）+ 分页，可翻完所有作品
   接口：GET /discover/works?category=&sort=&skip=&limit=&with_total=true
         返回 {items, total, skip, limit}；分类来自 GET /discover/categories */

import { h, link } from '../dom.js';
import { pic } from '../img.js';
import { get } from '../api.js';
import { pageSize } from '../prefs.js';
import { mdText } from '../md.js';

export function render(params, query, paint) {
  var size = pageSize();
  var page = parseInt(query.page, 10);
  if (!page || page < 1) { page = 1; }
  var category = query.category || '';
  var sort = query.sort === 'hot' ? 'hot' : 'new';

  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  /* 先拿分类，再拿作品 */
  get('/discover/categories', null, function (ec, cats) {
    get('/discover/works', {
      category: category || null,
      sort: sort,
      skip: (page - 1) * size,
      limit: size,
      with_total: 'true'
    }, function (e, d) {
      if (e) { paint(h('div', { 'class': 'err', text: e.message })); return; }

      var items = d && d.items ? d.items : (d && d.length ? d : []);
      var total = d && typeof d.total === 'number' ? d.total : items.length;
      var pages = Math.max(1, Math.ceil(total / size));

      /* ---- 筛选表单（提交后改 hash，触发重新加载）---- */
      var catSel = h('select', { 'class': 'q' }, [h('option', { value: '', text: '全部分类' })]);
      var list = cats || [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var name = typeof c === 'string' ? c : (c.name || c.category || '');
        if (!name || name === '全部') { continue; }
        var op = h('option', { value: name, text: name });
        if (name === category) { op.selected = 'selected'; }
        catSel.appendChild(op);
      }
      var sortSel = h('select', { 'class': 'q' }, [
        h('option', { value: 'new', text: '最新' }),
        h('option', { value: 'hot', text: '最热' })
      ]);
      sortSel.value = sort;
      var sizeSel = h('select', { 'class': 'q' }, []);
      var sizes = [10, 20, 30, 50];
      for (var s = 0; s < sizes.length; s++) {
        var o2 = h('option', { value: String(sizes[s]), text: '每页 ' + sizes[s] + ' 条' });
        if (sizes[s] === size) { o2.selected = 'selected'; }
        sizeSel.appendChild(o2);
      }
      var go = h('input', { 'class': 'btn', type: 'submit', value: '筛选' });
      var form = h('form', { method: 'get' }, [
        h('span', { 'class': 'meta', text: '分类 ' }), catSel, h('span', { text: ' ' }),
        h('span', { 'class': 'meta', text: '排序 ' }), sortSel, h('span', { text: ' ' }),
        go
      ]);
      form.onsubmit = function () {
        location.hash = '#/works?category=' + encodeURIComponent(catSel.value) +
          '&sort=' + encodeURIComponent(sortSel.value) + '&page=1';
        return false;
      };

      /* ---- 列表 ---- */
      var ul = h('ul', { 'class': 'list' });
      for (var k = 0; k < items.length; k++) {
        var w = items[k];
        ul.appendChild(h('li', null, [
          h('span', { 'class': 't' }, link('#/work/' + w.id, w.title || '(无标题)')),
          w.category ? h('span', { 'class': 'tag', text: w.category }) : null,
          w.cover_url ? pic(w.cover_url, w.title, 120, 90) : null,
          h('div', { 'class': 'meta', text: mdText(w.description || '', 90) }),
          h('div', { 'class': 'meta', text: '浏览 ' + (w.views || 0) })
        ]));
      }

      /* ---- 分页 ---- */
      function pageUrl(p) {
        return '#/works?category=' + encodeURIComponent(category) + '&sort=' + encodeURIComponent(sort) + '&page=' + p;
      }
      var pager = h('div', { 'class': 'pager' });
      if (page > 1) { pager.appendChild(link(pageUrl(page - 1), '上一页')); }
      pager.appendChild(h('span', { 'class': 'meta', text: '第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 个作品' }));
      if (page < pages) { pager.appendChild(link(pageUrl(page + 1), '下一页')); }
      if (page < pages) { pager.appendChild(link(pageUrl(pages), '末页')); }

      paint(h('div', null, [
        h('h1', { text: '作品' }),
        h('p', { 'class': 'meta', text: category ? ('分类：' + category) : '全部分类' }),
        form,
        items.length ? ul : h('p', { 'class': 'meta', text: '这个筛选条件下没有作品' }),
        pager,
        h('p', null, link('#/', '返回首页'))
      ]));
    });
  });
}
