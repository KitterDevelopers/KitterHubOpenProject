// @material/web (Google MD3 Web Components) -> React 封装层
// 用 @lit/react 的 createComponent 把自定义元素包装成 React 组件，
// 正确映射属性与事件。图标统一用 lucide-react(SVG)，不依赖 Google Fonts。
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createComponent } from '@lit/react';

import { MdFilledButton } from '@material/web/button/filled-button.js';
import { MdFilledTonalButton } from '@material/web/button/filled-tonal-button.js';
import { MdOutlinedButton } from '@material/web/button/outlined-button.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdElevatedButton } from '@material/web/button/elevated-button.js';

import { MdFilledIconButton } from '@material/web/iconbutton/filled-icon-button.js';
import { MdFilledTonalIconButton } from '@material/web/iconbutton/filled-tonal-icon-button.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';

import { MdFab } from '@material/web/fab/fab.js';

import { MdFilledTextField } from '@material/web/textfield/filled-text-field.js';
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';

import { MdFilledSelect } from '@material/web/select/filled-select.js';
import { MdOutlinedSelect } from '@material/web/select/outlined-select.js';
import { MdSelectOption } from '@material/web/select/select-option.js';

import { MdDialog } from '@material/web/dialog/dialog.js';

import { MdList } from '@material/web/list/list.js';
import { MdListItem } from '@material/web/list/list-item.js';

import { MdTabs } from '@material/web/tabs/tabs.js';
import { MdPrimaryTab } from '@material/web/tabs/primary-tab.js';
import { MdSecondaryTab } from '@material/web/tabs/secondary-tab.js';

import { MdAssistChip } from '@material/web/chips/assist-chip.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { MdChipSet } from '@material/web/chips/chip-set.js';

import { MdCheckbox } from '@material/web/checkbox/checkbox.js';
import { MdSwitch } from '@material/web/switch/switch.js';
import { MdCircularProgress } from '@material/web/progress/circular-progress.js';
import { MdLinearProgress } from '@material/web/progress/linear-progress.js';
import { MdDivider } from '@material/web/divider/divider.js';

const react = React;

// 事件映射：@lit/react 只监听这里声明的事件（否则当作属性处理）
const CLICK = { onClick: 'click' };
const FIELD = { onInput: 'input', onChange: 'change' };
const CLOSE = { onClose: 'close', onClosed: 'closed', onOpened: 'opened' };

export const FilledButton = createComponent({ react, tagName: 'md-filled-button', elementClass: MdFilledButton, events: CLICK });
export const FilledTonalButton = createComponent({ react, tagName: 'md-filled-tonal-button', elementClass: MdFilledTonalButton, events: CLICK });
export const OutlinedButton = createComponent({ react, tagName: 'md-outlined-button', elementClass: MdOutlinedButton, events: CLICK });
export const TextButton = createComponent({ react, tagName: 'md-text-button', elementClass: MdTextButton, events: CLICK });
export const ElevatedButton = createComponent({ react, tagName: 'md-elevated-button', elementClass: MdElevatedButton, events: CLICK });

export const FilledIconButton = createComponent({ react, tagName: 'md-filled-icon-button', elementClass: MdFilledIconButton, events: CLICK });
export const FilledTonalIconButton = createComponent({ react, tagName: 'md-filled-tonal-icon-button', elementClass: MdFilledTonalIconButton, events: CLICK });
export const OutlinedIconButton = createComponent({ react, tagName: 'md-outlined-icon-button', elementClass: MdOutlinedIconButton, events: CLICK });
export const IconButton = createComponent({ react, tagName: 'md-icon-button', elementClass: MdIconButton, events: CLICK });

export const Fab = createComponent({ react, tagName: 'md-fab', elementClass: MdFab, events: CLICK });

const BaseFilledTextField = createComponent({ react, tagName: 'md-filled-text-field', elementClass: MdFilledTextField, events: FIELD });
const BaseOutlinedTextField = createComponent({ react, tagName: 'md-outlined-text-field', elementClass: MdOutlinedTextField, events: FIELD });

/* 文本框自动填充支持。
 *
 * 事实（已核对 @material/web 2.5.0 源码 textfield/internal/text-field.js:502-503）：
 *   MD3 的 text field **会**把宿主的 autocomplete / name 转发到内部 <input>，type 也会。
 *   唯一转发不到、且没有 ::part() 可用的是 **id** —— 必须用 JS 写进 shadowRoot。
 * 另外：真正的 <input> 在 shadow DOM 里，Chrome 的表单解析对它并不可靠
 *   （Chromium issue 41334315），所以凭证表单还要配 AutofillBridge 的 light DOM 兜底字段。
 *
 * 这里做两件事：默认 autocomplete=off（站内绝大多数文本框不是凭据，避免被乱填）；
 * id 用 updateComplete + 重试写进内部 input。
 */
function withAutofill(Base, tagName) {
  const Wrapped = react.forwardRef(function AutofillTextField({ autocomplete, name, inputId, ...rest }, ref) {
    // 默认 off：站内绝大多数文本框不是账号/密码（昵称、标题、搜索、反馈…），
    // 不关掉的话 Chrome 会拿登录账号去填昵称、拿密码去填搜索框 —— 这就是"乱套"。
    // 真正需要自动填充的框由调用方显式指定（见 Login.jsx / AccountTab.jsx 等）。
    const ac = autocomplete === undefined ? 'off' : autocomplete;
    const hostRef = react.useRef(null);
    react.useImperativeHandle(ref, () => hostRef.current, []);
    react.useEffect(() => {
      const host = hostRef.current;
      if (!host) return undefined;
      let stopped = false;
      const apply = () => {
        // textarea 也要兼容：MD3 的 textarea 变体内部是 <textarea>
        const inner =
          (host.querySelector && host.querySelector('input,textarea')) ||
          (host.shadowRoot && host.shadowRoot.querySelector('input,textarea'));
        if (!inner) return false;
        if (ac) inner.setAttribute('autocomplete', ac);
        if (name) inner.setAttribute('name', name);
        if (inputId) inner.setAttribute('id', inputId);
        return true;
      };
      if (apply()) return undefined;
      // 内部节点可能晚一帧甚至更晚才建好：updateComplete + 递增重试，避免低端机上永久丢 id
      const timers = [60, 200, 600].map((ms) => setTimeout(() => { if (!stopped) apply(); }, ms));
      if (host.updateComplete && typeof host.updateComplete.then === 'function') {
        host.updateComplete.then(() => { if (!stopped) apply(); });
      }
      return () => { stopped = true; timers.forEach(clearTimeout); };
    }, [ac, name, inputId]);
    return react.createElement(Base, {
      ...rest,
      ref: hostRef,
      // 这两个交给 MD3 自己转发到内部 input（见文件头注释）
      ...(ac ? { autocomplete: ac } : null),
      ...(name ? { name } : null),
    });
  });
  Wrapped.displayName = 'Autofill(' + tagName + ')';
  return Wrapped;
}

export const FilledTextField = withAutofill(BaseFilledTextField, 'md-filled-text-field');
export const OutlinedTextField = withAutofill(BaseOutlinedTextField, 'md-outlined-text-field');

export const FilledSelect = createComponent({ react, tagName: 'md-filled-select', elementClass: MdFilledSelect, events: { ...FIELD, ...CLOSE } });
export const OutlinedSelect = createComponent({ react, tagName: 'md-outlined-select', elementClass: MdOutlinedSelect, events: { ...FIELD, ...CLOSE } });

// md-select-option 的显示文本必须放在 slot="headline" 里（某些版本直接传 headline 属性
// 在展开面板中会不渲染/显示异常）。这里统一把 headline prop 转成 slot，其余属性透传。
// 注意：本文件是 .js（无 JSX），用 React.createElement 编写。
export function SelectOption({ headline, children, ...rest }) {
  return React.createElement(
    'md-select-option',
    rest,
    headline != null ? React.createElement('span', { slot: 'headline' }, headline) : null,
    children
  );
}

export const Dialog = createComponent({ react, tagName: 'md-dialog', elementClass: MdDialog, events: { onClose: 'close', onClosed: 'closed', onCancel: 'cancel' } });

// Menu / MenuItem：自绘 JS 定位下拉（md-menu 原生 CSS 锚点定位在当前浏览器环境失效，见文件末尾实现）

export const List = createComponent({ react, tagName: 'md-list', elementClass: MdList });
export const ListItem = createComponent({ react, tagName: 'md-list-item', elementClass: MdListItem, events: CLICK });

export const Tabs = createComponent({ react, tagName: 'md-tabs', elementClass: MdTabs, events: { onChange: 'change' } });
export const PrimaryTab = createComponent({ react, tagName: 'md-primary-tab', elementClass: MdPrimaryTab, events: CLICK });
export const SecondaryTab = createComponent({ react, tagName: 'md-secondary-tab', elementClass: MdSecondaryTab, events: CLICK });

export const AssistChip = createComponent({ react, tagName: 'md-assist-chip', elementClass: MdAssistChip, events: CLICK });
export const FilterChip = createComponent({ react, tagName: 'md-filter-chip', elementClass: MdFilterChip, events: CLICK });
export const ChipSet = createComponent({ react, tagName: 'md-chip-set', elementClass: MdChipSet });

export const Checkbox = createComponent({ react, tagName: 'md-checkbox', elementClass: MdCheckbox, events: FIELD });
export const Switch = createComponent({ react, tagName: 'md-switch', elementClass: MdSwitch, events: FIELD });
export const CircularProgress = createComponent({ react, tagName: 'md-circular-progress', elementClass: MdCircularProgress });
export const LinearProgress = createComponent({ react, tagName: 'md-linear-progress', elementClass: MdLinearProgress });
export const Divider = createComponent({ react, tagName: 'md-divider', elementClass: MdDivider });

// ---------------------------------------------------------------------------
// Menu / MenuItem（自绘版）
// @material/web 的 md-menu 依赖 CSS 锚点定位（Chromium anchor positioning），
// 在当前部署环境（含无头 Chrome/Edge 与部分用户浏览器）实测失效：弹窗总是落到
// 页面左上角而非锚点附近。这里改为 JS 测量定位的自绘下拉，外观沿用 MD3 风格
// （圆角 12、surface-container 底色、item 悬停高亮），用法与原 API 一致：
//   <Menu anchor="some-id" open onClosed={...}><MenuItem onClick={...}>项</MenuItem><Divider/></Menu>
// ---------------------------------------------------------------------------

export function MenuItem({ children, className, onClick, ...rest }) {
  return React.createElement(
    'button',
    { type: 'button', role: 'menuitem', className: `m3-menu-item${className ? ' ' + className : ''}`, onClick, ...rest },
    children
  );
}

export function Menu({ anchor, open = false, onClosed, children, style, align = 'start' }) {
  const [phase, setPhase] = useState('closed'); // closed | measuring | open
  const [place, setPlace] = useState({ x: 8, y: 64 });
  const panelRef = useRef(null);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  // 打开：先按锚点估算位置 → 隐藏渲染并【循环测量直到真实尺寸>0】→ 一次性定位后显示
  // （避免首轮宽度=0 时先摆到锚点右缘再被二次校正拉回 → 造成"向右闪一下再向左"）
  // align="start"：菜单左边缘贴锚点左边缘（默认）；align="right"：菜单右边缘贴锚点右边缘（顶栏右侧按钮用）
  useEffect(() => {
    if (!open) {
      setPhase('closed');
      return undefined;
    }
    const alignRight = align === 'right';
    const anchorEl = anchor ? document.getElementById(anchor) : null;
    let x = 8;
    let y = 64;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      x = alignRight ? r.right : r.left;
      y = r.bottom + 6;
    }
    setPlace({ x, y });
    setPhase('measuring');
    let raf = 0;
    const tryMeasure = (left) => {
      const p = panelRef.current;
      const pr = p ? p.getBoundingClientRect() : null;
      if (pr && pr.width > 0) {
        // 拿到真实尺寸后一次到位：start=左对齐，right=右对齐
        const nxRaw = alignRight ? x - pr.width : x;
        let nx = nxRaw;
        let ny = y;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (nx + pr.width > vw - 8) nx = Math.max(8, vw - pr.width - 8);
        if (nx < 8) nx = 8;
        if (ny + pr.height > vh - 8) ny = Math.max(8, y - pr.height - 6);
        setPlace({ x: nx, y: ny });
        setPhase('open');
        return;
      }
      if (left <= 0) {
        // 兜底：仍取不到尺寸就直接显示，后续二次校正兜底
        setPhase('open');
        return;
      }
      raf = requestAnimationFrame(() => tryMeasure(left - 1));
    };
    raf = requestAnimationFrame(() => tryMeasure(14));
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, align]);

  // 打开后二次校正：若首轮测量时机过早已致宽度为 0，则按真实尺寸重新对齐锚点
  useEffect(() => {
    if (phase !== 'open') return undefined;
    let tries = 0;
    let timer = null;
    const fix = () => {
      const p = panelRef.current;
      if (!p) return;
      const pr = p.getBoundingClientRect();
      if (pr.width <= 1 && tries < 5) {
        tries += 1;
        timer = setTimeout(fix, 40);
        return;
      }
      if (pr.width <= 1) return;
      const anchorEl = anchor ? document.getElementById(anchor) : null;
      const vw = window.innerWidth;
      let desired = pr.left;
      if (anchorEl) {
        const ar = anchorEl.getBoundingClientRect();
        // 期望位置：start=左缘贴锚点左缘；right=右缘贴锚点右缘
        desired = align === 'right' ? ar.right - pr.width : ar.left;
      }
      // 上下/左右都确保在视口内
      desired = Math.min(Math.max(desired, 6), vw - pr.width - 6);
      if (Math.abs(desired - pr.left) > 1) setPlace((prev) => ({ ...prev, x: desired }));
    };
    timer = setTimeout(fix, 50);
    return () => clearTimeout(timer);
  }, [phase, anchor, align]);

  // 打开期间：点击外部 / Esc / 窗口变化 → 关闭
  useEffect(() => {
    if (phase !== 'open') return undefined;
    const close = () => closedRef.current && closedRef.current();
    const onPointerDown = (e) => {
      const p = panelRef.current;
      const anchorEl = anchor ? document.getElementById(anchor) : null;
      if (p && !p.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [phase, anchor]);

  if (phase === 'closed') return null;
  const hidden = phase === 'measuring';
  const items = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type === Divider) return child;
    const orig = child.props.onClick;
    const wrapped = (ev) => {
      try {
        if (orig) orig(ev);
      } finally {
        closedRef.current && closedRef.current();
      }
    };
    return React.cloneElement(child, { onClick: wrapped });
  });
  return React.createElement(
    'div',
    {
      ref: panelRef,
      role: 'menu',
      className: 'm3-menu-panel',
      style: { left: place.x, top: place.y, visibility: hidden ? 'hidden' : 'visible', ...style },
    },
    items
  );
}
