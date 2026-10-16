import { useEffect, useState } from 'react';
import { Dialog, FilledButton, TextButton } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useErr } from '../i18n/server';

/**
 * 友好条约：未签订的新用户首次进入弹出，同意后升级 LV1。
 *
 * 两个曾经把用户卡死的坑，都在这里修掉：
 *  1) **未实名账号不弹这个框**。英文邮箱注册的账号注册完就去 /verify 传护照，
 *     而这个框是模态、关不掉的，正好盖住护照页；更糟的是签条约是写接口，
 *     锁定期间后端会 403，于是「同意」永远失败 —— 页面被挡、按钮点了没反应。
 *     站长要求：等账号激活之后再提示，所以这里加了 verify_state 判断。
 *  2) **弹窗必须能关掉**。原来 onClose/onCancel 是空函数、「以后再说」按钮也调用
 *     同一个签条约接口，等于没有任何退出路径。现在「以后再说」= 只关闭不调接口，
 *     Esc / 点遮罩也能关（关掉不等于签了，下次进来还会提示）。
 *  另外补了 try/catch + finally：接口失败要给出提示并把 busy 复位，而不是静默卡住。
 */
export default function TreatyDialog() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const err = useErr();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 已实名（或本来就不需要实名）的 LV0 未签用户才提示
  const needsTreaty = !!user
    && !user.treaty
    && !user.treaty_signed
    && user.level === 0
    && (!user.verify_state || user.verify_state === 'ok');

  useEffect(() => {
    if (!needsTreaty) {
      setOpen(false);
      setError('');
      return undefined;
    }
    const timer = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(timer);
  }, [needsTreaty]);

  if (!needsTreaty) return null;

  const close = () => {
    setOpen(false);
    setError('');
  };

  const sign = async () => {
    setBusy(true);
    setError('');
    try {
      await client.post('/users/me/treaty');
      setOpen(false);
      await refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} onCancel={close}>
      <div slot="headline">{t('treaty.title')}</div>
      <div slot="content" style={{ lineHeight: 1.8 }}>
        <p style={{ margin: '0 0 8px' }}>{t('treaty.welcome')}</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>{t('treaty.rule1')}</li>
          <li>{t('treaty.rule2')}</li>
          <li>{t('treaty.rule3')}</li>
          <li>{t('treaty.rule4')}</li>
        </ul>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{t('treaty.levelUpPre')} <b>LV1</b>{t('treaty.levelUpPost')}</p>
        {error && (
          <div
            className="m3-badge m3-badge--error"
            style={{ display: 'block', whiteSpace: 'normal', padding: '8px 12px', marginTop: 10, borderRadius: 'var(--radius)' }}
          >
            {error}
          </div>
        )}
      </div>
      <div slot="actions">
        <TextButton onClick={close} disabled={busy}>{t('treaty.later')}</TextButton>
        <FilledButton onClick={sign} disabled={busy}>{busy ? t('treaty.signing') : t('treaty.agree')}</FilledButton>
      </div>
    </Dialog>
  );
}
