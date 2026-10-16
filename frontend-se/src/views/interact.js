/* 互动区：点赞 / 收藏 / 发评论 / 作品可选内嵌
   都需要登录；未登录时显示去登录的链接（不动用户已经写的内容） */

import { h, link, clear } from '../dom.js';
import { post, loggedIn, getToken, setToken, SITE_ORIGIN } from '../api.js';
import { previewMode } from '../prefs.js';

/* 作品的播放地址：
   1) 后端 play_url 已经算好（含 Scratch/TurboWarp 与各编辑器模板），优先用；
   2) 没有就自己拼 TurboWarp 内嵌（与主站 WorkPreview.jsx 的写法一致）。 */
export function playUrlOf(w) {
  if (!w) { return ''; }
  if (w.play_url) { return w.play_url; }
  if (w.work_type === 'scratch' && w.sb3_url) {
    var abs = w.sb3_url;
    if (abs.charAt(0) === '/') { abs = SITE_ORIGIN + abs; }
    return 'https://turbowarp.org/embed?project_url=' + encodeURIComponent(abs);
  }
  return w.source_url || '';
}

/* 内嵌播放器：默认直接放播放地址（不是主站详情页）
   点击后加载 / 不显示 由设置页决定 */
export function workPlayer(w) {
  var url = playUrlOf(w);
  if (!url) {
    return h('p', { 'class': 'meta', text: '这个作品暂时没有可用的播放地址，可以点下面的链接到主站看。' });
  }
  var mode = previewMode();
  /* IE（Trident）上播放器跑不起来，自动加载只会留一大块空白 —— 一律降级为"点击后加载" */
  var isIE = /Trident|MSIE/.test(navigator.userAgent || '');
  if (isIE && mode === 'embed') { mode = 'click'; }

  var frame = function () {
    return h('iframe', {
      src: url,
      width: '100%',
      height: '480',
      frameborder: '0',
      scrolling: 'auto',
      allowfullscreen: 'true'
    });
  };
  var fallback = function () {
    return h('p', { 'class': 'meta' }, [
      h('span', { text: '播放器没显示出来？' }),
      link(url, '在新窗口打开播放地址')
    ]);
  };

  if (mode === 'off') {
    return h('p', { 'class': 'meta' }, [
      h('span', { text: '已按设置隐藏播放器 —— ' }),
      link('#/settings', '去设置里打开')
    ]);
  }
  if (mode === 'click') {
    var holder = h('div');
    var btn = h('input', { 'class': 'btn', type: 'button', value: '加载播放器' });
    btn.onclick = function () { clear(holder); holder.appendChild(frame()); holder.appendChild(fallback()); };
    holder.appendChild(btn);
    if (isIE) { holder.appendChild(h('p', { 'class': 'meta', text: '（IE 上播放器可能无法运行，建议用现代浏览器或到主站查看）' })); }
    return holder;
  }
  return h('div', null, [frame(), fallback()]);
}

function loginHint(back) {
  return h('p', { 'class': 'meta' }, [
    h('span', { text: '登录后可以参与互动：' }),
    link('#/login?back=' + encodeURIComponent(back), '去登录')
  ]);
}

function tipLine() { return h('p', { 'class': 'meta', text: '' }); }

/* 帖子/作品的点赞与收藏 */
export function reactions(kind, id, initial) {
  var back = '#/' + (kind === 'post' ? 'post/' : 'work/') + id;
  var box = h('p');
  if (!loggedIn()) { box.appendChild(loginHint(back)); return box; }

  var likes = (initial && initial.like_count) || 0;
  var likeBtn = h('input', { 'class': 'btn', type: 'button', value: '点赞 ' + likes });
  var favBtn = h('input', { 'class': 'btn', type: 'button', value: '收藏' });
  var tip = tipLine();
  var path = kind === 'post' ? '/posts/' : '/works/';

  likeBtn.onclick = function () {
    likeBtn.disabled = true;
    post(path + id + '/like', null, function (e, d) {
      likeBtn.disabled = false;
      if (e) { tip.className = 'err'; tip.innerText = e.message; return; }
      var n = (d && (d.like_count !== undefined ? d.like_count : d.count)) || (likes + 1);
      likes = n;
      likeBtn.value = '点赞 ' + n;
      tip.className = 'ok'; tip.innerText = '已点赞';
    });
  };
  favBtn.onclick = function () {
    favBtn.disabled = true;
    post(path + id + '/favorite', null, function (e) {
      favBtn.disabled = false;
      if (e) { tip.className = 'err'; tip.innerText = e.message; return; }
      tip.className = 'ok'; tip.innerText = '已收藏';
    });
  };

  box.appendChild(likeBtn);
  box.appendChild(h('span', { text: ' ' }));
  box.appendChild(favBtn);
  box.appendChild(tip);
  return box;
}

/* 发评论（帖子、作品通用） */
export function commentForm(kind, id, onDone) {
  var back = '#/' + (kind === 'post' ? 'post/' : 'work/') + id;
  if (!loggedIn()) { return loginHint(back); }

  var ta = h('textarea', { 'class': 'q', rows: '4', cols: '40' });
  var btn = h('input', { 'class': 'btn', type: 'submit', value: '发表评论' });
  var tip = tipLine();
  var form = h('form', { method: 'post' }, [ta, h('p', null, btn), tip]);

  form.onsubmit = function () {
    var text = ta.value;
    if (!text || !text.replace(/\s/g, '')) { tip.className = 'err'; tip.innerText = '评论不能为空'; return false; }
    btn.disabled = true;
    var path = kind === 'post' ? '/posts/' + id + '/comments' : '/works/' + id + '/comments';
    post(path, { content: text }, function (e) {
      btn.disabled = false;
      if (e) { tip.className = 'err'; tip.innerText = e.message; return; }   /* 失败时保留输入内容 */
      ta.value = '';
      tip.className = 'ok'; tip.innerText = '已发表';
      if (onDone) { onDone(); }
    });
    return false;
  };
  return h('div', null, [h('h2', { text: '发表评论' }), form]);
}

/* 兼容旧调用：给 id 时无法拼播放地址，需要传作品对象 */
export function workEmbed(workId) {
  return workPlayer({ id: workId });
}
