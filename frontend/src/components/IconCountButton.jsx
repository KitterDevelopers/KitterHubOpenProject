/**
 * 图标 + 数字的操作按钮：点赞 / 收藏 / 投喂共用同一种外观。
 *
 * 为什么抽出来：这三件事在语义上是同一类「轻量互动」，外观必须完全一致，
 * 只差图标和激活色。原来收藏/投喂是带文字的 FilledTonalButton，和点赞的图标样式打架，
 * 一行里既有带文字的按钮又有纯图标按钮，看着很吵。
 *
 * 不带文字说明是刻意的 —— 可读性交给 title / aria-label。
 */
import { useState } from 'react';
import { IconButton } from '../ui';

export default function IconCountButton({
  icon: Icon,
  count = 0,
  active = false,
  activeColor,
  onClick,
  disabled = false,
  label,
  title,
  size = 20,
  fillWhenActive = true,
}) {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onClick();
    } catch {
      // 兜底：调用方（如 useWorkDetail）自己会弹提示；这里再吞一层，
      // 避免任何遗漏的 reject 变成控制台里的 unhandled rejection + 按钮像坏了一样没反应。
    } finally {
      setBusy(false);
    }
  };

  const color = active && activeColor ? activeColor : undefined;

  return (
    <span className="row" style={{ gap: 2 }}>
      <IconButton
        onClick={handle}
        disabled={disabled || busy}
        aria-label={label}
        title={title || label}
        aria-pressed={active || undefined}
      >
        <Icon
          size={size}
          style={color ? { color } : undefined}
          fill={active && fillWhenActive ? 'currentColor' : 'none'}
        />
      </IconButton>
      <span className="muted" style={{ fontSize: 14, minWidth: 14 }}>{count ?? 0}</span>
    </span>
  );
}
