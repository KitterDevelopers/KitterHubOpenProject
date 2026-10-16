import { NavLink } from 'react-router-dom';
import { Home, Compass, MessagesSquare, MessageCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

const ITEMS = [
  { to: '/', key: 'nav.home', icon: Home, end: true },
  { to: '/discover', key: 'nav.discover', icon: Compass },
  { to: '/forum', key: 'nav.forum', icon: MessagesSquare },
  { to: '/chat', key: 'nav.chat', icon: MessageCircle, auth: true },
];

export default function BottomNav() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <nav className="m3-bottom-nav hide-desktop">
      {ITEMS.filter((i) => !i.auth || user).map(({ to, key, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon size={22} />
          <span>{t(key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
