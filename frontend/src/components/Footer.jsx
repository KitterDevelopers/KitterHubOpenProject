import { useState } from 'react';
import { Link } from 'react-router-dom';
import KitterLogo from './KitterLogo';
import DonateDialog from './DonateDialog';
import MsIcon from './MsIcon';
import { LangToggle, useI18n } from '../i18n';

// 站点版本号（页脚展示用）。
// v2.6（2026-10-01）：社区风纪委员会 + 评论举报 + 「无违规」投票（3 票判定无违规）。
// v2.3（2026-10-01）：深色模式**再压暗**（站长：「而且还是太浅了」）——
//                    站标上 0.38 / 下 0.50、按钮品牌深色 0.38（饱和度仍 ×0.6）；
//                    并修掉按钮**图标色漏改**的 bug（Material 的图标是独立 token
//                    --md-filled-button-icon-color，深色下默认取很暗的 on-primary →
//                    白字配深色图标，站长截图里的「创作中心」就是这个）。
// v2.2（2026-10-01）：深色模式下**实心按钮**改用品牌深色（站长：「按钮的颜色可以深一点」）——
//                    按钮读 --brand-deep（由 applyThemeColor 按用户选色算：色相不变、饱和度 ×0.6、
//                    亮度 0.45），只改按钮，不动 --md-sys-color-primary 本身。
// v2.1（2026-10-01）：深色模式**再收一截饱和度**（站长：「深色还是太鲜艳了」）——
//                    亮度固定 0.45 / 0.57，饱和度取选色的 0.6（他的绿 46% → 28%），沉稳不刺眼。
// v2.0（2026-10-01）：**深色模式单独定档**（站长：「深色模式下优化一下」）——
//                    浅色：上面 = 选的色亮度 −0.05、下面 = 色相 −20°、亮度 +0.08；
//                    深色：上面 = 固定 l 0.48、下面 = 0.62，饱和度取选色的 0.9（略收，免得刺眼）；
//                    色相一律来自用户选的颜色。深色这档是给站长挑的三档里的 B - 中间。
// v1.9（2026-10-01）：站标基色改为「**用户在设置里选的那个颜色**」（站长：「太鲜艳了，再深点，
//                    就用取的那个颜色深点就行」）——不再用深色主题那个被提亮的浅色调当基色，
//                    也不再提纯饱和度；上面 = 基色亮度 −0.05、下面 = 色相 −20°、亮度 +0.08。
// v1.8（2026-10-01）：**深色主题**下 LOGO 与顶栏「KitterHub」文字改用更深的一档
//                    （深色主题的主色 token 本身很浅，跟着走会发白；站长：「太浅了，深一点」）。
//                    文字与 LOGO 现在共用同一个 hook（components/useBrandColors.js），颜色必然一致。
// v1.7（2026-10-01）：站标**上面那块再压深一档**（站长：「上面的再深一点」）——
//                    现在上面 = 主题色亮度 −0.10，下面 = 色相 −20°、亮度 +0.12（上深下浅）。
// v1.6（2026-10-01）：站标上下两块的深浅方向纠正 —— 上面那块（主色）深、下面那块浅
//                    （站长：「上面的那个深一点比下面的」；原图也是上深下浅）。
// v1.5（2026-10-01）：站标配色再加固 —— 改为**从站标元素自身**读 --md-sys-color-primary
//                    （CSS 变量继承，主题色写在 html/body/某层容器上都能读到），仍用 JS 算第二色。
// v1.4（2026-10-01）：站标配色改为 **JS 现算**（读页面上生效的 --md-sys-color-primary，
//                    第二个形状用 HSL 运算得出）——不再依赖 CSS 变量 / html[data-brand] 标记 /
//                    相对颜色语法，换主题色立刻生效。之前 v1.3 那版就是这么写的但站长那边没生效。
// v1.3（2026-10-01）：站标改内联 SVG、跟随自定义主题色；等级徽章改六边形；存储默认 100MB；
//                    编程猫注册可补填邀请码。**页脚版本号也是排查「页面是不是旧版」最直接的依据**。
const APP_VERSION = 'v2.6';

// 对外支持邮箱。⚠️ 改之前先确认这个地址**真的能收信**（阿里云企业邮箱在 RCPT 阶段就会
// 告诉你收件人存不存在，.forensics/verify/probe_mailboxes.py 可以探）。
// 页脚写一个不存在的地址，用户发过去直接退信，比不写更糟。
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com';

/**
 * 站点页脚。
 *
 * 站长 2026-10-02：「整理一下页脚」——原先「帮助」一列堆了 7 条（帮助、使用说明、规则、免责、
 * 反馈、捐款、pickCat 工具混在一起）。现在按性质分四列，每列只放**公开可达**的入口：
 *   社区（发现/论坛/工作室/风纪委员会）
 *   活动与工具（接力大赛、点亮中国、pickCat 头像工具）
 *   帮助（帮助中心、使用说明、意见反馈、支持我们）
 *   规则（社区管理规定、免责声明）
 * 需要登录才有意义的入口（创作中心、经验中心、我的）一律不放进页脚。
 * 底栏固定放版权 + 支持邮箱 + 语言切换。
 */
export default function Footer() {
  const [donateOpen, setDonateOpen] = useState(false);
  const { t } = useI18n();
  return (
    <>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <Link to="/" className="site-footer__logo">
              <KitterLogo size={26} />
              <span>KitterHub</span>
              <span className="site-footer__version">{APP_VERSION}</span>
            </Link>
            <p className="site-footer__tagline">{t('footer.tagline')}</p>
          </div>

          <nav className="site-footer__nav" aria-label={t('footer.nav')}>
            {/* 1. 社区 */}
            <div className="site-footer__col">
              <h4>{t('footer.groupCommunity')}</h4>
              <Link to="/discover">{t('nav.discover')}</Link>
              <Link to="/forum">{t('nav.forum')}</Link>
              <Link to="/studios">{t('nav.studios')}</Link>
              <Link to="/committee">{t('committee.title')}</Link>
            </div>

            {/* 2. 活动与工具（都是独立页面，新标签打开） */}
            <div className="site-footer__col">
              <h4>{t('footer.groupActivity')}</h4>
              <Link to="/contest/lit-china">{t('maplit.title')}</Link>
              <Link to="/pages">{t('pages.entry')}</Link>
              {/* pickCat 自定义头像工具：部署在本站 /pickcat-avatar/，操作的是 pickCat 的账号，
                  与本站数据无关；页面上有「凭据经本站转发」的提示。 */}
              <a href="/pickcat-avatar/" target="_blank" rel="noopener noreferrer">
                {t('footer.pickcatAvatar')}
              </a>
            </div>

            {/* 3. 帮助 */}
            <div className="site-footer__col">
              <h4>{t('footer.groupHelp')}</h4>
              <Link to="/help">{t('help.title')}</Link>
              <a href="/help.html">{t('footer.help')}</a>
              <Link to="/feedback">{t('footer.feedback')}</Link>
              <button type="button" onClick={() => setDonateOpen(true)}>{t('footer.donate')}</button>
            </div>

            {/* 4. 规则（独立法规文档，见 pages/RulesCenter.jsx） */}
            <div className="site-footer__col">
              <h4>{t('footer.groupRules')}</h4>
              <Link to="/rules">{t('footer.rules')}</Link>
              <Link to="/disclaimer">{t('footer.disclaimer')}</Link>
            </div>
          </nav>
        </div>

        <div className="site-footer__bottom">
          <span className="site-footer__copy">{t('footer.copyright', { year: new Date().getFullYear() })}</span>
          <a
            className="site-footer__contact"
            href={`mailto:${SUPPORT_EMAIL}`}
            title={t('footer.contactSupport')}
            aria-label={t('footer.contactSupport')}
          >
            <MsIcon name="mail" size={15} />
            <span>{SUPPORT_EMAIL}</span>
          </a>
          <LangToggle />
        </div>
      </footer>
      <DonateDialog open={donateOpen} onClose={() => setDonateOpen(false)} />
    </>
  );
}
