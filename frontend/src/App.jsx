import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { FilledButton, TextButton } from './ui';
import { AuthProvider } from './context/AuthContext';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import Footer from './components/Footer';
import ToastHost from './components/Toast';
import BackToTop from './components/BackToTop';
import ProtectedRoute from './components/ProtectedRoute';
import CreationGate from './components/CreationGate';
import RestReminder from './components/RestReminder';
import TreatyDialog from './components/TreatyDialog';
import { useI18n } from './i18n';
import { readPageTitleName, APPEARANCE_EVENT } from './appearance';
import Home from './pages/Home';
import RulesCenter from './pages/RulesCenter';
import Event from './pages/Event';
import MapLighting from './pages/MapLighting';
import LegalDoc from './pages/LegalDoc';
import AdminApp from './pages/admin/AdminApp';
import { ConfirmProvider } from './pages/admin/ui';   // 后台统一的二次确认弹窗
import Committee from './pages/Committee';
import CommitteeExam from './pages/CommitteeExam';
import Pages from './pages/Pages';
import AppearanceTab from './pages/settings/AppearanceTab';
import Login from './pages/Login';
import BannedPage from './pages/BannedPage';
import Verify from './pages/Verify';
import Discover from './pages/Discover';
import WorkDetail from './pages/work-detail';
import WorkCreate from './pages/work-form';
import WorkEdit from './pages/WorkEdit';
import Forum from './pages/Forum';
import PostDetail from './pages/PostDetail';
import PostCreate from './pages/PostCreate';
import PostEdit from './pages/PostEdit';
import Profile from './pages/Profile';
import Studios from './pages/Studios';
import StudioDetail from './pages/StudioDetail';
import StudioCreate from './pages/StudioCreate';
import Favorites from './pages/Favorites';
import Search from './pages/Search';
import CreateCenter from './pages/CreateCenter';
import Me from './pages/Me';
import Notifications from './pages/Notifications';
import History from './pages/History';
import Later from './pages/Later';
import Settings from './pages/Settings';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import Help from './pages/Help';
import Feedback from './pages/Feedback';
import Followers from './pages/Followers';
import MyReports from './pages/MyReports';
import { SeriesDetail } from './pages/Series';
import TopicPage from './pages/TopicPage';
import XpCenter from './pages/XpCenter';
import Chat from './pages/Chat';

// [路径前缀, 标题词条 key]（顺序敏感：更具体的放前面）
const TITLE_MAP = [
  ['/xp', 'title.xp'],
  ['/pages', 'title.pages'],
  ['/committee', 'title.committee'],
  ['/rules', 'title.rules'],
  ['/contest/lit-china', 'maplit.title'],
  ['/login', 'title.login'], ['/verify', 'title.verify'], ['/discover', 'title.discover'],
  ['/forum', 'title.forum'], ['/chat', 'title.chat'], ['/studios', 'title.studios'],
  ['/rankings', 'title.rankings'], ['/favorites', 'title.favorites'], ['/history', 'title.history'],
  ['/notifications', 'title.notifications'], ['/search', 'title.search'], ['/admin', 'title.admin'],
  ['/create', 'title.create'], ['/me', 'title.me'], ['/settings', 'title.settings'],
  ['/collections', 'title.collections'], ['/help', 'title.help'], ['/feedback', 'title.feedback'],
];

function TitleManager() {
  const { pathname } = useLocation();
  const { t } = useI18n();
  // 页面名是否进标题：本机偏好，默认关（只显示 KitterHub）
  const [withName, setWithName] = useState(readPageTitleName);
  useEffect(() => {
    const sync = () => setWithName(readPageTitleName());
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  useEffect(() => {
    let pageKey = '';
    for (const [prefix, key] of TITLE_MAP) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) { pageKey = key; break; }
    }
    if (pathname.startsWith('/works/') && !pathname.endsWith('/edit')) pageKey = 'title.work';
    else if (pathname.startsWith('/posts/')) pageKey = 'title.post';
    else if (pathname.startsWith('/users/')) pageKey = 'title.profile';
    document.title = withName && pageKey ? `${t(pageKey)} - KitterHub` : 'KitterHub';
  }, [pathname, t, withName]);
  return null;
}

// 切换页面回到顶部：避免上一个页面的滚动位置被带到新页面
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  return null;
}

// 排行临时下架页
function RankingsClosed() {
  const { t } = useI18n();
  return (
    <div className="page-pad" style={{ textAlign: 'center', paddingTop: 90 }}>
      <div className="m3-card m3-card--filled" style={{ maxWidth: 420, margin: '0 auto', padding: '32px 24px' }}>
        <h2 style={{ margin: '0 0 10px', fontWeight: 800 }}>{t('app.rankingsClosedTitle')}</h2>
        <p className="muted" style={{ lineHeight: 1.8 }}>{t('app.rankingsClosedDesc')}</p>
      </div>
    </div>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page-pad" style={{ textAlign: 'center', paddingTop: 60 }}>
      <svg viewBox="0 0 200 160" width="160" height="128" style={{ display: 'inline-block' }}>
        <circle cx="60" cy="90" r="46" fill="#ffb74d" />
        <circle cx="140" cy="90" r="46" fill="#4c6ef5" opacity="0.85" />
        <path d="M20 60 L60 30 L100 60" fill="none" stroke="#e65100" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M100 60 L140 30 L180 60" fill="none" stroke="#1d4ed8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="44" cy="80" r="6" fill="#fff" /><circle cx="76" cy="80" r="6" fill="#fff" />
        <circle cx="124" cy="80" r="6" fill="#fff" /><circle cx="156" cy="80" r="6" fill="#fff" />
        <path d="M48 106 q12 12 24 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M128 106 q12 12 24 0" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M30 130 q10 16 26 12" stroke="#5c3d2e" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M170 130 q-10 16 -26 12" stroke="#5c3d2e" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
      <h2 style={{ fontWeight: 800, margin: '8px 0 4px' }}>{t('app.notFoundTitle')}</h2>
      <p className="muted">{t('app.notFoundDesc')}</p>
      <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 16 }}>
        <FilledButton onClick={() => { window.location.href = '/'; }}>{t('app.backHome')}</FilledButton>
        <TextButton onClick={() => window.history.back()}>{t('app.backPrev')}</TextButton>
      </div>
    </div>
  );
}

/* ---- 维护模式（2026-10-15 站长要求：重构期间给访客提示）----
   开关：服务器上存在 /maintenance.flag 就显示提示，删掉即恢复 —— 不用重新构建。
   放行 /admin，否则自己在重构期间进不去后台。 */
function MaintenanceNotice() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 16px' }}>
        <div className="m3-card" style={{ maxWidth: 520, width: '100%', padding: '40px 32px', textAlign: 'center' }}>
          <img src="/kitter-logo.png" alt="KitterHub" style={{ height: 46, marginBottom: 22 }} />
          <h1 style={{ fontSize: 22, margin: '0 0 14px', fontWeight: 700 }}>正在维护</h1>
          <p style={{ lineHeight: 1.9, margin: '0 0 12px' }}>
            我们正在重构后台系统，期间网站暂时无法访问。
          </p>
          <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.9 }}>
            你的作品与帖子数据完好保留，重构完成后立即恢复。
          </p>
        </div>
      </div>
      <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '18px 16px 26px' }}>
        KitterHub - 一起用代码创造世界
      </div>
    </div>
  );
}

function MaintenanceGate({ children }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      if (window.location.pathname.indexOf('/admin') === 0) return;   // 后台放行
    } catch (e) { /* 忽略 */ }
    /* 注意：不能用 r.ok 判断 —— 这个站点任何不存在的路径都会回落成 index.html（HTTP 200），
       所以必须校验文件内容本身是不是 "ON"。 */
    fetch('/maintenance.flag', { cache: 'no-store' })
      .then((r) => r.text())
      .then((t) => { if (String(t).trim() === 'ON') setOn(true); })
      .catch(() => {});
  }, []);
  return on ? <MaintenanceNotice /> : children;
}

export default function App() {
  return (
    <MaintenanceGate>
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <TitleManager />
        <div className="m3-nav-frost" aria-hidden="true" />
        <TopBar />
        <ToastHost />
        <BackToTop />
        <RestReminder />
        <TreatyDialog />
        <main className="container" style={{ minHeight: 'calc(100vh - 64px)' }}>
          <Routes>
        <Route path="/rules" element={<RulesCenter />} />
        <Route path="/rules/:key" element={<LegalDoc />} />
        <Route path="/event/:key" element={<Event />} />
        <Route path="/contest/lit-china" element={<MapLighting />} />
        <Route path="/disclaimer" element={<LegalDoc standalone="disclaimer" />} />
        <Route path="/admin/new" element={<ConfirmProvider><AdminApp /></ConfirmProvider>} />
        {/* 风纪委员会（2026-10-12 重做）：审议库 + 考试与申请 */}
        <Route path="/committee" element={<Committee />} />
        <Route path="/committee/exam" element={<CommitteeExam />} />
        <Route path="/pages" element={<Pages />} />
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Navigate to="/login?mode=signup" replace />} />
            <Route path="/banned" element={<BannedPage />} />
            <Route path="/verify" element={<ProtectedRoute><Verify /></ProtectedRoute>} />
            <Route path="/discover" element={<Discover />} />
            {/* 创作 / 编辑类页面统一走 CreationGate：英文模式与未实名账号都会被挡下 */}
            <Route path="/works/new" element={<CreationGate><WorkCreate /></CreationGate>} />
            <Route path="/works/:id/edit" element={<CreationGate><WorkEdit /></CreationGate>} />
            <Route path="/works/:id" element={<WorkDetail />} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/posts/new" element={<CreationGate><PostCreate /></CreationGate>} />
            <Route path="/posts/:id/edit" element={<CreationGate><PostEdit /></CreationGate>} />
            <Route path="/posts/:id" element={<PostDetail />} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/studios" element={<Studios />} />
            <Route path="/studios/new" element={<CreationGate><StudioCreate /></CreationGate>} />
            <Route path="/studios/:id" element={<StudioDetail />} />
            <Route path="/rankings" element={<RankingsClosed />} />
            <Route path="/rankings/week" element={<RankingsClosed />} />
            <Route path="/favorites" element={<ProtectedRoute><Favorites /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
            <Route path="/later" element={<ProtectedRoute><Later /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
            <Route path="/search" element={<Search />} />
            <Route path="/admin" element={<ProtectedRoute><ConfirmProvider><AdminApp /></ConfirmProvider></ProtectedRoute>} />
            <Route path="/create" element={<CreationGate><CreateCenter /></CreationGate>} />
            <Route path="/me" element={<ProtectedRoute><Me /></ProtectedRoute>} />
            <Route path="/my-reports" element={<ProtectedRoute><MyReports /></ProtectedRoute>} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/topics/:topic" element={<TopicPage />} />
            <Route path="/xp" element={<ProtectedRoute><XpCenter /></ProtectedRoute>} />
            <Route path="/xp-detail" element={<Navigate to="/xp" replace />} />
            <Route path="/settings/*" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/collections" element={<ProtectedRoute><Collections /></ProtectedRoute>} />
            <Route path="/collections/:id" element={<CollectionDetail />} />
            <Route path="/help" element={<Help />} />
            <Route path="/feedback" element={<Feedback />} />
            <Route path="/users/:id" element={<Profile />} />
            <Route path="/users/:id/followers" element={<Followers />} />
            <Route path="/users/:id/following" element={<Followers />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <BottomNav />
        <Footer />
      </BrowserRouter>
    </AuthProvider>
    </MaintenanceGate>
  );
}
