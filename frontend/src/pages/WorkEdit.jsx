import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Wand2 } from 'lucide-react';
import { OutlinedTextField, OutlinedSelect, SelectOption, FilledButton, OutlinedButton } from '../ui';
import ImageUpload from '../components/ImageUpload';
import MsIcon from '../components/MsIcon';
import client from '../api/client';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

const CATEGORIES = ['游戏', '动画', '故事', '音乐', '绘画', '数学', '科学', '其他'];
// 分类的中文原值会原样提交给后端，这里只把展示文案换成词条
const CATEGORY_KEYS = {
  游戏: 'form.catGame',
  动画: 'form.catAnimation',
  故事: 'form.catStory',
  音乐: 'form.catMusic',
  绘画: 'form.catDrawing',
  数学: 'form.catMath',
  科学: 'form.catScience',
  其他: 'form.catOther',
};

export default function WorkEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const err = useErr();
  const [editors, setEditors] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('游戏');
  const [coverUrl, setCoverUrl] = useState('');
  const [origCover, setOrigCover] = useState('');
  const [tags, setTags] = useState('');
  const [attr, setAttr] = useState('original'); // original / repost
  const [originalUrl, setOriginalUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get('/works/editors').then((r) => setEditors(r.data)).catch(() => {});
    client.get(`/works/${id}`).then((r) => {
      const w = r.data;
      setTitle(w.title);
      setDescription(w.description || '');
      setCategory(w.category || '游戏');
      setCoverUrl(w.cover_url || '');
      setOrigCover(w.cover_url || '');
      setTags((w.tags || []).join(', '));
      setAttr(w.is_repost ? 'repost' : 'original');
      setOriginalUrl(w.original_url || '');
    }).catch((e) => setError(err(e)));
  }, [id]);

  // 一键填入原作链接：按该作品自身的编辑器 + 编号生成编程猫原作页
  const fillOriginalFromEditor = async () => {
    try {
      const w = (await client.get(`/works/${id}`)).data;
      const ed = editors.find((e) => e.code === w.editor_code);
      if (ed && w.editor_work_id) {
        setOriginalUrl(ed.url_template.replace('{work_id}', String(w.editor_work_id)));
      }
    } catch { /* ignore */ }
  };

  const origLinkValid = /^https?:\/\//i.test((originalUrl || '').trim());
  const catLabel = (v) => (CATEGORY_KEYS[v] ? t(CATEGORY_KEYS[v]) : v);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (attr === 'repost' && !origLinkValid) {
      setError(t('form.needRepostUrlShort'));
      return;
    }
    setBusy(true);
    try {
      const payload = { title, description, category, tags, is_repost: attr === 'repost', original_url: attr === 'repost' ? originalUrl.trim() : '' };
      if (coverUrl !== origCover) payload.cover_url = coverUrl || '';
      await client.patch(`/works/${id}`, payload);
      navigate(`/works/${id}`);
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={{ padding: 32 }}>
        <h2 className="row" style={{ margin: 0, fontWeight: 800, gap: 8, alignItems: 'center' }}><MsIcon name="rocket_launch" size={22} /> {t('form.editWork')}</h2>
        {error && <div className="m3-badge m3-badge--error" style={{ marginTop: 12, padding: '8px 12px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>{error}</div>}

        <div style={{ margin: '16px 0 8px', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><MsIcon name="verified" size={17} /> {t('form.workNature')}</div>
        <div className="row" style={{ gap: 10 }}>
          <div onClick={() => setAttr('original')} style={{ flex: 1, cursor: 'pointer', padding: '12px 14px', borderRadius: 'var(--radius)', border: `2px solid ${attr === 'original' ? 'var(--md-sys-color-primary)' : 'var(--border-soft)'}`, background: attr === 'original' ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-low)', fontSize: 14, fontWeight: 700 }}>
            <MsIcon name="verified" size={16} /> {t('form.originalWork')}
          </div>
          <div onClick={() => setAttr('repost')} style={{ flex: 1, cursor: 'pointer', padding: '12px 14px', borderRadius: 'var(--radius)', border: `2px solid ${attr === 'repost' ? 'var(--md-sys-color-primary)' : 'var(--border-soft)'}`, background: attr === 'repost' ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-low)', fontSize: 14, fontWeight: 700 }}>
            <MsIcon name="share" size={16} /> {t('form.repostWork')}
          </div>
        </div>

        {attr === 'repost' && (
          <div className="m3-card m3-card--filled" style={{ padding: 14, marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}><MsIcon name="link" size={16} /> {t('form.originalUrlRepostRequired')}</div>
            <div className="row" style={{ gap: 8 }}>
              <OutlinedTextField label={t('form.originalUrl')} value={originalUrl} onInput={(e) => setOriginalUrl(e.target.value)} placeholder="https://…" style={{ flex: 1 }} />
            </div>
            <OutlinedButton type="button" onClick={fillOriginalFromEditor} style={{ marginTop: 10 }}>
              <span slot="icon"><Wand2 size={16} /></span>{t('form.autoFillOriginal')}
            </OutlinedButton>
          </div>
        )}

        <form onSubmit={submit} className="stack" style={{ marginTop: 16 }}>
          <OutlinedTextField label={t('form.workTitleLabel')} value={title} onInput={(e) => setTitle(e.target.value)} maxLength={200} />
          <ImageUpload value={coverUrl} onChange={setCoverUrl} label={t('form.uploadCoverImage')} previewSize={64} />
          <OutlinedSelect label={t('form.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <SelectOption key={c} value={c} headline={catLabel(c)} />)}
          </OutlinedSelect>
          <OutlinedTextField label={t('form.tagsLabel')} value={tags} onInput={(e) => setTags(e.target.value)} />
          <OutlinedTextField label={t('form.workDescLabel')} type="textarea" rows={4} value={description} onInput={(e) => setDescription(e.target.value)} />
          <FilledButton type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? t('form.saving') : t('form.saveChanges')}</FilledButton>
        </form>
      </div>
    </div>
  );
}
