/**
 * 浮层滚动条（站长 2026-10-01「直接重构吧」）。
 *
 * 为什么要自绘，而不是继续调原生滚动条：
 *   Windows 上原生滚动条会占一条 **8px 的槽（gutter）**，而那条槽**只有页面画布底色能上色** ——
 *   实测：固定定位图层画不进去、根元素上的背景**图**也铺不进去（`cover` / `calc(100% + 24px)`
 *   / `fixed` / `scroll` 全试过，槽里始终是 `background-color`）。
 *   于是只要用户设了背景图，槽里就必然是一条与背景对不上的色带 —— 这是浏览器行为，调不出来。
 *
 * 所以索性**隐藏原生页面滚动条**（页面照常能滚：滚轮 / 触控板 / 键盘 / 拖本组件都在），
 * 再画一个浮层指示条：贴着视口右边 8px、半透明、拖动可滚动、滚动时出现、闲置 900ms 淡出。
 * 因为没有原生槽了，背景图能铺满整个窗口，边上再也不会出现那条异色带。
 *
 * 内层滚动区（聊天列表、侧栏等）不受影响：它们继续用 global.css 里 `::-webkit-scrollbar`
 * 的细圆条样式（那些滚动条在视口内部，不存在槽的问题）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_THUMB = 36;      // 滑块最小高度，太短不好拖
const WIDTH = 8;           // 与内层细滚动条一致的宽度
const IDLE_MS = 900;       // 闲置多久淡出

export default function OverlayScrollbar() {
  const [state, setState] = useState({ need: false, top: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  const idleTimer = useRef(0);
  const dragging = useRef(false);
  const dragStart = useRef({ y: 0, scroll: 0 });

  const measure = useCallback(() => {
    const doc = document.documentElement;
    const view = window.innerHeight;
    const total = doc.scrollHeight;
    const max = total - view;
    if (max <= 1) {
      setState({ need: false, top: 0, height: 0 });
      return;
    }
    const h = Math.max(MIN_THUMB, Math.round((view / total) * view));
    const top = Math.round((doc.scrollTop / max) * (view - h));
    setState({ need: true, top, height: h });
  }, []);

  // 滚动 / 尺寸变化 → 重新量，并让滑块短暂出现
  useEffect(() => {
    const show = () => {
      setVisible(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        if (!dragging.current) setVisible(false);
      }, IDLE_MS);
    };
    const onScroll = () => { measure(); show(); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const ro = new ResizeObserver(onScroll);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
      window.clearTimeout(idleTimer.current);
    };
  }, [measure]);

  // 拖动滑块
  const onPointerDown = (e) => {
    dragging.current = true;
    dragStart.current = { y: e.clientY, scroll: document.documentElement.scrollTop };
    setVisible(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const doc = document.documentElement;
    const view = window.innerHeight;
    const max = doc.scrollHeight - view;
    const track = view - state.height;
    if (track <= 0) return;
    const dy = e.clientY - dragStart.current.y;
    doc.scrollTop = dragStart.current.scroll + (dy / track) * max;
  };
  const onPointerUp = () => {
    dragging.current = false;
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  };

  if (!state.need) return null;
  // 触屏设备（没有精确指针）不显示：系统自己的浮层滚动条更合适
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return null;

  return (
    <div className="ovsb" aria-hidden="true">
      <div
        className={`ovsb-thumb${visible || dragging.current ? ' is-on' : ''}`}
        style={{ top: state.top, height: state.height, width: WIDTH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseEnter={() => setVisible(true)}
      />
    </div>
  );
}
