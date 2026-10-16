/* 应用骨架：路由表 + 渲染 + 图片开关 + 登录状态 + 错误兜底（纯 ES5，IE11 可执行） */

import { h, clear, link } from './dom.js';
import { imgEnabled, setImg } from './img.js';
import { add as rAdd, go as rGo, current as rCurrent, resolve as rResolve, start as rStart } from './router.js';
import { loggedIn, me, logout } from './api.js';

/* 必须具名导入：import * as 会让 Rollup 生成 const + 对象展开（IE11 跑不了） */
import { render as renderHome } from './views/home.js';
import { render as renderForum } from './views/forum.js';
import { render as renderWorks } from './views/works.js';
import { render as renderPost } from './views/post.js';
import { render as renderWork } from './views/work.js';
import { render as renderUser } from './views/user.js';
import { render as renderSearch } from './views/search.js';
import { render as renderLogin } from './views/login.js';
import { render as renderSettings } from './views/settings.js';
import { render as renderNotifications } from './views/notifications.js';

var VIEWS = {
  home: renderHome,
  forum: renderForum,
  works: renderWorks,
  post: renderPost,
  work: renderWork,
  user: renderUser,
  search: renderSearch,
  login: renderLogin,
  settings: renderSettings,
  notifications: renderNotifications
};

var root = null;

function setImageMode(on) {
  setImg(on);
  /* 注意：不能用 current().path 回跳 —— 此刻当前路径就是 /img/x，会无限递归 */
  rGo('/');
  render();
}

function paint(node) {
  clear(root);
  root.appendChild(node);
}

export function err(message) {
  return h('div', { 'class': 'err', text: message || '出错了' });
}

export function empty(tip) {
  return h('p', { 'class': 'meta', text: tip || '没有内容' });
}

export function render() {
  var hit = rResolve();
  if (!hit) { paint(err('页面不存在：' + rCurrent().path)); return; }

  /* 图片开关：#/img/1 或 #/img/0 */
  if (hit.handler === 'img') { setImageMode(hit.params.mode === '1'); return; }

  /* 退出登录：令牌已在 logout() 里立刻清掉，这里不等网络 */
  if (hit.handler === 'logout') { logout(); location.reload(); return; }

  var view = VIEWS[hit.handler];
  if (!view) { paint(err('页面不存在。')); return; }
  view(hit.params, hit.query, paint);
}

export function boot() {
  root = document.getElementById('app');
  if (!root) { return; }

  /* 顶部登录状态 */
  var auth = document.getElementById('auth');
  if (auth) {
    if (loggedIn()) {
      me(function (e, u) {
        var name = (!e && u) ? (u.display_name || u.nickname || u.username || '我') : '我';
        auth.appendChild(h('span', { 'class': 'meta', text: '｜' }));
        auth.appendChild(h('a', { href: '#/user/' + ((!e && u && u.uid) || ''), text: name }));
        auth.appendChild(h('span', { text: ' ' }));
        auth.appendChild(h('a', { href: '#/logout', text: '退出' }));
      });
    } else {
      auth.appendChild(h('span', { 'class': 'meta', text: '｜' }));
      auth.appendChild(h('a', { href: '#/login', text: '登录' }));
    }
  }

  /* 图片开关高亮当前状态 */
  var onEl = document.getElementById('img_on');
  var offEl = document.getElementById('img_off');
  var on = imgEnabled();
  if (onEl) { onEl.style.fontWeight = on ? 'bold' : 'normal'; }
  if (offEl) { offEl.style.fontWeight = on ? 'normal' : 'bold'; }

  rAdd('/', 'home');
  rAdd('/forum', 'forum');
  rAdd('/works', 'works');
  rAdd('/post/:id', 'post');
  rAdd('/work/:id', 'work');
  rAdd('/user/:uid', 'user');
  rAdd('/search', 'search');
  rAdd('/login', 'login');
  rAdd('/settings', 'settings');
  rAdd('/notifications', 'notifications');
  rAdd('/logout', 'logout');
  rAdd('/img/:mode', 'img');

  rStart(function () {
    try { render(); } catch (e) { paint(err('页面渲染出错：' + (e && e.message ? e.message : e))); }
  });
}

/* 脚本在 body 末尾，DOM 已就绪，直接启动 */
boot();
