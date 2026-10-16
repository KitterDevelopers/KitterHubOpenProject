import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Italic, Strikethrough, Code, SquareCode, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Link2, Image as ImageIcon, Table2, Hash,
  Eye, Pencil, Columns2, CircleHelp, LoaderCircle, CloudUpload,
} from 'lucide-react';
import { FilledButton, Dialog } from '../../ui';
import client from '../../api/client';
import { toast } from '../Toast';
import Markdown from './Markdown';
import { useI18n } from '../../i18n';
import { useErr } from '../../i18n/server';

const MODE_KEY = 'nimao_md_mode';

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countWords(text) {
  const zh = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (text.match(/[A-Za-z0-9_'-]+/g) || []).length;
  return zh + en;
}

// Markdown 编辑器：工具栏 + 快捷键 + 实时预览 + 粘贴/拖拽上传图片
export default function MarkdownEditor({
  value = '',
  onChange,
  placeholder,
  minHeight = 340,
  onSubmit,
  label,
}) {
  const { t } = useI18n();
  const err = useErr();
  const taRef = useRef(null);
  const pvRef = useRef(null);
  const fileRef = useRef(null);
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || 'split');
  const [uploading, setUploading] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  // 分栏模式下预览不再单独出一条滚动条（CSS 里 overflow:hidden），
  // 改成跟着正文按比例滚：正文滚到 50%，预览也到 50%。
  const syncPreview = useCallback(() => {
    const ta = taRef.current;
    const pv = pvRef.current;
    if (!ta || !pv) return;
    const pvMax = pv.scrollHeight - pv.clientHeight;
    if (pvMax <= 0) return;
    const taMax = ta.scrollHeight - ta.clientHeight;
    const ratio = taMax > 0 ? ta.scrollTop / taMax : 0;
    pv.scrollTop = ratio * pvMax;
  }, []);

  const set = useCallback(
    (next, selStart, selEnd) => {
      onChange(next);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        if (selStart != null) ta.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
      });
    },
    [onChange]
  );

  // 选区两侧包一层（粗体/斜体/代码…）
  const surround = (before, after = before, ph = '') => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = value.slice(s, e) || ph;
    set(value.slice(0, s) + before + sel + after + value.slice(e), s + before.length, s + before.length + sel.length);
  };

  // 插入文本，光标放到 offset 处
  const insert = (text, offset) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = value.slice(0, s) + text + value.slice(e);
    set(next, s + (offset == null ? text.length : offset));
  };

  // 给选中的每一行加/去前缀
  const prefixLines = (marker, { numbered = false, cycle = false } = {}) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const blockStart = value.lastIndexOf('\n', s - 1) + 1;
    const nl = value.indexOf('\n', e);
    const blockEnd = nl === -1 ? value.length : nl;
    const lines = value.slice(blockStart, blockEnd).split('\n');
    const anyHas = lines.some((l) => l.trim().startsWith(marker));
    const stripRe = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+|#{1,6}\s+)/;
    const out = lines.map((l, i) => {
      const bare = l.replace(stripRe, '');
      if (cycle && anyHas) return bare;
      if (numbered) return `${i + 1}. ${bare}`;
      return `${marker} ${bare}`;
    });
    const next = value.slice(0, blockStart) + out.join('\n') + value.slice(blockEnd);
    set(next, blockStart, blockStart + out.join('\n').length);
  };

  const cycleHeading = () => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const nl = value.indexOf('\n', s);
    const lineEnd = nl === -1 ? value.length : nl;
    const line = value.slice(lineStart, lineEnd);
    const m = /^(#{1,6})\s+/.exec(line);
    const level = m ? m[1].length : 0;
    const nextLevel = level >= 3 ? 0 : level + 1;
    const bare = line.replace(/^#{1,6}\s+/, '');
    const out = nextLevel ? `${'#'.repeat(nextLevel)} ${bare}` : bare;
    const next = value.slice(0, lineStart) + out + value.slice(lineEnd);
    set(next, lineStart + out.length);
  };

  // ---- 图片上传：工具栏 / 粘贴 / 拖拽 ----
  const uploadFiles = async (files) => {
    const list = [...(files || [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    try {
      for (const f of list) {
        const fd = new FormData();
        fd.append('file', f);
        const up = await client.post('/upload', fd);
        insert(`\n![${f.name.replace(/\.[^.]+$/, '') || t('editor.phImage')}](${up.data.url})\n`);
      }
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setUploading((n) => Math.max(0, n - list.length));
    }
  };

  const onKeyDown = (e) => {
    const ta = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      return surround('**', '**', t('editor.phBold'));
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      return surround('*', '*', t('editor.phItalic'));
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return surround('[', '](https://)', t('editor.phLink'));
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      onSubmit && onSubmit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) {
        if (value.slice(lineStart, lineStart + 2) === '  ') {
          const next = value.slice(0, lineStart) + value.slice(lineStart + 2);
          set(next, Math.max(lineStart, s - 2));
        }
      } else {
        const next = `${value.slice(0, lineStart)}  ${value.slice(lineStart)}`;
        set(next, s + 2);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // 列表/引用自动续行；空项则跳出
      const s = ta.selectionStart;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      let m;
      if ((m = /^(\s*)([-*+])\s+(.*)$/.exec(line))) {
        e.preventDefault();
        if (!m[3].trim()) {
          const next = value.slice(0, lineStart) + '\n' + value.slice(s);
          return set(next, lineStart + 1);
        }
        const add = `\n${m[1]}${m[2]} `;
        return insert(add);
      }
      if ((m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line))) {
        e.preventDefault();
        if (!m[3].trim()) {
          const next = value.slice(0, lineStart) + '\n' + value.slice(s);
          return set(next, lineStart + 1);
        }
        const add = `\n${m[1]}${Number(m[2]) + 1}. `;
        return insert(add);
      }
      if ((m = /^(\s*)>\s?(.*)$/.exec(line))) {
        e.preventDefault();
        if (!m[2].trim()) {
          const next = value.slice(0, lineStart) + '\n' + value.slice(s);
          return set(next, lineStart + 1);
        }
        return insert(`\n${m[1]}> `);
      }
    }
  };

  const words = useMemo(() => countWords(value), [value]);
  const readMin = Math.max(1, Math.round(words / 300));

  const Btn = ({ icon: Icon, title, onClick, active }) => (
    <button
      type="button"
      className={`md-tool${active ? ' active' : ''}`}
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );

  return (
    <div className={`md-editor${dragOver ? ' dragging' : ''}`}>
      <div className="md-toolbar">
        <div className="md-tool-group">
          <Btn icon={Heading1} title={t('editor.tHeading')} onClick={cycleHeading} />
          <Btn icon={Bold} title={t('editor.tBold')} onClick={() => surround('**', '**', t('editor.phBold'))} />
          <Btn icon={Italic} title={t('editor.tItalic')} onClick={() => surround('*', '*', t('editor.phItalic'))} />
          <Btn icon={Strikethrough} title={t('editor.tStrike')} onClick={() => surround('~~', '~~', t('editor.phStrike'))} />
        </div>
        <div className="md-tool-group">
          <Btn icon={List} title={t('editor.tUl')} onClick={() => prefixLines('-', { cycle: true })} />
          <Btn icon={ListOrdered} title={t('editor.tOl')} onClick={() => prefixLines('1.', { numbered: true })} />
          <Btn icon={Quote} title={t('editor.tQuote')} onClick={() => prefixLines('>', { cycle: true })} />
          <Btn icon={Minus} title={t('editor.tHr')} onClick={() => insert('\n---\n')} />
        </div>
        <div className="md-tool-group">
          <Btn icon={Code} title={t('editor.tCode')} onClick={() => surround('`', '`', t('editor.phCode'))} />
          <Btn icon={SquareCode} title={t('editor.tCodeBlock')} onClick={() => insert(`\n\`\`\`\n${t('editor.phCode')}\n\`\`\`\n`, 5)} />
          <Btn icon={Table2} title={t('editor.tTable')} onClick={() => insert(`\n${t('editor.tableSample')}`)} />
        </div>
        <div className="md-tool-group">
          <Btn icon={Link2} title={t('editor.tLink')} onClick={() => surround('[', '](https://)', t('editor.phLink'))} />
          <Btn icon={ImageIcon} title={t('editor.tImage')} onClick={() => fileRef.current?.click()} />
          <Btn icon={Hash} title={t('editor.tTopic')} onClick={() => surround('#', '#', t('editor.phTopic'))} />
        </div>
        <span className="spacer" />
        <div className="md-tool-group">
          <Btn icon={CircleHelp} title={t('editor.tHelp')} onClick={() => setHelpOpen(true)} />
        </div>
        <div className="md-modes">
          <Btn icon={Pencil} title={t('editor.modeEdit')} active={mode === 'edit'} onClick={() => setMode('edit')} />
          <Btn icon={Columns2} title={t('editor.modeSplit')} active={mode === 'split'} onClick={() => setMode('split')} />
          <Btn icon={Eye} title={t('editor.modePreview')} active={mode === 'preview'} onClick={() => setMode('preview')} />
        </div>
      </div>

      <div className={`md-panes mode-${mode}`}>
        {mode !== 'preview' && (
          <div className="md-pane md-pane--edit">
            {label && <div className="md-pane-label">{label}</div>}
            <textarea
              ref={taRef}
              className="md-textarea"
              style={{ minHeight }}
              value={value}
              placeholder={placeholder || t('editor.placeholder')}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={syncPreview}
              onPaste={(e) => {
                const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
                if (files.length) {
                  e.preventDefault();
                  uploadFiles(files);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                uploadFiles(e.dataTransfer?.files);
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="md-pane md-pane--preview">
            <div className="md-pane-label">{t('editor.previewLabel')}</div>
            <div className="md-preview thin-scroll" ref={pvRef} style={{ minHeight }}>
              {value.trim() ? (
                <Markdown text={value} />
              ) : (
                <div className="md-empty">{t('editor.emptyPreview')}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="md-status">
        <span>
          {t('editor.readStats', { words, min: readMin })}
        </span>
        {uploading > 0 && (
          <span className="row" style={{ gap: 4, alignItems: 'center' }}>
            <LoaderCircle size={13} className="md-spin" /> {t('editor.uploadingImages', { n: uploading })}
          </span>
        )}
        <span className="row" style={{ gap: 4, alignItems: 'center' }}>
          <CloudUpload size={13} /> {t('editor.pasteHint')}
        </span>
        <span className="muted">{t('editor.shortcuts')}</span>
      </div>

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} onCancel={() => setHelpOpen(false)}>
        <div slot="headline" className="row" style={{ gap: 8, alignItems: 'center' }}>
          <CircleHelp size={18} /> {t('editor.tHelp')}
        </div>
        <div slot="content" style={{ maxWidth: '86vw' }}>
          <table className="md-cheat">
            <tbody>
              {[
                ['editor.mdHeading', 'editor.mdHeadingDesc'],
                ['editor.mdStyle', 'editor.mdStyleDesc'],
                ['editor.mdList', 'editor.mdListDesc'],
                ['editor.mdQuote', 'editor.mdQuoteDesc'],
                ['editor.mdCode', 'editor.mdCodeDesc'],
                ['editor.mdLink', 'editor.mdLinkDesc'],
                ['editor.mdImage', 'editor.mdImageDesc'],
                ['editor.mdTable', 'editor.mdTableDesc'],
                ['editor.mdDivider', 'editor.mdDividerDesc'],
                ['editor.mdTopicSample', 'editor.mdTopicDesc'],
              ].map(([codeKey, descKey]) => (
                <tr key={codeKey}>
                  <td><code className="md-code">{t(codeKey)}</code></td>
                  <td className="muted">{t(descKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="md-cheat-note">{t('editor.cheatNote')}</div>
        </div>
        <div slot="actions">
          <FilledButton onClick={() => setHelpOpen(false)}>{t('editor.gotIt')}</FilledButton>
        </div>
      </Dialog>
    </div>
  );
}
