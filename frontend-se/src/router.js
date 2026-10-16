/* hash 路由（IE 下最稳，不需要 history API，也不需要 nginx 重写规则）
   用法：add('/post/:id', fn)；start()；go('/forum?page=2') */

var routes = [];

export function add(pattern, handler) {
  routes.push({ parts: pattern.replace(/^\//, '').split('/'), handler: handler });
}

export function go(path) {
  location.hash = '#' + (path.charAt(0) === '/' ? path : '/' + path);
}

/* 返回 { path, query } */
export function current() {
  var raw = location.hash ? location.hash.replace(/^#/, '') : '/';
  if (raw === '') { raw = '/'; }
  var qi = raw.indexOf('?');
  var path = qi > -1 ? raw.substring(0, qi) : raw;
  var query = {};
  if (qi > -1) {
    var pairs = raw.substring(qi + 1).split('&');
    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf('=');
      if (eq > -1) { query[decodeURIComponent(pairs[i].substring(0, eq))] = decodeURIComponent(pairs[i].substring(eq + 1)); }
    }
  }
  return { path: path, query: query };
}

function match(patternParts, pathParts) {
  if (patternParts.length !== pathParts.length) { return null; }
  var params = {};
  for (var i = 0; i < patternParts.length; i++) {
    if (patternParts[i].charAt(0) === ':') {
      params[patternParts[i].substring(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function resolve() {
  var cur = current();
  var pathParts = cur.path.replace(/^\/+|\/+$/g, '').split('/');
  if (pathParts.length === 1 && pathParts[0] === '') { pathParts = []; }
  for (var i = 0; i < routes.length; i++) {
    var params = match(routes[i].parts[0] === '' ? [] : routes[i].parts, pathParts);
    if (params) { return { handler: routes[i].handler, params: params, query: cur.query }; }
  }
  return null;
}

export function start(onChange) {
  window.onhashchange = onChange;
  onChange();
}
