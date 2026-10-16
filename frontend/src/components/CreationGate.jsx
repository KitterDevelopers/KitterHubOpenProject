/* 创作类页面的准入网关。
 *
 * 两种拦截：
 *  1) 账号实名未通过（verify_state != ok）→ 一律送到 /verify 先交材料。
 *  2) 界面处于英文模式 → 显示说明卡片。英文模式目前不开放创作/编辑类功能
 *     （投稿、发帖、编辑、建工作室、工作室管理），这是产品范围决定，不是安全边界，
 *     所以只在前端拦，后端不做限制。
 */
import { Link, Navigate } from 'react-router-dom';
import { FilledButton, OutlinedButton, CircularProgress } from '../ui';
import MsIcon from '../components/MsIcon';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

/** 供其它组件（如工作室管理按钮）复用同一套判断。 */
export function useCreationLocked() {
  const { user } = useAuth();
  const { isEn } = useI18n();
  const verifyLocked = !!(user && user.verify_state && user.verify_state !== 'ok');
  return { locked: isEn || verifyLocked, isEn, verifyLocked, user };
}

export default function CreationGate({ children }) {
  const { user, loading } = useAuth();
  const { isEn, setLang, t } = useI18n();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <CircularProgress indeterminate />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.verify_state && user.verify_state !== 'ok') return <Navigate to="/verify" replace />;

  if (isEn) {
    return (
      <div className="page-pad" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="m3-card m3-card--filled" style={{ padding: 28, textAlign: 'center' }}>
          <MsIcon name="translate" size={40} />
          <h2 style={{ margin: '10px 0 8px', fontWeight: 800 }}>{t('lock.creationTitle')}</h2>
          <p className="muted" style={{ lineHeight: 1.8 }}>{t('lock.creationDesc')}</p>
          <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 18 }}>
            <FilledButton onClick={() => setLang('zh')}>{t('lock.switchToChinese')}</FilledButton>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <OutlinedButton>{t('lock.backToBrowse')}</OutlinedButton>
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return children;
}
