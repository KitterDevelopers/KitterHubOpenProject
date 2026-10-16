// 编程猫 Logo：优先用 public/codemao-logo.png；未放图时显示内置的猫脸 SVG 标识（非 emoji）
import { useState } from 'react';

// 默认猫脸标识（纯 SVG，圆底 + 猫耳 + 眼睛 + 微笑）
function CatFace({ size, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0, verticalAlign: -2, ...style }}>
      <circle cx="24" cy="26" r="19" fill="#4c6ef5" />
      <path d="M10 14 L13 4 L20 11 Z" fill="#4c6ef5" />
      <path d="M38 14 L35 4 L28 11 Z" fill="#4c6ef5" />
      <path d="M13 6 L10 14 L17 12 Z" fill="#ffd43b" />
      <path d="M35 6 L38 14 L31 12 Z" fill="#ffd43b" />
      <circle cx="18" cy="24" r="3.4" fill="#fff" />
      <circle cx="30" cy="24" r="3.4" fill="#fff" />
      <circle cx="18.8" cy="24.8" r="1.5" fill="#212529" />
      <circle cx="30.8" cy="24.8" r="1.5" fill="#212529" />
      <path d="M19 33 Q24 39 29 33" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M24 27 L24 31" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 32 Q12 36 15 37" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M37 32 Q36 36 33 37" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function CodemaoLogo({ size = 16, rounded = true, style }) {
  const [err, setErr] = useState(false);
  if (err) return <CatFace size={Math.round(size * 1.1)} style={style} />;
  return (
    <img
      src="/codemao-logo.png"
      alt="编程猫"
      onError={() => setErr(true)}
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? 'var(--radius-circle)' : 'var(--radius)',
        objectFit: 'cover',
        verticalAlign: -2,
        display: 'inline-block',
        ...style,
      }}
    />
  );
}
