import { useEffect, useRef, useState } from 'react';
import { Dialog, FilledButton, TextButton } from '../ui';
import MsIcon from './MsIcon';
import { useI18n } from '../i18n';

// 防沉迷提醒：累计活跃 30 分钟后弹出「休息一下」，之后每 30 分钟提醒一次。
const ACTIVE_INTERVAL = 30 * 60 * 1000;

export default function RestReminder() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const lastActiveRef = useRef(Date.now());

  useEffect(() => {
    const resetTimer = () => {
      lastActiveRef.current = Date.now();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setOpen(true), ACTIVE_INTERVAL);
    };
    const events = ['click', 'scroll', 'keydown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      clearTimeout(timerRef.current);
    };
  }, []);

  const takeRest = () => {
    setOpen(false);
    lastActiveRef.current = Date.now();
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), ACTIVE_INTERVAL);
  };

  return (
    <Dialog open={open} onClose={takeRest} onCancel={takeRest}>
      <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}><MsIcon name="visibility" size={20} /> {t('rest.title')}</div>
      <div slot="content">
        <p style={{ margin: 0, lineHeight: 1.7 }}>
          {t('rest.bodyPre')} <b>{t('rest.bodyBold')}</b>{t('rest.bodyPost')}
          <br />
          <span className="muted" style={{ fontSize: 13 }}>{t('rest.tip')}</span>
        </p>
      </div>
      <div slot="actions">
        <TextButton onClick={takeRest}>{t('rest.keepCreating')}</TextButton>
        <FilledButton onClick={takeRest}>{t('rest.takeBreak')}</FilledButton>
      </div>
    </Dialog>
  );
}
