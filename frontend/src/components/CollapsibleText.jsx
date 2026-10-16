/**
 * 长文本折叠：**真的超出 maxLines 行**才出现「展开」，展开后可以「收起」。
 *
 * 为什么不用「字符数 > N」判断：中英文混排、有没有换行、容器宽度（手机/桌面）都会影响行数，
 * 按字符数判断要么该折叠的没折（撑满一屏），要么没超的也挂个「展开」（点开发现只多一行）。
 * 这里用 CSS line-clamp 折行 + 量一次真实高度（scrollHeight vs clientHeight）来决定按钮要不要出现。
 *
 * 细节：
 * - 折叠时末行用 mask 渐隐，暗示「下面还有」，且不依赖页面底色（换主题也不用改）；
 * - 展开状态下**不再重新测量**，否则 scrollHeight == clientHeight 会让按钮自己消失、没法收起；
 * - 长链接/长单词用 overflow-wrap:anywhere 强制折行，不会撑出横向滚动条。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '../i18n';

export default function CollapsibleText({ text, children, maxLines = 6, style, className = '', buttonStyle }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef(null);
  // 既支持纯文本（text，稿件描述用），也支持富内容（children，稿件来源那种带加粗标签的块）
  const content = children != null ? children : text;
  const resetKey = text != null ? text : String(maxLines);

  // 换了一篇稿件（内容变了）就收起来
  useEffect(() => { setOpen(false); }, [resetKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return undefined; // 展开态不测量（见文件头说明）
    const measure = () => {
      if (!ref.current) return;
      setOverflow(ref.current.scrollHeight - ref.current.clientHeight > 4);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [resetKey, open, maxLines, content]);

  if (content == null || content === '') return null;

  const clamp = open ? {} : {
    display: '-webkit-box',
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    // 末行渐隐（mask 跟文字一起淡出，不受底色影响）
    WebkitMaskImage: 'linear-gradient(to bottom, #000 78%, rgba(0,0,0,0.15) 100%)',
    maskImage: 'linear-gradient(to bottom, #000 78%, rgba(0,0,0,0.15) 100%)',
  };

  return (
    <div className={className} style={style}>
      {/* 用 div 而不是 p：富内容（children）里可能有 div/br，p 里塞块级元素不合法 */}
      <div ref={ref} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, overflowWrap: 'anywhere', ...clamp }}>
        {content}
      </div>
      {overflow && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="row"
          style={{
            gap: 4, alignItems: 'center', marginTop: 6, padding: '2px 8px 2px 4px', cursor: 'pointer',
            background: 'transparent', border: 0, borderRadius: 'var(--radius)',
            color: 'var(--md-sys-color-primary)', font: 'inherit', fontWeight: 700, fontSize: 13,
            ...buttonStyle,
          }}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {open ? t('common.collapse') : t('common.expand')}
        </button>
      )}
    </div>
  );
}
