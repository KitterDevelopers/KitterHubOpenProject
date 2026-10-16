/**
 * 风纪委员会（2026-10-12 按新规则重做）
 *
 * 一条页面装三件事：
 *   审议库   按 待审议 / 已隐藏 / 待管理员复审 / 已恢复 分栏；每条给内容预览、
 *            「有违规 / 无违规」两个标记按钮、当前完整票型；下面是「我的标记记录」。
 *   考试     100 题库随机抽 20 题不定项（少选多选错选都算错），答对 ≥15 题获得一次申请机会。
 *   申请     考试通过后才出现「申请成为风纪委员」；再次申请必须重新考试（历史留痕）。
 *   任期     60 天，任期内标记 n/50 进度；到期 >50 免审核免答题连任，否则重新答题。
 *
 * 规范：KitterHub 品牌、无 emoji、矩形走 --radius、胶囊只给 badge/chip/进度条、
 *       所有文案走 i18n（中英成对，见 i18n/dict/committee.js）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Gavel, RefreshCw, ShieldCheck,
} from 'lucide-react';
import {
  CircularProgress, FilledButton, LinearProgress, OutlinedButton, OutlinedSelect,
  OutlinedTextField, SelectOption, TextButton,
} from '../ui';
import client, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { toast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import MsIcon from '../components/MsIcon';

const KIND_LABEL = {
  work: 'committee.kindWork',
  post: 'committee.kindPost',
  work_comment: 'committee.kindWorkComment',
  post_comment: 'committee.kindPostComment',
};

const STATE_LABEL = {
  pending: 'committee.statePending',
  hidden: 'committee.stateHidden',
  admin_review: 'committee.stateAdminReview',
  restored: 'committee.stateRestored',
  rejected: 'committee.stateRejected',
};

const SOURCE_LABEL = {
  sensitive: 'committee.sourceSensitive',
  report: 'committee.sourceReport',
  committee: 'committee.sourceCommittee',
};

const TABS = [
  ['all', 'committee.tabAll'],
  ['pending', 'committee.tabPending'],
  ['hidden', 'committee.tabHidden'],
  ['admin_review', 'committee.tabAdminReview'],
  ['restored', 'committee.tabRestored'],
];

const fmtTime = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—');

/** 选项下标数组 -> "A、C" */
function letters(idx) {
  return (idx || []).map((i) => String.fromCharCode(65 + i)).join('、') || '—';
}

/* ------------------------------------------------------------------ 小件 */
function Badge({ tone = 'plain', children }) {
  return (
    <span className={`m3-badge${tone === 'primary' ? ' m3-badge--primary' : ''}${tone === 'error' ? ' m3-badge--error' : ''}`}>
      {children}
    </span>
  );
}

function VoteRow({ votes, t }) {
  if (!votes) return null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <Badge tone={votes.violation > 0 ? 'error' : 'plain'}>
        <AlertTriangle size={12} /> {t('committee.votesViolation', { n: votes.violation })}
      </Badge>
      <Badge tone={votes.clean >= votes.need_clean ? 'primary' : 'plain'}>
        <CheckCircle2 size={12} /> {t('committee.votesClean', { n: votes.clean })}
      </Badge>
      <span className="muted" style={{ fontSize: 12 }}>
        {t('committee.ruleViolationHint', { n: votes.need_violation })} {t('committee.ruleCleanHint', { n: votes.need_clean })}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 页面 */
export default function Committee() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [me, setMe] = useState(null);
  const [queue, setQueue] = useState(null);
  const [tab, setTab] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(0);

  const loadMe = useCallback(() => (
    client.get('/committee/me').then((r) => setMe(r.data)).catch(() => setMe(null))
  ), []);
  const loadQueue = useCallback((state = tab) => (
    client.get('/committee/queue', { params: { state, limit: 60 } })
      .then((r) => setQueue(r.data))
      .catch(() => setQueue(null))
  ), [tab]);

  useEffect(() => { if (user) loadMe(); }, [user, loadMe]);
  useEffect(() => {
    if (user && me && me.is_member) loadQueue(tab);
  }, [user, me, tab, loadQueue]);

  const thresholds = me?.thresholds || queue?.thresholds || {};
  const counts = queue?.counts || me?.counts || {};

  const mark = async (item, verdict) => {
    setSettling(item.review_id);
    try {
      const r = await client.post(`/committee/reviews/${item.review_id}/mark`, { verdict });
      const action = r.data?.result?.action;
      if (action === 'hidden_and_escalated') toast(t('committee.markedHidden'), 'ok');
      else if (action === 'restored_by_committee') {
        toast(t('committee.markedRestored', { n: r.data?.result?.state?.clean || 0 }), 'ok');
      } else toast(t('committee.markedOk'), 'ok');
      await Promise.all([loadMe(), loadQueue(tab)]);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSettling(0);
    }
  };

  if (!user) {
    return (
      <div className="page-pad">
        <div className="committee-shell">
          <EmptyState msIcon="shield_person" title={t('committee.loginRequired')} subtitle={t('committee.loginRequiredDesc')} />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="page-pad">
        <div className="row" style={{ justifyContent: 'center', padding: 60 }}><CircularProgress indeterminate /></div>
      </div>
    );
  }

  const term = me.term;
  const markedN = term?.marked_count || 0;
  const markThreshold = term?.mark_threshold || thresholds.renew_marks || 50;
  const progress = Math.min(100, Math.round((markedN / Math.max(1, markThreshold)) * 100));

  const statusKey = me.is_member
    ? 'committee.statusMember'
    : me.stage === 'expired' ? 'committee.statusExpired'
      : me.stage === 'exam_passed' ? 'committee.statusCandidate'
        : me.stage === 'pending' ? 'committee.statusPending'
          : me.stage === 'rejected' ? 'committee.statusRejected'
            : 'committee.statusVisitor';

  const items = (queue && queue.items) || [];
  const mine = (queue && queue.my_marks) || [];

  return (
    <div className="page-pad">
      <div className="committee-shell">
        <div className="committee-head">
          <h1 className="committee-title"><ShieldCheck size={22} /> {t('committee.title')}</h1>
          <div className="muted committee-subtitle">{t('committee.subtitle')}</div>
        </div>

        {/* 我的状态 */}
        <div className="m3-card m3-card--filled" style={{ padding: 16, marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={me.is_member ? 'primary' : 'plain'}>{t('committee.myStatus')}：{t(statusKey)}</Badge>
              {me.exam?.last_score != null && (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {t('committee.examLast', { score: me.exam.last_score, total: me.exam.last_total, at: fmtTime(me.exam.last_at) })}
                </span>
              )}
            </div>
            {!me.is_member && (
              <Link to="/committee/exam" style={{ textDecoration: 'none' }}>
                <FilledButton>
                  <span slot="icon"><Gavel size={16} /></span>
                  {me.stage === 'exam_passed' ? t('committee.examApplyTitle') : t('committee.examTitle')}
                </FilledButton>
              </Link>
            )}
          </div>
          {typeof thresholds.report_hide === 'number' && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.9 }}>
              {t('committee.adminThresholds', {
                report_hide: thresholds.report_hide,
                violation_hide: thresholds.violation_hide,
                clean_restore: thresholds.clean_restore,
                term_days: thresholds.term_days,
                renew_marks: thresholds.renew_marks,
                exam_draw: thresholds.exam_draw,
                exam_pass: thresholds.exam_pass,
              })}
            </div>
          )}
        </div>

        {/* 任期与进度（委员才显示） */}
        {me.is_member && term && (
          <div className="m3-card m3-card--filled" style={{ padding: 16, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{t('committee.termTitle')}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {t('committee.termRange', { start: fmtTime(term.term_started_at), end: fmtTime(term.term_ends_at) })}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, margin: '8px 0 6px' }}>
              {t('committee.termDays', { days: term.days_left ?? 0, total: term.term_days })}
            </div>
            <LinearProgress value={progress / 100} />
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {t('committee.termProgress', { n: markedN, threshold: markThreshold })}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.8 }}>
              {markedN > markThreshold ? t('committee.termAutoRenewHint', { threshold: markThreshold })
                : t('committee.termExamRenewHint', { threshold: markThreshold })}
            </div>
          </div>
        )}

        {/* 审议库 */}
        {me.is_member ? (
          <>
            <div className="m3-card m3-card--filled" style={{ padding: 16, marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 15 }}>{t('committee.libraryTitle')}</b>
                <OutlinedButton onClick={() => Promise.all([loadMe(), loadQueue(tab)])} disabled={busy}>
                  <span slot="icon"><RefreshCw size={16} /></span>{t('committee.refresh')}
                </OutlinedButton>
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.9 }}>{t('committee.libraryHint')}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t('committee.countsSummary', {
                  pending: counts.pending || 0,
                  hidden: counts.hidden || 0,
                  adminReview: counts.admin_review || 0,
                  restored: counts.restored || 0,
                })}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`m3-badge${tab === key ? ' m3-badge--primary' : ''}`}
                    style={{ cursor: 'pointer', border: 'none' }}
                    onClick={() => setTab(key)}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="m3-card m3-card--filled" style={{ padding: 8, marginBottom: 12 }}>
                <EmptyState msIcon="task_alt" title={t('committee.empty')} compact />
              </div>
            ) : (
              <div className="committee-queue" style={{ marginBottom: 12 }}>
                {items.map((it) => (
                  <div key={`${it.target_type}-${it.target_id}-${it.review_id}`} className="m3-card m3-card--filled committee-item">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Badge tone={it.review_state === 'admin_review' ? 'error' : it.review_state === 'restored' ? 'primary' : 'plain'}>
                        {t(STATE_LABEL[it.review_state] || 'committee.statePending')}
                      </Badge>
                      <Badge>{t(KIND_LABEL[it.target_type] || 'committee.kindWork')}</Badge>
                      <span className="muted" style={{ fontSize: 12 }}>{t(SOURCE_LABEL[it.source] || 'committee.sourceReport')}</span>
                      {it.report_count > 0 && (
                        <span className="muted" style={{ fontSize: 12 }}>{t('committee.reportCount', { n: it.report_count })}</span>
                      )}
                      {it.hidden_reason && (
                        <span className="muted" style={{ fontSize: 12 }}>{t('committee.hiddenBy', { reason: it.hidden_reason })}</span>
                      )}
                    </div>

                    <div className="committee-item-title" style={{ marginTop: 8 }}>{it.title || '—'}</div>
                    {it.preview && <div className="committee-item-preview">{it.preview}</div>}
                    {it.sensitive_words && it.sensitive_words.length > 0 && (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                        {t('committee.sensitiveWords', { words: it.sensitive_words.join('、') })}
                      </div>
                    )}
                    <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t('committee.author', { name: (it.author && (it.author.display_name || it.author.nickname)) || '—' })}
                      </span>
                      {it.url && (
                        <Link to={it.url} className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 }} target="_blank" rel="noopener">
                          <ExternalLink size={12} /> {t('committee.openTarget')}
                        </Link>
                      )}
                    </div>

                    <VoteRow votes={it.votes} t={t} />

                    <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {it.voted ? (
                        <Badge tone={it.my_verdict === 'violation' ? 'error' : 'primary'}>
                          {it.my_verdict === 'violation' ? t('committee.markedViolation') : t('committee.markedClean')}
                        </Badge>
                      ) : (
                        <>
                          <FilledButton disabled={settling === it.review_id}
                                         onClick={() => mark(it, 'violation')}>
                            <span slot="icon"><AlertTriangle size={15} /></span>{t('committee.markViolation')}
                          </FilledButton>
                          <OutlinedButton disabled={settling === it.review_id}
                                          onClick={() => mark(it, 'clean')}>
                            <span slot="icon"><CheckCircle2 size={15} /></span>{t('committee.markClean')}
                          </OutlinedButton>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 我的标记记录 */}
            <div className="m3-card m3-card--filled" style={{ padding: 16 }}>
              <b style={{ fontSize: 15 }}>{t('committee.mineTitle')}</b>
              {mine.length === 0 ? (
                <EmptyState msIcon="history" title={t('committee.mineEmpty')} compact />
              ) : (
                <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                  {mine.map((m) => (
                    <div key={m.mark_id} className="committee-mine" style={{ border: '1px solid var(--border-soft)' }}>
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Badge tone={m.verdict === 'violation' ? 'error' : 'primary'}>
                          {m.verdict === 'violation' ? t('committee.verdictViolation') : t('committee.verdictClean')}
                        </Badge>
                        <Badge>{t(STATE_LABEL[m.review_state] || 'committee.statePending')}</Badge>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {t(KIND_LABEL[m.target_type] || 'committee.kindWork')} - {fmtTime(m.at)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13.5, marginTop: 4 }}>{(m.item && m.item.title) || `#${m.target_id}`}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="m3-card m3-card--filled" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <Gavel size={17} style={{ color: 'var(--md-sys-color-primary)' }} />
              <b style={{ fontSize: 15 }}>{t('committee.examTitle')}</b>
            </div>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
              {t('committee.examIntro', {
                total: me.exam.total_questions, draw: me.exam.draw, pass: me.exam.pass,
              })}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Link to="/committee/exam" style={{ textDecoration: 'none' }}>
                <FilledButton>
                  <span slot="icon"><Gavel size={16} /></span>{t('committee.examTitle')}
                </FilledButton>
              </Link>
            </div>
          </div>
        )}

        <div className="muted committee-foot">
          <MsIcon name="info" size={13} /> {t('committee.ruleViolationHint', { n: thresholds.violation_hide || 1 })}
        </div>
      </div>
    </div>
  );
}