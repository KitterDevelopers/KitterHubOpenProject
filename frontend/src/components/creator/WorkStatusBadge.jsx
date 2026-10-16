import MsIcon from '../MsIcon';
import { useI18n } from '../../i18n';

// 稿件状态徽章：已发布 / 待审核 / 已驳回 / 定时发布
const MAP = {
  published: ['status.published', 'check_circle'],
  pending: ['status.pending', 'pending'],
  rejected: ['status.rejected', 'cancel'],
  scheduled: ['status.scheduled', 'schedule'],
  draft: ['status.draft', 'edit_note'],
};

export default function WorkStatusBadge({ status }) {
  const { t } = useI18n();
  const [labelKey, icon] = MAP[status] || ['status.unknown', 'help'];
  return (
    <span className={`cc-status cc-status--${MAP[status] ? status : 'unknown'}`}>
      <MsIcon name={icon} size={13} />
      {t(labelKey)}
    </span>
  );
}
