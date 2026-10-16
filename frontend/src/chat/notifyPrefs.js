/**
 * 通知偏好的本地缓存。
 *
 * 为什么要缓存：聊天提示音要在**任意页面**、消息到达的瞬间判断「这个开关关了吗」，
 * 每个 socket 事件都去 GET 一次 /users/me/notify_prefs 显然不行。
 * 所以：账号设置读到/保存后写进 localStorage，各处读缓存；缓存缺失时按「默认开启」处理。
 * 服务端仍是唯一事实来源，缓存只是它的一个镜像。
 */
const KEY = 'nimao_notify_prefs';

export function cacheNotifyPrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs || {}));
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

export function readNotifyPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** 通知偏好一律「默认开启」：只有显式 false 才算关。 */
export function prefOn(prefs, key) {
  return (prefs || {})[key] !== false;
}
