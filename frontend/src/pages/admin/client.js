/**
 * 管理员后台 · 接口层（唯一取数入口）
 *
 * 规矩（2026-10-15 重做时定的，改这个文件前先读一遍）：
 *   1. **所有请求都在这里**。面板里不允许出现 `http.get('/admin/...')`、
 *      `fetch('/api/...')` 或自己拼 URL —— 页面只 import 本文件的函数。
 *   2. **不在这一层改名**：函数名/参数名与后端字段一致（契约见 .forensics/ADMIN-CONTRACT.md）。
 *   3. **统一返回形状**：一律返回 `{ data, total, headers }`。
 *      - `data` 是后端原样返回（裸数组就是数组，不包装成 {items}）
 *      - `total` 取 `X-Total-Count`（后端分页接口用它；没有就是 null）
 *      需要列表数组的面板用 `toList(data, keys)`，不要自己猜字段名。
 *   4. **统一错误**：所有函数失败时抛 `AdminApiError`，`message` 是人话（走 axios 的 errMsg），
 *      `status` 是 HTTP 状态码。面板统一 `catch (e) { setErr(msgOf(e)) }`，不许吞异常。
 *   5. **分页口径**：paged='server' 的接口用 limit+skip，其余全量返回由页面本地切片（PAGED）。
 */
import http from '../../api/client';
import { errMsg } from '../../api/client';

/* ---------------------------------------------------------------- 返回形状 */
export class AdminApiError extends Error {
  constructor(message, status, cause) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status || 0;
    this.cause = cause;
  }
}

const unwrap = (res) => ({
  data: res.data,
  total: Number(res.headers?.['x-total-count'] ?? NaN) || null,
  headers: res.headers || {},
});

const wrap = (fn) => async (...args) => {
  try {
    return unwrap(await fn(...args));
  } catch (e) {
    throw new AdminApiError(errMsg(e), e?.response?.status || 0, e);
  }
};

/** 错误 -> 人话。面板统一用它，保证提示文案一致。 */
export const msgOf = (e) => (e instanceof AdminApiError ? e.message : errMsg(e));

/** 从响应体里取列表数组（后端有的返回裸数组，有的包 items / requests / studios…）。 */
export const toList = (data, keys = []) => {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of [...keys, 'items', 'list', 'rows', 'data', 'requests', 'studios', 'users', 'works', 'posts']) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
};

/* ---------------------------------------------------------------- 请求封装 */
const get = (path, query) => http.get(path, { params: query });
const post = (path, body, query) => http.post(path, body === undefined ? undefined : body, { params: query });
const patch = (path, body) => http.patch(path, body);
const del = (path, query) => http.delete(path, { params: query });

/* ============================================================ 概览 */
export const getStats = wrap(() => get('/admin/stats'));
export const getUserRegions = wrap(() => get('/admin/user-regions'));
export const exportCsvUrl = (name) => `/api/admin/export/${name}.csv`;

/* ============================================================ 用户 */
// query: limit, skip, q, status, role, verify, login, region, sort   (paged: server)
export const listUsers = wrap((query) => get('/admin/users', query));
export const userDetail = wrap((uid) => get(`/admin/users/${uid}/detail`));
export const listBannedUsers = wrap(() => get('/admin/users/banned'));
export const userDeletePreview = wrap((uid) => get(`/admin/users/${uid}/delete-preview`));
export const userAudit = wrap((uid) => get(`/admin/audit/${uid}`));
// body: { reason, until }   until ∈ 1d / 7d / 30d / permanent / ISO
export const banUser = wrap((uid, body) => post(`/admin/users/${uid}/ban`, body));
export const unbanUser = wrap((uid) => post(`/admin/users/${uid}/unban`));
// body: { nickname, bio, avatar_url, ban_until, sensitive_exempt }
export const editUser = wrap((uid, body) => patch(`/admin/users/${uid}`, body));
export const forceLogout = wrap((uid) => post(`/admin/users/${uid}/force_logout`));
export const purgeUser = wrap((uid) => post(`/admin/users/${uid}/purge`));
// confirm 必须是用户名原文（query）
export const deleteUser = wrap((uid, confirm) => del(`/admin/users/${uid}`, { confirm }));
export const grantXp = wrap((uid, delta) => post(`/admin/users/${uid}/xp`, { delta }));
export const grantFish = wrap((uid, delta) => post(`/admin/users/${uid}/fish`, { delta }));
// body: { type: 'blue'|'gold', title }
export const verifyUser = wrap((uid, body) => post(`/admin/users/${uid}/verify`, body));
export const unverifyUser = wrap((uid) => del(`/admin/users/${uid}/verify`));
// body: { quota_mb }
export const setScratchQuota = wrap((uid, quota_mb) => post(`/admin/users/${uid}/scratch-quota`, { quota_mb }));
// body: { uids, action: ban|unban|force_logout|xp|fish, reason, until, delta }
export const batchUsers = wrap((body) => post('/admin/users/batch', body));

/* ============================================================ 稿件 */
// query: limit, skip, q, status, category, author, editor, featured, pinned, sort
export const listWorks = wrap((query) => get('/admin/works', query));
export const workVersions = wrap((id) => get(`/admin/works/${id}/versions`));
export const editWork = wrap((id, body) => patch(`/admin/works/${id}`, body));
export const deleteWork = wrap((id) => del(`/admin/works/${id}`));
export const workFlag = wrap((id, flag, on) => post(`/admin/works/${id}/${on ? flag : 'un' + flag}`));
export const reviewWork = wrap((id, body) => post(`/admin/works/${id}/review`, body));   // { decision, reason }
export const batchWorks = wrap((ids, action) => post('/admin/works/batch', { ids, action }));
export const listFeatured = wrap(() => get('/admin/featured'));

/* ============================================================ 帖子 / 评论 */
export const listPosts = wrap((query) => get('/admin/posts', query));
export const postVersions = wrap((id) => get(`/admin/posts/${id}/versions`));
export const editPost = wrap((id, body) => patch(`/admin/posts/${id}`, body));
export const deletePost = wrap((id) => del(`/admin/posts/${id}`));
export const postFlag = wrap((id, flag, on) => post(`/admin/posts/${id}/${on ? flag : 'un' + flag}`));
export const batchPosts = wrap((ids, action) => post('/admin/posts/batch', { ids, action }));
export const listComments = wrap((query) => get('/admin/comments', query));      // limit, skip, q, target_type
export const deleteComment = wrap((id) => del(`/admin/comments/${id}`));
export const batchComments = wrap((ids) => post('/admin/comments/batch', { ids }));

/* ============================================================ 举报 */
export const listReports = wrap((query) => get('/reports', query));
export const handleReport = wrap((id, body) => post(`/reports/${id}/handle`, body));       // { status, note }
export const batchReports = wrap((body) => post('/admin/reports/batch', body));            // { ids, status, note }

/* ============================================================ 审核队列 / 敏感词 */
export const reviewQueue = wrap(() => get('/admin/review_queue'));
export const listSensitiveReviews = wrap((query) => get('/admin/sensitive-reviews', query));  // limit, skip, status, source
export const approveSensitive = wrap((id) => post(`/admin/sensitive-reviews/${id}/approve`));
// body: { reason, penalty, amount, days }
export const rejectSensitive = wrap((id, body) => post(`/admin/sensitive-reviews/${id}/reject`, body));
export const listSensitiveWords = wrap(() => get('/admin/sensitive-words'));
export const addSensitiveWord = wrap((word) => post('/admin/sensitive-words', { word }));
export const deleteSensitiveWord = wrap((id) => del(`/admin/sensitive-words/${id}`));
export const sensitiveStats = wrap(() => get('/admin/sensitive-words/stats'));
export const sensitiveStatsShort = wrap(() => get('/admin/sensitive-stats'));

/* ============================================================ 回收站 / 日志 */
export const listRecycle = wrap((query) => get('/admin/recycle', query));     // limit, skip, q, target_type
export const restoreRecycle = wrap((id) => post(`/admin/recycle/${id}/restore`));
export const listLogs = wrap((query) => get('/admin/logs', query));           // limit, skip, q
export const listAuditLogs = wrap((query) => get('/admin/audit_logs', query)); // limit, skip

/* ============================================================ 工作室 */
export const listStudios = wrap((query) => get('/admin/studios', query));     // limit, skip, q, status, category
export const studioDetail = wrap((id) => get(`/admin/studios/${id}`));
export const editStudio = wrap((id, body) => patch(`/admin/studios/${id}`, body));
export const freezeStudio = wrap((id) => post(`/admin/studios/${id}/freeze`));
export const unfreezeStudio = wrap((id) => post(`/admin/studios/${id}/unfreeze`));
export const banStudio = wrap((id) => post(`/admin/studios/${id}/ban`));
export const unbanStudio = wrap((id) => post(`/admin/studios/${id}/unban`));
export const disbandStudio = wrap((id) => post(`/admin/studios/${id}/force_disband`));
export const studioInvite = wrap((id) => post(`/admin/studios/${id}/invite`));
export const revokeStudioInvite = wrap((id) => del(`/admin/studios/${id}/invite`));
export const studioMembers = wrap((id, query) => get(`/admin/studios/${id}/members`, query));   // limit, status
export const setStudioMemberRole = wrap((sid, uid, role) => post(`/admin/studios/${sid}/members/${uid}/role`, { role }));
export const kickStudioMember = wrap((sid, uid) => del(`/admin/studios/${sid}/members/${uid}`));
export const muteStudioMember = wrap((sid, uid, muted) => post(`/admin/studios/${sid}/members/${uid}/mute`, { muted }));
export const transferStudioOwner = wrap((sid, user_id) => post(`/admin/studios/${sid}/transfer_owner`, { user_id }));

/* ============================================================ 认证 */
export const listVerifications = wrap(() => get('/admin/verifications'));
// 护照/实名待审队列。**与侧栏「护照审核」角标同源**：
//   角标 = /admin/stats 的 pending_passport（后端 pending_verifications_query）
//   列表 = 本函数（同一个 users.verify_state IN (awaiting_passport, pending_review, rejected)）
// ⚠️ 不要用 listVerifications 代替：那个接口只返回**已经认证通过**的用户（2 条），口径不同。
export const verifyQueue = wrap(() => get('/admin/verify-queue'));
export const verifyDocUrl = (uid) => `/admin/verify-docs/${uid}`;
export const approveVerifyDoc = wrap((uid) => post(`/admin/verify-docs/${uid}/approve`));
export const rejectVerifyDoc = wrap((uid, reason) => post(`/admin/verify-docs/${uid}/reject`, { reason }));
export const resetVerifyDoc = wrap((uid) => post(`/admin/verify-docs/${uid}/reset`));

/* ============================================================ 风纪委员会（2026-10-12 重做） */
export const committeeOverview = wrap(() => get('/admin/committee/overview'));
export const committeeReviewQueue = wrap((query) => get('/admin/committee/review-queue', query));          // { state, limit }
export const committeeDecide = wrap((reviewId, body) => post(`/admin/committee/reviews/${reviewId}/decide`, body)); // { decision: restore|uphold, note }
export const reviewCommitteeApplication = wrap((uid, body) => post(`/admin/committee/applications/${uid}/review`, body)); // { decision: approve|reject, note }
export const grantCommitteeMember = wrap((uid, body) => post(`/admin/committee/members/${uid}/grant`, body));            // { note }
export const suspendCommitteeMember = wrap((uid, body) => post(`/admin/committee/members/${uid}/suspend`, body));        // { suspended, note }
export const renewCommitteeMember = wrap((uid, body) => post(`/admin/committee/members/${uid}/renew`, body));            // { note }
export const committeeAudit = wrap((query) => get('/admin/committee/audit', query));                        // { limit }

/* ============================================================ 扩容 */
export const listQuotaRequests = wrap((query) => get('/admin/scratch-quota/requests', query));   // status
export const reviewQuotaRequest = wrap((id, body) => post(`/admin/scratch-quota/requests/${id}/review`, body)); // { decision, grant_mb, note }

/* ============================================================ 站点：开关 / 公告 / Banner / 通知 */
export const listSwitches = wrap(() => get('/admin/switches'));
export const setSwitch = wrap((key, value) => patch(`/admin/switches/${key}`, { value }));
export const getAnnouncement = wrap(() => get('/admin/announcement'));
export const saveAnnouncement = wrap((body) => post('/admin/announcement', body));   // { announcement, scheduled_at }
export const listBanners = wrap(() => get('/admin/banners'));
export const createBanner = wrap((body) => post('/admin/banners', body));
export const patchBanner = wrap((id, body) => patch(`/admin/banners/${id}`, body));
export const deleteBanner = wrap((id) => del(`/admin/banners/${id}`));
export const notifyAll = wrap((content) => post('/admin/notify', { content }));

/* ============================================================ 云变量 */
export const cloudStats = wrap(() => get('/admin/cloud/stats'));
export const cloudRooms = wrap((query) => get('/admin/cloud/rooms', query));      // limit
export const cloudRoom = wrap((workId) => get(`/admin/cloud/rooms/${workId}`));
export const clearCloudRoom = wrap((workId) => post(`/admin/cloud/rooms/${workId}/clear`));

/* ============================================================
   分页元信息：与后端契约一一对应，页面据此选择翻页方式
   ============================================================ */
export const PAGED = {
  server: new Set([
    '/admin/users', '/admin/recycle', '/admin/works', '/admin/posts', '/admin/comments',
    '/admin/logs', '/admin/audit_logs', '/admin/studios', '/admin/sensitive-reviews',
  ]),
  limitOnly: new Set(['/admin/studios/{id}/members', '/admin/cloud/rooms']),
};
