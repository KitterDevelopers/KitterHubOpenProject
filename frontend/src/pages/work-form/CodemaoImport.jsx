/**
 * 编程猫作品导入面板（**内嵌，不是弹窗**）。
 *
 * 为什么内嵌：这是投稿页最主要的使用路径（本站绝大多数稿件都来自编程猫），
 * 塞进弹窗里等于把它藏起来 —— 用户得先发现那个小按钮、再点开一层。
 * 现在它就在「选择作品来源」下面直接铺开，点一下就自动填好编辑器/编号/标题/简介/封面。
 *
 * 已投稿的作品会被**置灰并说明原因**，避免重复投稿（这也是站长明确要求的提示）。
 */
import { RefreshCw, Check, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TextButton, CircularProgress } from '../../ui';
import CodemaoLogo from '../../components/CodemaoLogo';
import MsIcon from '../../components/MsIcon';
import { useI18n } from '../../i18n';
import { isBlocked } from './useCodemaoImport';

/**
 * 卡片右上角的角标文案。
 * 已发布 / 审核中 → 拦住；被驳回 → 允许重投，所以文案要区别开。
 */
function stateOf(item, t) {
  if (!item.imported) return null;
  if (item.imported_status === 'rejected') return { kind: 'warn', text: t('form.cmRejected') };
  if (item.imported_status === 'pending') return { kind: 'block', text: t('form.cmPending') };
  return { kind: 'block', text: t('form.cmAlready') };
}

function Tile({ item, selected, picking, disabled, onPick }) {
  const { t } = useI18n();
  const state = stateOf(item, t);
  const blocked = isBlocked(item);

  return (
    <button
      type="button"
      className={`wf-tile${selected ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`}
      onClick={() => onPick(item)}
      disabled={disabled || blocked || picking}
      aria-pressed={selected}
      title={blocked ? `${item.work_name} - ${state?.text}` : item.work_name}
    >
      <span className="wf-tile__cover">
        {item.preview
          ? <img src={item.preview} alt="" loading="lazy" />
          : <MsIcon name="extension" size={26} />}
        {picking && <span className="wf-tile__loading"><CircularProgress indeterminate /></span>}
        {selected && !picking && <span className="wf-tile__pick"><Check size={16} /></span>}
      </span>

      <span className="wf-tile__body">
        <span className="wf-tile__name">{item.work_name}</span>
        <span className="wf-tile__stats">
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="play_arrow" size={12} /> {item.view_times}</span>
          <span className="row" style={{ gap: 3, alignItems: 'center' }}><MsIcon name="thumb_up" size={12} /> {item.liked_times}</span>
        </span>
      </span>

      {state && <span className={`wf-tile__badge wf-tile__badge--${state.kind}`}>{state.text}</span>}
      {!state && item.imported_by_others && (
        <span className="wf-tile__badge wf-tile__badge--soft">{t('form.cmByOthers')}</span>
      )}
    </button>
  );
}

export default function CodemaoImport({
  bound, uid, works, meta, loading, error, pickingId, selectedId, onReload, onPick, imported,
}) {
  const { t } = useI18n();

  // 没绑定编程猫：这里给一句明确的引导，不要留个空面板
  if (!bound) {
    return (
      <div className="m3-card wf-import wf-import--empty">
        <CodemaoLogo size={20} />
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>{t('form.cmNeedBind')}</b>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.7 }}>{t('form.cmNeedBindHint')}</div>
        </div>
        <Link to="/settings#bind-codemao" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          <TextButton>{t('form.goBind')}</TextButton>
        </Link>
      </div>
    );
  }

  return (
    <div className="m3-card wf-import">
      <div className="wf-import__head">
        <CodemaoLogo size={18} />
        <b style={{ fontSize: 14 }}>{t('form.myCodemaoWorks')}</b>
        {!loading && !error && <span className="muted" style={{ fontSize: 12 }}>{t('form.cmCount', { n: (meta && meta.total) ?? works.length })}</span>}
        {uid && <span className="muted" style={{ fontSize: 11.5 }}>UID {uid}</span>}
        <span style={{ marginLeft: 'auto' }}>
          <TextButton onClick={onReload} disabled={loading}>
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              <RefreshCw size={13} /> {t('form.cmRefresh')}
            </span>
          </TextButton>
        </span>
      </div>

      {loading && (
        <div className="wf-import__state"><CircularProgress indeterminate /><span className="muted">{t('form.cmLoading')}</span></div>
      )}

      {!loading && error && (
        <div className="wf-import__state">
          <MsIcon name="error" size={18} />
          <span className="muted" style={{ fontSize: 13 }}>{error}</span>
          <TextButton onClick={onReload}>{t('form.cmRetry')}</TextButton>
        </div>
      )}

      {!loading && !error && works.length === 0 && (
        <div className="wf-import__state">
          <MsIcon name="extension" size={18} />
          <span className="muted" style={{ fontSize: 13 }}>{t('form.noCodemaoWorks')}</span>
        </div>
      )}

      {!loading && !error && works.length > 0 && (
        <>
          <div className="wf-import__grid">
            {works.map((w) => (
              <Tile
                key={w.id}
                item={w}
                selected={selectedId === String(w.id)}
                picking={String(pickingId) === String(w.id)}
                disabled={Boolean(pickingId)}
                onPick={onPick}
              />
            ))}
          </div>

          {imported ? (
            <div className="wf-import__done">
              <Check size={15} />
              <span>
                {t('form.cmFilled', { name: imported.name })}
                {imported.filled.length > 0 && (
                  <span className="muted"> - {t('form.cmFilledFields', { fields: imported.filled.join('、') })}</span>
                )}
              </span>
            </div>
          ) : (
            <div className="wf-import__tip">
              <MsIcon name="info" size={14} />
              <span>{t('form.cmPickHint')}</span>
            </div>
          )}

          {works.some((w) => w.imported && w.imported_work_id) && (
            <div className="wf-import__links">
              <Eye size={13} />
              {t('form.cmSeeMine')}
              {works.filter((w) => w.imported && w.imported_work_id).slice(0, 3).map((w) => (
                <Link key={w.id} to={`/works/${w.imported_work_id}`}>{w.work_name}</Link>
              ))}
            </div>
          )}

          {meta && meta.truncated && (
            <div className="wf-import__tip">
              <MsIcon name="info" size={14} />
              <span>{t('form.cmTruncated', { n: works.length, total: meta.total ?? works.length })}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
