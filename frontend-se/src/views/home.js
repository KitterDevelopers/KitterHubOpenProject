/* 首页：/api/discover/home → {banners, featured, featured_posts, for_you, hot, newest, codemao, topics} */

import { h, link } from '../dom.js';
import { pic, imgEnabled } from '../img.js';
import { get } from '../api.js';
import { mdText } from '../md.js';

/* 首页横幅：/api/discover/home 的 banners（title / color / image_url / target_type / target_id / target_url） */
function bannerLink(b, inner) {
  var href = '';
  if (b.target_url) { href = b.target_url; }
  else if (b.target_type === 'post' && b.target_id) { href = '#/post/' + b.target_id; }
  else if (b.target_type === 'work' && b.target_id) { href = '#/work/' + b.target_id; }
  if (!href) { return inner; }
  return h('a', { href: href }, inner);
}

function bannerBlock(b) {
  if (b.enabled === 0) { return null; }
  var style = 'display:block;padding:10px 12px;margin:8px 0;border:1px solid #ddd;border-radius:6px;';
  if (b.color) { style += 'background:' + b.color + ';'; }
  var inner = [h('span', { text: b.title || '' })];
  if (imgEnabled() && b.image_url) {
    inner.push(h('br'));
    inner.push(pic(b.image_url, b.title || '横幅', 640, 120));
  }
  return h('div', { style: style }, [bannerLink(b, inner)]);
}

function banners(items) {
  if (!items || !items.length) { return null; }
  var box = h('div');
  for (var i = 0; i < items.length; i++) {
    var node = bannerBlock(items[i]);
    if (node) { box.appendChild(node); }
  }
  return box;
}

function workItem(w) {
  return h('li', null, [
    h('span', { 'class': 't' }, link('#/work/' + w.id, w.title || '(无标题)')),
    w.category ? h('span', { 'class': 'tag', text: w.category }) : null,
    h('div', { 'class': 'meta', text: mdText(w.description || '', 80) }),
    w.cover_url ? pic(w.cover_url, w.title, 120, 90) : null
  ]);
}

function postItem(p) {
  return h('li', null, [
    h('span', { 'class': 't' }, link('#/post/' + p.id, p.title || '(无标题)')),
    p.category ? h('span', { 'class': 'tag', text: p.category }) : null,
    h('div', { 'class': 'meta', text: mdText(p.summary || p.content || '', 100) })
  ]);
}

function section(title, items, render) {
  if (!items || !items.length) { return null; }
  var ul = h('ul', { 'class': 'list' });
  for (var i = 0; i < items.length && i < 10; i++) { ul.appendChild(render(items[i])); }
  return h('div', null, [h('h2', { text: title }), ul]);
}

/* 站点公告（主站顶部那条带喇叭的提示）。两个可能的接口都试一下，取第一个有内容的。 */
function loadAnnouncement(cb) {
  get('/site/announcement', null, function (e, d) {
    /* 后端实际返回 {"announcement": "..."} */
    if (!e && d && (d.announcement || d.text || d.content || d.title)) { cb(d); return; }
    get('/public/announcement', null, function (e2, d2) {
      if (!e2 && d2 && (d2.announcement || d2.text || d2.content || d2.title)) { cb(d2); return; }
      cb(null);
    });
  });
}

function announcementBox(a) {
  if (!a) { return null; }
  var txt = a.announcement || a.text || a.content || a.title || '';
  if (!txt) { return null; }
  return h('div', { 'class': 'notice' }, [h('span', { text: '公告：' }), h('span', { text: txt })]);
}


export function render(params, query, paint) {
  paint(h('p', { 'class': 'meta', text: '载入中…' }));
  loadAnnouncement(function (ann) {
  get('/discover/home', null, function (e, d) {
    if (e) { paint(h('div', { 'class': 'err', text: e.message })); return; }
    paint(h('div', null, [
      h('h1', { text: 'KitterHubSE' }),
      h('p', { 'class': 'meta', text: '轻量版：作品、帖子、评论、搜索都能用；创作中心请用主站。' }),
      announcementBox(ann),
      section('精选作品', d.featured, workItem),
      section('热门帖子', d.featured_posts, postItem),
      section('最新作品', d.newest, workItem),
      section('热门作品', d.hot, workItem),
      section('为你推荐', d.for_you, workItem)
    ]));
  });
  });
}
