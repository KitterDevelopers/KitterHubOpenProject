/**
 * 风纪委员考试与申请（2026-10-12 新规则）。
 *
 *   考试：后端题库 100 道不定项选择题，每次随机抽 20 题；答对 ≥15 题才算通过，
 *         通过后获得**一次**申请机会（少选、多选、错选均为错）。
 *   申请：只有通过考试才能申请；管理员审批；再次申请必须重新考试（历史留痕）。
 *   续任：任期届满且标记未超过 50 条时，在这里重新答题通过即可免审核连任。
 *
 * 规范：无 emoji、矩形 --radius、可点区域 ≥44px、文案全部 i18n。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Gavel, RefreshCw, XCircle } from 'lucide-react';
import { CircularProgress, FilledButton, OutlinedButton, OutlinedTextField } from '../ui';
import client, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { toast } from '../components/Toast';
import EmptyState from '../components/EmptyState';

const letter = (i) => String.fromCharCode(65 + i);

export default function CommitteeExam() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [me, setMe] = useState(null);
  const [paper, setPaper] = useState(null);       // { question_ids, questions }
  const [answers, setAnswers] = useState({});     // { qid: [idx] }
  const [result, setResult] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadMe = useCallback(() => (
    client.get('/committee/me').then((r) => setMe(r.data)).catch(() => setMe(null))
  ), []);

  useEffect(() => { if (user) loadMe(); }, [user, loadMe]);

  const start = async () => {
    setBusy(true); setResult(null); setShowDetail(false); setAnswers({});
    try {
      const r = await client.get('/committee/exam');
      setPaper({ question_ids: r.data.question_ids, questions: r.data.questions });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (q, idx) => {
    setAnswers((prev) => {
      const cur = prev[q.id] || [];
      if (q.multi) {
        return { ...prev, [q.id]: cur.includes(idx) ? cur.filter((x) => x !== idx) : [...cur, idx].sort((a, b) => a - b) };
      }
      return { ...prev, [q.id]: cur.includes(idx) ? [] : [idx] };
    });
  };

  const answeredCount = paper ? paper.questions.filter((q) => (answers[q.id] || []).length > 0).length : 0;

  const submit = async () => {
    if (!paper) return;
    setBusy(true);
    try {
      const r = await client.post('/committee/exam', { question_ids: paper.question_ids, answers });
      setResult(r.data);
      setPaper(null);
      await loadMe();
      if (r.data.already_submitted) toast(t('committee.examAlready'), 'info');
      else if (r.data.passed) toast(t('committee.examPassed'), 'ok');
      else toast(t('committee.examFailed', { pass: r.data.pass }), 'info');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await client.post('/committee/apply', { note: note.trim() });
      toast(t('committee.examApplied'), 'ok');
      await loadMe();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
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

  if (me.is_member) {
    return (
      <div className="page-pad">
        <div className="committee-shell">
          <h1 className="committee-title"><Gavel size={22} /> {t('committee.title')}</h1>
          <div className="m3-card m3-card--filled" style={{ padding: 16, marginTop: 12 }}>
            <EmptyState msIcon="verified" title={t('committee.statusMember')} compact />
            <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
              <OutlinedButton onClick={() => navigate('/committee')}>{t('committee.libraryTitle')}</OutlinedButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canApply = !!me.exam.can_apply && !me.application;
  const pendingApp = me.application && me.application.status === 'pending';

  return (
    <div className="page-pad">
      <div className="committee-shell">
        <h1 className="committee-title"><Gavel size={22} /> {t('committee.examTitle')}</h1>
        <div className="m3-card m3-card--filled" style={{ padding: 16, marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.9 }}>
            {t('committee.examIntro', {
              total: me.exam.total_questions, draw: me.exam.draw, pass: me.exam.pass,
            })}
          </div>
          {me.exam.last_score != null && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {t('committee.examLast', {
                score: me.exam.last_score, total: me.exam.last_total,
                at: me.exam.last_at ? String(me.exam.last_at).slice(0, 16).replace('T', ' ') : '—',
              })}
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <FilledButton onClick={start} disabled={busy || !!paper}>
              <span slot="icon"><RefreshCw size={16} /></span>
              {me.exam.attempts > 0 ? t('committee.examRestart') : t('committee.examStart')}
            </FilledButton>
            <Link to="/committee" style={{ textDecoration: 'none' }}>
              <OutlinedButton>{t('committee.libraryTitle')}</OutlinedButton>
            </Link>
          </div>
        </div>

        {/* 试卷 */}
        {paper && (
          <div className="m3-card m3-card--filled" style={{ padding: 16, marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15 }}>{t('committee.examTitle')}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {t('committee.examAnswered', { n: answeredCount, total: paper.questions.length })}
              </span>
            </div>
            <div className="stack" style={{ gap: 14, marginTop: 12 }}>
              {paper.questions.map((q, qi) => (
                <div key={q.id}>
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span className="muted" style={{ fontSize: 13, minWidth: 22 }}>{qi + 1}.</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.8 }}>{q.stem}</div>
                      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {q.source} - {q.multi ? t('committee.examMulti') : t('committee.examSingle')}
                      </div>
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                    {q.options.map((opt, oi) => {
                      const picked = (answers[q.id] || []).includes(oi);
                      return (
                        <label key={oi} className={`kh-choice${picked ? ' is-picked' : ''}`}>
                          <input
                            type={q.multi ? 'checkbox' : 'radio'}
                            name={`q-${q.id}`}
                            checked={picked}
                            onChange={() => toggle(q, oi)}
                          />
                          <span className="kh-choice-mark">{letter(oi)}</span>
                          <span className="kh-choice-text">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <FilledButton onClick={submit} disabled={busy}>
                <span slot="icon"><CheckCircle2 size={16} /></span>{busy ? t('committee.examBusy') : t('committee.examSubmit')}
              </FilledButton>
              <OutlinedButton onClick={() => { setPaper(null); setAnswers({}); }}>{t('committee.refresh')}</OutlinedButton>
            </div>
          </div>
        )}

        {/* 成绩 */}
        {result && (
          <div className="m3-card m3-card--filled" style={{ padding: 16, marginTop: 12 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {result.passed
                ? <CheckCircle2 size={18} style={{ color: 'var(--md-sys-color-primary)' }} />
                : <XCircle size={18} style={{ color: 'var(--md-sys-color-error)' }} />}
              <b style={{ fontSize: 15 }}>
                {t('committee.examScore', { score: result.score, total: result.total, pass: result.pass })}
              </b>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.9 }}>{result.message}</div>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <OutlinedButton onClick={() => setShowDetail((v) => !v)}>{t('committee.examReview')}</OutlinedButton>
              <OutlinedButton onClick={start} disabled={busy}>{t('committee.examRestart')}</OutlinedButton>
            </div>
            {showDetail && (
              <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                {(result.detail || []).map((d, i) => (
                  <div key={d.id} className="committee-mine" style={{ border: '1px solid var(--border-soft)' }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="muted" style={{ fontSize: 12 }}>{i + 1}. {d.id}</span>
                      <span className={`m3-badge${d.ok ? ' m3-badge--primary' : ' m3-badge--error'}`}>
                        {d.ok ? t('committee.examCorrect') : t('committee.examWrong')}
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t('committee.examYourAnswer', { answer: (d.chosen || []).map(letter).join('、') || t('committee.examNoAnswer') })}
                        {' · '}
                        {t('committee.examCorrectAnswer', { answer: (d.answer || []).map(letter).join('、') })}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.8 }}>
                      {t('committee.examAnalysis')}：{d.analysis}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 申请 */}
        <div className="m3-card m3-card--filled" style={{ padding: 16, marginTop: 12 }}>
          <b style={{ fontSize: 15 }}>{t('committee.examApplyTitle')}</b>
          <div className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.9 }}>{t('committee.examApplyHint')}</div>
          {pendingApp ? (
            <div className="m3-badge m3-badge--primary" style={{ display: 'inline-block', marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius)' }}>
              {t('committee.statusPending')}
              {me.application.review_note ? `：${me.application.review_note}` : ''}
            </div>
          ) : canApply ? (
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              <OutlinedTextField label={t('committee.examApplyNote')} value={note}
                                 onInput={(e) => setNote(e.target.value)} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <FilledButton onClick={apply} disabled={busy}>
                  <span slot="icon"><CheckCircle2 size={16} /></span>{t('committee.examApplySubmit')}
                </FilledButton>
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              {me.stage === 'rejected' ? t('committee.statusRejected') : t('committee.examNeedExam')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}