import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PencilLine, Save } from 'lucide-react';
import { OutlinedTextField, OutlinedSelect, SelectOption, FilledButton, TextButton } from '../ui';
import MarkdownEditor from '../components/markdown/MarkdownEditor';
import client from '../api/client';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

const CATS = ['讨论', '教程', '求助', '展示'];
// 分类的中文原值会原样提交给后端，这里只把展示文案换成词条
const CAT_KEYS = {
  讨论: 'form.catDiscussion',
  教程: 'form.catTutorial',
  求助: 'form.catHelp',
  展示: 'form.catShowcase',
};

// 编辑帖子（与发帖页共用 Markdown 编辑器）
export default function PostEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const err = useErr();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('讨论');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    client
      .get(`/posts/${id}`)
      .then((r) => {
        setTitle(r.data.title || '');
        setContent(r.data.content || '');
        setCategory(r.data.category || '讨论');
      })
      .catch((e) => setError(err(e)))
      .finally(() => setLoaded(true));
  }, [id]);

  const submit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!title.trim()) return setError(t('form.needTitle'));
    if (!content.trim()) return setError(t('form.needBody'));
    setBusy(true);
    try {
      await client.patch(`/posts/${id}`, { title: title.trim(), content, category });
      navigate(`/posts/${id}`);
    } catch (ex) {
      setError(err(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-pad" style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1 className="row" style={{ margin: '0 0 16px', fontWeight: 800, gap: 8, alignItems: 'center', fontSize: 24 }}>
        <PencilLine size={22} /> {t('form.editPost')}
      </h1>
      {error && (
        <div className="m3-badge m3-badge--error" style={{ marginBottom: 16, padding: '10px 14px', display: 'block', whiteSpace: 'normal', borderRadius: 'var(--radius)' }}>
          {error}
        </div>
      )}
      <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
        <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <OutlinedSelect label={t('form.category')} value={category} onChange={(e) => setCategory(e.target.value)} style={{ minWidth: 140 }}>
              {CATS.map((c) => (
                <SelectOption key={c} value={c} headline={t(CAT_KEYS[c])} />
              ))}
            </OutlinedSelect>
            <OutlinedTextField
              label={t('form.titleLabel')}
              value={title}
              maxLength={200}
              onInput={(e) => setTitle(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <MarkdownEditor value={content} onChange={setContent} onSubmit={submit} label={t('form.bodyLabel')} minHeight={380} />
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <FilledButton type="submit" disabled={busy || !loaded} style={{ flex: 1, minWidth: 160 }}>
            <Save slot="icon" size={18} /> {busy ? t('form.saving') : t('form.saveChanges')}
          </FilledButton>
          <TextButton type="button" onClick={() => navigate(`/posts/${id}`)}>{t('common.cancel')}</TextButton>
        </div>
      </form>
    </div>
  );
}
