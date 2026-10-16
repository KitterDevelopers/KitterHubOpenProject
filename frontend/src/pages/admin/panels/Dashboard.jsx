/**
 * 数据看板
 *
 * 数据源：GET /admin/stats（users/works/posts/comments/studios/banned_users/
 * pending_works/pending_reports/pending_sensitive/recycle_total/...）
 * 另拉 GET /admin/review_queue 拿到"待审稿件 + 待处理举报"的实时条数。
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Download, FileText, Flag, MessageSquare, Palette,
  ShieldAlert, Trash2, TrendingUp, Users,
} from 'lucide-react';
import { CircularProgress, OutlinedButton } from '../../../ui';
import MsIcon from '../../../components/MsIcon';
import * as api from '../client';
import { Badge, Card, Loading, Note, PanelHead, detail } from '../ui';

const COLORS = ['#4c6ef5', '#40c057', '#f59f00', '#e64980', '#9c36b5', '#0ca678', '#ff922b', '#1971c2'];

function Donut({ data, total }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="116" height="116" viewBox="0 0 116 116" style={{ flexShrink: 0 }} role="img" aria-label="内容构成">
        <circle cx="58" cy="58" r={R} fill="none" stroke="var(--md-sys-color-surface-container-high)" strokeWidth="18" />
        {data.map((d, i) => {
          const dash = total ? (d.count / total) * C : 0;
          const seg = (
            <circle key={i} cx="58" cy="58" r={R} fill="none" stroke={COLORS[i % COLORS.length]}
                    strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc}
                    transform="rotate(-90 58 58)" opacity="0.9" />
          );
          acc += dash;
          return seg;
        })}
        <text x="58" y="55" textAnchor="middle" fontSize="16" fontWeight="800" fill="var(--md-sys-color-on-surface)">{total}</text>
        <text x="58" y="70" textAnchor="middle" fontSize="10" fill="var(--md-sys-color-on-surface-variant)">总数</text>
      </svg>
      <div className="stack" style={{ gap: 4 }}>
        {data.map((d, i) => (
          <div key={d.name} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
            {d.name} - {d.count}（{total ? Math.round((d.count / total) * 100) : 0}%）
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ setTab }) {
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [st, q] = await Promise.all([api.getStats(), api.reviewQueue().catch(() => null)]);
        setStats(st.data || {});
        const qd = (q && q.data) || {};
        setQueue({
          works: (qd.pending_works || []).length,
          reports: (qd.pending_reports || []).length,
          scheduled: (qd.scheduled_works || []).length,
        });
      } catch (e) { setErr(detail(e)); }
    })();
  }, []);

  if (err) return <Note tone="error">{err}</Note>;
  if (!stats) return <Loading />;

  const cards = [
    [<Users size={17} />, '用户', stats.users],
    [<Palette size={17} />, '稿件', stats.works],
    [<FileText size={17} />, '帖子', stats.posts],
    [<MessageSquare size={17} />, '评论', stats.comments],
    [<TrendingUp size={17} />, '工作室', stats.studios],
    [<ShieldAlert size={17} />, '封禁中', stats.banned_users],
  ];

  const todos = [
    ['待审稿件', queue ? queue.works : (stats.pending_works || 0), 'works-review', <AlertTriangle size={16} />],
    ['待处理举报', queue ? queue.reports : (stats.pending_reports || 0), 'reports', <Flag size={16} />],
    ['敏感词待审', stats.pending_sensitive || 0, 'sensitive', <ShieldAlert size={16} />],
    ['存储扩容申请', stats.pending_scratch_quota || 0, 'quota', <Download size={16} />],
    ['风纪委员会', stats.pending_committee || 0, 'committee', <Users size={16} />],
    ['回收站', stats.recycle_total || 0, 'recycle', <Trash2 size={16} />],
  ];

  return (
    <>
      <div className="adm-stats">
        {cards.map(([icon, label, val]) => (
          <Card key={label} className="adm-stat" style={{ padding: 14 }}>
            <span className="adm-stat-icon">{icon}</span>
            <div>
              <div className="adm-stat-num">{val ?? '—'}</div>
              <div className="adm-stat-label">{label}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <PanelHead icon={<AlertTriangle size={17} />} title="待处理" />
        <div className="adm-todos">
          {todos.map(([label, count, key, icon]) => (
            <button key={label} type="button" className={`adm-todo${Number(count) > 0 ? ' has-work' : ''}`} onClick={() => setTab(key)}>
              {icon}
              <span className="adm-todo-label">{label}</span>
              <span className="adm-todo-num">{count ?? 0}</span>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
        {queue && queue.scheduled > 0 && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            另有 {queue.scheduled} 件定时发布稿件在队列中。
          </div>
        )}
      </Card>

      <Card>
        <PanelHead icon={<Palette size={17} />} title="内容构成" />
        {(() => {
          const data = [
            { name: '稿件', count: Number(stats.works || 0) },
            { name: '帖子', count: Number(stats.posts || 0) },
            { name: '评论', count: Number(stats.comments || 0) },
            { name: '工作室', count: Number(stats.studios || 0) },
          ].filter((d) => d.count > 0);
          const total = data.reduce((sum, d) => sum + d.count, 0);
          return total ? <Donut data={data} total={total} /> : <Note>暂无数据</Note>;
        })()}
      </Card>

      <Card>
        <PanelHead icon={<Download size={17} />} title="数据导出">
          <OutlinedButton onClick={() => setTab('export')}>打开导出面板</OutlinedButton>
        </PanelHead>
        <Note>
          导出为 CSV（服务端生成）：用户、稿件、帖子、评论、举报、日志。
          在「数据导出」面板里可以直接下载。
        </Note>
      </Card>
    </>
  );
}
