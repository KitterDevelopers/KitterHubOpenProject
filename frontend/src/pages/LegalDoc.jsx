/**
 * 单篇规则文档页：《KitterHub 社区管理规定》各篇 + 独立的《免责声明》。
 *
 * 内容不写在代码里，而是从站内 Markdown 文件读取（/docs/<key>.md、/disclaimer.md），
 * 这样站长可以直接改 MD，不用动前端。渲染用的是站内自研 Markdown 组件（安全的那个）。
 *
 * 路由：
 *   /rules/:key    -> 七篇之一（key 见 RULES）
 *   /disclaimer    -> 独立的免责声明（standalone）
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileText, ListOrdered, ShieldAlert } from 'lucide-react';
import Markdown from '../components/markdown/Markdown';
import { OutlinedButton, TextButton, CircularProgress } from '../ui';
import { useI18n } from '../i18n';

/** 管理规定七篇（顺序即篇号） */
export const RULES = [
  { key: 'general', part: '第一篇', path: '/docs/general.md' },
  { key: 'conduct', part: '第二篇', path: '/docs/conduct.md' },
  { key: 'terms', part: '第三篇', path: '/docs/terms.md' },
  { key: 'privacy', part: '第四篇', path: '/docs/privacy.md' },
  { key: 'minors', part: '第五篇', path: '/docs/minors.md' },
  { key: 'report', part: '第六篇', path: '/docs/report.md' },
  { key: 'copyright', part: '第七篇', path: '/docs/copyright.md' },
];

/** 独立页面（不属于管理规定体系） */
export const STANDALONE = {
  disclaimer: { path: '/disclaimer.md' },
};

export default function LegalDoc({ standalone }) {
  const { key } = useParams();
  const { t } = useI18n();
  const [text, setText] = useState(null);
  const [error, setError] = useState(false);

  const entry = useMemo(() => {
    if (standalone) return STANDALONE[standalone] ? { key: standalone, part: '', ...STANDALONE[standalone] } : null;
    return RULES.find((r) => r.key === key) || null;
  }, [key, standalone]);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(false);
    if (!entry) { setError(true); return () => { alive = false; }; }
    fetch(entry.path)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((md) => { if (alive) setText(md); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [entry]);

  const idx = RULES.findIndex((r) => r.key === (entry && entry.key));
  const prev = idx > 0 ? RULES[idx - 1] : null;
  const next = idx >= 0 && idx < RULES.length - 1 ? RULES[idx + 1] : null;

  if (!entry || error) {
    return (
      <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="m3-card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('legal.notFound')}</div>
          <Link to="/rules">
            <OutlinedButton>{t('legal.backToCenter')}</OutlinedButton>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-pad" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link to="/rules" style={{ textDecoration: 'none' }}>
          <TextButton>
            <span slot="icon"><ListOrdered size={16} /></span>
            {t('legal.backToCenter')}
          </TextButton>
        </Link>
        {entry.part && <span className="m3-badge m3-badge--primary">{entry.part}</span>}
        {standalone && (
          <span className="m3-badge">
            <ShieldAlert size={12} /> {t('legal.standaloneBadge')}
          </span>
        )}
      </div>

      <article className="m3-card legal-doc" style={{ padding: '22px 22px 26px' }}>
        {text == null ? (
          <div className="row" style={{ justifyContent: 'center', padding: 30 }}>
            <CircularProgress indeterminate />
          </div>
        ) : (
          <Markdown text={text} className="legal-md" />
        )}
      </article>

      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          {prev && (
            <Link to={`/rules/${prev.key}`} style={{ textDecoration: 'none' }}>
              <OutlinedButton>
                <span slot="icon"><ArrowLeft size={16} /></span>
                {prev.part} {t(`legal.title.${prev.key}`)}
              </OutlinedButton>
            </Link>
          )}
        </div>
        <div>
          {next && (
            <Link to={`/rules/${next.key}`} style={{ textDecoration: 'none' }}>
              <OutlinedButton>
                {next.part} {t(`legal.title.${next.key}`)}
                <span slot="trailing-icon"><ArrowRight size={16} /></span>
              </OutlinedButton>
            </Link>
          )}
        </div>
      </div>

      <div className="muted row" style={{ gap: 6, marginTop: 14, fontSize: 12, justifyContent: 'center' }}>
        <FileText size={13} />
        {t('legal.sourceHint')}
      </div>
    </div>
  );
}
