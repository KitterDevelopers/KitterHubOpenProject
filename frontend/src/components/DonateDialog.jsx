// 捐款支持弹窗：微信 / 支付宝 / Paypal（SVG 图标）
import { useState } from 'react';
import { Dialog, TextButton } from '../ui';
import { Heart } from 'lucide-react';
import { useI18n } from '../i18n';

// 支付方式 LOGO（图片来自 public/donate/pay-*.png）
function PayLogo({ src, alt }) {
  return <img src={src} alt={alt} style={{ height: 30, width: 'auto', display: 'block', objectFit: 'contain' }} />;
}

// 二维码：优先加载 public/donate/{name}，无图时显示纯占位
function QrSlot({ name, hint }) {
  const { t } = useI18n();
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img
        src={`/donate/${name}`}
        alt={hint}
        onError={() => setErr(true)}
        style={{ width: 180, height: 180, borderRadius: 'var(--radius)', objectFit: 'contain', display: 'inline-block', border: '1px solid var(--border-soft)' }}
      />
    );
  }
  return (
    <div style={{ width: 180, height: 180, borderRadius: 'var(--radius)', border: '2px dashed var(--border-soft)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--md-sys-color-on-surface-variant)', background: 'var(--md-sys-color-surface-container-low)' }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3zM17 17h4v4h-4zM14 21v0M21 14v0" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 12 }}>{t('donate.qrPending')}</span>
    </div>
  );
}

export default function DonateDialog({ open, onClose }) {
  const { t } = useI18n();
  const [active, setActive] = useState('wechat');
  const tabs = [
    { key: 'wechat', label: t('donate.wechat'), icon: <PayLogo src="/donate/pay-wechat.png" alt={t('donate.wechatPay')} />, color: '#07c160', paypal: false, img: 'wechat.png', hint: t('donate.wechatHint') },
    { key: 'alipay', label: t('donate.alipay'), icon: <PayLogo src="/donate/pay-alipay.png" alt={t('donate.alipay')} />, color: '#1677ff', paypal: false, img: 'alipay.png', hint: t('donate.alipayHint') },
    { key: 'paypal', label: 'Paypal', icon: <PayLogo src="/donate/pay-paypal.png" alt="Paypal" />, color: '#009cde', paypal: true },
  ];
  const cur = tabs.find((tab) => tab.key === active);

  return (
    <Dialog open={open} onClose={onClose} onCancel={onClose}>
      <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}><Heart size={20} style={{ color: 'var(--md-sys-color-error)' }} /> {t('donate.title')}</div>
      <div slot="content" className="stack">
        <div className="muted" style={{ fontSize: 13 }}>{t('donate.blurb')}</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              style={{
                flex: 1, minWidth: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 'var(--radius)', cursor: 'pointer',
                border: active === tab.key ? `2px solid ${tab.color}` : '1px solid var(--border-soft)',
                background: active === tab.key ? 'var(--md-sys-color-surface-container-high)' : 'var(--md-sys-color-surface-container-low)',
              }}
            >
              {tab.icon}
              <span style={{ fontSize: 13, fontWeight: 700 }}>{tab.label}</span>
            </button>
          ))}
        </div>
        {cur && (
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            {cur.paypal ? (
              <div style={{ padding: 26, borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container-low)', color: 'var(--md-sys-color-on-surface-variant)', fontWeight: 600 }}>
                {t('donate.paypalSoon')}
              </div>
            ) : (
              <>
                <QrSlot name={cur.img} hint={cur.hint} />
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{cur.hint}</div>
              </>
            )}
          </div>
        )}
        <div style={{ marginTop: 8, padding: '14px 16px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-surface-container-low)', border: '1px solid var(--border-soft)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('donate.rewardTitle')}</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            {t('donate.rewardBody')}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t('donate.ownerQq')}</span>
            <a
              href="https://wpa.qq.com/msgrd?v=3&uin=481029429&site=qq&menu=yes"
              target="_blank"
              rel="noreferrer"
              style={{ padding: '6px 16px', borderRadius: 'var(--radius)', background: 'var(--md-sys-color-primary)', color: 'var(--md-sys-color-on-primary)', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
            >
              481029429
            </a>
          </div>
        </div>
      </div>
      <div slot="actions">
        <TextButton onClick={onClose}>{t('common.close')}</TextButton>
      </div>
    </Dialog>
  );
}
