import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import MsIcon from '../components/MsIcon';
import { FilledButton, OutlinedButton, TextButton, Dialog, OutlinedTextField, CircularProgress } from '../ui';
import client from '../api/client';
import WorkCard from '../components/WorkCard';
import EmptyState from '../components/EmptyState';
import { useI18n } from '../i18n';
import { formatTime, plainPreview } from '../utils';

export default function Favorites() {
  const { t } = useI18n();
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null); // null=全部
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const loadFolders = () => client.get('/users/me/folders').then((r) => setFolders(r.data)).catch(() => {});
  const loadItems = (folderId = activeFolder) => {
    setLoading(true);
    client.get('/users/me/favorites', { params: folderId ? { folder_id: folderId } : {} })
      .then((r) => setItems(r.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadFolders();
    loadItems(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFolder = (fid) => {
    setActiveFolder(fid);
    loadItems(fid);
  };

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    await client.post('/users/me/folders', { name });
    setNewName('');
    setCreateOpen(false);
    loadFolders();
  };

  const renameFolder = async (folder) => {
    const name = window.prompt(t('favorites.renamePrompt'), folder.name);
    if (name && name.trim()) {
      await client.patch(`/users/me/folders/${folder.id}`, { name: name.trim() });
      loadFolders();
    }
  };

  const deleteFolder = async (folder) => {
    if (!window.confirm(t('favorites.deleteConfirm', { name: folder.name }))) return;
    await client.delete(`/users/me/folders/${folder.id}`);
    if (activeFolder === folder.id) {
      setActiveFolder(null);
      loadItems(null);
    }
    loadFolders();
  };

  const renderItem = (x) => {
    if (x.kind === 'work') return <WorkCard work={x.data} />;
    const p = x.data;
    return (
      <Link to={`/posts/${p.id}`} className="m3-card" style={{ display: 'block', padding: 16 }}>
        <span className="m3-badge m3-badge--primary">{p.category}</span>
        <div style={{ fontWeight: 700, marginTop: 6 }}>{p.title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{plainPreview(p.content, 80)}</div>
      </Link>
    );
  };

  return (
    <div className="page-pad">
      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 className="row" style={{ margin: 0, fontWeight: 800, fontSize: 24, gap: 8, alignItems: 'center' }}><Star size={22} /> {t('favorites.title')}</h1>
        <FilledButton onClick={() => setCreateOpen(true)} style={{ marginLeft: 'auto' }}>{t('favorites.newFolder')}</FilledButton>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span
          onClick={() => pickFolder(null)}
          style={{ cursor: 'pointer', padding: '6px 14px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: activeFolder === null ? 700 : 400, background: activeFolder === null ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-high)', color: activeFolder === null ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)' }}
        >{t('common.all')}</span>
        {folders.map((f) => (
          <span key={f.id} className="row" style={{ gap: 4 }}>
            <span
              onClick={() => pickFolder(f.id)}
              style={{ cursor: 'pointer', padding: '6px 14px', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: activeFolder === f.id ? 700 : 400, background: activeFolder === f.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-surface-container-high)', color: activeFolder === f.id ? 'var(--md-sys-color-on-primary)' : 'var(--md-sys-color-on-surface)' }}
            ><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MsIcon name="folder" size={13} />{f.name} ({f.count})</span></span>
            <TextButton onClick={() => renameFolder(f)} style={{ minWidth: 0, padding: 0, fontSize: 12 }}>{t('favorites.rename')}</TextButton>
            <TextButton onClick={() => deleteFolder(f)} style={{ minWidth: 0, padding: 0, fontSize: 12, '--md-sys-color-primary': 'var(--md-sys-color-error)' }}>{t('favorites.delete')}</TextButton>
          </span>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}><CircularProgress indeterminate /></div>
      ) : items.length === 0 ? (
        <EmptyState loading={loading} msIcon="star" title={t('favorites.emptyTitle')} subtitle={t('favorites.emptyDesc')} />
      ) : (
        <div className="grid-works">{items.map((x, i) => <div key={i}>{renderItem(x)}</div>)}</div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)}>
        <div slot="headline">{t('favorites.newFolderTitle')}</div>
        <div slot="content">
          <OutlinedTextField label={t('favorites.folderName')} value={newName} onInput={(e) => setNewName(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div slot="actions">
          <TextButton onClick={() => setCreateOpen(false)}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={createFolder} disabled={!newName.trim()}>{t('favorites.create')}</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
