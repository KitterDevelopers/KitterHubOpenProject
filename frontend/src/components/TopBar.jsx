import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Sun, Moon, Monitor, Menu as MenuIcon, LogOut, UserRound, Star, PencilLine, House, Search, ShieldCheck, Heart, Bell, Clock, MessageCircle, BadgeCheck, Settings, Gavel } from 'lucide-react';
import { IconButton, FilledButton, TextButton, Menu, MenuItem, Divider } from '../ui';
import { useAuth } from '../context/AuthContext';
import { useThemeMode } from '../context/ThemeModeContext';
import { useI18n } from '../i18n';
import UserAvatar from './Avatar';
import KitterLogo from './KitterLogo';
import useBrandColors from './useBrandColors';
import NotificationBell from './NotificationBell';

const NAV = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/discover', key: 'nav.discover' },
  { to: '/forum', key: 'nav.forum' },
  { to: '/chat', key: 'nav.chat' },
  { to: '/studios', key: 'nav.studios' },
  { to: '/xp', key: 'xp.title' },
];

function ItemRow({ icon: Icon, children }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <Icon size={18} />
      <span>{children}</span>
    </span>
  );
}

export default function TopBar() {
  const { user, logout } = useAuth();
  const { mode, cycle } = useThemeMode();
  const { t, isEn } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // 品牌区（LOGO + 「KitterHub」文字）共用一套颜色：深色主题下会取更深的一档，避免发白
  const [brandRef, brandColors] = useBrandColors();
  const navRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, visible: false });

  // 未实名账号：顶栏给一个明显的「去验证」入口
  const verifyLocked = !!(user && user.verify_state && user.verify_state !== 'ok');
  // 英文模式不开放创作，顶栏不再展示创作入口（路由守卫兜底）
  const showCreate = !!user && !isEn && !verifyLocked;

  // 测量当前激活导航项位置，驱动高亮滑块滑动
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => {
      const active = nav.querySelector('.navlink.active');
      if (!active) return;
      const navRect = nav.getBoundingClientRect();
      const elRect = active.getBoundingClientRect();
      setSlider({ left: elRect.left - navRect.left, width: elRect.width, visible: true });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [location.pathname]);

  // MD3 悬浮 App Bar：页面滚动后浮起（elevation）
  // 同时把「是否已滚动」写到 <html data-scrolled>：顶栏那层垫底磨砂（.m3-nav-frost）
  // 只在滚动后才需要（它本来是压住从顶栏下面滚过去的内容）；页面在最顶上时它下面没东西，
  // 却会在背景图上压出一条浅带（站长 2026-10-01：「顶部那条白印还在」）→ 用这个开关关掉。
  useEffect(() => {
    const onScroll = () => {
      const on = window.scrollY > 4;
      setScrolled(on);
      const root = document.documentElement;
      const next = on ? 'on' : 'off';
      if (root.getAttribute('data-scrolled') !== next) root.setAttribute('data-scrolled', next);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/');
  };
  const go = (to) => {
    setMenuOpen(false);
    setMobileOpen(false);
    navigate(to);
  };

  return (
    <header className={`m3-topbar${scrolled ? ' m3-topbar--scrolled' : ''}`}>
      <Link
        to="/"
        ref={brandRef}
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 18, color: brandColors.text || 'var(--md-sys-color-primary)', whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {/* 用内联 SVG 版（KitterLogo）：能跟着自定义主题色走；位图只留给 favicon / 分享海报 */}
        <KitterLogo size={26} />
        <span className="m3-brand-text">KitterHub</span>
      </Link>

      <nav ref={navRef} className="m3-nav hide-mobile" aria-label={t('topbar.mainNav')}>
        {/* 滑动高亮滑块：随选中项在按钮间非线性滑动 */}
        <span
          className="m3-nav-slider"
          style={{
            transform: `translateX(${slider.left}px)`,
            width: slider.width,
            opacity: slider.visible ? 1 : 0,
          }}
        />
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
            {t(n.key)}
          </NavLink>
        ))}
      </nav>

      <span className="spacer" />

      <IconButton onClick={() => navigate('/search')} aria-label={t('topbar.search')}>
        <Search size={22} />
      </IconButton>

      <IconButton onClick={cycle} aria-label={t('topbar.theme')}>
        {mode === 'light' ? <Moon size={22} /> : mode === 'dark' ? <Sun size={22} /> : <Monitor size={22} />}
      </IconButton>

      <NotificationBell />

      {user ? (
        <>
          {verifyLocked && (
            <span className="hide-mobile">
              <FilledButton onClick={() => navigate('/verify')}>
                <span slot="icon"><BadgeCheck size={18} /></span>
                {t('verify.goVerify')}
              </FilledButton>
            </span>
          )}
          {showCreate && (
            <span className="hide-mobile">
              {/* 圆角由 .m3-topbar 作用域统一覆盖成 --radius（见 global.css） */}
              <FilledButton onClick={() => navigate('/create')}>
                <span slot="icon"><PencilLine size={18} /></span>
                {t('topbar.createCenter')}
              </FilledButton>
            </span>
          )}
          <IconButton id="user-menu-anchor" className="avatar-icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={t('topbar.userMenu')}>
            <UserAvatar user={user} size={34} />
          </IconButton>
          <Menu anchor="user-menu-anchor" align="right" open={menuOpen} onClosed={() => setMenuOpen(false)}>
            <MenuItem onClick={() => go(`/users/${user.uid}`)}><ItemRow icon={UserRound}>{t('topbar.profile')}</ItemRow></MenuItem>
            <MenuItem onClick={() => go('/me')}><ItemRow icon={Heart}>{t('topbar.me')}</ItemRow></MenuItem>
            <MenuItem onClick={() => go('/notifications')}><ItemRow icon={Bell}>{t('topbar.notifications')}</ItemRow></MenuItem>
            <MenuItem onClick={() => go('/favorites')}><ItemRow icon={Star}>{t('topbar.favorites')}</ItemRow></MenuItem>
            <MenuItem onClick={() => go('/history')}><ItemRow icon={Clock}>{t('topbar.history')}</ItemRow></MenuItem>
            {verifyLocked && (
              <MenuItem onClick={() => go('/verify')}><ItemRow icon={BadgeCheck}>{t('verify.goVerify')}</ItemRow></MenuItem>
            )}
            {!isEn && !verifyLocked && (
              <MenuItem onClick={() => go('/studios/new')}><ItemRow icon={House}>{t('topbar.newStudio')}</ItemRow></MenuItem>
            )}
            {user.role === 'admin' && (
              <MenuItem onClick={() => go('/admin')}><ItemRow icon={ShieldCheck}>{t('topbar.admin')}</ItemRow></MenuItem>
            )}
            {/* 风纪委员会（2026-10-12 重做）：先考试（100 题库抽 20 题）→ 申请 → 管理员审批 */}
            <MenuItem onClick={() => go('/committee')}><ItemRow icon={Gavel}>{t('topbar.committee')}</ItemRow></MenuItem>
            {/* 设置：页面里含「账号设置 / 界面设置」两个页签，所以这里就叫「设置」，不用「账号设置」 */}
            <MenuItem onClick={() => go('/settings')}><ItemRow icon={Settings}>{t('topbar.settings')}</ItemRow></MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}><ItemRow icon={LogOut}>{t('common.logout')}</ItemRow></MenuItem>
          </Menu>
        </>
      ) : (
        <>
          <FilledButton onClick={() => navigate('/login')}>{t('common.login')}</FilledButton>
        </>
      )}

      <IconButton id="mobile-menu-anchor" className="hide-desktop" onClick={() => setMobileOpen(!mobileOpen)} aria-label={t('topbar.menu')}>
        <MenuIcon size={22} />
      </IconButton>
      <Menu anchor="mobile-menu-anchor" align="right" open={mobileOpen} onClosed={() => setMobileOpen(false)}>
        {NAV.map((n) => (
          <MenuItem key={n.to} onClick={() => go(n.to)}>{t(n.key)}</MenuItem>
        ))}
        {showCreate && <MenuItem onClick={() => go('/create')}><ItemRow icon={PencilLine}>{t('topbar.createCenter')}</ItemRow></MenuItem>}
        {verifyLocked && <MenuItem onClick={() => go('/verify')}><ItemRow icon={BadgeCheck}>{t('verify.goVerify')}</ItemRow></MenuItem>}
        {user && <MenuItem onClick={() => go('/chat')}><ItemRow icon={MessageCircle}>{t('nav.chat')}</ItemRow></MenuItem>}
      </Menu>
    </header>
  );
}
