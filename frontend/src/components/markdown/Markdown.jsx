import { Link } from 'react-router-dom';

// ===========================================================================
// 极简 Markdown 渲染器
//
// 两条硬性原则：
// 1. **不用 dangerouslySetInnerHTML**：解析出来的是数据结构，交给 React 渲染成元素，
//    所以正文里写 <script> 之类只会原样显示成文字，天然没有 XSS 面。
// 2. **链接白名单**：只允许 http/https、站内路径（/…）、锚点（#…），
//    javascript:/data: 这类一律当作普通文字。
// ===========================================================================

const SAFE_HREF = /^(https?:\/\/|\/|#)/i;
const SAFE_SRC = /^(https?:\/\/|\/)/i;
const FENCE = /^\s*(```|~~~)\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>/;
const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)\d+[.)]\s+(.*)$/;
const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function isSafeHref(url) {
  return typeof url === 'string' && SAFE_HREF.test(url) && !/^\s*javascript:/i.test(url);
}
export function isSafeSrc(url) {
  return typeof url === 'string' && SAFE_SRC.test(url) && !/^\s*javascript:/i.test(url);
}

function isBlockStart(line) {
  return (
    !line.trim() ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST_LINE.test(line)
  );
}

// ---------------------------------------------------------------- 行内
export function parseInline(text) {
  const nodes = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      nodes.push({ type: 'text', text: buf });
      buf = '';
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);
    let m;

    if (rest[0] === '\n') {
      flush();
      nodes.push({ type: 'br' });
      i += 1;
      continue;
    }
    if (rest[0] === '`' && (m = /^`([^`\n]+)`/.exec(rest))) {
      flush();
      nodes.push({ type: 'code', text: m[1] });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('![') && (m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest))) {
      flush();
      if (isSafeSrc(m[2])) nodes.push({ type: 'image', alt: m[1], src: m[2] });
      else buf += m[0];
      i += m[0].length;
      continue;
    }
    if (rest[0] === '[' && (m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest))) {
      flush();
      if (isSafeHref(m[2])) nodes.push({ type: 'link', href: m[2], children: parseInline(m[1]) });
      else buf += m[0];
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('**') && (m = /^\*\*([\s\S]+?)\*\*/.exec(rest))) {
      flush();
      nodes.push({ type: 'strong', children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('__') && (m = /^__([\s\S]+?)__/.exec(rest))) {
      flush();
      nodes.push({ type: 'strong', children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('~~') && (m = /^~~([\s\S]+?)~~/.exec(rest))) {
      flush();
      nodes.push({ type: 'del', children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (rest[0] === '*' && (m = /^\*([^*\n]+)\*/.exec(rest))) {
      flush();
      nodes.push({ type: 'em', children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    if (rest[0] === '_' && (m = /^_([^_\n]+)_/.exec(rest))) {
      flush();
      nodes.push({ type: 'em', children: parseInline(m[1]) });
      i += m[0].length;
      continue;
    }
    // 裸链接
    if ((m = /^https?:\/\/[^\s<>()（）【】]+/.exec(rest))) {
      flush();
      nodes.push({ type: 'link', href: m[0], children: [{ type: 'text', text: m[0] }] });
      i += m[0].length;
      continue;
    }
    // 站内话题 #话题#
    if (rest[0] === '#' && (m = /^#([^#\s]{1,20})#/.exec(rest))) {
      flush();
      nodes.push({ type: 'topic', text: m[0], topic: m[1] });
      i += m[0].length;
      continue;
    }
    // @提及（高亮显示，不做跳转：前端不知道该昵称对应哪个账号）
    if (rest[0] === '@' && (m = /^@([^\s@#，。！？、；：,.!?;:]{1,20})/.exec(rest))) {
      flush();
      nodes.push({ type: 'mention', text: m[0] });
      i += m[0].length;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return nodes;
}

// ---------------------------------------------------------------- 块级
function parseTable(lines, start) {
  const split = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const head = split(lines[start]);
  const aligns = split(lines[start + 1]).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return null;
  });
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
    rows.push(split(lines[i]));
    i += 1;
  }
  return { block: { type: 'table', head, aligns, rows }, next: i };
}

function parseList(lines, start) {
  const first = LIST_LINE.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = OL.test(lines[start]) && !UL.test(lines[start]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = UL.exec(lines[i]) || OL.exec(lines[i]);
    if (!m || m[1].length !== baseIndent) break;
    const itemLines = [m[2]];
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // 空行：后面若还有更深缩进则属于本项，否则列表结束
        if (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
          itemLines.push('');
          i += 1;
          continue;
        }
        break;
      }
      const nm = LIST_LINE.exec(line);
      if (nm && nm[1].length <= baseIndent) break;
      if (!nm && line.match(/^\s*/)[0].length <= baseIndent) break;
      itemLines.push(line.replace(new RegExp(`^\\s{0,${baseIndent + 2}}`), ''));
      i += 1;
    }
    items.push(parseMarkdown(itemLines.join('\n')));
  }
  return { block: { type: 'list', ordered, items }, next: i };
}

export function parseMarkdown(src) {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    let m;
    if ((m = FENCE.exec(line))) {
      const fence = m[1];
      const close = new RegExp(`^\\s*${fence}`);
      const buf = [];
      i += 1;
      while (i < lines.length && !close.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过收尾的 ```
      blocks.push({ type: 'code', lang: m[2] || '', code: buf.join('\n') });
      continue;
    }

    if ((m = HEADING.exec(line))) {
      blocks.push({ type: 'heading', level: m[1].length, children: parseInline(m[2].trim()) });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (buf.length && lines[i].trim()))) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', blocks: parseMarkdown(buf.join('\n')) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const t = parseTable(lines, i);
      blocks.push(t.block);
      i = t.next;
      continue;
    }

    if (LIST_LINE.test(line)) {
      const l = parseList(lines, i);
      blocks.push(l.block);
      i = l.next;
      continue;
    }

    // 普通段落：连续非空且非块起始的行合成一段
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    if (!buf.length) {
      i += 1; // 兜底，避免死循环
      continue;
    }
    blocks.push({ type: 'paragraph', children: parseInline(buf.join('\n')) });
  }

  return blocks;
}

// ---------------------------------------------------------------- 渲染
function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <span key={i}>{n.text}</span>;
      case 'br':
        return <br key={i} />;
      case 'code':
        return (
          <code key={i} className="md-code">
            {n.text}
          </code>
        );
      case 'strong':
        return <strong key={i}><Inline nodes={n.children} /></strong>;
      case 'em':
        return <em key={i}><Inline nodes={n.children} /></em>;
      case 'del':
        return <del key={i}><Inline nodes={n.children} /></del>;
      case 'link':
        return n.href.startsWith('/') ? (
          <Link key={i} to={n.href} className="md-link"><Inline nodes={n.children} /></Link>
        ) : (
          <a key={i} href={n.href} className="md-link" target="_blank" rel="noopener noreferrer nofollow">
            <Inline nodes={n.children} />
          </a>
        );
      case 'image':
        return <img key={i} src={n.src} alt={n.alt || ''} className="md-img" loading="lazy" />;
      case 'topic':
        return (
          <Link key={i} to={`/search?q=${encodeURIComponent(n.topic)}`} className="md-topic">
            {n.text}
          </Link>
        );
      case 'mention':
        return <span key={i} className="md-mention">{n.text}</span>;
      default:
        return null;
    }
  });
}

export function MarkdownBlocks({ blocks }) {
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading': {
        const Tag = `h${Math.min(6, Math.max(1, b.level))}`;
        return <Tag key={i} className="md-h"><Inline nodes={b.children} /></Tag>;
      }
      case 'paragraph':
        return <p key={i} className="md-p"><Inline nodes={b.children} /></p>;
      case 'code':
        return (
          <pre key={i} className="md-pre" data-lang={b.lang || undefined}>
            <code>{b.code}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={i} className="md-quote">
            <MarkdownBlocks blocks={b.blocks} />
          </blockquote>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className="md-list">
            {b.items.map((item, j) => (
              <li key={j}>
                <MarkdownBlocks blocks={item} />
              </li>
            ))}
          </Tag>
        );
      }
      case 'hr':
        return <hr key={i} className="md-hr" />;
      case 'table':
        return (
          <div key={i} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={b.aligns[j] ? { textAlign: b.aligns[j] } : undefined}>
                      <Inline nodes={parseInline(c)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {b.head.map((_, ci) => (
                      <td key={ci} style={b.aligns[ci] ? { textAlign: b.aligns[ci] } : undefined}>
                        <Inline nodes={parseInline(row[ci] || '')} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

// 对外组件：<Markdown text={...} />
export default function Markdown({ text, className }) {
  const blocks = parseMarkdown(text);
  if (!blocks.length) return null;
  return (
    <div className={`md-body${className ? ' ' + className : ''}`}>
      <MarkdownBlocks blocks={blocks} />
    </div>
  );
}
