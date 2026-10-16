/**
 * 规则中心（/rules）：《KitterHub 社区管理规定》七篇的总入口 + 独立页面入口。
 * 站长 2026-10-02：「做成一个系统规定」「单独开一个页面，不跟 help 一个」。
 */
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, FileCheck2, Gavel, ScrollText, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import { RULES } from './LegalDoc';

const ICONS = {
  general: ScrollText,
  conduct: Gavel,
  terms: FileCheck2,
  privacy: ShieldAlert,
  minors: ShieldAlert,
  report: ShieldAlert,
  copyright: FileCheck2,
};

export default function RulesCenter() {
  const { t } = useI18n();

  return (
    <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
      <header className="m3-card m3-card--filled" style={{ padding: 22, marginBottom: 14 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <BookOpenCheck size={20} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{t('legal.centerTitle')}</h1>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.85 }}>
          {t('legal.centerDesc')}
        </p>
      </header>

      <div className="stack" style={{ gap: 10 }}>
        {RULES.map((r) => {
          const Icon = ICONS[r.key] || ScrollText;
          return (
            <Link key={r.key} to={`/rules/${r.key}`} className="legal-card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="legal-card-icon"><Icon size={18} /></span>
              <span className="legal-card-body">
                <span className="legal-card-part">{r.part}</span>
                <span className="legal-card-title">{t(`legal.title.${r.key}`)}</span>
                <span className="legal-card-desc">{t(`legal.desc.${r.key}`)}</span>
              </span>
              <ArrowRight size={16} className="legal-card-arrow" />
            </Link>
          );
        })}

        <Link to="/disclaimer" className="legal-card legal-card--solo" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="legal-card-icon"><ShieldAlert size={18} /></span>
          <span className="legal-card-body">
            <span className="legal-card-part">{t('legal.standaloneBadge')}</span>
            <span className="legal-card-title">{t('legal.title.disclaimer')}</span>
            <span className="legal-card-desc">{t('legal.desc.disclaimer')}</span>
          </span>
          <ArrowRight size={16} className="legal-card-arrow" />
        </Link>
      </div>

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.8, marginTop: 16, textAlign: 'center' }}>
        {t('legal.centerFoot')}
      </p>
    </div>
  );
}
