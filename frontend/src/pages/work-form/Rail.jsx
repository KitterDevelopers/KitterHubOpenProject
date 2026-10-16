/**
 * 右栏：实时预览 → 投稿清单 → 提交。
 *
 * 为什么这三样放一起并做成 sticky：它们是「填表过程中一直想看着」的东西 ——
 * 预览要能随时对照、清单要能随时知道还差什么、提交按钮不该在长表单底部找不到。
 * 原来「分类/封面」也挤在这一栏里，现在挪回主栏跟其它字段排在一起了。
 */
import { Save, Send } from 'lucide-react';
import { FilledButton, TextButton } from '../../ui';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { CATEGORY_KEYS } from './constants';

export default function Rail({ f }) {
  const { t } = useI18n();
  const catLabel = (v) => (CATEGORY_KEYS[v] ? t(CATEGORY_KEYS[v]) : v);
  const requiredMissing = f.checks.filter((c) => !c.ok && !c.opt).length;

  return (
    <aside className="wf-rail">
      {/* ---- 实时预览 ---- */}
      <div className="m3-card" style={{ padding: 16 }}>
        <div className="wf-rail__title"><MsIcon name="visibility" size={16} /> {t('form.preview')}</div>
        <div className="wf-preview">
          <div className="wf-preview__cover">
            {f.coverUrl ? <img src={f.coverUrl} alt="" /> : <MsIcon name="image" size={30} />}
          </div>
          <div className="wf-preview__body">
            <span className="m3-badge m3-badge--primary">{catLabel(f.category)}</span>
            <div className="wf-preview__title">{f.title.trim() || t('form.workTitleLabel')}</div>
            <div className="wf-preview__desc">{f.description.trim() || t('form.previewDesc')}</div>
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {f.tagArr.length > 0
                ? f.tagArr.map((tag) => <span key={tag} className="m3-badge">{tag}</span>)
                : <span className="muted" style={{ fontSize: 12 }}>{t('form.noTags')}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ---- 投稿清单 ---- */}
      <div className="m3-card" style={{ padding: 16 }}>
        <div className="wf-rail__title">
          <MsIcon name="checklist" size={16} /> {t('form.requirements')}
          {requiredMissing > 0
            ? <span className="wf-rail__count">{t('form.needMore', { n: requiredMissing })}</span>
            : <span className="wf-rail__count is-ok">{t('form.allReady')}</span>}
        </div>
        <div className="wf-checks">
          {f.checks.map((c) => (
            <div key={c.key} className={`wf-check ${c.ok ? 'ok' : (c.opt ? 'todo opt' : 'todo')}`}>
              <MsIcon name={c.ok ? 'check_circle' : 'pending'} size={15} />
              <span>{c.label}</span>
            </div>
          ))}
          {!f.levelOk && (
            <div className="wf-check bad">
              <MsIcon name="warning" size={15} />
              <span>{f.levelMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- 提交 ---- */}
      <div className="m3-card wf-submit">
        <FilledButton type="button" onClick={f.submit} disabled={f.busy} style={{ width: '100%' }}>
          <span slot="icon"><Send size={18} /></span>
          {f.busy ? t('form.submitting') : f.submitLabel}
        </FilledButton>
        <div className="row" style={{ gap: 8, marginTop: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <TextButton type="button" onClick={f.saveAsNew} disabled={f.busy}>
            <Save slot="icon" size={15} /> {t('form.saveAsNewDraft')}
          </TextButton>
          <span className="muted" style={{ fontSize: 11.5 }}>{f.savedTip || t('form.autoSaveOn')}</span>
        </div>
        <ul className="wf-tips">
          <li>{t('form.tipNoDuplicate')}</li>
          <li>{t('form.tipExternalReview')}</li>
          <li>{t('form.tipCover')}</li>
          <li>{t('form.tipDrafts')}</li>
        </ul>
      </div>
    </aside>
  );
}
