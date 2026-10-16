/**
 * 后台「稿件预览」弹窗：审核前先看作品本体（封面 + 播放器 + 说明），不用先通过再去看。
 *
 * 为什么不能直接跳 /works/{id}：公共详情接口对未发布稿件一律 404
 * （backend/app/routers/works.py 的 get_work），待审稿件没有可跳转的详情页。
 * 所以预览走**列表已有的字段**自绘弹窗，不新增后端接口：
 *
 *   GET /admin/works 逐条走 serializers.work_out()，已经带回
 *   title / description / cover_url / category / tags / work_type / source_url /
 *   editor_code / editor_work_id / sb3_url / is_scratch / status / scheduled_at /
 *   created_at / views / author / play_url —— 预览要的东西全都在里面。
 *
 * 播放地址的取法（三级回落，全部复用既有规则，不在这里硬抄一份模板）：
 *   1) work.play_url —— 后端 models.Work.play_url → config.build_play_url(editor_code, editor_work_id)
 *      的结果；Scratch 还带本站云变量票据，所以**优先用它**。
 *   2) work.play_url 为空且是 Scratch（后端 PUBLIC_BASE_URL 没配时会是 None）：
 *      前端自己拼 TurboWarp 内嵌页 https://turbowarp.org/embed?project_url=<sb3 绝对地址>，
 *      写法与 pages/work-form/useWorkForm.js 的 playUrl 一致（必须是 /embed）。
 *   3) 编辑器作品：按 GET /works/editors（就是后端 config.EDITORS）的 url_template 用
 *      editor_work_id 替换 {work_id} 拼出来。
 *   都取不到就明说「无法内嵌预览」，并给一个在新标签打开的出口。
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Eye } from 'lucide-react';
import { Dialog, OutlinedButton, TextButton } from '../../../ui';
import http from '../../../api/client';
import { API_BASE } from '../../../api/base';
import { Avatar, Badge, Note, T, authorOf, num, s } from '../ui';

const HTTP_RE = /^https?:\/\//i;

const STATUS_TEXT = { pending: '待审中', published: '已发布', rejected: '已驳回', scheduled: '定时发布' };

/** 编辑器规则只在需要回落拼接时才取，取一次缓存整个会话 */
let editorsPromise = null;
function loadEditors() {
  if (!editorsPromise) {
    editorsPromise = http.get('/works/editors')
      .then((r) => (Array.isArray(r.data) ? r.data : []))
      .catch(() => []);
  }
  return editorsPromise;
}

/** 站内相对地址（/uploads/...）的绝对化基准：生产是同源；本地 vite dev（5173）指向线上后端时要用后端域名 */
function assetOrigin() {
  if (HTTP_RE.test(API_BASE)) {
    try { return new URL(API_BASE).origin; } catch (e) { /* 解析失败就退回同源 */ }
  }
  return window.location.origin;
}

function absUrl(u) {
  const v = s(u).trim();
  if (!v) return '';
  if (HTTP_RE.test(v)) return v;
  if (v.startsWith('//')) return `${window.location.protocol}${v}`;
  if (v.startsWith('/')) return `${assetOrigin()}${v}`;
  return '';
}

/** 最终交给 iframe 的播放地址；空串 = 无法内嵌预览 */
export function resolvePlayUrl(work, editors = []) {
  if (!work) return '';
  // 1) 后端已按 EDITORS 的 url_template 拼好（Scratch 还带云变量票据）
  if (HTTP_RE.test(s(work.play_url))) return s(work.play_url).trim();
  // 2) Scratch：后端拿不到公网直链时自己拼 TurboWarp 内嵌页
  if ((work.is_scratch || s(work.work_type) === 'scratch') && s(work.sb3_url)) {
    const abs = absUrl(work.sb3_url);
    if (abs) return `https://turbowarp.org/embed?project_url=${encodeURIComponent(abs)}`;
  }
  // 3) 编辑器作品：url_template + editor_work_id（与投稿页 playUrl 同一套写法）
  const ed = editors.find((e) => s(e.code) === s(work.editor_code));
  const wid = s(work.editor_work_id).trim();
  if (ed && s(ed.url_template) && wid) return s(ed.url_template).replace('{work_id}', wid);
  // 4) 外链作品
  if (s(work.work_type) === 'url' && HTTP_RE.test(s(work.source_url))) return s(work.source_url).trim();
  return '';
}

/** 编辑器显示名：优先取后端规则里的中文名，取不到就退回 code，不在这里维护第二份名字表 */
function editorLabelOf(work, editors) {
  const code = s(work && work.editor_code);
  if (code) {
    const ed = editors.find((e) => s(e.code) === code);
    return ed ? (s(ed.name) || code) : code;
  }
  if (work && (work.is_scratch || s(work.work_type) === 'scratch')) return 'Scratch（本站 .sb3）';
  if (work && s(work.work_type) === 'url') return '站外链接';
  return '—';
}

export default function WorkPreview({ work, onClose }) {
  const [editors, setEditors] = useState([]);
  const [coverOk, setCoverOk] = useState(true);
  // 关闭动画期间 work 已经变成 null，这里留一份「最后看过的稿件」把内容画完再卸载
  const [shown, setShown] = useState(work || null);

  useEffect(() => { if (work) setShown(work); }, [work]);

  useEffect(() => {
    if (!work) return undefined;
    let alive = true;
    loadEditors().then((list) => { if (alive) setEditors(list); });
    return () => { alive = false; };
  }, [work]);

  const workId = work ? work.id : null;
  useEffect(() => { setCoverOk(true); }, [workId]);

  const play = useMemo(() => resolvePlayUrl(work, editors), [work, editors]);

  const w = shown;
  if (!w) return null;

  const title = s(w.title) || '(无标题)';
  const status = s(w.status);
  const desc = s(w.description);
  const cover = coverOk ? absUrl(w.cover_url) : '';
  const tags = Array.isArray(w.tags) ? w.tags.map((t) => s(t)).filter(Boolean) : [];
  const published = status === 'published';
  // 在新标签打开的出口：优先播放地址；已发布稿件还可以去公开详情页
  const openLink = play || (published ? `/works/${w.id}` : '');

  return (
    <Dialog
      open={!!work}
      onClosed={onClose}
      className="adm-preview-dialog"
      /* md-dialog 的 :host 写死 max-width/max-height: min(560px, 100% - 48px)，
         文档里普通声明的样式会盖过 :host，所以这里能放开宽度；宽度用 vw 计算，
         窄屏（手机）永远比视口窄 32px，不会把页面撑出横向滚动条。 */
      style={{
        width: 'min(880px, calc(100vw - 32px))',
        maxWidth: 'min(880px, calc(100vw - 32px))',
        maxHeight: 'min(880px, calc(100vh - 32px))',
      }}
    >
      <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Eye size={18} /> 稿件预览
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>#{w.id}</span>
      </div>

      <div slot="content" className="adm-preview">
        <div className="adm-preview-top">
          <div className="adm-preview-cover">
            {cover
              ? <img src={cover} alt={`${title} 封面`} onError={() => setCoverOk(false)} />
              : <span className="muted">无封面</span>}
          </div>

          <div className="adm-preview-facts">
            <div className="adm-preview-title">{title}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Badge tone={status === 'published' ? 'primary' : status === 'rejected' ? 'error' : 'plain'}>
                {STATUS_TEXT[status] || status || '—'}
              </Badge>
              {s(w.category) && <Badge>{s(w.category)}</Badge>}
              {w.is_featured && <Badge>加精</Badge>}
              {w.is_pinned && <Badge>置顶</Badge>}
            </div>
            <div className="adm-preview-meta">
              <Avatar user={w.author} size={26} />
              <span>{authorOf(w)}</span>
              <span className="muted">·</span>
              <span className="muted">编辑器 {editorLabelOf(w, editors)}</span>
              <span className="muted">·</span>
              <span className="muted">提交 {T(w.created_at)}</span>
              {w.scheduled_at ? <span className="muted">· 定时 {T(w.scheduled_at)}</span> : null}
              <span className="muted">· 播放 {num(w.views)}</span>
            </div>
            {tags.length > 0 && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>标签：{tags.join(' / ')}</div>
            )}
          </div>
        </div>

        <div className="adm-preview-play">
          {play ? (
            /* 内嵌播放器的属性与公共详情页 Player.jsx 完全一致（sandbox / referrerPolicy /
               allow / color-scheme），不自己发明第二套，免得某些编辑器播不出来 */
            <div className="work-player">
              <iframe
                src={play}
                title={`${title} 播放器`}
                allowFullScreen
                allow="autoplay; fullscreen; gamepad"
                allowTransparency
                style={{ colorScheme: 'auto' }}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-orientation-lock allow-presentation"
              />
            </div>
          ) : (
            <Note tone="error">
              无法内嵌预览：这件稿件没有可用的播放地址（外链缺失或作品文件不存在）。
              {published ? '可以点下面的「打开详情页」在站内查看。' : '未发布的稿件没有公开详情页。'}
            </Note>
          )}
        </div>

        <div>
          <div className="adm-preview-label">作品说明</div>
          <div className="adm-preview-desc">{desc || '（作者没有填写说明）'}</div>
        </div>
      </div>

      <div slot="actions">
        {openLink && (
          <a href={openLink} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <OutlinedButton>
              <span slot="icon"><ExternalLink size={16} /></span>{play ? '在新标签打开' : '打开详情页'}
            </OutlinedButton>
          </a>
        )}
        <TextButton onClick={onClose}>关闭</TextButton>
      </div>
    </Dialog>
  );
}
