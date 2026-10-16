/* 登录：与主站共用同一个 token（localStorage.nimao_token），登录后整站通用 */

import { h, link } from '../dom.js';
import { post, setToken, me } from '../api.js';

export function render(params, query, paint) {
  var account = h('input', { 'class': 'q', type: 'text', name: 'account', value: '', autocomplete: 'off' });
  var pwd = h('input', { 'class': 'q', type: 'password', name: 'password', value: '' });
  var tip = h('p', { 'class': 'meta', text: '' });
  var btn = h('input', { 'class': 'btn', type: 'submit', value: '登录' });

  function submit() {
    if (!account.value || !pwd.value) { tip.className = 'err'; tip.innerText = '请填写账号和密码'; return false; }
    btn.disabled = true;
    tip.className = 'meta'; tip.innerText = '正在登录…';
    post('/auth/login', { account: account.value, password: pwd.value, lang: 'zh' }, function (e, d) {
      btn.disabled = false;
      if (e) { tip.className = 'err'; tip.innerText = e.message || '登录失败'; return; }
      var token = d && (d.token || d.access_token);
      if (!token) { tip.className = 'err'; tip.innerText = '登录返回里没有令牌，请联系管理员'; return; }
      setToken(token);
      var back = query.back ? decodeURIComponent(query.back) : '/';
      location.hash = '#' + back;
      /* 顶部登录状态是页面加载时渲染的，登录后必须整页重载一次才会变成"昵称 + 退出" */
      location.reload();
    });
    return false;
  }

  var form = h('form', { method: 'post' }, [
    h('table', { 'class': 'kv' }, [
      h('tr', null, [h('td', { 'class': 'k', text: '账号' }), h('td', null, account)]),
      h('tr', null, [h('td', { 'class': 'k', text: '密码' }), h('td', null, pwd)])
    ]),
    h('p', null, [btn, h('span', { 'class': 'meta', text: '  本站与主站是不同域名，登录状态各自独立' })]),
    tip
  ]);
  form.onsubmit = submit;

  /* 编程猫登录：POST /auth/login-codemao { identity, password }（后端 auth.py:442） */
  var cmId = h('input', { 'class': 'q', type: 'text', name: 'cm_identity', value: '', autocomplete: 'off' });
  var cmPwd = h('input', { 'class': 'q', type: 'password', name: 'cm_password', value: '' });
  var cmTip = h('p', { 'class': 'meta', text: '' });
  var cmBtn = h('input', { 'class': 'btn', type: 'submit', value: '编程猫登录' });
  var cmForm = h('form', { method: 'post' }, [
    h('table', { 'class': 'kv' }, [
      h('tr', null, [h('td', { 'class': 'k', text: '编程猫账号' }), h('td', null, cmId)]),
      h('tr', null, [h('td', { 'class': 'k', text: '密码' }), h('td', null, cmPwd)])
    ]),
    h('p', null, cmBtn),
    cmTip
  ]);
  cmForm.onsubmit = function () {
    if (!cmId.value || !cmPwd.value) { cmTip.className = 'err'; cmTip.innerText = '请填写编程猫账号和密码'; return false; }
    cmBtn.disabled = true;
    cmTip.className = 'meta'; cmTip.innerText = '正在向编程猫验证…';
    post('/auth/login-codemao', { identity: cmId.value, password: cmPwd.value, lang: 'zh' }, function (e, d) {
      cmBtn.disabled = false;
      if (e) { cmTip.className = 'err'; cmTip.innerText = e.message || '编程猫登录失败'; return; }
      var tk = d && (d.token || d.access_token);
      if (!tk) { cmTip.className = 'err'; cmTip.innerText = '登录返回里没有令牌，请联系管理员'; return; }
      setToken(tk);
      var back = query.back ? decodeURIComponent(query.back) : '/';
      location.hash = '#' + back;
      /* 顶部登录状态是页面加载时渲染的，登录后必须整页重载一次才会变成"昵称 + 退出" */
      location.reload();
    });
    return false;
  };

  paint(h('div', null, [
    h('h1', { text: '登录' }),
    form,
    h('h2', { text: '用编程猫账号登录' }),
    h('p', { 'class': 'meta', text: '填写编程猫账号（用户名 / 手机号）与密码，首次登录会按编程猫资料自动注册。' }),
    cmForm,
    h('p', null, link('#/', '返回首页'))
  ]));
}
