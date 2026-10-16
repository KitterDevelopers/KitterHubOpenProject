/* 通知中心：GET /notifications（列表）+ /notifications/unread_count + POST /notifications/read_all
   字段名做防御式兼容（不同版本可能用 title/body/content/message 等）。 */

import { h, link, clear } from '../dom.js';
import { get, post, loggedIn } from '../api.js';

function when(s) { return s ? String(s).replace('T', ' ').substring(0, 16) : ''; }

export function render(params, query, paint) {
  if (!loggedIn()) {
    paint(h('div', null, [
      h('h1', { text: '通知' }),
      h('p', { 'class': 'meta' }, [h('span', { text: '登录后才能看通知：' }), link('#/login?back=' + encodeURIComponent('/notifications'), '去登录')]),
      h('p', null, link('#/', '返回首页'))
    ]));
    return;
  }

  paint(h('p', { 'class': 'meta', text: '载入中…' }));

  get('/notifications', { limit: 50 }, function (e, d) {
    if (e) {
      paint(h('div', null, [
        h('h1', { text: '通知' }),
        h('div', { 'class': 'err', text: e.message || '取通知失败' }),
        h('p', null, link('#/', '返回首页'))
      ]));
      return;
    }
    var items = d && d.items ? d.items : (d && d.length ? d : []);
    var unread = 0;

    var ul = h('ul', { 'class': 'list' });
    for (var i = 0; i < items.length; i++) {
      var n = items[i] || {};
      var text = n.text || n.body || n.content || n.message || n.title || '';
      var read = n.is_read === true || n.read === true || n.read_at;
      if (!read) { unread++; }

      var line = h('li', null, [
        h('div', { 'class': 'meta', text: (n.type || n.kind || '通知') + ' · ' + when(n.created_at || n.createdAt) + (read ? '' : ' · 未读') }),
        h('div', { 'class': read ? 'md' : 'md unread', text: text })
      ]);
      /* 带目标的就做成链接 */
      var tid = n.target_id || n.targetId;
      var ttype = n.target_type || n.targetType;
      if (tid && (ttype === 'post' || ttype === 'work')) {
        line.appendChild(h('p', null, link('#/' + ttype + '/' + tid, '查看')));
      }
      line.style.fontWeight = read ? 'normal' : 'bold';
      ul.appendChild(line);
    }

    var box = h('div', null, [
      h('h1', { text: '通知' }),
      h('p', { 'class': 'meta', text: '共 ' + items.length + ' 条' + (unread ? ('，未读 ' + unread + ' 条') : '') }),
      items.length ? ul : h('p', { 'class': 'meta', text: '还没有通知' })
    ]);

    if (unread) {
      var btn = h('input', { 'class': 'btn', type: 'button', value: '全部标为已读' });
      var tip = h('p', { 'class': 'meta', text: '' });
      btn.onclick = function () {
        btn.disabled = true;
        post('/notifications/read_all', null, function (e2) {
          btn.disabled = false;
          if (e2) { tip.className = 'err'; tip.innerText = e2.message; return; }
          tip.className = 'ok'; tip.innerText = '已全部标为已读';
          render(params, query, paint);   /* 重新拉一次 */
        });
      };
      box.appendChild(h('p', null, btn));
      box.appendChild(tip);
    }

    box.appendChild(h('p', null, link('#/', '返回首页')));
    paint(box);
  });
}
