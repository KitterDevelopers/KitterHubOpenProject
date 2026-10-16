// 回到顶部按钮（页面出现滚动时显示）
import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '../i18n';

export default function BackToTop() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t('rest.backToTop')}
      style={{
        position: 'fixed', right: 24, bottom: 84, width: 44, height: 44, borderRadius: 'var(--radius-circle)', cursor: 'pointer', zIndex: 900,
        border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--md-sys-color-primary)', color: 'var(--md-sys-color-on-primary)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
      }}
    >
      <ArrowUp size={20} />
    </button>
  );
}
