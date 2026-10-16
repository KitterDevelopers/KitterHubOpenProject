import { LifeBuoy } from 'lucide-react';
import { FilledButton } from '../ui';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { useI18n } from '../i18n';

const FAQ = [
  ['help.q1', 'help.a1'],
  ['help.q2', 'help.a2'],
  ['help.q3', 'help.a3'],
  ['help.q4', 'help.a4'],
  ['help.q5', 'help.a5'],
  ['help.q6', 'help.a6'],
  ['help.q7', 'help.a7'],
];

export default function Help() {
  const { t } = useI18n();
  return (
    <div className="page-pad" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 className="row" style={{ margin: '0 0 16px', fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><LifeBuoy size={22} /> {t('help.title')}</h1>
      <EmptyState icon={LifeBuoy} title={t('help.guideTitle')} subtitle={t('help.guideSubtitle')}>
        {/* 下面是常见问题，完整说明（注册/等级/投稿/工作室…全流程）在静态页 help.html */}
        <a href="/help.html" style={{ textDecoration: 'none' }}>
          <FilledButton>
            <span slot="icon"><MsIcon name="menu_book" size={18} /></span>
            {t('help.openGuide')}
          </FilledButton>
        </a>
      </EmptyState>
      <div className="stack" style={{ gap: 10 }}>
        {FAQ.map(([q, a]) => (
          <div key={q} className="m3-card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><MsIcon name="help" size={18} /> {t(q)}</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 6, lineHeight: 1.7 }}>{t(a)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
