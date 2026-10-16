import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Trash2 } from 'lucide-react';
import { FilledButton, CircularProgress, IconButton, FilterChip } from '../ui';
import client from '../api/client';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';
import { toast } from '../components/Toast';
import { formatTime } from '../utils';
import { useI18n } from '../i18n';

const FILTERS = [
  ['all', 'common.all'],
  ['post', 'draft.postDraft'],
  ['work', 'draft.workDraft'],
];

// 把 Markdown 正文压成一行纯文本预览
function toPlain(body, t) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, t('draft.mdImage'))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, t('draft.mdCode'))
    .replace(/[`*_>#~|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function draftInfo(d, t) {
  const data = d.data || {};
  const isPost = d.draft_type === 'post';
  const title = String(data.title || '').trim();
  const body = toPlain(data.content || data.description || '', t);
  const extras = [];
  if (data.category) extras.push(data.category);
  if (!isPost) {
    if (data.editor_code) extras.push(String(data.editor_code));
    if (data.source_url) extras.push(t('draft.externalRepost'));
  }
  return { isPost, title, body, extras };
}

export default function DraftsPanel({ drafts: draftsProp, loading: loadingProp, onChanged }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const controlled = draftsProp !== undefined;
  const [local, setLocal] = useState([]);
  const [localLoading, setLocalLoading] = useState(!controlled);
  const [kind, setKind] = useState('all');

  const load = () => {
    setLocalLoading(true);
    client.get('/drafts').then((r) => setLocal(r.data || [])).catch(() => setLocal([])).finally(() => setLocalLoading(false));
  };

  useEffect(() => {
    if (!controlled) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled]);

  const drafts = controlled ? draftsProp : local;
  const loading = controlled ? Boolean(loadingProp) : localLoading;

  const reload = () => {
    if (controlled) onChanged?.();
    else load();
  };

  const counts = useMemo(() => {
    const list = drafts || [];
    return {
      all: list.length,
      post: list.filter((d) => d.draft_type === 'post').length,
      work: list.filter((d) => d.draft_type === 'work').length,
    };
  }, [drafts]);

  const shown = useMemo(() => {
    const list = drafts || [];
    return kind === 'all' ? list : list.filter((d) => d.draft_type === kind);
  }, [drafts, kind]);

  const del = async (d) => {
    if (!window.confirm(t('draft.deleteConfirm'))) return;
    try {
      await client.delete(`/drafts/${d.id}`);
      toast(t('draft.deleted'), 'success');
      reload();
    } catch {
      toast(t('creator.deleteFail'), 'error');
    }
  };

  const duplicate = async (d) => {
    try {
      await client.post(`/drafts/${d.id}/duplicate`);
      toast(t('draft.copied'), 'success');
      reload();
    } catch {
      toast(t('draft.copyFail'), 'error');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  }

  if ((drafts || []).length === 0) {
    return (
      <EmptyState msIcon="edit_note" title={t('draft.empty')} subtitle={t('draft.emptyDesc')}>
        <div className="row" style={{ justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <FilledButton onClick={() => navigate('/posts/new')}>
            <span slot="icon"><MsIcon name="edit" size={18} /></span>{t('draft.writePost')}
          </FilledButton>
          <FilledButton onClick={() => navigate('/works/new')}>
            <span slot="icon"><MsIcon name="rocket_launch" size={18} /></span>{t('creator.publishWork')}
          </FilledButton>
        </div>
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="cc-chips">
        <span className="cc-chips-label">{t('creator.filterType')}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, labelKey]) => (
            <FilterChip
              key={k}
              label={`${t(labelKey)}${counts[k] ? ` (${counts[k]})` : ''}`}
              selected={kind === k}
              onClick={() => setKind(k)}
            />
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState msIcon="edit_note" title={t('draft.noDraftsInFilter')} />
      ) : (
        <div className="cc-list">
          {shown.map((d) => {
            const { isPost, title, body, extras } = draftInfo(d, t);
            const editPath = isPost ? `/posts/new?draft=${d.id}` : `/works/new?draft=${d.id}`;
            return (
              <div
                key={d.id}
                className="cc-draft-row"
                role="button"
                tabIndex={0}
                onClick={() => navigate(editPath)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(editPath); }}
              >
                <span className={`cc-draft-icon${isPost ? ' cc-draft-icon--post' : ''}`}>
                  <MsIcon name={isPost ? 'article' : 'videocam'} size={20} />
                </span>

                <div className="cc-draft-body">
                  <div className="cc-draft-head">
                    <span className="m3-badge m3-badge--primary">{isPost ? t('draft.postDraft') : t('draft.workDraft')}</span>
                    <span className="cc-draft-title">{title}</span>
                  </div>
                  <div className="cc-draft-preview">{body || t('draft.noBody')}</div>
                  <div className="cc-draft-meta muted">
                    {extras.map((x) => <span key={x} className="m3-badge">{x}</span>)}
                    <span>{t('draft.updatedAt', { time: formatTime(d.updated_at) })}</span>
                  </div>
                </div>

                <div className="cc-draft-actions" onClick={(e) => e.stopPropagation()}>
                  <FilledButton onClick={() => navigate(editPath)}>{t('draft.continueEdit')}</FilledButton>
                  <IconButton title={t('draft.duplicate')} onClick={() => duplicate(d)}><Copy size={17} /></IconButton>
                  <IconButton title={t('draft.deleteOne')} style={{ color: 'var(--md-sys-color-error)' }} onClick={() => del(d)}><Trash2 size={17} /></IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
