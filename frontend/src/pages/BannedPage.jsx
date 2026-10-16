// 封禁说明页：被封禁用户登录后展示
import { ShieldOff } from 'lucide-react';
import { FilledButton } from '../ui';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { fmtChina } from '../utils';

export default function BannedPage() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const until = user?.ban_until ? fmtChina(user.ban_until, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <div className="page-pad" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="m3-card m3-card--filled" style={{ padding: 32, textAlign: 'center' }}>
        <ShieldOff size={48} style={{ color: 'var(--md-sys-color-error)' }} />
        <h1 style={{ margin: '12px 0 6px', fontWeight: 800 }}>{t('banned.title')}</h1>
        {user?.is_permanently_banned ? (
          <p className="muted">{t('banned.permanent')}</p>
        ) : until ? (
          <p className="muted">
            {t('banned.untilPrefix')}<b>{until.toLocaleString()}</b>{t('banned.untilSuffix')}
          </p>
        ) : (
          <p className="muted">{t('banned.temporary')}</p>
        )}
        {user?.ban_reason && (
          <div className="m3-card" style={{ padding: 14, margin: '16px 0', textAlign: 'left', fontSize: 14 }}>
            {t('banned.reason', { reason: user.ban_reason })}
          </div>
        )}
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t('banned.appeal')}</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <FilledButton onClick={() => { logout(); navigate('/'); }}>{t('banned.backHome')}</FilledButton>
        </div>
      </div>
    </div>
  );
}
