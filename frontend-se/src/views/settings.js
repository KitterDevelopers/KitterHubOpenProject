/* 设置：把常用功能集中在这里（SE 版不搞创作中心，这里只有阅读相关的开关） */

import { h, link } from '../dom.js';
import { imgEnabled, setImg } from '../img.js';
import { previewMode, setPreviewMode, pageSize, setPageSize } from '../prefs.js';
import { loggedIn, setToken } from '../api.js';

function radio(name, value, current, label, onPick) {
  var input = h('input', { type: 'radio', name: name, value: value });
  if (value === current) { input.checked = 'checked'; }
  input.onclick = function () { onPick(value); location.reload(); };
  return h('label', { 'class': 'opt' }, [input, h('span', { text: ' ' + label })]);
}

export function render(params, query, paint) {
  var on = imgEnabled();
  var mode = previewMode();
  var size = pageSize();

  var imgRow = h('p', null, [
    h('input', { 'class': 'btn', type: 'button', value: on ? '当前：显示图片（点此关闭）' : '当前：不显示图片（点此打开）' , onclick: '' }),
  ]);
  var imgBtn = imgRow.firstChild;
  imgBtn.onclick = function () { setImg(!imgEnabled()); location.reload(); };

  paint(h('div', null, [
    h('h1', { text: '设置' }),
    h('p', { 'class': 'meta', text: '只影响本机浏览器，换设备需要重设。' }),

    h('h2', { text: '图片' }),
    imgRow,

    h('h2', { text: '作品播放器' }),
    h('p', null, [
      radio('preview', 'embed', mode, '直接内嵌播放（默认）', setPreviewMode),
      h('br'),
      radio('preview', 'click', mode, '点击后再加载（省流量，IE 上自动用这个）', setPreviewMode),
      h('br'),
      radio('preview', 'off', mode, '不显示播放器', setPreviewMode)
    ]),

    h('h2', { text: '论坛每页条数' }),
    h('p', null, [
      radio('size', '10', String(size), '10 条', function (v) { setPageSize(v); }),
      h('br'),
      radio('size', '20', String(size), '20 条', function (v) { setPageSize(v); }),
      h('br'),
      radio('size', '30', String(size), '30 条', function (v) { setPageSize(v); })
    ]),

    h('h2', { text: '登录状态' }),
    loggedIn()
      ? h('p', null, [h('input', { 'class': 'btn', type: 'button', value: '退出登录', onclick: '' })])
      : h('p', { 'class': 'meta' }, [h('span', { text: '未登录 —— ' }), link('#/login', '去登录')]),

    h('p', null, link('#/', '返回首页'))
  ]));

  /* 退出按钮（上面那行建好后再挂事件，保持代码简单） */
  var btns = document.querySelectorAll('input[type=button]');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].value === '退出登录') {
      btns[i].onclick = function () { setToken(''); location.reload(); };
    }
  }
}
