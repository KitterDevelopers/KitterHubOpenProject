import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FilterChip, CircularProgress, FilledButton } from '../../ui';
import client from '../../api/client';
import UserAvatar from '../Avatar';
import EmptyState from '../EmptyState';
import MsIcon from '../MsIcon';
import { formatTime, displayName, fmtCount } from '../../utils';
import { useI18n } from '../../i18n';

const FILTERS = [
  ['all', 'common.all'],
  ['work', 'creator.filterWork'],
  ['post', 'creator.filterPost'],
];

export default function CreatorInteract() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState('all');

  useEffect(() => {
    let alive = true;
    client.get('/users/me/liked_by')
      .then((r) => { if (alive) setItems(r.data || []); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(
    () => (kind === 'all' ? items : items.filter((it) => it.kind === kind)),
    [items, kind]
  );

  const counts = useMemo(() => ({
    all: items.length,
    work: items.filter((i) => i.kind === 'work').length,
    post: items.filter((i) => i.kind === 'post').length,
  }), [items]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px 0' }}><CircularProgress indeterminate /></div>;
  }

  if (failed) {
    return <EmptyState msIcon="error" title={t('creator.interactFailed')} subtitle={t('creator.interactFailedDesc')} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState msIcon="favorite" title={t('creator.noLikes')} subtitle={t('creator.noLikesDesc')}>
        <FilledButton onClick={() => navigate('/discover')}>
          <span slot="icon"><MsIcon name="whatshot" size={18} /></span>{t('creator.goDiscover')}
        </FilledButton>
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

      <div className="cc-result-line muted">
        {t('creator.likesSummary', { n: fmtCount(items.length), m: shown.length })}
      </div>

      {shown.length === 0 ? (
        <EmptyState loading={loading} msIcon="favorite" title={t('creator.noLikesInFilter')} />
      ) : (
        <div className="cc-list">
          {shown.map((it, i) => {
            const isWork = it.kind === 'work';
            return (
              <div key={`${it.kind}-${it.target_id}-${i}`} className="cc-like-row">
                {it.liker ? (
                  <Link to={`/users/${it.liker.uid}`}><UserAvatar user={it.liker} size={40} /></Link>
                ) : (
                  <span className="cc-like-ph"><MsIcon name="person" size={22} /></span>
                )}

                <div className="cc-like-body">
                  <div className="cc-like-head">
                    {it.liker ? (
                      <Link to={`/users/${it.liker.uid}`} className="cc-like-name">{displayName(it.liker)}</Link>
                    ) : (
                      <span className="cc-like-name">{t('creator.mysteryUser')}</span>
                    )}
                    <span className="muted">{isWork ? t('creator.likedYourWork') : t('creator.likedYourPost')}</span>
                    <span className={`cc-status cc-status--${isWork ? 'published' : 'scheduled'}`}>
                      <MsIcon name={isWork ? 'videocam' : 'article'} size={13} />{isWork ? t('creator.filterWork') : t('creator.filterPost')}
                    </span>
                  </div>
                  <Link to={isWork ? `/works/${it.target_id}` : `/posts/${it.target_id}`} className="cc-like-target">
                    {t('creator.quotedTitle', { title: it.target_title || t('creator.deleted') })}
                  </Link>
                </div>

                <span className="muted cc-like-time">{formatTime(it.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
