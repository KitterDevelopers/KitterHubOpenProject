import { useI18n } from '../../i18n';

// 近 7 天趋势柱状图（纯 div + 固定像素高度，避免百分比高度在不同引擎下的差异）
export default function TrendBars({ values = [], labels = [], unit, height = 96 }) {
  const { t } = useI18n();
  const amountUnit = unit || t('creator.trendUnit');
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  const total = values.reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <div className="cc-trend-wrap">
      <div className="cc-trend" style={{ height: height + 46 }}>
        {values.map((raw, i) => {
          const v = Number(raw) || 0;
          const h = v > 0 ? Math.max(5, Math.round((v / max) * height)) : 3;
          return (
            <div className="cc-trend-col" key={i} title={t('creator.trendTip', { label: labels[i] || '', value: v, unit: amountUnit })}>
              <span className="cc-trend-num">{v > 0 ? v : ''}</span>
              <div className={`cc-trend-bar${v > 0 ? '' : ' is-zero'}`} style={{ height: h }} />
              <span className="cc-trend-x">{labels[i] || ''}</span>
            </div>
          );
        })}
      </div>
      <div className="cc-trend-total muted">{t('creator.trendTotal', { n: values.length })} <b>{total}</b> {amountUnit}</div>
    </div>
  );
}
