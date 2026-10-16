/**
 * 设置页外壳：只负责「分两栏 + 导航 + 把当前栏写进 URL」，具体内容在两个 tab 里。
 *
 * 为什么要分：
 *   以前是一张 666 行、12 张卡片平铺的长页，页面标题叫「账号设置」，里面却混着
 *   「界面设置」卡、语言和明暗主题又都不在这页 —— 用户根本不知道什么该去哪找。
 *
 * 分栏判据（唯一一条）：
 * - 账号设置：**跟着账号走**（存服务器 / 影响登录 / 影响别人看到什么）→ 换台电脑登录依然在
 * - 界面设置：**只影响我自己在这台设备看到什么**（存 localStorage）→ 换台电脑恢复默认
 *
 * ⚠️ 所以「显示封面 / 显示等级徽章 / 公开性别」属于**账号设置**，不是界面设置 ——
 *    它们决定的是「别人在你主页上看到什么」，并且存在服务器上。
 *
 * 用真实路由（而不是组件内 state）是为了能深链：
 * - 「去绑定编程猫账号」→ /settings#bind-codemao
 * - GitHub 授权回跳 → /settings?gh=...
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, PrimaryTab } from '../ui';
import { UserRound, Palette } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import { useI18n } from '../i18n';
import AccountTab from './settings/AccountTab';
import AppearanceTab from './settings/AppearanceTab';

const TAB_ACCOUNT = '/settings';
const TAB_APPEARANCE = '/settings/appearance';

export default function Settings() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname, hash } = useLocation();

  const isAppearance = pathname.replace(/\/+$/, '') === TAB_APPEARANCE;
  const tab = isAppearance ? 1 : 0;

  // 深链锚点：#bind-codemao 之类。tab 切换后内容才挂载，所以要等一帧再滚。
  useEffect(() => {
    if (!hash || isAppearance) return undefined;
    const id = hash.slice(1);
    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    }, 60);
    return () => clearTimeout(timer);
  }, [hash, isAppearance]);

  return (
    /* ⚠️ 这里曾经是 maxWidth: 640 —— 两个 tab 现在都是「分组卡 + 设置行」的单列版式
       （账号设置 .acct-page / 界面设置 .appr-page，各 900px 居中，见 global.css）。
       外壳若还压着 640，卡片里的设置行就会被挤着换行，所以列宽交给两个 tab 自己管。 */
    <div className="page-pad">
      <h1 style={{ margin: '0 0 4px', fontWeight: 800, fontSize: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <MsIcon name={isAppearance ? 'palette' : 'settings'} size={22} />{' '}
        {isAppearance ? t('settings.appearanceTitle') : t('settings.title')}
      </h1>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {isAppearance ? t('settings.appearanceSubtitle') : t('settings.accountSubtitle')}
      </div>

      <Tabs>
        <PrimaryTab selected={tab === 0} onClick={() => navigate(TAB_ACCOUNT)}>
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <UserRound size={15} /> {t('settings.tabAccount')}
          </span>
        </PrimaryTab>
        <PrimaryTab selected={tab === 1} onClick={() => navigate(TAB_APPEARANCE)}>
          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
            <Palette size={15} /> {t('settings.tabAppearance')}
          </span>
        </PrimaryTab>
      </Tabs>

      <div style={{ marginTop: 16 }}>
        {isAppearance ? <AppearanceTab /> : <AccountTab />}
      </div>
    </div>
  );
}
