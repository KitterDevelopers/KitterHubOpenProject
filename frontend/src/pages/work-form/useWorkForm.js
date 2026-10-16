/**
 * 投稿表单的全部状态与行为。
 *
 * 收敛了原来散在 WorkCreate.jsx 里的 18 个 useState、派生的校验状态、草稿自动保存和提交逻辑，
 * 页面组件只负责排版。
 *
 * 保存语义：
 * - 草稿自动保存（防抖 800ms）到后端 `/drafts`，`?draft=<id>` 可指定某一份；
 * - 进页面时会尝试恢复最近一份 `draft_type=work` 的草稿；
 * - 提交成功后删掉这份草稿。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import { toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';
import {
  HTTP_RE, MAX_TAGS, SOURCE_CODEMAO, SOURCE_MANUAL, SOURCE_SCRATCH, SOURCE_URL, workTypeOf,
} from './constants';
import { makeCoverFromSb3 } from './scratchCover';

export default function useWorkForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draftParam = params.get('draft');
  const { user } = useAuth();
  const { t } = useI18n();
  const errOf = useErr();

  const [editors, setEditors] = useState([]);
  const [source, setSource] = useState(user?.codemao_uid ? SOURCE_CODEMAO : SOURCE_MANUAL);
  const [attr, setAttr] = useState('original');       // original 原创 / repost 转载
  const [isOriginal, setIsOriginal] = useState(false); // 原创声明
  const [originalUrl, setOriginalUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [editorCode, setEditorCode] = useState('');
  const [editorWorkId, setEditorWorkId] = useState('');
  const [category, setCategory] = useState('游戏');
  const [coverUrl, setCoverUrl] = useState('');
  // ---- Scratch 作品（.sb3）----
  const [sb3, setSb3] = useState(null);            // { url, size, sha256, name }
  const [sb3Busy, setSb3Busy] = useState(false);   // 上传中
  const [coverMode, setCoverMode] = useState('manual'); // manual 自己传 / auto 自动取舞台背景
  const [coverBusy, setCoverBusy] = useState(false);    // 自动生成中
  const [tagArr, setTagArr] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [publishMode, setPublishMode] = useState('auto'); // auto / review / scheduled
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTip, setSavedTip] = useState('');
  /** 从编程猫导入后，用来在界面上显示「已自动填入哪些东西」 */
  const [imported, setImported] = useState(null);

  const loadedRef = useRef(false);
  const timerRef = useRef(null);
  const draftIdRef = useRef(null);
  /**
   * 来源是否已经被「确定」过（用户手动选过，或草稿里存过）。
   * ⚠️ 为什么需要它：`user` 是异步加载的，首帧一定是 null，
   *    所以 `useState(user?.codemao_uid ? CODEMAO : MANUAL)` 会让**绑定过编程猫的用户也默认落在
   *    「手动填写编号」**。这里在 user 到位后补一次默认值，但只要用户/草稿已经定了就不再改。
   */
  const sourceLockedRef = useRef(false);
  const pickSource = (v) => {
    sourceLockedRef.current = true;
    setSource(v);
  };

  const workType = workTypeOf(source);

  // 绑定过编程猫 → 默认走「从编程猫导入」（这是本站最主要的投稿路径）
  useEffect(() => {
    if (sourceLockedRef.current) return;
    if (user?.codemao_uid) setSource(SOURCE_CODEMAO);
  }, [user?.codemao_uid]);

  // ---- 初始化：编辑器清单 + 恢复草稿 ----
  useEffect(() => {
    client.get('/works/editors')
      .then((r) => {
        setEditors(r.data || []);
        setEditorCode((cur) => cur || r.data?.[0]?.code || '');
      })
      .catch(() => {});

    const apply = (d) => {
      if (!d) return;
      draftIdRef.current = d.id;
      const v = d.data || {};
      setTitle(v.title || '');
      setDescription(v.description || '');
      setSourceUrl(v.source_url || '');
      setEditorCode(v.editor_code || '');
      setEditorWorkId(v.editor_work_id || '');
      setCategory(v.category || '游戏');
      setCoverUrl(v.cover_url || '');
      if (v.sb3_url) setSb3({ url: v.sb3_url, size: v.sb3_size || 0, sha256: '', name: v.sb3_name || '' });
      if (v.cover_mode === 'auto' || v.cover_mode === 'manual') setCoverMode(v.cover_mode);
      setTagArr((v.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean));
      setAttr(v.is_repost ? 'repost' : 'original');
      setOriginalUrl(v.original_url || '');
      setIsOriginal(Boolean(v.is_original));
      if (v.scheduled_at) {
        setPublishMode('scheduled');
        setScheduledAt(v.scheduled_at);
      }
      // 草稿里存过来源就用它；老草稿没有这个字段，按有没有编号推断
      if (v.source && [SOURCE_CODEMAO, SOURCE_MANUAL, SOURCE_URL, SOURCE_SCRATCH].includes(v.source)) {
        sourceLockedRef.current = true;
        setSource(v.source);
      } else if (v.source_url) {
        sourceLockedRef.current = true;
        setSource(SOURCE_URL);
      }
      toast(t('form.draftRestored'));
    };
    const finish = () => { loadedRef.current = true; };
    // 只有**明确指定草稿**（从「我的草稿」点进来 / 创作中心「继续创作」带 ?draft=）才恢复。
    // 直接打开 /works/new 时必须是**空白表单** —— 站长要求：新建投稿不要自动把上次的草稿灌进来
    // （以前会 find 最近一份 work 草稿并 toast「已恢复草稿」，导致每次新建都像在改旧稿）。
    if (draftParam) {
      client.get(`/drafts/${draftParam}`).then((r) => apply(r.data)).catch(() => {}).finally(finish);
    } else {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam]);

  // ---- 草稿自动保存（防抖 800ms）----
  const draftData = useMemo(() => ({
    source,
    work_type: workType,
    title,
    description,
    source_url: sourceUrl,
    editor_code: editorCode,
    editor_work_id: editorWorkId,
    sb3_url: sb3?.url || '',
    sb3_name: sb3?.name || '',
    sb3_size: sb3?.size || 0,
    cover_mode: coverMode,
    category,
    cover_url: coverUrl,
    tags: tagArr.join(', '),
    is_repost: attr === 'repost',
    is_original: isOriginal,
    original_url: originalUrl,
    scheduled_at: publishMode === 'scheduled' ? scheduledAt : '',
  }), [source, workType, title, description, sourceUrl, editorCode, editorWorkId, sb3, coverMode,
    category, coverUrl, tagArr, attr, isOriginal, originalUrl, publishMode, scheduledAt]);

  const doSave = useCallback(async () => {
    const body = { draft_type: 'work', draft_id: draftIdRef.current || undefined, data: draftData };
    let res;
    try {
      res = await client.post('/drafts', body);
    } catch (e) {
      // 草稿已在别处被提交或删除（后端 404 草稿不存在）。丢掉旧 id 另存一份，
      // 否则自动保存一直静默 404，正在填的稿件内容永远存不进去。
      if (e?.response?.status !== 404 || !draftIdRef.current) throw e;
      draftIdRef.current = null;
      res = await client.post('/drafts', { draft_type: 'work', data: draftData });
    }
    draftIdRef.current = res.data.id;
    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    setSavedTip(t('form.draftSaved', { time: now }));
    return res.data.id;
  }, [draftData, t]);

  useEffect(() => {
    if (!loadedRef.current) return undefined;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { doSave().catch(() => {}); }, 800);
    return () => clearTimeout(timerRef.current);
  }, [doSave]);

  const saveAsNew = async () => {
    draftIdRef.current = null;
    try {
      const id = await doSave();
      toast(t('form.draftSavedNew', { id }));
    } catch {
      toast(t('form.saveFail'), 'error');
    }
  };

  // ---- 派生状态 ----
  const activeEditor = useMemo(() => editors.find((e) => e.code === editorCode), [editors, editorCode]);
  const playUrl = useMemo(() => {
    if (workType === 'editor' && activeEditor && editorWorkId.trim()) {
      return activeEditor.url_template.replace('{work_id}', editorWorkId.trim());
    }
    // Scratch：预览 TurboWarp 的**内嵌播放页**（本地开发用当前 origin 拼绝对地址）
    // 注意必须是 /embed —— 用顶层写法 ?project_url= 在 iframe 里会显示「Invalid TurboWarp Embed」
    if (workType === 'scratch' && sb3?.url) {
      const abs = new URL(sb3.url, window.location.origin).href;
      return `https://turbowarp.org/embed?project_url=${encodeURIComponent(abs)}`;
    }
    return '';
  }, [workType, activeEditor, editorWorkId, sb3]);
  const urlOk = HTTP_RE.test(sourceUrl.trim());
  const origOk = HTTP_RE.test(originalUrl.trim());
  const editorOk = Boolean(editorCode && editorWorkId.trim());
  const sb3Ok = Boolean(sb3?.url);
  const sourceOk = workType === 'url' ? urlOk : workType === 'scratch' ? sb3Ok : editorOk;
  const needLv = workType === 'url' ? 4 : 1;
  const myLv = user?.level ?? 0;
  const levelOk = user?.role === 'admin' || myLv >= needLv;
  // 外链与 Scratch 一律强制审核（Scratch 是站长定的：LV1 可投，但必须过审）
  const forceReview = workType === 'url' || workType === 'scratch';

  const levelMsg = t('form.levelNeed', {
    kind: workType === 'url' ? t('form.kindExternal') : workType === 'scratch' ? t('form.kindScratch') : t('form.kindWork'),
    lv: needLv,
    cur: myLv,
  });

  const checks = [
    { key: 'title', label: t('form.checkTitle'), ok: Boolean(title.trim()) },
    { key: 'nature', label: attr === 'repost' ? t('form.checkOriginalUrl') : t('form.checkOriginalClaim'), ok: attr === 'repost' ? origOk : isOriginal },
    {
      key: 'source',
      label: workType === 'url' ? t('form.checkSourceUrl') : workType === 'scratch' ? t('form.checkSb3') : t('form.checkEditorId'),
      ok: sourceOk,
    },
    ...(!forceReview && publishMode === 'scheduled'
      ? [{ key: 'sched', label: t('form.checkSchedule'), ok: Boolean(scheduledAt) && new Date(scheduledAt).getTime() > Date.now() }]
      : []),
    { key: 'desc', label: t('form.checkDesc'), ok: Boolean(description.trim()), opt: true },
    { key: 'cover', label: t('form.checkCover'), ok: Boolean(coverUrl), opt: true },
    { key: 'tags', label: t('form.checkTags'), ok: tagArr.length > 0, opt: true },
  ];

  const submitLabel = forceReview || publishMode === 'review'
    ? t('form.submitReview')
    : (attr === 'repost' ? t('form.publishRepost') : t('form.publishWorkBtn'));

  // 用户一动手就撤掉上一次的报错，避免「明明改了还红着」
  useEffect(() => { setError(''); }, [draftData]);

  // ---- 标签 ----
  const addTag = () => {
    const v = tagInput.trim().replace(/[,，]/g, '');
    if (v && !tagArr.includes(v) && tagArr.length < MAX_TAGS) setTagArr((prev) => [...prev, v]);
    setTagInput('');
  };
  const removeTag = (tag) => setTagArr((prev) => prev.filter((x) => x !== tag));
  const onTagKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !tagInput && tagArr.length) {
      setTagArr((prev) => prev.slice(0, -1));
    }
  };

  // ---- 一键填入原作链接 ----
  const fillOriginalFromEditor = () => {
    if (!activeEditor || !editorWorkId.trim()) return;
    setOriginalUrl(activeEditor.url_template.replace('{work_id}', editorWorkId.trim()));
  };

  /**
   * 编程猫导入的落地：把详情里的权威信息填进来。
   * 只在字段为空时填标题/简介/封面，避免把用户已经改过的内容覆盖掉。
   */
  const applyCodemaoImport = (detail) => {
    setEditorCode(detail.editor_code);
    setEditorWorkId(String(detail.id));
    const filled = [];
    if (!title.trim() && detail.work_name) { setTitle(detail.work_name); filled.push(t('form.fieldTitle')); }
    if (!description.trim() && detail.description) { setDescription(detail.description); filled.push(t('form.fieldDesc')); }
    if (!coverUrl && detail.cover) { setCoverUrl(detail.cover); filled.push(t('form.fieldCover')); }
    setImported({ id: String(detail.id), name: detail.work_name, editor: detail.editor_code, filled });
    toast(t('form.cmImportOk', { name: detail.work_name || detail.id }));
  };

  // ---- Scratch 作品文件的上传 / 自动取封面 ----
  const uploadSb3 = async (file) => {
    if (!file) return;
    if (!/\.sb3$/i.test(file.name)) {
      toast(t('form.sb3NeedFile'), 'error');
      return;
    }
    setSb3Busy(true);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await client.post('/upload/scratch', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,   // 几十 MB 的文件，别用默认超时
      });
      setSb3({ url: r.data.url, size: r.data.size, sha256: r.data.sha256, name: file.name });
      toast(t('form.sb3Ok', { mb: r.data.size_mb }));
    } catch (e) {
      toast(errOf(e), 'error');
    } finally {
      setSb3Busy(false);
    }
  };

  /** 自动封面：在浏览器里解开 .sb3，取舞台背景图上传成封面 */
  const autoCover = async (file) => {
    if (!file) return;
    setCoverBusy(true);
    try {
      const blob = await makeCoverFromSb3(file);
      const fd = new FormData();
      fd.append('file', blob, 'scratch-cover.png');
      const r = await client.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setCoverUrl(r.data.url);
      toast(t('form.coverAutoOk'));
    } catch {
      toast(t('form.coverAutoFail'), 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  // ---- 校验：顺序与后端一致 ----
  const validate = () => {
    if (!title.trim()) return t('form.needWorkTitle');
    if (attr === 'original' && !isOriginal) return t('form.needOriginalDeclare');
    if (attr === 'repost' && !origOk) return t('form.needRepostUrl');
    if (workType === 'url' && !urlOk) return t('form.needSourceUrlMsg');
    if (workType === 'scratch' && !sb3Ok) return t('form.sb3NeedFile');
    if (workType === 'editor' && !editorCode) return t('form.needEditor');
    if (workType === 'editor' && !editorWorkId.trim()) return t('form.needEditorIdMsg');
    if (!levelOk) return levelMsg;
    if (!forceReview && publishMode === 'scheduled') {
      if (!scheduledAt) return t('form.needScheduleTime');
      if (new Date(scheduledAt).getTime() <= Date.now()) return t('form.schedulePast');
    }
    return '';
  };

  const submit = useCallback(async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError('');
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        description,
        work_type: workType,
        category,
        cover_url: coverUrl || null,
        tags: tagArr.join(', '),
        publish_mode: forceReview ? 'review' : (publishMode === 'scheduled' ? 'auto' : publishMode),
        is_original: attr === 'original' ? isOriginal : false,
        is_repost: attr === 'repost',
        original_url: attr === 'repost' ? originalUrl.trim() : '',
      };
      if (workType === 'url') {
        payload.source_url = sourceUrl.trim();
      } else if (workType === 'scratch') {
        payload.sb3_url = sb3.url;
      } else {
        payload.editor_code = editorCode;
        payload.editor_work_id = editorWorkId.trim();
      }
      if (publishMode === 'scheduled' && scheduledAt && !forceReview) {
        payload.scheduled_at = new Date(scheduledAt).toISOString();
      }
      const res = await client.post('/works', payload);
      if (draftIdRef.current) await client.delete(`/drafts/${draftIdRef.current}`).catch(() => {});
      navigate(`/works/${res.data.id}`);
    } catch (e) {
      setError(errOf(e));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, workType, category, coverUrl, tagArr, forceReview, publishMode,
    isOriginal, attr, originalUrl, sourceUrl, editorCode, editorWorkId, sb3, scheduledAt,
    levelOk, needLv, myLv, navigate]);

  // Ctrl / Cmd + Enter 快速发布
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  return {
    // 状态
    user, editors, source, setSource: pickSource, attr, setAttr, isOriginal, setIsOriginal,
    originalUrl, setOriginalUrl, title, setTitle, description, setDescription,
    sourceUrl, setSourceUrl, editorCode, setEditorCode, editorWorkId, setEditorWorkId,
    category, setCategory, coverUrl, setCoverUrl, tagArr, tagInput, setTagInput,
    sb3, setSb3, sb3Busy, coverMode, setCoverMode, coverBusy,
    publishMode, setPublishMode, scheduledAt, setScheduledAt,
    error, busy, savedTip, imported, draftIdRef,
    // 派生
    activeEditor, playUrl, urlOk, origOk, editorOk, sourceOk, levelOk, levelMsg,
    forceReview, checks, submitLabel, workType, sb3Ok,
    // 行为
    addTag, removeTag, onTagKey, fillOriginalFromEditor, applyCodemaoImport,
    uploadSb3, autoCover,
    submit, saveAsNew,
  };
}
