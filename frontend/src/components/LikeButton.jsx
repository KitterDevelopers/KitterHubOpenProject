// 点赞按钮：图标 + 数字（与收藏/投喂共用 IconCountButton，保证一行里外观完全一致）
import { Heart } from 'lucide-react';
import IconCountButton from './IconCountButton';
import { useI18n } from '../i18n';

export default function LikeButton({ liked, count, onToggle, disabled }) {
  const { t } = useI18n();
  return (
    <IconCountButton
      icon={Heart}
      count={count}
      active={Boolean(liked)}
      activeColor="var(--md-sys-color-error)"
      onClick={onToggle}
      disabled={disabled}
      label={t('common.like')}
      title={disabled ? t('card.loginFirst') : t('common.like')}
    />
  );
}
