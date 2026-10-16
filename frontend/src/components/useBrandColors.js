/**
 * 站标 / 品牌文字的配色 hook（站长 2026-10-01）。
 *
 * 为什么要有它：LOGO（内联 SVG）与顶栏「KitterHub」文字要**用同一套颜色**，
 * 而且都要跟着主题色、跟着明暗主题实时变。之前 LOGO 自己算一份、文字直接用
 * `var(--md-sys-color-primary)`，深色主题下那个 token 是很浅的色调 → 文字与 LOGO 都发白
 * （站长：「标题和 LOGO 的颜色深一点，太浅了」）。
 *
 * 现在两处共用这一个 hook：
 *   const [ref, colors] = useBrandColors();   // ref 挂在容器/元素上，colors = { a, b, text }
 * 元素自身的 computed style 能读到继承下来的 `--md-sys-color-primary`，
 * 所以主题色被写在 html/body/任何一层都能读到；再盯着 <html>/<body> 的属性与内联样式变化，
 * 换主题色或切明暗主题都会立刻重算（不需要刷新）。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { logoColors } from '../appearance';

const BRAND = { a: '#3b8afd', b: '#17c7ff', text: null };

export default function useBrandColors() {
  const ref = useRef(null);
  const [colors, setColors] = useState(BRAND);
  useLayoutEffect(() => {
    const update = () => setColors(logoColors(ref.current));
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'data-brand'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-theme', 'data-brand'] });
    return () => mo.disconnect();
  }, []);
  return [ref, colors];
}
