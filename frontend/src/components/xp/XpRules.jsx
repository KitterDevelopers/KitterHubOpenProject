/**
 * 规则说明：从「底部一整张卡片」改成一行文字按钮 + 对话框。
 *
 * 版面大改反馈：站长说底下顶着个大「规则」太难看。规则是「看一次就不再点」的内容，
 * 却占着整页最后一行最大的视觉块（还带个折叠箭头），把入口按钮都压下去了。
 * 现在它只是底部一行里的一颗文字按钮，默认完全不占版面，要看再点开对话框。
 * 展开后的条目和最早那版完全一致，没有删减。
 */
import { useState } from 'react';
import { Dialog, TextButton } from '../../ui';
import MsIcon from '../MsIcon';

export default function XpRules({ t }) {
  const [open, setOpen] = useState(false);
  const items = ['ruleSignin', 'ruleFeedGive', 'ruleFeedGet', 'ruleInvite', 'ruleFishUse'];
  const close = () => setOpen(false);

  return (
    <>
      <TextButton onClick={() => setOpen(true)} className="xp-rules-btn">
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          <MsIcon name="menu_book" size={17} /> {t('xp.rulesTitle')}
        </span>
      </TextButton>

      <Dialog
        open={open}
        onClose={close}
        onCancel={close}
        style={{ '--md-dialog-container-shape': 'var(--radius)' }}
      >
        <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}>
          <MsIcon name="menu_book" size={20} /> {t('xp.rulesTitle')}
        </div>
        <div slot="content" style={{ maxWidth: 'min(520px, 82vw)', lineHeight: 1.9 }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {items.map((k) => <li key={k}>{t(`xp.${k}`)}</li>)}
          </ul>
        </div>
        <div slot="actions">
          <TextButton onClick={close}>{t('common.close')}</TextButton>
        </div>
      </Dialog>
    </>
  );
}
