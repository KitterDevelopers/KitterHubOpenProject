import { useLayoutEffect, useRef, useState } from 'react';
import WorkCard from './WorkCard';

// 作品网格：横排数量按容器实际宽度算，竖向固定最多 2 行，不出现横向滚动条。
// 列数收敛在 [2, maxCols]；超出的部分由调用方决定是否提供「查看更多」入口。
const MIN_CARD = 200;
const MAX_COLS = 6;
const GAP = 16;
const ROWS = 2;

export default function WorkGrid({ works = [], minCard = MIN_CARD, maxCols = MAX_COLS }) {
  const boxRef = useRef(null);
  const [cols, setCols] = useState(4);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      const fit = Math.floor((w + GAP) / (minCard + GAP));
      const next = Math.max(2, Math.min(maxCols, fit));
      setCols((c) => (c === next ? c : next));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [works.length, minCard, maxCols]);

  const shown = works.slice(0, cols * ROWS);

  return (
    <div ref={boxRef} className="work-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {shown.map((w) => (
        <WorkCard key={w.id} work={w} />
      ))}
    </div>
  );
}
