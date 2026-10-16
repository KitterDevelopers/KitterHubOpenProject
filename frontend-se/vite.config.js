import { defineConfig } from 'vite';

/* SE 版构建配置（IE11 可用的关键在这里）
   ⚠️ 血泪教训：默认的 app 构建产出 `<script type="module">`，**IE11 不执行 module 脚本**
   —— 页面会永远停在"正在载入"。所以这里改用 lib 模式输出 **IIFE 普通脚本**，
     文件名不带 hash 且不用 type=module，HTML 由我们自己在 public/index.html 里写。
   源码本身就是纯 ES5，不需要 polyfill、不需要 nomodule 双包。 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es5',
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'terser',   /* 用 Terser 而不是 esbuild：esbuild 会为了 es2015 把字符串拼接改写成模板字符串（IE11 语法错误） */
    terserOptions: { ecma: 5, compress: { ecma: 5 }, format: { ecma: 5 }, mangle: true },
    reportCompressedSize: false,
    modulePreload: false,
    /* ⚠️ 关键：Rollup 默认会注入 `Object.defineProperty(exports, Symbol.toStringTag, ...)`
       给入口模块打 ESM 标记 —— 而 **IE11 没有 Symbol**，那行会在加载时抛 ReferenceError，
       整个脚本不执行（页面永远停在"正在载入"）。下面这些开关全部关掉，
       强制 Rollup 只生成 IE 能跑的产物。 */
    rollupOptions: {
      output: {
        generatedCode: {
          symbols: false,
          constBindings: false,
          arrowFunctions: false,
          objectShorthand: false,
          reservedNamesAsProps: false,
        },
      },
    },
    lib: {
      entry: 'src/app.js',
      name: 'KitterHubSE',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'style',
    },
  },
});
