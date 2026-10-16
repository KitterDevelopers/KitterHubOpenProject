import { io } from 'socket.io-client';
import { SOCKET_URL } from './base';

export { SOCKET_URL };

// 全站只维护一条 Socket 连接：站内通知、聊天消息、未读角标共用，
// 避免同一标签页里多个组件各开一条连接导致重复推送与资源浪费。
let shared = null;
let sharedToken = null;

export function createSocket(token) {
  return io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
}

export function getSharedSocket(token) {
  if (!token) {
    closeSharedSocket();
    return null;
  }
  if (shared && sharedToken === token) return shared;
  closeSharedSocket();
  shared = createSocket(token);
  sharedToken = token;
  return shared;
}

export function closeSharedSocket() {
  if (shared) {
    try {
      shared.removeAllListeners();
      shared.disconnect();
    } catch {
      /* 忽略断开异常 */
    }
  }
  shared = null;
  sharedToken = null;
}
