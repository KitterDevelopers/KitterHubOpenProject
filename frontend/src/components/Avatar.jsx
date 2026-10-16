import { colorFor, getInitial, displayName } from '../utils';
import { VerifySeal } from './VerifyBadge';
import { useI18n } from '../i18n';
import { API_BASE } from '../api/base';

// 头像/聊天图片如果是本站相对路径（/uploads/…），拼上后端地址。
// ★ 这里原来自己写了一份 `import.meta.env.VITE_API_URL || 'http://localhost:8000/api'`，
//   和 client.js / socket.js 是同一类坑：本地 build 出来的包里写死 localhost:8000，
//   上线后浏览器去连用户自己电脑 → 图片全部加载失败（onError 把 img 隐藏，只剩字母头像）。
//   现在统一从 api/base.js 取（生产是相对路径 `/uploads/...`，同源）。
export function resolveUploadUrl(url) {
  if (!url) return '';
  if (url.startsWith('/uploads/')) return API_BASE.replace(/\/api\/?$/, '') + url;
  return url;
}

// 头像 + 官方认证角标（角标大小/溢出比例随头像自动调整：角标 = 头像 42%，露出约 1/4）
export default function UserAvatar({ user, size = 36, style, showVerify = true, ...rest }) {
  const { t } = useI18n();
  if (!user) return null;
  const name = displayName(user) || '?';
  const verified = showVerify && (user.verification_type === 'blue' || user.verification_type === 'gold');
  return (
    <span
      {...rest}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: size,
        height: size,
        flexShrink: 0,
        lineHeight: 0,
        ...style,
      }}
    >
      <span
        className="m3-avatar"
        style={{ position: 'relative', width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}
        aria-label={name}
      >
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{getInitial(name)}</span>
        {user.avatar_url && (
          <img
            src={resolveUploadUrl(user.avatar_url)}
            alt={name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--avatar-radius)' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </span>
      {verified && (
        <span
          style={{
            position: 'absolute',
            right: '-12%',
            bottom: '-12%',
            width: '42%',
            height: '42%',
            lineHeight: 0,
          }}
        >
          <VerifySeal type={user.verification_type} title={user.verification_title || t('me.verified')} />
        </span>
      )}
    </span>
  );
}
