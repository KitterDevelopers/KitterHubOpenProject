/* 帖子详情页顶部的「pickCat 同步状态」提示条。
 *
 * 存在的意义：KitterHub 的帖子**一定**已经发布成功，pickCat 这边可能失败（网络、会话过期、
 * 校验不过）。失败时必须让作者看得见、并且能**复用同一个 Idempotency-Key** 重试，
 * 而不是让人以为稿子丢了。
 *
 * 本地记录来自 `kh:pickcat-sync:<帖子id>`（见 sync.js），不含任何凭据。
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import { OutlinedButton, TextButton } from '../ui';
import { useI18n } from '../i18n';
import { imageWarnText, isDevServer, syncErrorText } from './api';
import { postUrlOf, readSync, repairTopicId, syncToPickCat } from './sync';

export default function PickCatSyncNote({ ownPostId, title, markdown }) {
  const { t } = useI18n();
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => { setRec(readSync(ownPostId)); }, [ownPostId]);
  useEffect(() => { reload(); }, [reload]);

  // 老记录（把首楼帖子 id 当主题 id 存进去的那批）在这里**自动纠正**：
  // 用公开的 GET /topics/<id> 反查出真正的主题 id 并写回，链接随之变正确。
  // 失败也只是不发链接（不会显示坏链），不影响页面其它内容。
  useEffect(() => {
    let alive = true;
    if (!rec || rec.status !== 'done') return undefined;
    if (postUrlOf(rec)) return undefined;
    repairTopicId(rec).then((fixed) => {
      if (alive && fixed && fixed !== rec) setRec(fixed);
    }).catch(() => {});
    return () => { alive = false; };
  }, [rec]);

  const retry = async () => {
    if (!rec || busy) return;
    setBusy(true);
    try {
      const next = await syncToPickCat({
        ownPostId,
        title: rec.title || title,
        markdown: rec.markdown || markdown,
        tagIds: rec.tagIds || [],
        kind: rec.kind || 'DISCUSSION',
        withImages: true,
      });
      setRec(next);
    } finally {
      setBusy(false);
    }
  };

  const url = postUrlOf(rec);
  if (isDevServer() || !rec) return null;

  const warnText = imageWarnText(rec.warnings, t);

  if (rec.status === 'done') {
    // 同步确实成功了，但本地记录里的 id 是老的「首楼帖子 id」、又没能反查出主题 id：
    // 这时**不给坏链**，只说明链接待修正（重新同步一次即可拿到正确地址）。
    if (!url) {
      return (
        <div className="pc-note pc-note--warn">
          <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {t('pc.syncedOn')} {t('pc.linkPending')}
          </span>
        </div>
      );
    }
    return (
      <div className="pc-note pc-note--ok">
        <Check size={15} style={{ flexShrink: 0, marginTop: 2 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          {t('pc.syncedOn')}{' '}
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t('pc.syncedLink')} <ExternalLink size={12} style={{ verticalAlign: -1 }} />
          </a>
        </span>
      </div>
    );
  }

  const expired = rec.status === 'expired';

  return (
    <div className={`pc-note ${expired ? 'pc-note--warn' : 'pc-note--err'}`}>
      <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {expired ? t('pc.expiredTitle') : t('pc.failedTitle')}
        </div>
        <div style={{ marginTop: 2, lineHeight: 1.7 }}>{syncErrorText(rec.error, t)}</div>
        {warnText && <div style={{ marginTop: 2, lineHeight: 1.7 }}>{warnText}</div>}
        {expired && <div style={{ marginTop: 2, lineHeight: 1.7 }}>{t('pc.expiredHint')}</div>}
        <div className="muted" style={{ marginTop: 2, lineHeight: 1.7 }}>{t('pc.khSaved')}</div>
        {rec.attempts > 1 && (
          <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>{t('pc.attempts', { n: rec.attempts })}</div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <OutlinedButton type="button" onClick={retry} disabled={busy} style={{ minHeight: 44 }}>
            <span slot="icon"><RefreshCw size={16} /></span>
            {busy ? t('common.loading') : t('pc.retry')}
          </OutlinedButton>
          <TextButton type="button" onClick={reload} disabled={busy} style={{ minHeight: 44 }}>
            {t('pc.refreshStatus')}
          </TextButton>
        </div>
        {!expired && <div className="muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.7 }}>{t('pc.sameKey')}</div>}
      </div>
    </div>
  );
}
