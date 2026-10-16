import { useState } from 'react';
import { Flag } from 'lucide-react';
import { OutlinedButton, Dialog, TextButton, FilledButton, OutlinedSelect, SelectOption } from '../ui';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

// value 保持中文原文（提交给后端的值不变），显示用 label 里的词条 key。
const REASONS = [
  { value: '垃圾内容', label: 'report.reasonSpam' },
  { value: '辱骂攻击', label: 'report.reasonAbuse' },
  { value: '色情低俗', label: 'report.reasonPorn' },
  { value: '广告引流', label: 'report.reasonAds' },
  { value: '抄袭搬运', label: 'report.reasonPlagiarism' },
  { value: '虚假宣传', label: 'report.reasonFalseClaim' },
  { value: '骚扰霸凌', label: 'report.reasonHarassment' },
  { value: '诱导消费', label: 'report.reasonSpending' },
  { value: '隐私泄露', label: 'report.reasonPrivacy' },
  { value: '涉恐涉暴', label: 'report.reasonViolence' },
  { value: '其他', label: 'report.reasonOther' },
];

export default function ReportButton({ targetType, targetId, noTrigger = false, open, onClose, variant = 'default' }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [selfOpen, setSelfOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].value);
  const [snack, setSnack] = useState('');

  // 受控模式：外部传 open/onClose 则用外部状态；否则内部自管理
  const isOpen = open !== undefined ? open : selfOpen;
  const close = () => (onClose ? onClose() : setSelfOpen(false));
  const openDialog = () => { if (open === undefined) setSelfOpen(true); };

  const submit = async () => {
    try {
      await client.post('/reports', { target_type: targetType, target_id: targetId, reason });
      close();
      setSnack(t('report.submitted'));
      setTimeout(() => setSnack(''), 2500);
    } catch (e) {
      // 以前这里把错误吞掉了（.catch(() => {})）：失败也照样提示「已提交」，
      // 评论举报接上来之后更容易踩到（比如类型不被接受），所以改成如实提示。
      const d = e && e.response && e.response.data && e.response.data.detail;
      setSnack(typeof d === 'string' && d ? d : t('report.failed'));
      setTimeout(() => setSnack(''), 3000);
    }
  };

  if (!user) return null;

  return (
    <>
      {!noTrigger && (variant === 'text' ? (
        // 评论行的举报入口：跟「回复 / 引用」同一排，所以用 TextButton（文字按钮），不用整块 OutlinedButton
        <TextButton onClick={openDialog}>
          <span className="row" style={{ gap: 4, alignItems: 'center' }}><Flag size={13} /> {t('common.report')}</span>
        </TextButton>
      ) : (
        <OutlinedButton onClick={openDialog}>
          <span slot="icon"><Flag size={16} /></span>
          {t('common.report')}
        </OutlinedButton>
      ))}
      <Dialog open={isOpen} onClose={close} onCancel={close}>
        <div slot="headline">{t('common.report')}</div>
        <div slot="content" className="stack">
          <OutlinedSelect label={t('report.reason')} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <SelectOption key={r.value} value={r.value} headline={t(r.label)} />)}
          </OutlinedSelect>
        </div>
        <div slot="actions">
          <TextButton onClick={close}>{t('common.cancel')}</TextButton>
          <FilledButton onClick={submit}>{t('report.submit')}</FilledButton>
        </div>
      </Dialog>
      {snack && <div className="m3-snackbar">{snack}</div>}
    </>
  );
}
