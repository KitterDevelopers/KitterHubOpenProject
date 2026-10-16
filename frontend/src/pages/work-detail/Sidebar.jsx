/**
 * 侧栏：关于作者 / 稿件数据 / 稿件来源 / 猜你喜欢（顺序与改动前一致）。
 * 数据卡仍是 2×2 格子，保持原版面。
 */
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { OutlinedButton } from '../../ui';
import UserAvatar from '../../components/Avatar';
import CollapsibleText from '../../components/CollapsibleText';
import EditorChip from '../../components/EditorChip';
import UserBadge from '../../components/UserBadge';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { displayName } from '../../utils';

function Title({ children }) {
  return <h3 style={{ margin: '0 0 12px', fontWeight: 800 }}>{children}</h3>;
}

/** 下载时用的文件名：用稿件标题（比 sha 前 16 位好认），去掉文件名非法字符 */
function safeFileName(work) {
  return `${(work.title || 'work').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.sb3`;
}

/** 存盘用的 .sb3 直链文件名（服务端是 sha 前 16 位那个，展示出来方便核对） */
function sb3Name(work) {
  return String(work.sb3_url || '').split('/').pop() || 'work.sb3';
}

/** 下载作品原始 .sb3：直链就在本站 /uploads/games/ 下（nginx 给的是 octet-stream + 允许跨域） */
function downloadSb3(work) {
  const a = document.createElement('a');
  a.href = work.sb3_url;
  a.download = safeFileName(work);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Sidebar({ work, related }) {
  const { t } = useI18n();
  const author = work.author || {};

  return (
    <div className="stack">
      {/* 关于作者 */}
      <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <Title>{t('work.aboutAuthor')}</Title>
        <div className="row" style={{ gap: 12 }}>
          <UserAvatar user={author} size={44} />
          <div style={{ minWidth: 0 }}>
            <span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Link to={`/users/${author.uid}`} style={{ fontWeight: 700 }}>{displayName(author)}</Link>
              <UserBadge user={author} />
            </span>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{author.bio || t('work.noBio')}</div>
          </div>
        </div>
      </div>

      {/* 稿件数据 */}
      <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
        <Title>{t('work.workStats')}</Title>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[['play_arrow', 'work.statViews', work.views], ['favorite', 'common.like', work.like_count], ['chat_bubble', 'common.comment', work.comment_count], ['star', 'work.favorite', work.favorite_count]].map(([ic, lk, v]) => (
            <div key={lk}>
              <div className="muted" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MsIcon name={ic} size={14} /> {t(lk)}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{v ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 稿件来源：先挂编辑器胶囊（Kitten4 / KittenN / Kitten3 / Coco / NEMO / Scratch） */}
      {(work.editor_code || work.is_scratch) && (
        <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <Title>{t('work.source')}</Title>
          <div style={{ marginBottom: 8 }}><EditorChip work={work} size={14} /></div>
          {/* 播放地址可能极长（带 cloud_host 票据的那种能到几百字符），超过 4 行就折叠 */}
          <CollapsibleText maxLines={4}>
            <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              {work.editor_code && (<>{t('work.editorLabel')}<b>{work.editor_code}</b><br /></>)}
              {work.editor_work_id && (<>{t('work.workNo')}<b>{work.editor_work_id}</b><br /></>)}
              {work.play_url && <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{t('work.playUrl')}{work.play_url}</span>}
            </div>
          </CollapsibleText>
        </div>
      )}

      {/* 源文件下载：单独一张卡（只有 Scratch 作品才有）。
          CC BY-SA 2.0 本来就允许下载与改编，把入口明明白白放出来 —— 想自己打开看/改的用户
          不用再到处找人要文件。 */}
      {work.is_scratch && work.sb3_url && (
        <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <Title>{t('work.sourceFile')}</Title>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
            {t('work.sourceFileHint')}
          </div>
          <OutlinedButton onClick={() => downloadSb3(work)} style={{ width: '100%' }}>
            <span slot="icon"><Download size={16} /></span>
            {t('work.downloadSource')}
          </OutlinedButton>
          <div className="row" style={{ fontSize: 12, marginTop: 10, gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="m3-badge" style={{ textTransform: 'lowercase' }}>.sb3</span>
            <span className="muted">{((work.sb3_size || 0) / 1024 / 1024).toFixed(2)} MB</span>
            <span className="muted" style={{ wordBreak: 'break-all' }}>{sb3Name(work)}</span>
          </div>
        </div>
      )}

      {/* 猜你喜欢 */}
      {related.length > 0 && (
        <div className="m3-card m3-card--filled" style={{ padding: 20 }}>
          <h3 className="row" style={{ margin: '0 0 12px', fontWeight: 800, gap: 6, alignItems: 'center' }}>
            <MsIcon name="help" size={18} /> {t('work.related')}
          </h3>
          <div className="stack" style={{ gap: 10 }}>
            {related.map((w) => (
              <div key={w.id} className="row" style={{ gap: 10 }}>
                <div className={`work-cover grad-${(w.id % 5) + 1}`} style={{ width: 64, height: 48, aspectRatio: 'auto', fontSize: 22, borderRadius: 'var(--radius)', flexShrink: 0 }}>
                  {w.cover_url
                    ? <img src={w.cover_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius)' }} />
                    : <MsIcon name="palette" size={22} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link to={`/works/${w.id}`} style={{ fontWeight: 600, fontSize: 14, display: 'block' }}>{w.title}</Link>
                  <div className="muted row" style={{ fontSize: 12, gap: 10 }}>
                    <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="play_arrow" size={12} /> {w.views ?? 0}</span>
                    <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="favorite" size={12} /> {w.like_count ?? 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
