/* 取数层：XMLHttpRequest + JSON（IE11 可用的最小集合，不用 fetch/Promise）
   base = /api（与主站一致，同源，无需 CORS）
   登录态：如果主站已登录，localStorage 里有 nimao_token，顺手带上；
           SE 版是只读的，不带也能看公开内容 */

export var BASE = '/api';

/* 主站对外地址：SE 版回跳主站时使用。构建期由 Vite 用 VITE_SITE_ORIGIN 替换，
   IE11 最终只看到字面量。自建部署请在 frontend-se/.env 里改，不要改这里的默认占位符。 */
export var SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN || 'https://example.com';

function qs(params) {
  if (!params) { return ''; }
  var parts = [];
  for (var k in params) {
    if (params.hasOwnProperty(k) && params[k] !== null && params[k] !== undefined && params[k] !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/* cb(err, data) —— err 为 null 表示成功 */
export function get(path, params, cb) {
  var xhr = new XMLHttpRequest();
  var url = BASE + path + qs(params);
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Accept', 'application/json');
  try {
    var token = window.localStorage ? window.localStorage.getItem('nimao_token') : '';
    if (token) { xhr.setRequestHeader('Authorization', 'Bearer ' + token); }
  } catch (e) { /* 隐私模式下 localStorage 可能抛错，忽略 */ }
  xhr.timeout = 15000;

  function done() {
    if (xhr.readyState !== 4) { return; }
    if (xhr.status >= 200 && xhr.status < 300) {
      /* 先尝试按 JSON 解析 —— 不靠 Content-Type 判断：
         经过反代后类型头可能是 text/html，但内容确实是 JSON；
         反过来，被回落成 HTML 页面时解析会失败，这时才报错（避免视图拿到 null 崩掉） */
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e2) { data = null; }
      if (data === null) {
        cb({ message: '没有取到数据（可能服务未就绪或路由配置不对）' }, null);
        return;
      }
      cb(null, data);
    } else if (xhr.status === 0) {
      cb({ message: '网络不可用或请求被中断' }, null);
    } else {
      var msg = '请求失败（HTTP ' + xhr.status + '）';
      try {
        var j = JSON.parse(xhr.responseText);
        if (j && j.detail) { msg = j.detail; }
      } catch (e3) { /* 保留默认文案 */ }
      cb({ status: xhr.status, message: msg }, null);
    }
  }

  xhr.onreadystatechange = done;
  xhr.ontimeout = function () { cb({ message: '请求超时' }, null); };
  xhr.onerror = function () { cb({ message: '网络错误' }, null); };
  xhr.send(null);
}

/* 写操作：POST（登录、发评论、点赞、关注等） */
export function post(path, body, cb) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', BASE + path, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'application/json');
  var token = getToken();
  if (token) { xhr.setRequestHeader('Authorization', 'Bearer ' + token); }
  xhr.timeout = 20000;

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }
    var data = null;
    try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { data = null; }
    if (xhr.status >= 200 && xhr.status < 300) { cb(null, data); return; }
    var msg = data && data.detail ? data.detail : ('操作失败（HTTP ' + xhr.status + '）');
    if (xhr.status === 401) { msg = '请先登录'; }
    if (xhr.status === 403) { msg = '没有权限'; }
    cb({ status: xhr.status, message: msg }, null);
  };
  xhr.ontimeout = function () { cb({ message: '请求超时' }, null); };
  xhr.onerror = function () { cb({ message: '网络错误' }, null); };
  xhr.send(body ? JSON.stringify(body) : null);
}

/* 登录态：与主站共用同一个 localStorage 键，所以在任何一边登录都通用 */
var TOKEN_KEY = 'nimao_token';

export function getToken() {
  try { return window.localStorage ? (window.localStorage.getItem(TOKEN_KEY) || '') : ''; } catch (e) { return ''; }
}

export function setToken(t) {
  try { if (t) { window.localStorage.setItem(TOKEN_KEY, t); } else { window.localStorage.removeItem(TOKEN_KEY); } } catch (e) { /* 忽略 */ }
}

export function loggedIn() { return !!getToken(); }

/* 退出：先本地清掉令牌（这是真正决定登录状态的东西），再尽力通知后端；
   不把清令牌挂在请求回调里 —— 接口若不存在或超时，用户就退不出去了 */
export function logout(cb) {
  setToken('');
  post('/auth/logout', null, function () { if (cb) { cb(); } });
}

/* 当前登录用户（未登录时返回 401，调用方自行忽略） */
export function me(cb) { get('/auth/me', null, cb); }

