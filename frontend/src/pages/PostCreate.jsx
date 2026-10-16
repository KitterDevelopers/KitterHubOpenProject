import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, X, PencilLine, Save, Send, Users, ChevronDown, ListChecks, ImagePlus, Check, TriangleAlert, ExternalLink, Link2 } from 'lucide-react';
import { OutlinedTextField, OutlinedSelect, SelectOption, FilledButton, TextButton, FilterChip } from '../ui';
import ImageUpload from '../components/ImageUpload';
import MarkdownEditor from '../components/markdown/MarkdownEditor';
import client from '../api/client';
import { toast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';
import PickCatSyncPanel from '../pickcat/PickCatSyncPanel';
import { imageWarnText, isDevServer, syncErrorText } from '../pickcat/api';
import { postUrlOf, syncToPickCat } from '../pickcat/sync';

const CATS = ['讨论', '教程', '求助', '展示'];
// 分类的中文原值会原样提交给后端，这里只把展示文案换成词条
const CAT_KEYS = {
  讨论: 'form.catDiscussion',
  教程: 'form.catTutorial',
  求助: 'form.catHelp',
  展示: 'form.catShowcase',
};

// 发帖页（重构版）：Markdown 编辑器 + 实时预览 + 分类/圈子/配图/投票 + 草稿自动保存
export default function PostCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const draftParam = params.get('draft');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('讨论');
  const [imageUrl, setImageUrl] = useState('');
  const [pollOn, setPollOn] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTip, setSavedTip] = useState('');
  const [sideOpen, setSideOpen] = useState(true);

  // ---- 同步发帖到 pickCat（可选，默认不勾）----
  // 状态机：本站帖子**先发成功**，pickCat 只是可选的第二步；第二步失败不回滚、不丢内容。
  const [syncOn, setSyncOn] = useState(false);       // 勾选框
  const [syncTags, setSyncTags] = useState([]);      // 选中的 pickCat 标签 id
  const [createdId, setCreatedId] = useState(null);  // 本站已成功创建的帖子 id
  const [syncStatus, setSyncStatus] = useState('');  // '' | syncing | done | failed | expired
  const [syncErr, setSyncErr] = useState(null);      // 归一化后的错误
  const [syncResult, setSyncResult] = useState(null); // 成功时的记录（含 postUrl）
  const [syncing, setSyncing] = useState(false);

  const loadedRef = useRef(false);
  const timerRef = useRef(null);
  const draftIdRef = useRef(null);

  // 载入草稿：优先 ?draft=id，否则最近一条帖子草稿
  useEffect(() => {
    const apply = (d) => {
      if (!d) return;
      const dd = d.data || {};
      draftIdRef.current = d.id;
      setTitle(dd.title || '');
      setContent(dd.content || '');
      setCategory(dd.category || '讨论');
      setImageUrl(dd.image_url || '');
      if (dd.poll) {
        setPollOn(true);
        setPollQ(dd.poll.question || '');
        // options 有两种历史形态：草稿里存的是纯文本数组，已发布帖子存的是 {text} 对象。
        // 只按其中一种解会把另一类读成 undefined，渲染 pollInvalid 时 o.trim() 直接崩掉整页。
        setPollOpts(
          (Array.isArray(dd.poll.options) ? dd.poll.options : []).map((o) =>
            typeof o === 'string' ? o : o?.text ?? ''
          )
        );
      }
      toast(t('form.postRestored'));
    };
    const finish = () => {
      loadedRef.current = true;
    };
    // 只有**明确指定草稿**（从「我的草稿」点进来带 ?draft=）才恢复；直接打开 /posts/new
    // 一定是空白表单 —— 站长要求：新建发帖不要自动灌入最近那份草稿。
    if (draftParam) {
      client
        .get(`/drafts/${draftParam}`)
        .then((r) => apply(r.data))
        .catch(() => {})
        .finally(finish);
    } else {
      finish();
    }
  }, [draftParam]);

  const draftPayload = useCallback(
    () => ({
      title,
      content,
      category,
      image_url: imageUrl,
      poll: pollOn ? { question: pollQ, options: pollOpts.filter((o) => (o || '').trim()) } : null,
    }),
    [title, content, category, imageUrl, pollOn, pollQ, pollOpts]
  );

  const doSave = useCallback(async () => {
    const payload = { draft_type: 'post', draft_id: draftIdRef.current || undefined, data: draftPayload() };
    let res;
    try {
      res = await client.post('/drafts', payload);
    } catch (e) {
      // 草稿已经在别处被发布或删除（后端 404 草稿不存在）。丢掉旧 id 重新存一份，
      // 否则自动保存会一直静默失败，正在写的内容永远存不进去。
      if (e?.response?.status !== 404 || !draftIdRef.current) throw e;
      draftIdRef.current = null;
      res = await client.post('/drafts', { draft_type: 'post', data: draftPayload() });
    }
    draftIdRef.current = res.data.id;
    setSavedTip(t('form.draftSaved', { time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }));
    return res.data.id;
  }, [draftPayload]);

  // 自动保存（防抖 800ms）
  useEffect(() => {
    if (!loadedRef.current) return undefined;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSave().catch(() => {});
    }, 800);
    return () => clearTimeout(timerRef.current);
  }, [doSave]);

  const saveAsNew = async () => {
    draftIdRef.current = null;
    const id = await doSave();
    toast(t('form.draftSavedNew', { id }));
  };

  // ---- pickCat 同步（本站发帖成功之后才执行）----
  const runSync = useCallback(async (ownId, snap) => {
    setSyncStatus('syncing');
    setSyncErr(null);
    const rec = await syncToPickCat({
      ownPostId: ownId,
      title: snap.title,
      markdown: snap.content,
      tagIds: snap.tagIds,
      kind: 'DISCUSSION',
      withImages: true,
    });
    setSyncResult(rec);
    if (rec.status === 'done') {
      setSyncStatus('done');
    } else {
      setSyncStatus(rec.status === 'expired' ? 'expired' : 'failed');
      setSyncErr(rec.error || {});
    }
    return rec;
  }, []);

  // 已经发过一次之后又改了标题/正文：允许再次发布（不会静默），也不清掉既有的同步提示
  useEffect(() => {
    if (!createdId || syncing) return;
    setCreatedId(null);
    setSyncResult(null);
    setSyncStatus('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  // 重试时必须复用**第一次尝试时**的原稿与标签（幂等键在 sync.js 里复用，请求体也保持一致）
  const syncSnapshot = () => ({
    title: (syncResult && syncResult.title) || title.trim(),
    content: (syncResult && syncResult.markdown) || content,
    tagIds: (syncResult && syncResult.tagIds) || syncTags,
    kind: (syncResult && syncResult.kind) || 'DISCUSSION',
  });

  const submit = useCallback(async () => {
    // 已经在本站发布过了：pickCat 那一步失败过时只允许「重试同步」，避免重复发帖
    if (createdId) {
      if (!syncOn || syncing || syncStatus === 'expired') return;
      setSyncing(true);
      try {
        await runSync(createdId, syncSnapshot());
      } finally {
        setSyncing(false);
      }
      return;
    }

    setError('');
    if (!title.trim()) {
      setError(t('form.needPostTitle'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!content.trim()) {
      setError(t('form.needPostBody'));
      return;
    }
    if (syncOn && !isDevServer() && syncTags.length === 0) {
      setError(t('pc.needTag'));
      return;
    }
    setBusy(true);
    try {
      const poll = pollOn ? { question: pollQ, options: pollOpts.filter((o) => (o || '').trim()) } : undefined;
      const res = await client.post('/posts', {
        title: title.trim(),
        content,
        category,
        poll,
        image_url: imageUrl || null,
      });
      // 到这里为止：KitterHub 的帖子已经**成功**。后面的 pickCat 步骤无论怎么失败都不回滚它。
      const ownId = res.data.id;
      const snap = { title: title.trim(), content, tagIds: syncTags };
      if (draftIdRef.current) await client.delete(`/drafts/${draftIdRef.current}`).catch(() => {});
      draftIdRef.current = null;
      if (!syncOn || isDevServer()) {
        navigate(`/posts/${ownId}`);
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setCreatedId(ownId);
      setSyncing(true);
      try {
        await runSync(ownId, snap);
      } finally {
        setSyncing(false);
        setBusy(false);
      }
      return;
    } catch (e) {
      setError(err(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }, [title, content, category, pollOn, pollQ, pollOpts, imageUrl, navigate, createdId, syncOn, syncTags, syncing, syncResult, syncStatus, runSync, err, t]);

  const retrySync = useCallback(async () => {
    if (!createdId || syncing) return;
    setSyncing(true);
    try {
      await runSync(createdId, syncSnapshot());
    } finally {
      setSyncing(false);
    }
  }, [createdId, syncing, syncResult, title, content, syncTags, runSync]);

  // 发布后提示条里的失败原因与图片告警（与详情页提示条共用同一套文案）
  const syncReason = syncErrorText(syncErr, t);
  const syncWarn = syncResult ? imageWarnText(syncResult.warnings, t) : '';
  // 帖子详情页地址统一由 postUrlOf 现拼（官方是 /forum/post/<id>，不是 /topic/<id>）
  const syncUrl = syncResult ? postUrlOf(syncResult) : null;

  const setOpt = (i, v) => setPollOpts((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  const addOpt = () => {
    if (pollOpts.length < 4) setPollOpts((prev) => [...prev, '']);
  };
  const removeOpt = (i) => setPollOpts((prev) => prev.filter((_, idx) => idx !== i));

  const pollInvalid = pollOn && (!pollQ.trim() || pollOpts.filter((o) => (o || '').trim()).length < 2);

  return (
    <div className="page-pad">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ margin: 0, fontWeight: 800, gap: 8, alignItems: 'center', fontSize: 24 }}>
            <PencilLine size={22} /> {t('creator.publishPost')}
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {t('form.postIntroBefore')} <b>Markdown</b> {t('form.postIntroAfter')}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <TextButton type="button" onClick={() => setSideOpen((v) => !v)}>
            <ChevronDown slot="icon" size={16} style={{ transform: sideOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .2s' }} />
            {sideOpen ? t('form.collapseOptions') : t('form.expandOptions')}
          </TextButton>
        </div>
      </div>

      {error && (
        <div className="m3-badge m3-badge--error" style={{ marginBottom: 16, padding: '10px 14px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>
          {error}
        </div>
      )}

      <div className={`post-grid${sideOpen ? '' : ' side-hidden'}`}>
        <div className="post-main">
          <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
            <OutlinedTextField
              label={t('form.titleLabel')}
              value={title}
              maxLength={200}
              onInput={(e) => setTitle(e.target.value)}
              style={{ width: '100%' }}
              supporting-text={`${title.length}/200`}
            />
            <div style={{ marginTop: 16 }}>
              <MarkdownEditor
                value={content}
                onChange={setContent}
                onSubmit={submit}
                placeholder={t('form.bodyPlaceholder')}
                label={t('form.bodyLabel')}
              />
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <FilledButton
              type="button"
              onClick={createdId ? retrySync : submit}
              disabled={busy || syncing || pollInvalid || (createdId && (!syncOn || syncStatus === 'expired'))}
              style={{ flex: 1, minWidth: 160 }}
            >
              <Send slot="icon" size={18} />
              {syncing ? t('pc.syncing') : (busy ? t('form.publishing') : (createdId ? t('pc.retry') : t('creator.publishPost')))}
            </FilledButton>
            <TextButton type="button" onClick={saveAsNew} disabled={busy}>
              <Save slot="icon" size={16} /> {t('form.saveAsNewDraft')}
            </TextButton>
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>{savedTip || t('form.autoSaveOnShort')}</span>
          </div>

          {/* 本站已发布成功，pickCat 这一步的结果集中显示在这里（永不回滚本站帖子） */}
          {createdId && (
            <div className={`pc-note${syncStatus === 'done' ? ' pc-note--ok' : syncStatus === 'expired' ? ' pc-note--warn' : ' pc-note--err'}`} style={{ marginTop: 16, marginBottom: 0 }}>
              {syncStatus === 'done' ? (
                <Check size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <TriangleAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {syncStatus === 'done' ? t('pc.postPublishedAndSynced')
                    : syncStatus === 'expired' ? t('pc.expiredTitle')
                      : syncStatus === 'syncing' ? t('pc.syncing') : t('pc.failedTitle')}
                </div>
                <div style={{ marginTop: 4, lineHeight: 1.7 }}>
                  {syncStatus === 'done'
                    ? t('pc.postSyncedHint')
                    : syncStatus === 'syncing'
                      ? t('pc.syncingHint')
                      : syncReason}
                </div>
                {syncStatus !== 'syncing' && syncWarn && (
                  <div style={{ marginTop: 4, lineHeight: 1.7 }}>{syncWarn}</div>
                )}
                {(syncStatus === 'failed' || syncStatus === 'expired') && (
                  <div style={{ marginTop: 4, lineHeight: 1.7 }}>{t('pc.khSaved')}</div>
                )}
                {syncStatus === 'expired' && (
                  <div style={{ marginTop: 4, lineHeight: 1.7 }}>{t('pc.expiredHint')}</div>
                )}
                {syncStatus === 'failed' && (
                  <div className="muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.7 }}>{t('pc.sameKey')}</div>
                )}
                <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <Link to={`/posts/${createdId}`}>
                    <FilledButton type="button" style={{ minHeight: 44 }}>{t('pc.viewPost')}</FilledButton>
                  </Link>
                  {syncStatus === 'expired' ? (
                    <TextButton type="button" onClick={() => setSideOpen(true)} style={{ minHeight: 44 }}>
                      <Link2 slot="icon" size={15} /> {t('pc.reloginAction')}
                    </TextButton>
                  ) : (
                    syncOn && (
                      <TextButton type="button" onClick={retrySync} disabled={syncing} style={{ minHeight: 44 }}>
                        <Send slot="icon" size={15} /> {syncing ? t('pc.syncing') : t('pc.retry')}
                      </TextButton>
                    )
                  )}
                  {syncStatus === 'done' && syncUrl && (
                    <a href={syncUrl} target="_blank" rel="noopener noreferrer">
                      <TextButton type="button" style={{ minHeight: 44 }}>
                        <ExternalLink slot="icon" size={15} /> {t('pc.viewOnPickcat')}
                      </TextButton>
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {sideOpen && (
          <aside className="post-side">
            <div className="m3-card" style={{ padding: 16 }}>
              <div className="post-side-title"><ListChecks size={16} /> {t('form.postSettings')}</div>

              <div className="stack" style={{ gap: 12, marginTop: 12 }}>
                <OutlinedSelect label={t('form.category')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
                  {CATS.map((c) => (
                    <SelectOption key={c} value={c} headline={t(CAT_KEYS[c])} />
                  ))}
                </OutlinedSelect>

                <div>
                  <div className="post-side-label"><ImagePlus size={15} /> {t('form.coverImageOptional')}</div>
                  <ImageUpload value={imageUrl} onChange={setImageUrl} label={t('form.uploadImage')} previewSize={72} />
                </div>

                <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
                  <PickCatSyncPanel
                    enabled={syncOn}
                    onEnabledChange={setSyncOn}
                    onTagsChange={setSyncTags}
                    onBound={() => setSyncOn(true)}
                  />
                </div>

                {!pollOn ? (
                  <TextButton type="button" onClick={() => setPollOn(true)} style={{ alignSelf: 'flex-start' }}>
                    <Plus slot="icon" size={16} /> {t('form.addPoll')}
                  </TextButton>
                ) : (
                  <div className="m3-card" style={{ padding: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="post-side-label">{t('form.poll')}</span>
                      <TextButton
                        type="button"
                        onClick={() => setPollOn(false)}
                        style={{ '--md-sys-color-primary': 'var(--md-sys-color-error)', fontSize: 12 }}
                      >
                        {t('form.remove')}
                      </TextButton>
                    </div>
                    <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                      <OutlinedTextField
                        label={t('form.question')}
                        value={pollQ}
                        maxLength={50}
                        onInput={(e) => setPollQ(e.target.value)}
                        style={{ width: '100%' }}
                      />
                      {pollOpts.map((o, i) => (
                        <div key={i} className="row" style={{ gap: 6 }}>
                          <OutlinedTextField
                            label={t('form.optionN', { n: i + 1 })}
                            value={o}
                            maxLength={30}
                            onInput={(e) => setOpt(i, e.target.value)}
                            style={{ flex: 1 }}
                          />
                          {pollOpts.length > 2 && (
                            <TextButton type="button" onClick={() => removeOpt(i)} aria-label={t('form.removeOption')}>
                              <X size={16} />
                            </TextButton>
                          )}
                        </div>
                      ))}
                      {pollOpts.length < 4 && (
                        <TextButton type="button" onClick={addOpt} style={{ alignSelf: 'flex-start', fontSize: 13 }}>
                          <Plus slot="icon" size={14} /> {t('form.addOption')}
                        </TextButton>
                      )}
                      {pollInvalid && <div className="muted" style={{ fontSize: 12, color: 'var(--md-sys-color-error)' }}>{t('form.pollHint')}</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="m3-card" style={{ padding: 16 }}>
              <div className="post-side-title"><Users size={16} /> {t('form.writingTips')}</div>
              <ul className="post-tips">
                <li>{t('form.tipHeadPre')} <b>{t('form.tipHeadCode')}</b> {t('form.tipHeadPost')}</li>
                <li>{t('form.tipImagePre')} <b>{t('form.tipImageBold')}</b>{t('form.tipImagePost')}</li>
                <li><b>{t('form.tipTopicBold')}</b> {t('form.tipTopicPost')}</li>
                <li><b>{t('form.tipMentionBold')}</b> {t('form.tipMentionPost')}</li>
                <li>{t('form.tipDraftsPost')}</li>
                {user?.level < 1 && <li style={{ color: 'var(--md-sys-color-error)' }}>{t('form.levelNoPost')}</li>}
              </ul>
              <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <FilterChip label={t('form.snippetH2')} onClick={() => setContent((c) => `${c}\n## ${t('form.insertHeading')}\n`)} />
                <FilterChip label={t('form.snippetBold')} onClick={() => setContent((c) => `${c}**${t('form.insertImportant')}**`)} />
                <FilterChip label={t('form.snippetList')} onClick={() => setContent((c) => `${c}\n- ${t('form.insertPoint1')}\n- ${t('form.insertPoint2')}\n`)} />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
