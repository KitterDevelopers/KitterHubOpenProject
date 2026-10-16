/**
 * 管理员后台 - 外壳
 *
 * 结构：左侧分组导航 / 右侧面板；?tab= 深链；移动端导航可收起。
 * 旧后台的数字 tab（0/1/2/13/3/8/4/7/5/6/9/10 与 0b/pp/rc/5a/sq/12）全部映射到新键，
 * 保证既有链接与书签不会失效。
 *
 * ★ 角标与列表**同源**（2026-10-15 重构）：
 *   导航上每个数字都来自 `/admin/stats` 或 `/admin/review_queue` 里那个
 *   **与面板列表共用同一查询函数**的字段，前端不再自己"数数组"或拿别的接口凑。
 *   具体对应关系写在下面 NAV 的 badge 字段旁，逐条可查：
 *
 *     pending_works        <- /admin/works?status=pending（同一过滤条件）
 *     pending_reports      <- /reports?status=pending
 *     pending_sensitive    <- /admin/sensitive-reviews（默认 status=pending & source=sensitive）
 *     recycle_total        <- /admin/recycle（总数）
 *     pending_passport     <- /admin/verify-queue
 *     pending_scratch_quota<- /admin/scratch-quota/requests?status=pending
 *     pending_committee    <- /admin/committee/overview -> applications
 *     queue_total          <- /admin/review_queue 里两类待办的条数之和（本页自有口径）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity, BarChart3, Bell, Cloud, FileText, Flag, Gavel, Image as ImageIcon,
  LayoutGrid, ListTree, Menu, MessageSquare, Palette, Recycle, RefreshCw, Shield, Sparkles,
  ShieldAlert, SlidersHorizontal, Users, X,
} from 'lucide-react';
import { CircularProgress, IconButton, OutlinedButton } from '../../ui';
import MsIcon from '../../components/MsIcon';
import * as api from './client';
import Dashboard from './panels/Dashboard';
import { FeaturedWorks, Works, WorksReview, Queue, PostsAndComments, Reports, Sensitive, RecycleBin } from './panels/Content';
import { UsersPanel, Verifications, Quota, UserAudit, Studios, Committee, CloudRooms, Passport } from './panels/People';
import { Logs, AuditLogs, Switches, BannersAndAnnouncement, Notify, Export } from './panels/System';

/** 旧 tab 值 -> 新键（旧后台的导航契约，逐条映射，避免老链接 404） */
const LEGACY = {
  '0': 'dashboard', '1': 'works', '2': 'works-review', '13': 'queue', '3': 'posts',
  '8': 'featured-works', '4': 'reports', '7': 'studios', '5': 'logs', '5a': 'audit',
  '6': 'banners', '9': 'notify', '10': 'switches', '0b': 'users', 'pp': 'passport',
  'rc': 'recycle', 'sq': 'quota', '12': 'user-audit',
};

export function tabValue(raw) {
  if (!raw) return 'dashboard';
  if (LEGACY[raw]) return LEGACY[raw];
  return raw;                                  // 已经是新键就原样使用
}

// [tab, 标题, 图标, 角标字段(来自 /admin/stats 或 /admin/review_queue)]
const NAV = [
  { group: '概览', items: [['dashboard', '数据看板', LayoutGrid]] },
  {
    group: '内容',
    items: [
      ['works', '稿件管理', Palette, 'pending_works'],
      ['works-review', '稿件审核', ShieldAlert, 'pending_works'],
      ['queue', '审核队列', ListTree, 'queue_total'],
      ['posts', '帖子 / 评论', MessageSquare],
      ['reports', '举报处理', Flag, 'pending_reports'],
      ['featured-works', '官方精选', Sparkles],
      ['sensitive', '敏感词与处罚', ShieldAlert, 'pending_sensitive'],
      ['recycle', '回收站', Recycle, 'recycle_total'],
    ],
  },
  {
    group: '用户',
    items: [
      ['users', '用户管理', Users],
      ['verifications', '官方认证', Shield],
      ['passport', '护照审核', FileText, 'pending_passport'],
      ['quota', '存储扩容', Activity, 'pending_scratch_quota'],
      ['user-audit', '用户审计', Gavel],
    ],
  },
  {
    group: '社区',
    items: [
      ['studios', '工作室', Users],
      ['committee', '风纪委员会', Gavel, 'pending_committee'],
      ['cloud', '云变量房间', Cloud],
    ],
  },
  {
    group: '系统',
    items: [
      ['logs', '操作日志', ListTree],
      ['audit', '安全审计', Shield],
      ['switches', '站点开关', SlidersHorizontal],
      ['banners', '公告与 Banner', ImageIcon],
      ['notify', '全站通知', Bell],
      ['export', '数据导出', BarChart3],
    ],
  },
];

const PANELS = {
  dashboard: Dashboard,
  works: Works,
  'works-review': WorksReview,
  'featured-works': FeaturedWorks,
  queue: Queue,
  posts: PostsAndComments,
  reports: Reports,
  sensitive: Sensitive,
  recycle: RecycleBin,
  users: UsersPanel,
  verifications: Verifications,
  passport: Passport,
  quota: Quota,
  'user-audit': UserAudit,
  studios: Studios,
  committee: Committee,
  cloud: CloudRooms,
  logs: Logs,
  audit: AuditLogs,
  switches: Switches,
  banners: BannersAndAnnouncement,
  notify: Notify,
  export: Export,
};

export default function AdminApp() {
  const [params, setParams] = useSearchParams();
  const tab = tabValue(params.get('tab'));
  const [stats, setStats] = useState(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [badgeErr, setBadgeErr] = useState('');

  /** 角标数据：只取两侧接口的**计数字段**，不改口径、不在前端二次计算。 */
  const loadBadges = useCallback(async () => {
    setBusy(true);
    setBadgeErr('');
    try {
      const [st, q] = await Promise.all([
        api.getStats(),
        api.reviewQueue().catch(() => null),        // 队列失败只影响 queue_total
      ]);
      setStats(st.data || {});
      const qd = (q && q.data) || {};
      setQueueTotal((qd.pending_works || []).length + (qd.pending_reports || []).length);
    } catch (e) {
      setBadgeErr(api.msgOf(e));                     // 角标失败不影响面板使用，但要看得见
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { loadBadges(); }, [tab, loadBadges]);

  const badges = useMemo(() => ({ ...(stats || {}), queue_total: queueTotal }), [stats, queueTotal]);

  const setTab = (key) => {
    setParams(key === 'dashboard' ? {} : { tab: key }, { replace: false });
    setNavOpen(false);
  };

  const Panel = PANELS[tab] || Dashboard;
  const title = NAV.flatMap((g) => g.items).find(([k]) => k === tab);

  return (
    <div className="page-pad">
      <div className="adm-shell">
        {/* 顶部 */}
        <div className="adm-head">
          <div className="adm-head-left">
            <MsIcon name="admin_panel_settings" size={20} />
            <div>
              <div className="adm-head-title">{title ? title[1] : '管理员后台'}</div>
              <div className="adm-head-sub">
                管理员后台
                {stats ? ` - 用户 ${stats.users ?? '—'} - 稿件 ${stats.works ?? '—'} - 帖子 ${stats.posts ?? '—'}` : ''}
              </div>
            </div>
          </div>
          <div className="adm-head-actions">
            <OutlinedButton onClick={() => setNavOpen((v) => !v)} className="adm-nav-toggle-inline">
              <span slot="icon">{navOpen ? <X size={16} /> : <Menu size={16} />}</span>面板
            </OutlinedButton>
            <OutlinedButton onClick={loadBadges} disabled={busy}>
              <span slot="icon"><RefreshCw size={16} /></span>刷新
            </OutlinedButton>
            <a href="/" style={{ textDecoration: 'none' }}>
              <OutlinedButton>回站点</OutlinedButton>
            </a>
          </div>
        </div>

        {badgeErr && <div className="m3-badge m3-badge--error" style={{ marginBottom: 10 }}>角标数据加载失败：{badgeErr}</div>}

        <div className="adm-body">
          {/* 导航 */}
          <nav className={`adm-nav${navOpen ? ' is-open' : ''}`}>
            {NAV.map((g) => (
              <div className="adm-nav-group" key={g.group}>
                <div className="adm-nav-group-title">{g.group}</div>
                {g.items.map(([key, label, Icon, badgeKey]) => {
                  const n = badgeKey ? Number(badges[badgeKey] || 0) : 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`admin-nav-item${tab === key ? ' is-active' : ''}`}
                      aria-current={tab === key ? 'page' : undefined}
                      onClick={() => setTab(key)}
                      data-badge-key={badgeKey || ''}
                    >
                      <Icon size={15} />
                      <span className="adm-nav-label">{label}</span>
                      {n > 0 && <span className="adm-nav-badge">{n}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* 面板 */}
          <div className="adm-panels">
            <Panel setTab={setTab} onBadges={loadBadges} />
          </div>
        </div>
      </div>
    </div>
  );
}
