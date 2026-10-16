/**
 * 页面背景层（站长 2026-10-01「直接给我重构」）。
 *
 * 为什么重做成独立组件 + 三明治结构，而不是继续用 body::before/::after 伪元素：
 *   旧实现把 **filter: blur() 直接加在"图片层"上**。模糊有个副作用——**图层自身的边缘会淡到透明**
 *   （模糊要采样元素外面，外面是空的）。于是视口最上/最左/最右/最下那几像素里透出的是下一层的颜色，
 *   亮色主题下就是白色 → 站长反复看到的「顶部那条白印」。`transform: scale(1.04)` 也压不住，
 *   因为淡化宽度跟模糊半径一起变。
 *
 * 新结构（三层固定定位，都在内容之下、画布之上）：
 *   ① .app-bg__image  清晰图，inset: 0，正好铺满视口（边缘是硬的，不会淡）
 *   ② .app-bg__blur   inset: -60px 的**浮层**，只负责 backdrop-filter: blur()；
 *                     它自己的淡边落在视口外 60px 处，所以视口内每一像素都被均匀模糊
 *   ③ .app-bg__dim    inset: -60px，压暗（surface × --app-bg-dim）
 * 视口内的边缘像素因此不再有任何淡化，也就不会露出画布颜色。
 *
 * 配套：背景图开启时 body 自身背景置为透明（否则 body 的背景会盖住这一层 ——
 * 负 z-index 子元素画在"块级背景"之前）。画布色仍由 html 的主题底色兜底。
 */
export default function BackgroundLayer() {
  return (
    <div className="app-bg" aria-hidden="true">
      <div className="app-bg__image" />
      <div className="app-bg__blur" />
      <div className="app-bg__dim" />
    </div>
  );
}
