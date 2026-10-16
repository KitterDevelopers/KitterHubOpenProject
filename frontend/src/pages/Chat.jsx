import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilledButton, IconButton, Menu, MenuItem, OutlinedTextField, Divider } from '../ui';
import MsIcon from '../components/MsIcon';
import Lightbox from '../components/Lightbox';
import { useAuth } from '../context/AuthContext';
import useChat from '../chat/useChat';
import ThreadAvatar from '../components/chat/ThreadAvatar';
import MessageItem from '../components/chat/MessageItem';
import Composer from '../components/chat/Composer';
import NewChatDialog from '../components/chat/NewChatDialog';
import GroupInfoDialog from '../components/chat/GroupInfoDialog';
import { MediaDialog, SearchDialog } from '../components/chat/ChatPanels';
import { toast } from '../components/Toast';
import { useI18n } from '../i18n';
import { dayLabel, fmtChina, displayName, parseTs, formatTime } from '../utils';

const RECALL_MS = 2 * 60 * 1000;
const GROUP_GAP_MS = 5 * 60 * 1000;

function ThreadRow({ thread, active, onClick }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`chat-thread${active ? ' active' : ''}`} onClick={onClick}>
      <ThreadAvatar thread={thread} size={44} />
      <span className="chat-thread-main">
        <span className="chat-thread-top">
          <b>{thread.title || t('chat.untitled')}</b>
          <small>
            {thread.last_message_at
              ? fmtChina(thread.last_message_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
              : ''}
          </small>
        </span>
        <span className="chat-thread-bottom">
          <span className="chat-prev">{thread.last_message || t('chat.greeting')}</span>
          <span className="chat-thread-tags">
            {thread.mute_all && <MsIcon name="volume_off" size={14} />}
            {thread.notify_off && <MsIcon name="notifications_off" size={14} />}
            {thread.pinned && <MsIcon name="star" size={14} />}
            {thread.unread > 0 && <i className="chat-unread">{thread.unread > 99 ? '99+' : thread.unread}</i>}
          </span>
        </span>
      </span>
    </button>
  );
}

function MessageArea({
  messages,
  uid,
  detail,
  highlight,
  jumpId,
  loading,
  hasMore,
  olderLoading,
  peerRead,
  onLoadOlder,
  onReply,
  onRecall,
  onDelete,
  onPreviewImage,
  onOpenInfo,
}) {
  const { t } = useI18n();
  const boxRef = useRef(null);
  const bottomRef = useRef(null);
  const stickRef = useRef(true);
  const lastIdRef = useRef(null);
  // 换会话 / 首次进入时：等这一轮消息**渲染完**再把列表落到底部。
  // 原来是在 detail.id 变化的 useEffect 里直接 `el.scrollTop = el.scrollHeight`，
  // 那一刻新消息还没渲染（列表还是空的，scrollHeight == clientHeight），等于没滚；
  // 等消息到了又因为 lastIdRef 是 null 被当成"首批"提前 return，于是停在顶部（站长 2026-10-01 反馈）。
  const pendingBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // 切换会话：标记"待落底"，并把列表先挪到底（消息还没来时至少别停在最上面）
  useEffect(() => {
    stickRef.current = true;
    pendingBottomRef.current = true;
    setShowJump(false);
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    lastIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // 新消息：贴底时自动跟随；自己发的消息一定滚到底；否则提示「回到最新」
  useEffect(() => {
    const last = messages.length ? messages[messages.length - 1] : null;
    if (!last || last.id === lastIdRef.current) return;
    const first = lastIdRef.current === null;
    lastIdRef.current = last.id;
    // 首次拿到这个会话的消息（或刚切过来）：直接落到底，不要动画
    if (first || pendingBottomRef.current) {
      pendingBottomRef.current = false;
      const el = boxRef.current;
      const jump = () => {
        const box = boxRef.current;
        if (!box) return;
        stickRef.current = true;
        box.scrollTop = box.scrollHeight;
      };
      jump();
      // 图片/表情是异步撑高的，再补两次，免得落底后又被它们顶上去
      requestAnimationFrame(jump);
      window.setTimeout(jump, 120);
      window.setTimeout(jump, 400);
      return;
    }
    const mine = last.sender_id === uid;
    if (mine) stickRef.current = true;
    if (stickRef.current) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    } else {
      setShowJump(true);
    }
  }, [messages, uid]);

  useEffect(() => {
    if (!jumpId) return;
    const el = document.getElementById(`chat-msg-${jumpId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('chat-flash');
    setTimeout(() => el.classList.remove('chat-flash'), 1600);
  }, [jumpId, messages]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = near;
    if (near) setShowJump(false);
    if (el.scrollTop < 60 && hasMore && !olderLoading) onLoadOlder();
  };

  const isManager = Boolean(detail?.can_manage);

  return (
    <div className="chat-messages thin-scroll" ref={boxRef} onScroll={onScroll}>
      {loading && <div className="chat-empty-hint">{t('chat.loadingMessages')}</div>}
      {!loading && hasMore && (
        <div className="chat-more">
          <button type="button" onClick={onLoadOlder} disabled={olderLoading}>
            {olderLoading ? t('common.loading') : t('chat.loadEarlier')}
          </button>
        </div>
      )}
      {!loading && messages.length === 0 && <div className="chat-empty-hint">{t('chat.firstMessage')}</div>}
      {!loading &&
        messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const mine = m.sender_id === uid;
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const grouped =
            !newDay &&
            prev &&
            !prev.recalled &&
            !m.recalled &&
            prev.sender_id === m.sender_id &&
            parseTs(m.created_at) - parseTs(prev.created_at) < GROUP_GAP_MS;
          const recallable = mine && !m.recalled && Date.now() - parseTs(m.created_at) < RECALL_MS;
          return (
            <div key={m.id} id={`chat-msg-${m.id}`}>
              {newDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
              <MessageItem
                msg={m}
                mine={mine}
                isGroup={detail?.kind === 'group'}
                grouped={grouped}
                canManage={isManager}
                recallable={recallable}
                highlight={highlight}
                peerRead={peerRead}
                onReply={() => onReply(m)}
                onRecall={() => onRecall(m.id)}
                onDelete={() => onDelete(m.id)}
                onPreviewImage={onPreviewImage}
                onMentionClick={onOpenInfo}
              />
            </div>
          );
        })}
      <div ref={bottomRef} />
      {showJump && (
        <button
          type="button"
          className="chat-jump"
          onClick={() => {
            stickRef.current = true;
            setShowJump(false);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
        >
          <MsIcon name="arrow_downward" size={18} /> {t('chat.backToLatest')}
        </button>
      )}
    </div>
  );
}

export default function Chat() {
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const chat = useChat({ user, token });

  const [filter, setFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState('');
  const [jumpId, setJumpId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const bootRef = useRef(null);

  const bootKey = params.get('thread') || params.get('room') || params.get('to');

  // 深链：/chat?thread=<会话 id>（通知、工作室讨论区）或 /chat?to=<用户 uid>
  useEffect(() => {
    if (!user || !bootKey || bootRef.current === bootKey) return;
    bootRef.current = bootKey;
    const tid = params.get('thread') || params.get('room');
    const to = params.get('to');
    if (tid) chat.openThread(Number(tid), { silent: true });
    else if (to) chat.openDm(to);
    setParams({}, { replace: true });
    // 消费完就把标记清掉：以前 bootRef.current 从复位，导致「点通知打开群 5 → 回列表 →
    // 再点同样指向群 5 的通知」第二次毫无反应（组件没卸载、key 还是 "5"）。
    const clear = setTimeout(() => { bootRef.current = null; }, 0);
    return () => clearTimeout(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootKey, user]);

  useEffect(() => {
    setReplyTo(null);
    setHighlight('');
    setJumpId(null);
  }, [chat.activeId]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return chat.threads.filter((th) => {
      if (filter !== 'all' && th.kind !== filter) return false;
      if (!kw) return true;
      return (th.title || '').toLowerCase().includes(kw) || (th.last_message || '').toLowerCase().includes(kw);
    });
  }, [chat.threads, filter, keyword]);

  const typingName = chat.activeId ? chat.typing[chat.activeId]?.name : null;

  const onReply = useCallback((m) => {
    setReplyTo({
      id: m.id,
      sender_name: m.sender?.display_name || m.sender?.username || t('chat.peer'),
      preview: m.image_url ? t('chat.imageTag') : (m.content || '').slice(0, 60),
    });
  }, [t]);

  const subtitle = (() => {
    if (!chat.detail) return '';
    if (typingName) return t('chat.typing', { name: typingName });
    if (chat.detail.kind === 'group') return `${t('chat.memberCount', { n: chat.detail.member_count })}${chat.detail.mute_all ? t('chat.muteAllSuffix') : ''}`;
    // 私聊这里原来显示「在线 / 离线」，但那个 online 其实是【我自己】这条 socket 的
    // 连接状态，跟对方毫无关系（服务端也根本没有在线状态追踪），恒为「在线」纯属误导。
    // 改成有依据的信息：最后一条消息的时间。
    return chat.detail.last_message_at ? t('chat.lastMessage', { time: formatTime(chat.detail.last_message_at) }) : t('chat.neverChatted');
  })();

  const sendText = async (text) => {
    // ⚠️ 引用要一起发出去：第二个参数是「要引用的消息 id」。
    // 原来这里只传 text，引用就被丢了 —— 输入框上方显示着引用条、发出去却是普通消息。
    const ok = await chat.sendText(text, replyTo?.id);
    if (ok) setReplyTo(null);
    return ok;
  };

  return (
    <div className="page-pad">
      <div className={`chat-page${chat.activeId ? ' has-active' : ''}`}>
        {/* ---------------- 左栏：会话列表 ---------------- */}
        <aside className="chat-side m3-card">
          <div className="chat-side-head">
            <b className="chat-side-title">{t('nav.chat')}</b>
            <FilledButton onClick={() => setNewOpen(true)}>
              <MsIcon slot="icon" name="add" size={18} />
              {t('chat.newThread')}
            </FilledButton>
          </div>
          <OutlinedTextField label={t('chat.searchThreads')} value={keyword} onInput={(e) => setKeyword(e.target.value)} style={{ width: '100%' }}>
            <MsIcon slot="leading-icon" name="search" size={20} />
          </OutlinedTextField>
          <div className="chat-tabbar">
            {[
              ['all', 'common.all'],
              ['dm', 'chat.dm'],
              ['group', 'chat.group'],
            ].map(([k, labelKey]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {t(labelKey)}
              </button>
            ))}
          </div>
          <div className="chat-thread-list thin-scroll">
            {chat.threadsLoading && <div className="chat-empty-hint">{t('common.loading')}</div>}
            {!chat.threadsLoading && filtered.length === 0 && (
              <div className="chat-empty-hint">
                {chat.threads.length === 0 ? t('chat.noThreads') : t('chat.noMatchingThreads')}
              </div>
            )}
            {filtered.map((th) => (
              <ThreadRow key={th.id} thread={th} active={th.id === chat.activeId} onClick={() => chat.openThread(th.id)} />
            ))}
          </div>
        </aside>

        {/* ---------------- 右栏：会话内容 ---------------- */}
        <section className="chat-main m3-card">
          {!chat.detail ? (
            <div className="chat-placeholder">
              <MsIcon name="forum" size={64} />
              <b>{chat.messagesLoading ? t('chat.opening') : t('chat.pickThread')}</b>
              <span className="muted">{t('chat.pickThreadHint')}</span>
              <FilledButton onClick={() => setNewOpen(true)}>
                <MsIcon slot="icon" name="add" size={18} />
                {t('chat.newThread')}
              </FilledButton>
            </div>
          ) : (
            <>
              <header className="chat-head">
                <IconButton className="chat-back" onClick={chat.closeActive} aria-label={t('chat.backToList')}>
                  <MsIcon name="arrow_back" size={22} />
                </IconButton>
                <button type="button" className="chat-head-main" onClick={() => setInfoOpen(true)}>
                  <ThreadAvatar thread={chat.detail} size={40} />
                  <span className="chat-head-text">
                    <b>{chat.detail.title || displayName(chat.detail.peer) || t('chat.threadFallback')}</b>
                    <small>{subtitle}</small>
                  </span>
                </button>
                <IconButton onClick={() => setSearchOpen(true)} aria-label={t('chat.searchMessages')} title={t('chat.searchMessages')}>
                  <MsIcon name="search" size={22} />
                </IconButton>
                <IconButton onClick={() => setMediaOpen(true)} aria-label={t('chat.media')} title={t('chat.media')}>
                  <MsIcon name="image" size={22} />
                </IconButton>
                <IconButton id="chat-more-anchor" onClick={() => setMenuOpen((v) => !v)} aria-label={t('common.more')} title={t('common.more')}>
                  <MsIcon name="more_vert" size={22} />
                </IconButton>
                <Menu anchor="chat-more-anchor" align="right" open={menuOpen} onClosed={() => setMenuOpen(false)}>
                  <MenuItem onClick={() => setInfoOpen(true)}>
                    <span className="row" style={{ gap: 10 }}>
                      <MsIcon name="info" size={18} /> {chat.detail.kind === 'group' ? t('chat.groupInfoManage') : t('chat.threadInfo')}
                    </span>
                  </MenuItem>
                  <MenuItem onClick={() => chat.setMySettings({ pinned: !chat.detail.pinned })}>
                    <span className="row" style={{ gap: 10 }}>
                      <MsIcon name="star" size={18} /> {chat.detail.pinned ? t('chat.unpin') : t('chat.pin')}
                    </span>
                  </MenuItem>
                  <MenuItem onClick={() => chat.setMySettings({ notify_off: !chat.detail.notify_off })}>
                    <span className="row" style={{ gap: 10 }}>
                      <MsIcon name="notifications_off" size={18} /> {chat.detail.notify_off ? t('chat.unmute') : t('chat.mute')}
                    </span>
                  </MenuItem>
                  {chat.detail.kind === 'group' && chat.detail.can_manage && (
                    <>
                      <Divider />
                      <MenuItem onClick={() => chat.toggleMuteAll(!chat.detail.mute_all)}>
                        <span className="row" style={{ gap: 10 }}>
                          <MsIcon name="volume_off" size={18} /> {chat.detail.mute_all ? t('chat.unmuteAll') : t('chat.muteAll')}
                        </span>
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </header>

              {chat.detail.kind === 'group' && chat.detail.announcement && (
                <div className="chat-announce">
                  <MsIcon name="campaign" size={16} />
                  <span>{chat.detail.announcement}</span>
                </div>
              )}

              <MessageArea
                messages={chat.messages}
                uid={chat.uid}
                detail={chat.detail}
                highlight={highlight}
                jumpId={jumpId}
                loading={chat.messagesLoading}
                hasMore={chat.hasMore}
                olderLoading={chat.olderLoading}
                peerRead={chat.peerRead}
                onLoadOlder={chat.loadOlder}
                onReply={onReply}
                onRecall={chat.recallMessage}
                onDelete={chat.deleteMessage}
                onPreviewImage={setPreviewSrc}
                onOpenInfo={() => setInfoOpen(true)}
              />

              <Composer
                thread={chat.detail}
                myUid={chat.uid}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSendText={sendText}
                onSendImage={chat.sendImage}
                onTyping={chat.sendTyping}
              />
            </>
          )}
        </section>
      </div>

      <NewChatDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onOpenDm={chat.openDm}
        onCreateGroup={chat.createGroup}
        onJoinGroup={chat.joinGroup}
        searchUsers={chat.searchUsers}
        discoverGroups={chat.discoverGroups}
      />

      <GroupInfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        thread={chat.detail}
        myUid={chat.uid}
        onSaveInfo={chat.updateThreadInfo}
        onMySettings={chat.setMySettings}
        onToggleMuteAll={chat.toggleMuteAll}
        onUpdateMember={chat.updateMember}
        onKickMember={chat.kickMember}
        onLeave={() => {
          setInfoOpen(false);
          chat.leaveGroup();
        }}
        onDissolve={() => {
          setInfoOpen(false);
          chat.dissolveGroup();
        }}
        onBlock={chat.blockUser}
      />

      <MediaDialog open={mediaOpen} onClose={() => setMediaOpen(false)} onLoad={chat.loadMedia} onPreview={setPreviewSrc} />

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={chat.searchMessages}
        onJump={async (id) => {
          // 目标可能比当前这一页更早：先把历史翻出来再滚过去。
          // 以前只 setJumpId，而滚动逻辑要求 DOM 里已经有 #chat-msg-<id>，
          // 于是「点了搜索结果什么都不发生」，连报错都没有。
          const found = await chat.loadUntil(id);
          if (!found) {
            toast(t('chat.jumpNotFound'), 'error');
            return;
          }
          setJumpId(id);
        }}
      />

      <Lightbox src={previewSrc} onClose={() => setPreviewSrc('')} />
    </div>
  );
}
