// 通用图片灯箱（全屏大图预览，Esc 或点击关闭）
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';

export default function Lightbox({ src, alt, onClose }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!src) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [src, onClose]);
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24 }}
    >
      <img src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '94vw', maxHeight: '88vh', borderRadius: 'var(--radius)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} />
      <button onClick={onClose} aria-label={t('lightbox.close')} style={{ position: 'absolute', top: 18, right: 18, background: 'rgba(255,255,255,0.16)', border: 'none', borderRadius: 'var(--radius-circle)', width: 40, height: 40, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={22} />
      </button>
    </div>
  );
}
