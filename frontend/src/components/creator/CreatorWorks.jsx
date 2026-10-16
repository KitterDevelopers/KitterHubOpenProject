import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileEdit, Trash2, Link2 } from 'lucide-react';
import { OutlinedTextField, FilterChip, IconButton, OutlinedButton, FilledButton, CircularProgress } from '../../ui';
import client from '../../api/client';
import EmptyState from '../EmptyState';
import EditorChip from '../EditorChip';
import MsIcon from '../MsIcon';
import WorkStatusBadge from './WorkStatusBadge';
import { toast } from '../Toast';
import { fmtCount, fmtChina, parseTs } from '../../utils';
import { useI18n } from '../../i18n';

const STATUS_FILTERS = [
  ['all', 'common.all'],
  ['published', 'status.published'],
  ['pending', 'status.pending'],
  ['scheduled', 'creator.filterScheduled'],
  ['rejected', 'status.rejected'],
];

const SORTS = [
  ['new', 'creator.sortNew'],
  ['views', 'creator.sortViews'],
  ['likes', 'creator.sortLikes'],
  ['comments', 'creator.sortComments'],
];

// 复制到剪贴板（HTTP 环境下 navigator.clipboard 不可用时退回 execCommand）
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function WorkThumb({ work }) {
  if (work.cover_url) {
    return <img className="cc-work-thumb" src={work.cover_url} alt="" loading="lazy" />;
  }
  return (
    <span className={`cc-work-thumb cc-work-thumb--ph grad-${(work.id % 5) + 1}`}>
      <MsIcon name="extension" size={22} />
    </span>
  );
}

function WorkRow({ work, onDelete, onCopy }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const edited = work.edited_at && parseTs(work.edited_at) > parseTs(work.created_at);
  return (
    <div className="cc-work-row">
      <Link to={`/works/${work.id}`} className="cc-work-thumb-link"><WorkThumb work={work} /></Link>

      <div className="cc-work-main">
        <div className="cc-work-title-row">
          <Link to={`/works/${work.id}`} className="cc-work-title">{work.title}</Link>
          <WorkStatusBadge status={work.status} />
          {work.is_pinned && <span className="m3-badge m3-badge--error">{t('creator.badgePinned')}</span>}
          {work.is_featured && <span className="m3-badge m3-badge--primary">{t('creator.badgeFeatured')}</span>}
        </div>

        <div className="cc-work-meta">
          <EditorChip work={work} />
          {work.category && <span className="m3-badge">{work.category}</span>}
          {work.is_repost && <span className="m3-badge">{t('creator.badgeRepost')}</span>}
          <span>{t('creator.publishedOn', { date: fmtChina(work.created_at, { year: 'numeric', month: 'numeric', day: 'numeric' }) })}</span>
          {edited && <span> - {t('creator.editedOn', { date: fmtChina(work.edited_at, { month: 'numeric', day: 'numeric' }) })}</span>}
        </div>

        <div className="cc-metrics">
          <span title={t('creator.ttViews')}><MsIcon name="visibility" size={14} /> {fmtCount(work.views)}</span>
          <span title={t('creator.ttLikes')}><MsIcon name="thumb_up" size={14} /> {fmtCount(work.like_count)}</span>
          <span title={t('creator.ttFavorites')}><MsIcon name="bookmark" size={14} /> {fmtCount(work.favorite_count)}</span>
          <span title={t('creator.ttComments')}><MsIcon name="comment" size={14} /> {fmtCount(work.comment_count)}</span>
          {work.feed_count > 0 && <span title={t('creator.ttFeeds')}><MsIcon name="redeem" size={14} /> {fmtCount(work.feed_count)}</span>}
        </div>
      </div>

      <div className="cc-work-actions">
        <OutlinedButton type="button" onClick={() => navigate(`/works/${work.id}/edit`)}>
          <span slot="icon"><FileEdit size={15} /></span>{t('common.edit')}
        </OutlinedButton>
        <IconButton title={t('creator.copyLink')} onClick={() => onCopy(work)}><Link2 size={17} /></IconButton>
        <IconButton title={t('creator.deleteWork')} style={{ color: 'var(--md-sys-color-error)' }} onClick={() => onDelete(work)}><Trash2 size={17} /></IconButton>
      </div>
    </div>
  );
}

export default function CreatorWorks({ works, loading, initialStatus = 'all', onChanged }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [sort, setSort] = useState('new');

  const list = works || [];

  const counts = useMemo(() => {
    const c = { all: list.length };
    list.forEach((w) => { c[w.status] = (c[w.status] || 0) + 1; });
    return c;
  }, [list]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = list.filter((w) => {
      if (status !== 'all' && w.status !== status) return false;
      if (kw && !(w.title || '').toLowerCase().includes(kw)) return false;
      return true;
    });
    const by = {
      new: (a, b) => parseTs(b.created_at) - parseTs(a.created_at),
      views: (a, b) => (b.views || 0) - (a.views || 0),
      likes: (a, b) => (b.like_count || 0) - (a.like_count || 0),
      comments: (a, b) => (b.comment_count || 0) - (a.comment_count || 0),
    }[sort];
    return [...filtered].sort(by);
  }, [list, q, status, sort]);

  const del = async (work) => {
    if (!window.confirm(t('creator.deleteConfirm', { title: work.title }))) return;
    try {
      await client.delete(`/works/${work.id}`);
      toast(t('creator.deleted'), 'success');
      onChanged?.();
    } catch {
      toast(t('creator.deleteFail'), 'error');
    }
  };

  const copy = async (work) => {
    const url = `${window.location.origin}/works/${work.id}`;
    const ok = await copyText(url);
    toast(ok ? t('creator.copyDone') : t('creator.copyManual'), ok ? 'success' : 'error');
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  }

  if (list.length === 0) {
    return (
      <EmptyState msIcon="videocam" title={t('creator.noWorks')} subtitle={t('creator.noWorksDesc')}>
        <FilledButton onClick={() => navigate('/works/new')}>
          <span slot="icon"><MsIcon name="rocket_launch" size={18} /></span>{t('creator.publishWork')}
        </FilledButton>
      </EmptyState>
    );
  }

  return (
    <div className="cc-works">
      <div className="cc-toolbar">
        <div className="cc-search">
          <OutlinedTextField label={t('creator.searchWorks')} type="search" value={q} onInput={(e) => setQ(e.target.value)} />
        </div>
        <span className="cc-toolbar-gap" />
        <FilledButton onClick={() => navigate('/works/new')}>
          <span slot="icon"><MsIcon name="rocket_launch" size={18} /></span>{t('creator.publishWork')}
        </FilledButton>
      </div>

      <div className="cc-chips">
        <span className="cc-chips-label">{t('creator.statusLabel')}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(([k, labelKey]) => (
            <FilterChip
              key={k}
              label={`${t(labelKey)}${counts[k] ? ` (${counts[k]})` : ''}`}
              selected={status === k}
              onClick={() => setStatus(k)}
            />
          ))}
        </div>
      </div>

      <div className="cc-chips">
        <span className="cc-chips-label">{t('creator.sortLabel')}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {SORTS.map(([k, labelKey]) => (
            <FilterChip key={k} label={t(labelKey)} selected={sort === k} onClick={() => setSort(k)} />
          ))}
        </div>
      </div>

      <div className="cc-result-line muted">
        {t('creator.worksSummary', { n: list.length, m: shown.length })}
      </div>

      {shown.length === 0 ? (
        <EmptyState loading={loading} msIcon="search" title={t('creator.noMatch')} subtitle={t('creator.noMatchDesc')} />
      ) : (
        <div className="cc-list">
          {shown.map((w) => <WorkRow key={w.id} work={w} onDelete={del} onCopy={copy} />)}
        </div>
      )}
    </div>
  );
}
