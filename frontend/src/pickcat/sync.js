/* 「同步发帖」的本地状态机（浏览器侧）。
 *
 * 铁律：**KitterHub 的帖子永远先成功、永远不回滚**。
 *   本模块只在 KitterHub 发帖返回 2xx 之后被调用；任何 pickCat 侧的失败
 *   只写一条本地 pending 记录，帖子照常存在，用户可以随时重试。
 *
 * 幂等：每个帖子的「同步意图」在第一次尝试时就生成一个 Idempotency-Key 并**存下来**，
 *   之后所有重试都复用同一个 key —— pickCat 侧重复提交同一 key + 同一请求体时返回首次结果。
 *   图片上传同理：每个图片 URL 对应一个固定的 key，重试不会重复上传（已成功过的直接复用 fileId）。
 *   ⚠️ 前提是**请求体一致**：所以正文里的图片 URL 必须原样重传（不要传已被改写过的 markdown），
 *   单张图第一次失败、重试时才成功，会让 /posts 的请求体变化 → 对方回 409 IDEMPOTENCY_KEY_REUSED，
 *   这时界面会明确提示「同名幂等键内容不同」，让人刷新状态后判断，而不是静默重发。
 *
 * 会话：pickcat_session 只存在用户浏览器里（经 /pickcat-api/ 反代登录）。本地记录里
 *   **不含任何凭据**，只有帖子标题/正文/标签与幂等键。
 */
import {
  createTopic,
  getSession,
  getTopic,
  isAuthError,
  listUserTopics,
  pcError,
  PICKCAT_POST_URL,
  toWebpBlob,
  uploadFile,
} from './api';

const REC_KEY = (ownPostId) => `kh:pickcat-sync:${ownPostId}`;
const HAD_SESSION_KEY = 'kh:pickcat-had-session';

/* 记录里与 pickCat 身份有关的字段（命名容易搞混，写清楚）：
 *   topicId     —— **主题 id**。详情页地址 `/forum/post/<topicId>` 要的就是它。
 *   firstPostId —— 该主题**首楼帖子的 id**（`POST /posts` 时是响应里的 postId；
 *                  从 `GET /topics/<topicId>` 回来时是 firstPost.id）。
 * 旧记录（2026-10-11 之前）把 firstPostId 错存进了 topicId，所以一律按下面的
 * topicIdOf() 取：topicId 与 firstPostId 不同才认，相同就说明是老记录，需要反查。 */

/** 该记录里可用的**主题 id**（拿不准返回 null，交给 repairTopicId 反查）。 */
export function topicIdOf(rec) {
  if (!rec) return null;
  const t = rec.topicId || null;
  if (!t) return null;
  if (rec.firstPostId && rec.firstPostId === t) return null; // 老记录：这里存的是帖子 id
  return t;
}

/** 帖子详情页地址。**只按 id 现拼**，不把链接写死进 localStorage。
 *  拿不到主题 id 时返回 null（界面会走反查/降级，而不是给一个坏链）。 */
export function postUrlOf(rec) {
  const t = topicIdOf(rec);
  return t ? PICKCAT_POST_URL(t) : null;
}

/**
 * 反查并**就地修正**老记录里的主题 id。老记录（2026-10-11 之前）把「首楼帖子 id」当成了
 * 主题 id，所以链接点过去会 404。修法（全部只读、不怕猜错，因为每一步都自我校验）：
 *   ① 先试记录里的 id 本身是不是主题（`GET /topics/<id>`）—— 是就写回并结束；
 *   ② 不是的话，用**当前登录的 pickCat 账号**的主题列表（公开接口）按**标题精确匹配**
 *      找回主题 id（pickCat 没有「按帖子 id 反查主题」的接口，这是唯一可靠的路径）；
 *   ③ 都失败就标一个 _repairTried，界面改为提示「链接待修正」而不是给一条坏链。
 * 失败绝不抛错，也不影响页面其它内容。
 */
export async function repairTopicId(rec) {
  if (!rec || rec.status !== 'done') return rec;
  if (topicIdOf(rec)) return rec;
  const cand = rec.topicId || rec.firstPostId;
  if (!cand || rec._repairTried === cand) return rec;
  const stamp = (patch) => {
    const fixed = { ...rec, _repairTried: cand, updatedAt: new Date().toISOString(), ...patch };
    writeSync(fixed);
    return fixed;
  };
  try {
    // ① 这个 id 本身就是主题？
    const topic = await getTopic(cand);
    if (topic && topic.id) {
      return stamp({ topicId: String(topic.id), firstPostId: (topic.firstPost && topic.firstPost.id) || rec.firstPostId || null });
    }
  } catch (e) {
    /* 404/401/网络 -> 继续走 ② */
  }
  try {
    // ② 用当前账号的主题列表按标题精确匹配
    const s = await getSession();
    const uid = s && s.user && s.user.id;
    const title = rec.title;
    if (uid && title) {
      const items = await listUserTopics(uid, 50);
      const hit = items.find((it) => it && it.title === title);
      if (hit && hit.id) {
        return stamp({ topicId: String(hit.id), firstPostId: rec.firstPostId || null, _repairBy: 'title' });
      }
    }
    return stamp({ _repairError: 'not_found' });
  } catch (e) {
    const err = pcError(e);
    writeSync({ ...rec, _repairTried: cand, _repairError: err.status || (err.network ? 'network' : 'unknown') });
    return rec; // 返回同一引用，避免调用方 effect 反复触发
  }
}

/** 生成 1–128 位可打印 ASCII 的幂等键（UUID v4 一定满足）。 */
export function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {
    /* 老浏览器回退 */
  }
  const rnd = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${rnd()}-${rnd()}-${rnd()}-${rnd()}`;
}

/** 是否曾经在本浏览器登录成功过 pickCat（用来区分「没绑过」与「会话过期」）。 */
export function hadSession() {
  try {
    return localStorage.getItem(HAD_SESSION_KEY) === '1';
  } catch (e) {
    return false;
  }
}

export function markHadSession() {
  try {
    localStorage.setItem(HAD_SESSION_KEY, '1');
  } catch (e) {
    /* 隐私模式下无所谓 */
  }
}

export function clearHadSession() {
  try {
    localStorage.removeItem(HAD_SESSION_KEY);
  } catch (e) {
    /* ignore */
  }
}

export function readSync(ownPostId) {
  try {
    const raw = localStorage.getItem(REC_KEY(ownPostId));
    if (!raw) return null;
    const r = JSON.parse(raw);
    return r && typeof r === 'object' ? r : null;
  } catch (e) {
    return null;
  }
}

export function writeSync(rec) {
  try {
    localStorage.setItem(REC_KEY(rec.ownPostId), JSON.stringify(rec));
  } catch (e) {
    /* 存不下也不影响本次结果展示 */
  }
}

export function listSyncs() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('kh:pickcat-sync:')) continue;
      const r = readSync(k.slice('kh:pickcat-sync:'.length));
      if (r) out.push(r);
    }
  } catch (e) {
    /* ignore */
  }
  return out;
}

/** 会话探针：'bound' | 'unbound' | 'expired' | 'offline' | 'dev' */
export async function sessionState() {
  try {
    const s = await getSession();
    markHadSession();
    return { state: 'bound', user: (s && s.user) || null, expiresAt: s && s.expiresAt };
  } catch (e) {
    const err = pcError(e);
    if (err.network) return { state: 'offline' };
    if (isAuthError(err)) {
      // 401：以前登录过 -> 7 天会话过期；从没登录过 -> 还没绑定
      return { state: hadSession() ? 'expired' : 'unbound' };
    }
    return { state: 'offline' };
  }
}

/* ------------------------------------------------------------------ 正文里的图片 */

/** 找出正文里所有指向本站上传目录的图片地址（只同步我们能读到的自家图片）。 */
export function localImageUrls(markdown) {
  const out = [];
  const seen = new Set();
  const re = /!\[[^\]]*\]\(\s*(\/uploads\/[^\s)]+)\s*\)/g;
  let m = re.exec(markdown || '');
  while (m) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
    m = re.exec(markdown || '');
  }
  // 也可能是 HTML <img src="/uploads/...">
  const re2 = /<img[^>]+src=["'](\/uploads\/[^"']+)["']/gi;
  let m2 = re2.exec(markdown || '');
  while (m2) {
    if (!seen.has(m2[1])) {
      seen.add(m2[1]);
      out.push(m2[1]);
    }
    m2 = re2.exec(markdown || '');
  }
  return out;
}

/** 本站图片地址 -> pickCat 文件访问地址。 */
export const pickcatFileUrl = (fileId) => `https://cdsq.dao3.fun/api/v1/files/${fileId}`;

function replaceAll(text, from, to) {
  return String(text).split(from).join(to);
}

/**
 * 把正文里的本站图片上传到 pickCat，并把地址换成 pickCat 的文件地址。
 * 已成功的（fileMap 里有记录）不重复上传，也不会生成新记录 —— 重试安全。
 * 单张图失败只记 warning，不阻断整篇同步（这一张继续用本站地址）。
 *
 * 注意：pickCat 的 `POST /files` **只收 WebP**，而本站允许 PNG/JPEG/GIF，
 * 所以非 WebP 的图先用 canvas 转码（见 api.js 的 toWebpBlob）；GIF 动图转码会丢帧，
 * 直接跳过并记 warning，而不是悄悄发一张变形的图。
 *
 * @param {object} [onProgress] 每张图上传成功后回调 {fileMap, fileKeys}，
 *   让调用方**立刻落盘**：图片的成功结果与幂等键必须与这次上传同时保存，
 *   否则中途刷新/关页后再重试会给同一张图生成新 key，把它重复上传一遍。
 * @returns {Promise<{markdown, fileMap, fileKeys, warnings}>}
 */
export async function uploadLocalImages(markdown, fileMap, fileKeys, onProgress) {
  const map = { ...(fileMap || {}) };
  const keys = { ...(fileKeys || {}) };
  const warnings = [];
  let text = markdown || '';
  for (const url of localImageUrls(text)) {
    if (map[url]) {
      text = replaceAll(text, url, pickcatFileUrl(map[url]));
      continue;
    }
    if (!keys[url]) keys[url] = newIdempotencyKey(); // 固定 key：同一张图重试不会重复上传
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        warnings.push({ url, code: 'network', status: res.status });
        continue;
      }
      const buf = await res.arrayBuffer();
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const src = new Blob([buf], ct ? { type: ct } : undefined);
      const conv = await toWebpBlob(src);
      if (!conv.ok) {
        warnings.push({ url, code: conv.reason || 'not_webp', status: 0 });
        continue;
      }
      if (conv.blob.size > 10 * 1024 * 1024) {
        warnings.push({ url, code: 'too_large', status: 0 });
        continue;
      }
      const up = await uploadFile(conv.blob, keys[url]);
      map[url] = up.id;
      text = replaceAll(text, url, pickcatFileUrl(up.id));
      if (onProgress) onProgress({ fileMap: { ...map }, fileKeys: { ...keys } });
    } catch (e) {
      const err = pcError(e);
      warnings.push({
        url,
        code: err.code || (err.network ? 'network' : 'upload_failed'),
        status: err.status || 0,
      });
    }
  }
  return { markdown: text, fileMap: map, fileKeys: keys, warnings };
}

/* ------------------------------------------------------------------ 同步主流程 */

/**
 * 执行一次同步尝试。**调用方必须已经成功创建了 KitterHub 的帖子。**
 *
 * @param {object} opts
 * @param {number|string} opts.ownPostId KitterHub 帖子 id
 * @param {string} opts.title 标题
 * @param {string} opts.markdown KitterHub 上的原始正文（不要传已被改写的版本）
 * @param {string[]} opts.tagIds pickCat 标签 id
 * @param {'DISCUSSION'|'QUESTION'} [opts.kind]
 * @param {boolean} [opts.withImages] 是否把正文里的本站图片一起上传
 * @returns {Promise<object>} 更新后的本地记录
 */
export async function syncToPickCat(opts) {
  const {
    ownPostId,
    title,
    markdown,
    tagIds,
    kind = 'DISCUSSION',
    withImages = true,
  } = opts;

  const prev = readSync(ownPostId) || {};
  // 幂等键：第一次生成后永久复用
  const idempotencyKey = prev.idempotencyKey || newIdempotencyKey();
  let rec = {
    ownPostId,
    title,
    markdown,
    tagIds: Array.isArray(tagIds) ? tagIds : [],
    kind,
    idempotencyKey,
    fileMap: prev.fileMap || {},
    fileKeys: prev.fileKeys || {},
    attempts: (prev.attempts || 0) + 1,
    status: 'syncing',
    topicId: prev.topicId || null,
    firstPostId: prev.firstPostId || null,
    postId: prev.postId || null,
    postUrl: prev.postUrl || null,
    error: null,
    warnings: [],
    updatedAt: new Date().toISOString(),
  };
  writeSync(rec);

  try {
    let body = { title, markdown: rec.markdown, tagIds: rec.tagIds, kind };
    if (withImages) {
      // 每张图上传成功后立刻把 fileMap/fileKeys 落盘：这张图已经占到对方的 fileId，
      // 重试必须复用它（也复用同一个图片幂等键），不能重新上传一张重复文件。
      const up = await uploadLocalImages(rec.markdown, rec.fileMap, rec.fileKeys, (p) => {
        rec = { ...rec, fileMap: p.fileMap, fileKeys: p.fileKeys, updatedAt: new Date().toISOString() };
        writeSync(rec);
      });
      rec = { ...rec, fileMap: up.fileMap, fileKeys: up.fileKeys, warnings: up.warnings };
      writeSync(rec);
      body = { title, markdown: up.markdown, tagIds: rec.tagIds, kind };
    }
    const data = await createTopic(body, rec.idempotencyKey);
    /* POST /posts 的响应形状（官方前端真实用法 + 文档）：同时给主题和帖子身份。
     *   · topicId  -> **主题 id**，详情页地址 `/forum/post/<topicId>` 要的就是它
     *                 （官方发帖回跳就是 `outcome.type==='published' ? /forum/post/${outcome.topicId}`）
     *   · postId   -> 首楼帖子的 id，存下来另有用处（诊断/对账），**不要拿它拼链接**
     * 之前这里写反了（拿 postId 拼链接 / 或响应里没有 postId 时回退到 topicId 又存错字段），
     * 导致链接点过去是 404 主题。现在分开存、并且地址一律用 topicId 拼。 */
    const rawTopicId = data.topicId || (data.topic && data.topic.id) || null;
    const rawPostId = data.postId || (data.firstPost && data.firstPost.id) || null;
    rec = {
      ...rec,
      status: 'done',
      topicId: rawTopicId ? String(rawTopicId) : null,
      firstPostId: rawPostId ? String(rawPostId) : null,
      postId: rawPostId ? String(rawPostId) : null,
      // 详情页地址：/forum/post/<主题 id>
      postUrl: rawTopicId ? PICKCAT_POST_URL(rawTopicId) : null,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    markHadSession();
    writeSync(rec);
    return rec;
  } catch (e) {
    const err = pcError(e);
    rec = {
      ...rec,
      status: isAuthError(err) ? 'expired' : 'failed',
      error: {
        network: !!err.network,
        status: err.status || 0,
        code: err.code || '',
        message: err.message || '',
        fieldErrors: err.fieldErrors || null,
        permissionKey: err.permissionKey || '',
      },
      updatedAt: new Date().toISOString(),
    };
    writeSync(rec);
    return rec;
  }
}

/** 供界面用的短状态：done | failed | expired | syncing | null */
export function syncBadge(ownPostId) {
  const r = readSync(ownPostId);
  return r ? r.status : null;
}

export default {
  newIdempotencyKey,
  sessionState,
  hadSession,
  markHadSession,
  clearHadSession,
  readSync,
  writeSync,
  listSyncs,
  syncToPickCat,
  syncBadge,
  topicIdOf,
  postUrlOf,
  repairTopicId,
  localImageUrls,
  uploadLocalImages,
  pickcatFileUrl,
};
