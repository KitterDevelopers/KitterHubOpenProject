/**
 * 用户徽章（**统一展示位**）：按用户选的「展示哪个徽章」渲染，别处不要再自己判断。
 *
 * 站长 2026-09-30：「账号设置我们的等级徽章和编程猫的等级徽章只能选择一个展示，
 *                   展示徽章的各种地方统一一下」。
 * 所以个人主页昵称旁、稿件详情作者行（Info / Sidebar）等处一律用这个组件，
 * 口径只有后端 `users.badge_choice` 一个：
 *   codemao（默认）→ 编程猫作者等级徽章（没绑定 / 等级不在 2~5 时什么都不显示）
 *   site          → 本站等级徽章（六边形，见 LevelBadge）
 *   none          → 都不显示
 *
 * 兼容：老 payload 没有 badge_choice 时按默认 'codemao' 处理（与后端一致）。
 */
import LevelBadge from './LevelBadge';

// 编程猫徽章图在 public/badge/ 下，是新窗口里也可直接引用的站内静态资源
export default function UserBadge({ user, size = 'sm', onClick, title }) {
  if (!user) return null;
  const choice = user.badge_choice || 'codemao';
  // 编程猫徽章是**横长条**位图（比例约 4:1），所以高度定尺寸、宽度按比例走。
  // lg 只用在个人主页：站长 2026-10-01「个人主页的编程猫等级徽章小一点」→ 26 → 20
  //（昵称字号是 24px，20 的高度配起来齐一点；还要更小就改这一个数）。
  const h = size === 'lg' ? 20 : 15;

  if (choice === 'site') {
    if (!user.level || user.level < 1) return null;
    return <LevelBadge level={user.level} name={user.level_name} size={size} onClick={onClick} title={title} />;
  }

  if (choice === 'codemao') {
    const cm = user.codemao_badge;
    if (!cm || !cm.url) return null;
    // cm.url 形如 /badge/codemao-lv{2..5}.png，是站内静态资源，不需要再解析上传前缀
    return (
      <img
        className={`user-badge user-badge--codemao user-badge--${size}`}
        src={cm.url}
        alt={cm.name || ''}
        title={title || cm.name || ''}
        style={{ height: h, width: 'auto', maxWidth: size === 'lg' ? 80 : 60, objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      />
    );
  }

  return null;   // none
}
