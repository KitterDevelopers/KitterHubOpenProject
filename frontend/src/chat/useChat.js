// 聊天页全部状态与副作用集中在这里：REST 读写 + Socket 实时事件 + 未读角标同步。
// 页面组件只负责渲染，不直接碰网络，避免旧实现里"渲染期写 ref / 多处状态不一致"的问题。
import { useCallback, useEffect, useRef, useState } from 'react';
import client, { errMsg } from '../api/client';
import { getSharedSocket } from '../api/socket';
import { toast } from '../components/Toast';
import { useI18n } from '../i18n';
import { setActiveThreadId } from './sound';

export const PAGE_SIZE = 30;

export default function useChat({ user, token }) {
  const uid = user?.id;

  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [typing, setTyping] = useState({});
  const [peerRead, setPeerRead] = useState(0);

  const activeIdRef = useRef(null);
  const messagesRef = useRef([]);
  const socketRef = useRef(null);
  const typingSentRef = useRef({});
  const pendingSendRef = useRef(0);   // 正在等发送 ack 的条数（用于避免重复弹错误提示）
  const uidRef = useRef(uid);
  uidRef.current = uid;

  // 文案：用 ref 持有 t，回调身份保持稳定（socket 监听在 effect 里注册，
  // 若把 t 放进依赖会导致每次切语言都重新订阅），而取到的始终是当前语言。
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  messagesRef.current = messages;

  const refreshThreads = useCallback(async () => {
    try {
      const r = await client.get('/chat/threads');
      setThreads(r.data || []);
    } catch {
      /* 忽略 */
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!uid) {
      setThreads([]);
      setThreadsLoading(false);
      return;
    }
    refreshThreads();
  }, [uid, refreshThreads]);

  const markRead = useCallback(
    async (threadId, lastMessageId) => {
      try {
        await client.post(`/chat/threads/${threadId}/read`, lastMessageId ? { last_message_id: lastMessageId } : {});
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)));
      } catch {
        /* 忽略 */
      }
    },
    []
  );

  const closeActive = useCallback(() => {
    activeIdRef.current = null;
    setActiveId(null);
    setDetail(null);
    setMessages([]);
    setHasMore(false);
    setPeerRead(0);
  }, []);

  const openThread = useCallback(
    async (threadId, { silent = false } = {}) => {
      const id = Number(threadId);
      if (!id) return;
      activeIdRef.current = id;
      setActiveId(id);
      setMessages([]);
      setHasMore(false);
      setPeerRead(0);
      setMessagesLoading(true);
      setDetail((prev) => (prev && prev.id === id ? prev : null));
      try {
        const [d, m] = await Promise.all([
          client.get(`/chat/threads/${id}`),
          client.get(`/chat/threads/${id}/messages`, { params: { limit: PAGE_SIZE } }),
        ]);
        if (activeIdRef.current !== id) return;
        setDetail(d.data);
        const list = m.data.messages || [];
        setMessages(list);
        setHasMore(!!m.data.has_more);
        // 无条件推进已读水位：以前写成「最新一条不是自己发的才标已读」，
        // 于是「未读 > 0 但最新一条是自己发的」这种状态（手机端回过一句、另一端才打开）
        // 永远清不掉。服务端会把水位夹到真实最大 id 且只增不减，重复调用无害。
        const last = list[list.length - 1];
        if (last && last.id) await markRead(id, last.id);
      } catch (e) {
        if (!silent) toast(errMsg(e), 'error');
        if (activeIdRef.current === id) closeActive();
      } finally {
        if (activeIdRef.current === id) setMessagesLoading(false);
      }
    },
    [closeActive, markRead]
  );

  // 把「当前打开的会话」告诉全局提示音：正在看的这条会话来消息不该再响
  // （在别的页面时这个值是 null，任何新消息都会响）
  useEffect(() => {
    setActiveThreadId(activeId);
    return () => setActiveThreadId(null);
  }, [activeId]);

  // ---------------------------------------------------------------- Socket
  useEffect(() => {
    if (!token) {
      return undefined;
    }
    const s = getSharedSocket(token);
    if (!s) return undefined;
    socketRef.current = s;

    const onNew = ({ thread_id: tid, message }) => {
      if (!message) return;
      if (tid === activeIdRef.current) {
        setMessages((prev) => (prev.some((x) => x.id === message.id) ? prev : [...prev, message]));
        if (message.sender_id !== uidRef.current && message.id) {
          client
            .post(`/chat/threads/${tid}/read`, { last_message_id: message.id })
            .then(() => {
              setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, unread: 0 } : t)));
            })
            .catch(() => {});
        }
      } else {
        refreshThreads();
      }
    };
    const onTyping = ({ thread_id: tid, user_id, name }) => {
      if (user_id === uidRef.current) return;
      setTyping((prev) => ({ ...prev, [tid]: { user_id, name, at: Date.now() } }));
    };
    const onRead = ({ thread_id: tid, user_id, last_message_id }) => {
      if (user_id === uidRef.current || tid !== activeIdRef.current) return;
      setPeerRead((prev) => Math.max(prev, Number(last_message_id) || 0));
    };
    const onRecalled = ({ message_id }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === message_id ? { ...m, recalled: true, content: '', image_url: null, voice_url: null } : m))
      );
    };
    const onDeleted = ({ message_id }) => {
      setMessages((prev) => prev.filter((m) => m.id !== message_id));
    };
    const onGone = ({ thread_id: tid, kicked }) => {
      if (kicked !== undefined && kicked !== uidRef.current) return;
      if (tid === activeIdRef.current) closeActive();
      refreshThreads();
    };
    const onError = ({ reason }) => {
      // 正在等发送 ack 时，错误由 sendText/sendImage 统一提示一次，
      // 这里再弹就会「同一个失败弹两条」。
      if (pendingSendRef.current > 0) return;
      toast(reason || tRef.current('chat.toastSendFail'), 'error');
    };

    s.on('chat:new', onNew);
    s.on('chat:typing', onTyping);
    s.on('chat:read', onRead);
    s.on('chat:recalled', onRecalled);
    s.on('chat:deleted', onDeleted);
    s.on('chat:thread_gone', onGone);
    s.on('chat:error', onError);
    return () => {
      s.off('chat:new', onNew);
      s.off('chat:typing', onTyping);
      s.off('chat:read', onRead);
      s.off('chat:recalled', onRecalled);
      s.off('chat:deleted', onDeleted);
      s.off('chat:thread_gone', onGone);
      s.off('chat:error', onError);
    };
  }, [token, refreshThreads, closeActive]);

  // 输入中提示 5 秒后自动消失
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.at < 5000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------ 发送相关
  const appendLocal = useCallback((msg) => {
    setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  /**
   * 通过 socket 发一条消息，**等服务器的 ack** 再返回是否成功。
   *
   * 以前这里 `emit` 完直接 `return true`，于是被禁言/被拉黑/已退群/内容超长这些情况
   * （服务端只回 chat:error）也会返回成功 → Composer 把输入框清空 → 用户打的字白打了。
   * 现在：ack 说成功才算成功；失败返回 false，输入框内容保留。
   * 超时（8 秒没 ack）按失败处理，但不提示「失败」——消息可能其实发出去了，
   * 提示会误导；它最终会通过 chat:new 出现或由 chat:error 兜底。
   */
  const emitWithAck = useCallback((s, event, payload) => new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };
    // socket.io 自带的 ack 超时：**只 emit 一次**，回调拿到 (err, res)。
    // ⚠️ 绝不能「先 emit 一次、再 timeout().emit 一次」——那是两条消息。
    const timer = setTimeout(() => done({ ok: false, timeout: true }), 9000);
    try {
      s.timeout(8000).emit(event, payload, (err, res) => {
        clearTimeout(timer);
        if (err) done({ ok: false, timeout: true });
        else done(res && typeof res === 'object' ? res : { ok: true });
      });
    } catch {
      clearTimeout(timer);
      done({ ok: false, timeout: true });
    }
  }), []);

  /**
   * 发文字消息。
   * ⚠️ replyTo（要引用的那条消息 id）必须一路带下去：原来这个函数**根本不收这个参数**，
   * 只有 sendImage 带了 reply_to —— 于是「引用一条消息再发文字」时引用被整条丢掉，
   * 输入框上方明明显示着引用条、发出去却成了普通消息。（站长 2026-09-27：「消息的引用功能好像有问题」）
   */
  const sendText = useCallback(
    async (text, replyTo) => {
      const tid = activeIdRef.current;
      const content = (text || '').trim();
      if (!tid || !content) return false;
      const payload = { thread_id: tid, content, reply_to: replyTo || undefined };
      const s = socketRef.current;
      if (s && s.connected) {
        pendingSendRef.current += 1;
        try {
          const res = await emitWithAck(s, 'chat:send', payload);
          if (res && res.ok) return true;
          if (!res?.timeout) toast(res?.reason || tRef.current('chat.toastSendFail'), 'error');
          return Boolean(res?.timeout);   // 超时不当失败（可能已发出），不保留草稿免得重复发
        } finally {
          pendingSendRef.current -= 1;
        }
      }
      try {
        const r = await client.post(`/chat/threads/${tid}/messages`, payload);
        appendLocal(r.data);
        return true;
      } catch (e) {
        toast(errMsg(e), 'error');
        return false;
      }
    },
    [appendLocal, emitWithAck]
  );

  const sendImage = useCallback(
    async (file, replyTo) => {
      const tid = activeIdRef.current;
      if (!tid || !file) return false;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const up = await client.post('/upload', fd);
        const payload = { thread_id: tid, content: '', image_url: up.data.url, reply_to: replyTo || undefined };
        const s = socketRef.current;
        if (s && s.connected) {
          pendingSendRef.current += 1;
          try {
            const res = await emitWithAck(s, 'chat:send', payload);
            if (!res?.ok && !res?.timeout) toast(res?.reason || tRef.current('chat.toastSendFail'), 'error');
            return Boolean(res?.ok || res?.timeout);
          } finally {
            pendingSendRef.current -= 1;
          }
        }
        appendLocal((await client.post(`/chat/threads/${tid}/messages`, payload)).data);
        return true;
      } catch (e) {
        toast(errMsg(e), 'error');
        return false;
      }
    },
    [appendLocal, emitWithAck]
  );

  const sendTyping = useCallback(() => {
    const tid = activeIdRef.current;
    const s = socketRef.current;
    if (!tid || !s || !s.connected) return;
    // 输入中提示做节流：同一个人 2.5 秒内最多上报一次，避免每敲一个字就发一个包
    const now = Date.now();
    if (now - (typingSentRef.current[tid] || 0) < 2500) return;
    typingSentRef.current[tid] = now;
    s.emit('chat:typing', { thread_id: tid });
  }, []);

  const loadOlder = useCallback(async () => {
    const tid = activeIdRef.current;
    const first = messagesRef.current[0];
    if (!tid || !first || olderLoading) return;
    setOlderLoading(true);
    try {
      const r = await client.get(`/chat/threads/${tid}/messages`, { params: { before_id: first.id, limit: PAGE_SIZE } });
      // 请求在路上时用户可能已经切到别的会话：不校验就会把 A 的历史消息插进 B 的列表里
      // （openThread 有这个校验，这里以前漏了）。
      if (activeIdRef.current !== tid) return;
      const list = r.data.messages || [];
      setMessages((prev) => {
        // 再用 id 去一次重：翻页与实时消息可能撞在一起
        const seen = new Set(prev.map((m) => m.id));
        return [...list.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(!!r.data.has_more);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setOlderLoading(false);
    }
  }, [olderLoading]);

  /**
   * 一直往回翻页，直到找到指定消息（搜索结果的「跳转」用）。
   *
   * 搜索是覆盖整段历史的，而列表里只有最近 30 条 —— 目标更早时，光 setJumpId 是没反应的
   * （DOM 里根本没有那个节点）。这里最多翻 maxPages 页，返回是否找到。
   */
  const loadUntil = useCallback(async (msgId, maxPages = 10) => {
    const tid = activeIdRef.current;
    if (!tid) return false;
    let list = messagesRef.current;
    if (list.some((m) => m.id === msgId)) return true;
    for (let page = 0; page < maxPages; page += 1) {
      const first = list[0];
      if (!first) return false;
      let r;
      try {
        r = await client.get(`/chat/threads/${tid}/messages`, { params: { before_id: first.id, limit: PAGE_SIZE } });
      } catch {
        return false;
      }
      if (activeIdRef.current !== tid) return false;
      const older = r.data.messages || [];
      if (older.length === 0) return false;
      const seen = new Set(list.map((m) => m.id));
      list = [...older.filter((m) => !seen.has(m.id)), ...list];
      setMessages(list);
      setHasMore(!!r.data.has_more);
      if (list.some((m) => m.id === msgId)) return true;
      if (!r.data.has_more) return false;
    }
    return false;
  }, []);

  // ------------------------------------------------------------ 消息操作
  const recallMessage = useCallback(
    async (msgId) => {
      try {
        await client.post(`/chat/messages/${msgId}/recall`);
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, recalled: true, content: '', image_url: null, voice_url: null } : m))
        );
        toast(tRef.current('chat.toastRecalled'));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const deleteMessage = useCallback(async (msgId) => {
    try {
      await client.delete(`/chat/messages/${msgId}`);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      toast(tRef.current('chat.toastDeleted'));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }, []);

  // ------------------------------------------------------------ 会话操作
  const openDm = useCallback(
    async (targetUid) => {
      try {
        const r = await client.post('/chat/threads/dm', { uid: targetUid });
        await refreshThreads();
        await openThread(r.data.id);
        return r.data.id;
      } catch (e) {
        toast(errMsg(e), 'error');
        return null;
      }
    },
    [openThread, refreshThreads]
  );

  const createGroup = useCallback(
    async (title, announcement) => {
      try {
        const r = await client.post('/chat/threads/group', { title, announcement });
        await refreshThreads();
        await openThread(r.data.id);
        return r.data.id;
      } catch (e) {
        toast(errMsg(e), 'error');
        return null;
      }
    },
    [openThread, refreshThreads]
  );

  const joinGroup = useCallback(
    async (threadId) => {
      try {
        await client.post(`/chat/threads/${threadId}/join`);
        await refreshThreads();
        await openThread(threadId);
        return true;
      } catch (e) {
        toast(errMsg(e), 'error');
        return false;
      }
    },
    [openThread, refreshThreads]
  );

  const leaveGroup = useCallback(async () => {
    const tid = activeIdRef.current;
    if (!tid) return;
    try {
      await client.post(`/chat/threads/${tid}/leave`);
      closeActive();
      await refreshThreads();
      toast(tRef.current('chat.toastLeft'));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }, [closeActive, refreshThreads]);

  const dissolveGroup = useCallback(async () => {
    const tid = activeIdRef.current;
    if (!tid) return;
    try {
      await client.delete(`/chat/threads/${tid}`);
      closeActive();
      await refreshThreads();
      toast(tRef.current('chat.toastGroupDisbanded'));
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }, [closeActive, refreshThreads]);

  const updateThreadInfo = useCallback(
    async (patch) => {
      const tid = activeIdRef.current;
      if (!tid) return;
      try {
        const r = await client.patch(`/chat/threads/${tid}`, patch);
        // 只更新「还是当前会话」的那份 detail：否则在群里保存资料、请求还没回来就切到另一个群，
        // 返回的整份 detail 会把新会话的标题/公告/成员/权限全盖成旧群的。
        setDetail((prev) => (prev && prev.id === tid ? r.data : prev));
        setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, title: r.data.title, avatar_url: r.data.avatar_url } : t)));
        toast(tRef.current('chat.toastSaved'));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const setMySettings = useCallback(async (patch) => {
    const tid = activeIdRef.current;
    if (!tid) return;
    setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, ...patch } : t)));
    try {
      await client.patch(`/chat/threads/${tid}/me`, patch);
    } catch (e) {
      toast(errMsg(e), 'error');
      // 乐观更新失败要回滚，否则置顶/免打扰图标会一直停在错的状态直到手动刷新
      refreshThreads();
    }
  }, [refreshThreads]);

  const toggleMuteAll = useCallback(
    async (on) => {
      const tid = activeIdRef.current;
      if (!tid) return;
      try {
        await client.post(`/chat/threads/${tid}/mute-all`, { minutes: on ? 60 * 24 * 365 : 0 });
        setDetail((prev) => (prev ? { ...prev, mute_all: on } : prev));
        toast(tRef.current(on ? 'chat.toastMutedAll' : 'chat.toastUnmutedAll'));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const updateMember = useCallback(
    async (memberUid, patch) => {
      const tid = activeIdRef.current;
      if (!tid) return;
      try {
        const r = await client.patch(`/chat/threads/${tid}/members/${memberUid}`, patch);
        setDetail((prev) =>
          prev && prev.id === tid
            ? { ...prev, members: (prev.members || []).map((m) => (m.uid === memberUid ? { ...m, ...r.data } : m)) }
            : prev
        );
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const kickMember = useCallback(
    async (memberUid) => {
      const tid = activeIdRef.current;
      if (!tid) return;
      try {
        await client.delete(`/chat/threads/${tid}/members/${memberUid}`);
        setDetail((prev) =>
          prev && prev.id === tid ? { ...prev, members: (prev.members || []).filter((m) => m.uid !== memberUid) } : prev
        );
        toast(tRef.current('chat.toastRemoved'));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const blockUser = useCallback(
    async (memberUid, blocked) => {
      try {
        if (blocked) await client.post(`/chat/blocks/${memberUid}`);
        else await client.delete(`/chat/blocks/${memberUid}`);
        setDetail((prev) => (prev ? { ...prev, blocked } : prev));
        toast(tRef.current(blocked ? 'chat.toastBlocked' : 'chat.toastUnblocked'));
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    },
    []
  );

  const searchMessages = useCallback(async (q) => {
    const tid = activeIdRef.current;
    if (!tid || !q.trim()) return { messages: [], total: 0 };
    try {
      const r = await client.get(`/chat/threads/${tid}/search`, { params: { q } });
      return r.data;
    } catch (e) {
      toast(errMsg(e), 'error');
      return { messages: [], total: 0 };
    }
  }, []);

  const loadMedia = useCallback(async () => {
    const tid = activeIdRef.current;
    if (!tid) return [];
    try {
      const r = await client.get(`/chat/threads/${tid}/media`);
      return (r.data || []).filter((m) => m.image_url);
    } catch (e) {
      toast(errMsg(e), 'error');
      return [];
    }
  }, []);

  const searchUsers = useCallback(async (q) => {
    if (!q.trim()) return [];
    try {
      const r = await client.get('/chat/users', { params: { q } });
      return r.data || [];
    } catch {
      return [];
    }
  }, []);

  const discoverGroups = useCallback(async (q = '') => {
    try {
      const r = await client.get('/chat/discover', { params: { q } });
      return r.data || [];
    } catch {
      return [];
    }
  }, []);

  const listBlocks = useCallback(async () => {
    try {
      const r = await client.get('/chat/blocks');
      return r.data || [];
    } catch {
      return [];
    }
  }, []);

  return {
    uid,
    threads,
    threadsLoading,
    activeId,
    detail,
    messages,
    messagesLoading,
    hasMore,
    olderLoading,
    typing,
    peerRead,
    refreshThreads,
    openThread,
    closeActive,
    sendText,
    sendImage,
    sendTyping,
    loadOlder,
    loadUntil,
    recallMessage,
    deleteMessage,
    openDm,
    createGroup,
    joinGroup,
    leaveGroup,
    dissolveGroup,
    updateThreadInfo,
    setMySettings,
    toggleMuteAll,
    updateMember,
    kickMember,
    blockUser,
    searchMessages,
    loadMedia,
    searchUsers,
    discoverGroups,
    listBlocks,
    markRead,
  };
}
