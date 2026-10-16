/* pickCat 社区接口（浏览器直连本站反代）——「同步发帖」专用。
 *
 * 设计要点（与站长 2026-10-11 的硬性约束一致）：
 *   1. **凭据绝不落库**：pickcat_session 由用户浏览器持有（登录请求经本模块发到本站 nginx 的
 *      `/pickcat-api/` 反代，反代把 Set-Cookie 的 Domain 改写成我们自己的域名，浏览器存下）。
 *      KitterHub 服务器只做一次不知道内容的转发，不保存会话、不保存账号。
 *   2. 本模块**只读三条 + 写两条**：GET /session、GET /tags、POST /session（登录）、
 *      POST /posts（同步）、POST /files（正文图片，仅同步时）。不做任何其它写操作。
 *   3. 同步失败**绝不影响** KitterHub 的帖子：调用方（PostCreate/PostDetail）在
 *      KitterHub 发帖成功之后才调用这里，失败只写本地 pending 记录，可重试。
 *   4. 重试**复用同一个 Idempotency-Key**（见 sync.js 的 pending 记录）。
 *
 * 反代地址 `/pickcat-api/v1/**` 一一对应 `https://cdsq.dao3.fun/api/v1/**`。
 */
import axios from 'axios';

export const PICKCAT_API = '/pickcat-api/v1';
export const PICKCAT_SITE = 'https://cdsq.dao3.fun';

/* pickCat **帖子详情页**的地址：`/forum/post/<id>`。
 *
 * 路由本身（2026-10-11 抓官方前端产物核对）：
 *   `{name:"forum-post-postId", path:"/forum/post/:postId()"}` —— 路径名叫 postId。
 * 但**这个 id 实际要传主题 id（topic id），不是首楼帖子的 id**。两条独立证据：
 *   1. 官方发帖成功后的回跳就是拿响应里的 `topicId` 拼的：
 *      `lt = computed(() => outcome.type==='published' ? \`/forum/post/${outcome.topicId}\` : null)`
 *      （官方前端产物 Cywo9jfj2.js，我们已核对）
 *   2. 站长实例实测（只读 GET）：
 *      `GET /api/v1/topics/01a12ab0-43ca-719b-9e6a-5e776bcd6c4b` -> 200，title「测试-04」，
 *        且它的 `firstPost.id` = `01a12ab0-43ce-7340-bf41-af7e0d75d4fa`
 *      `GET /api/v1/topics/01a12ab0-43ce-7340-bf41-af7e0d75d4fa` -> 404 TOPIC_NOT_FOUND
 *   也就是说：我们之前**把 firstPost.id 当成 topic id 去拼链接**，所以点过去是错的。
 *   参数名仍叫 postId（保持调用点习惯），值必须是 topic id。
 */
export const PICKCAT_POST_URL = (topicId) => `${PICKCAT_SITE}/forum/post/${topicId}`;

/** 老名字（记录字段 & 旧代码里的叫法）。 */
export const PICKCAT_TOPIC_URL = PICKCAT_POST_URL;

/* 本地开发服务器（vite，5173 端口）默认没有配 `/pickcat-api/` 反代，
 * 强行探测只会得到一串假的网络失败。这里只做**提示**，不再阻止提交：
 * 面板会显示「本地开发环境下不可用」，其它功能照常。 */
export function isDevServer() {
  if (typeof window === 'undefined') return false;
  return String(window.location.port) === '5173';
}

const http = axios.create({
  baseURL: PICKCAT_API,
  timeout: 30000,
  // 同源请求浏览器本来就会带 cookie；显式打开是为了兼容反代/跨域场景，
  // 服务端 CORS 已开 access-control-allow-credentials，但不会回显任意 Origin，不会额外放宽。
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

/** 归一化错误：把 axios 错误变成 {status, code, message, fieldErrors, network} 形状。 */
export function pcError(e) {
  const res = e && e.response;
  const data = (res && res.data) || {};
  if (!res) {
    return { network: true, status: 0, code: 'NETWORK', message: '' };
  }
  const details = data.details && typeof data.details === 'object' ? data.details : {};
  const fieldErrors = Array.isArray(details.fieldErrors) ? details.fieldErrors : null;
  return {
    network: false,
    status: res.status,
    code: typeof data.code === 'string' ? data.code : '',
    message: typeof data.message === 'string' ? data.message : '',
    fieldErrors,
    permissionKey: typeof details.permissionKey === 'string' ? details.permissionKey : '',
  };
}

/** 会话是否失效（401）。会话有效期 7 天，过期后所有写操作都会得到 401。 */
export function isAuthError(err) {
  const e = err && err.status !== undefined ? err : pcError(err);
  if (e.network) return false;
  return e.status === 401 || e.code === 'AUTHENTICATION_REQUIRED' || e.code === 'UNAUTHENTICATED';
}

/** 读取当前 pickCat 会话（不发任何写请求）。成功返回 {user, expiresAt}。 */
export async function getSession() {
  const r = await http.get('/session');
  return r.data || {};
}

/**
 * 在本站域名下登录 pickCat，让浏览器拿到 pickcat_session。
 * 密码只在这一个请求体里出现，KitterHub 后端不接触（纯静态前端 + nginx 转发）。
 */
export async function login(username, password) {
  const r = await http.post('/session', { username, password }, {
    headers: { 'Content-Type': 'application/json' },
  });
  return r.data || {};
}

/** 退出 pickCat 会话（清掉浏览器里的 cookie）。 */
export async function logout() {
  try {
    await http.delete('/session');
  } catch (e) {
    /* 清不掉也不影响本地状态 */
  }
}

/** pickCat 可用标签（公开接口，无需登录）。返回 [{id, slug, name, description}]。 */
export async function listTags() {
  const r = await http.get('/tags');
  return (r.data && r.data.items) || [];
}

/**
 * 读主题详情（**公开**接口）。用来把「首楼帖子 id」反查回「主题 id」——
 * 详情页地址要的是主题 id（见 PICKCAT_POST_URL 注释）。
 * 返回 {id, title, firstPost:{id}, ...}；404 表示这个 id 不是主题（多半是帖子 id）。
 */
export async function getTopic(id) {
  const r = await http.get(`/topics/${id}`);
  return r.data || {};
}

/**
 * 某个用户发布的主题（**公开**接口）。用来修「老记录里存的是首楼帖子 id」的历史数据：
 * pickCat 没有「按帖子 id 反查主题」的接口，但账号自己的主题列表里有 id + title，
 * 可以按**标题精确匹配**把主题 id 找回来（匹配不上就宁可不给链接，见 sync.js）。
 */
export async function listUserTopics(userId, limit = 50) {
  const r = await http.get(`/users/${userId}/topics`, { params: { limit } });
  return (r.data && r.data.items) || [];
}

/**
 * 上传一张图片到 pickCat（**只收 WebP**，最大 10MB，必须带 Idempotency-Key）。
 * 返回 {id, raw}。fileId 之后由调用方拼成 https://cdsq.dao3.fun/api/v1/files/<id> 写进正文。
 */
export async function uploadFile(blob, idempotencyKey) {
  const fd = new FormData();
  fd.append('file', blob, 'image.webp');
  fd.append('ownership', 'PERSONAL');
  const r = await http.post('/files', fd, {
    headers: { 'Idempotency-Key': idempotencyKey },
    timeout: 60000,
  });
  const id = r.data && (r.data.id || r.data.fileId);
  if (!id) throw new Error('pickCat 未返回文件 id');
  return { id: String(id), raw: r.data };
}

/* --------------------------------------------------------------- 图片转码
 * pickCat 的 `POST /files` **只接受 WebP**（服务端校验 RIFF/WEBP 文件头，其它一律
 * `422 FILE_IMAGE_INVALID / details.reason = "NOT_WEBP"`），而 KitterHub 上图允许
 * PNG / JPEG / GIF / WebP。正文里的图必须先转成 WebP 才可能同步成功。
 * 这里用 canvas 转码：不出网、不需要后端（凭据与内容都不经过第三方接口）。
 * 用 objectURL 而不是原图地址，避免 canvas 被跨域图片污染（tainted）。
 */
const WEBP_RE = /^image\/webp/i;

function isWebpBytes(bytes) {
  return !!bytes && bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

async function canvasToWebpBlob(source, maxSide) {
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('decode failed'));
      im.src = url;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('empty image');
    // 只缩小不放大；长边阈值与 pickcat 正文展示尺寸对齐，避免无谓地浪费对方存储
    const cap = maxSide || 2560;
    const scale = Math.min(1, cap / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas 2d');
    // WebP 的 alpha 支持良好；JPEG 原图先铺白底，避免透明黑边
    if (!/png|webp|gif/i.test(source.type || '')) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob((b) => resolve(b), 'image/webp', 0.9);
      else resolve(null);
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 把任意本站图片 blob 变成 pickCat 能收的 WebP blob。
 * @returns {Promise<{ok:true, blob:Blob, converted:boolean} | {ok:false, reason:string}>}
 *   reason: 'gif'（动图，转码会丢帧，宁可不发）| 'decode' | 'not_webp'（浏览器不支持 WebP 编码）
 */
export async function toWebpBlob(blob) {
  const type = (blob && blob.type) || '';
  if (WEBP_RE.test(type)) {
    // 已经是 WebP：内容必须真是 WebP（对方校验文件头），否则当解码失败处理
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (isWebpBytes(bytes)) return { ok: true, blob, converted: false };
      return { ok: false, reason: 'not_webp' };
    } catch (e) {
      return { ok: false, reason: 'decode' };
    }
  }
  if (/gif/i.test(type)) return { ok: false, reason: 'gif' };
  try {
    const out = await canvasToWebpBlob(blob);
    if (!out || !out.size) return { ok: false, reason: 'not_webp' };
    const bytes = new Uint8Array(await out.slice(0, 16).arrayBuffer());
    if (!isWebpBytes(bytes)) return { ok: false, reason: 'not_webp' };
    // 转码后明显变大（少见）时也照发，但不超过对方 10MB 上限由调用方兜底
    return { ok: true, blob: out, converted: true };
  } catch (e) {
    return { ok: false, reason: 'decode' };
  }
}

/**
 * 发主题。必须带 Idempotency-Key（1–128 可打印 ASCII）。
 * 请求体形状与 pickCat 官方前端一致：{title, markdown, tagIds, kind}
 * （来自其前端产物 7gXPm9Sn2.js / Cywo9jfj2.js：tagIds 传的是标签 **id**，不是 slug）。
 */
export async function createTopic(body, idempotencyKey) {
  const r = await http.post('/posts', body, {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    timeout: 60000,
  });
  return r.data || {};
}

/** 把 pickCat 的 fieldErrors 变成一行可读文字（英文界面下也用同一套，避免中英混杂）。 */
export function fieldErrorText(err) {
  const e = err && err.fieldErrors !== undefined ? err : pcError(err);
  if (!e.fieldErrors || !e.fieldErrors.length) return '';
  const label = {
    title: 'title',
    markdown: 'body',
    tagIds: 'tags',
    kind: 'kind',
    topicId: 'topic',
  };
  const rule = (f) => {
    const name = label[f.field] || f.field || 'field';
    if (f.rule === 'REQUIRED') return `${name}: required`;
    if (f.rule === 'INVALID_VALUE') return `${name}: invalid value`;
    if (f.rule === 'UNEXPECTED_FIELD') return `${name}: not allowed here`;
    if (f.rule === 'TOO_LONG') return `${name}: too long`;
    if (f.rule === 'TOO_SHORT') return `${name}: too short`;
    if (f.rule === 'TOO_MANY') return `${name}: too many`;
    if (f.rule === 'TOO_FEW') return `${name}: too few`;
    if (f.rule === 'DUPLICATE') return `${name}: duplicate`;
    return `${name}: ${f.rule || 'invalid'}`;
  };
  return e.fieldErrors.map(rule).join('; ');
}

/* 图片同步时逐张的告警码 -> 词条键（面板/提示条共用）。 */
export const IMAGE_WARN_KEY = {
  too_large: 'pc.warnTooLarge',
  gif: 'pc.warnGif',
  not_webp: 'pc.warnNotWebp',
  decode: 'pc.warnDecode',
  network: 'pc.warnNetwork',
  upload_failed: 'pc.warnUpload',
};

/**
 * 把一次同步尝试的结果/错误变成**一句可读的原因**（中英都走词条）。
 * PostCreate（发布后提示）与 PickCatSyncNote（详情页提示条）共用，避免两处文案漂移。
 */
export function syncErrorText(err, t) {
  const e = err || {};
  if (e.network) return t('pc.reasonNetwork');
  if (e.status === 401) return t('pc.reasonAuth');
  if (e.status === 403 && e.permissionKey) return t('pc.reasonPerm', { key: e.permissionKey });
  if (e.status === 403) return t('pc.reasonDenied');
  if (e.status === 400) return t('pc.reasonField', { fields: fieldErrorText(e) || t('pc.reasonUnknown') });
  if (e.status === 409) return t('pc.reasonConflict');
  if (e.status === 413) return t('pc.reasonTooLarge');
  if (e.status === 422) return t('pc.reasonImage');
  if (e.status >= 500) return t('pc.reasonServer');
  return t('pc.reasonUnknown');
}

/** 失败原因里附带的图片告警（有就追加一行，没有返回空串）。 */
export function imageWarnText(warnings, t) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  const seen = new Set();
  const parts = [];
  for (const w of warnings) {
    const key = IMAGE_WARN_KEY[w && w.code] || 'pc.warnUpload';
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(t(key));
  }
  return t('pc.warnImages', { reasons: parts.join('；') });
}

export default {
  PICKCAT_API,
  PICKCAT_SITE,
  PICKCAT_POST_URL,
  PICKCAT_TOPIC_URL,
  isDevServer,
  pcError,
  isAuthError,
  getSession,
  login,
  logout,
  listTags,
  getTopic,
  listUserTopics,
  uploadFile,
  toWebpBlob,
  createTopic,
  fieldErrorText,
  syncErrorText,
  imageWarnText,
  IMAGE_WARN_KEY,
};
