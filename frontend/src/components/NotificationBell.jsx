import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconButton } from '../ui';
import client from '../api/client';
import { getSharedSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

export default function NotificationBell() {
  const { user, token } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [count, setCount] = useState(0);

  const loadCount = () => {
    if (!user) return;
    client.get('/notifications/unread_count').then((r) => setCount(r.data.count)).catch(() => {});
  };

  useEffect(() => {
    if (!user) return;
    loadCount();
    const t = setInterval(loadCount, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 离开通知中心页面时刷新角标（进入后可能标记已读）
  useEffect(() => {
    if (!user || location.pathname === '/notifications') return;
    loadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, user]);

  // 实时推送：收到新通知时立即更新角标（与聊天共用同一条 Socket 连接）
  useEffect(() => {
    if (!token) return undefined;
    const socket = getSharedSocket(token);
    if (!socket) return undefined;
    const onNotification = () => setCount((c) => c + 1);
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [token]);

  if (!user) return null;

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <IconButton onClick={() => navigate('/notifications')} aria-label={t('notify.label')}>
        <Bell size={22} />
      </IconButton>
      {count > 0 && <span className="m3-notif-badge">{count > 99 ? '99+' : count}</span>}
    </span>
  );
}
