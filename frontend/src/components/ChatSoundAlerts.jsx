/**
 * 全局聊天提示音：在**任何页面**收到别人的新消息就响一声。
 *
 * 为什么单独挂一个全局组件而不是写在 useChat 里：useChat 只挂在聊天页，
 * 用户在看论坛/发现的时候根本不会响。Socket 是全局共享的一条连接（见 api/socket.js），
 * 这里跟 NotificationBell 一样挂一个监听即可。
 *
 * 不响的几种情况（顺序即优先级）：
 *   1. 自己发的消息；
 *   2. 正停在那条会话里（看得见，不用提醒）；
 *   3. 「消息提示音」开关关掉；
 *   4. 对应类型的聊天通知关掉（私聊消息 / 群聊消息）—— 通知都关了就不该再响。
 *
 * 浏览器自动播放限制：首次交互时解锁一次，之后才可能出声（见 chat/sound.js）。
 */
import { useEffect, useRef } from 'react';
import client from '../api/client';
import { getSharedSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { cacheNotifyPrefs, prefOn, readNotifyPrefs } from '../chat/notifyPrefs';
import { getActiveThreadId, playMessageSound, primeMessageSound } from '../chat/sound';

export default function ChatSoundAlerts() {
  const { user, token } = useAuth();
  const uidRef = useRef(null);
  uidRef.current = user ? user.id : null;

  // 通知偏好：进站拉一次存到本地缓存（设置页保存时也会刷新它）
  useEffect(() => {
    if (!token) return;
    client.get('/users/me/notify_prefs').then((r) => cacheNotifyPrefs(r.data)).catch(() => {});
  }, [token]);

  // 首次交互解锁音频
  useEffect(() => {
    const unlock = () => primeMessageSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const s = getSharedSocket(token);
    if (!s) return undefined;
    const onNew = ({ thread_id: tid, message, kind }) => {
      if (!message || !message.id) return;
      if (message.sender_id === uidRef.current) return;
      if (Number(tid) === getActiveThreadId()) return;
      const prefs = readNotifyPrefs();
      if (!prefOn(prefs, 'chat_sound')) return;
      if (kind === 'dm' ? !prefOn(prefs, 'chat_dm') : !prefOn(prefs, 'chat_group')) return;
      playMessageSound();
    };
    s.on('chat:new', onNew);
    return () => {
      s.off('chat:new', onNew);
    };
  }, [token]);

  return null;
}
