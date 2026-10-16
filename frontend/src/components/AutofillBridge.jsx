/**
 * 自动填充桥：在 light DOM 里放一对"离屏但仍算可见"的原生 input。
 *
 * 为什么要它：MD3 的真实 <input> 在 shadow DOM 里，Chrome 的表单解析对它并不可靠
 * （Chromium issue 41334315），所以浏览器可能既不填充、也不弹"保存密码"。
 * 在 light DOM 放原生 input 是唯一稳妥的做法。
 *
 * ⚠️ 不能用 display:none / visibility:hidden / 尺寸为 0：Chromium 会**跳过不可见的口令字段**
 *    （CL 1408423003）。这里用"移出视口 + 非零尺寸 + 极低透明度"满足可见性判定。
 *
 * 用法：和表单的 state 双向绑定即可 —— 浏览器填进这里的值会通过 onChange 回流到 state，
 * 于是可见的 MD3 输入框跟着显示出来。
 */
const HIDDEN = {
  position: 'absolute',
  left: '-9999px',
  top: 0,
  width: 160,
  height: 24,
  opacity: 0.01,
  padding: 0,
  margin: 0,
  border: 0,
  pointerEvents: 'none',
};

export default function AutofillBridge({
  prefix,
  username,
  password,
  onUsername,
  onPassword,
  usernameAuto = 'username',
  passwordAuto = 'current-password',
}) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'visible' }}>
      <input
        type="text"
        name={`${prefix}-username`}
        autoComplete={usernameAuto}
        value={username || ''}
        onChange={(e) => onUsername && onUsername(e.target.value)}
        tabIndex={-1}
        style={HIDDEN}
      />
      <input
        type="password"
        name={`${prefix}-password`}
        autoComplete={passwordAuto}
        value={password || ''}
        onChange={(e) => onPassword && onPassword(e.target.value)}
        tabIndex={-1}
        style={HIDDEN}
      />
    </div>
  );
}
