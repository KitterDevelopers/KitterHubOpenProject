// 空状态：图标统一走 Material Symbols（msIcon），也可以传一个 lucide 组件（icon）。
// 站点规则是界面不用 emoji，所以原来那条 emoji 兜底（默认 🙀）已经删掉；
// 两个参数都不传时给一个中性的表情图标，不会再渲染 emoji。
//
// ⚠️ 2026-09-27 站长反馈：「作品卡片加载的时候会提示暂无作品，这显然是不准确的，应该提示加载中」。
//    根因是各地只判断了 `list.length === 0`，没管 loading —— 请求还没回来就先把「暂无」画出来了。
//    这里加一个 loading 开关（转圈 + 加载中…），调用方把各自的 loading 状态传进来即可。
//    （跨页面加中间态是必须的，不传 loading 时行为与从前完全一致。）
//
// compact：紧凑版（小图标 + 小内边距 + 小标题），给「页签切换出来的那一小块内容区」用。
//    个人主页 2026-10-12 重构时新增：默认空态是 52px 图标 + 48px 内边距的大坑，
//    新号的主页首屏基本就是一块空白。**默认 false，其它页面行为一字未改。**
import { CircularProgress } from '../ui';
import { useI18n } from '../i18n';
import MsIcon from './MsIcon';

export default function EmptyState({ icon: Icon, msIcon, title, subtitle, children, loading = false, loadingText, compact = false }) {
  const { t } = useI18n();
  const pad = compact ? '28px 16px' : '48px 16px';
  const iconSize = compact ? 34 : 52;
  const titleSize = compact ? 15 : 18;
  if (loading) {
    return (
      <div className="empty-state" style={{ textAlign: 'center', padding: pad }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <CircularProgress indeterminate />
        </div>
        <div className="muted" style={{ marginTop: 14, fontSize: 14 }}>{loadingText || t('common.loading')}</div>
      </div>
    );
  }
  return (
    <div className="empty-state" style={{ textAlign: 'center', padding: pad }}>
      <div style={{ color: 'var(--md-sys-color-on-surface-variant)', display: 'flex', justifyContent: 'center' }}>
        {Icon ? <Icon size={iconSize} strokeWidth={1.3} /> : <MsIcon name={msIcon || 'sentiment_dissatisfied'} size={iconSize} />}
      </div>
      <div style={{ fontSize: titleSize, fontWeight: 700, marginTop: compact ? 8 : 12 }}>{title}</div>
      {subtitle && <div className="muted" style={{ marginTop: 8, fontSize: compact ? 13 : undefined }}>{subtitle}</div>}
      {children && <div style={{ marginTop: compact ? 14 : 20 }}>{children}</div>}
    </div>
  );
}
