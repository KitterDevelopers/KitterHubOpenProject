// 全局 Toast 提示（替代 alert 的轻提示）
import { useEffect, useState } from 'react';

let pushFn = null;

export function toast(msg, type = 'info') {
  if (pushFn) pushFn(msg, type);
  else window.alert(msg);
}

export default function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushFn = (msg, type) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, msg, type }]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 2600);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div style={{ position: 'fixed', top: 76, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
      {items.map((t) => (
        <div key={t.id} style={{
          padding: '10px 18px', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          background: t.type === 'error' ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-inverse-surface)',
          color: t.type === 'error' ? 'var(--md-sys-color-on-error-container)' : 'var(--md-sys-color-inverse-on-surface)',
          animation: 'toast-in 0.2s ease',
        }}>
          {t.msg}
        </div>
      ))}
      <style>{'@keyframes toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}'}</style>
    </div>
  );
}
