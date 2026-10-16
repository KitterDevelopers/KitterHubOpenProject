> English version: [README.md](README.zh-CN.md) · 本文件为中文版

# frontend-se/ —— SE 精简版前端

**SE = Simplified Edition（精简版）**：面向**老浏览器（含 IE11）**的
**只读**社区浏览版本。无框架、纯 ES5、零运行时依赖。

> 「只读」是指**界面功能**：SE 版只提供浏览（首页、论坛、作品、帖子、用户、
> 搜索、通知、设置等），不做投稿与编辑。
> 取数层 `src/api.js` 里确实带了一个 `post()` 写操作辅助函数
> （供登录、点赞一类的轻量动作预留），但**视图层没有提供发布内容的功能**。

主站完整功能版见 [`../frontend/README.md`](../frontend/README.zh-CN.md)。

## 它为什么存在

老浏览器（尤其是 IE11）跑不动主站的现代前端：
主站产物是 ESM + `type="module"`，而 **IE11 不执行 module 脚本**，
页面会永远停在「正在载入」。SE 版用一个极简的 ES5 实现解决这个问题，
让老设备（学校机房、旧平板等）至少能**浏览**社区内容。

## 环境要求

- **Node.js 18+**（推荐 20 LTS）

## 依赖

见 [`package.json`](package.json)。**没有任何运行时依赖**——只有构建期依赖：

| 包 | 用途 |
| --- | --- |
| `vite` ^5.4.10 | 构建工具 |
| `@vitejs/plugin-legacy` ^5.4.3 | 旧浏览器支持 |
| `terser` ^5.36.0 | 压缩（**必须用 Terser，不能用 esbuild**，原因见下） |

`browserslist` 明确配置为 `["ie 11"]`。

## 开发

```bash
cd frontend-se
npm install
npm run dev      # vite 默认端口 5173
```

> ⚠️ **端口冲突提示**：本项目的 `vite.config.js` **没有配置 `server.port`**，
> 因此 `npm run dev` 会使用 Vite 默认的 **5173 —— 与主站 `frontend/` 完全相同**。
> 两个前端同时开发时，请用 `npm run dev -- --port 5174` 显式指定另一个端口。

### 后端地址

[`src/api.js`](src/api.js) 里写死 `BASE = '/api'`（**同源相对路径**，不走 CORS）。
开发时同理需要由开发服务器或反向代理把 `/api` 指到后端。

### 登录态

与主站**共用同一个 `localStorage` 键 `nimao_token`**，
所以在任意一边登录，另一边都通用（`src/api.js` 的 `getToken` / `setToken`）。

### 回跳主站地址

```js
export var SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN || 'https://example.com';
```

构建期由 Vite 注入 `VITE_SITE_ORIGIN`（IE11 最终只看到字面量）。
**自建部署请改这个环境变量，不要改代码里的默认占位符。**

## 构建

```bash
npm run build      # → frontend-se/dist/
```

### ⚠️ 构建配置里有两个「IE11 血泪坑」

都写在 [`vite.config.js`](vite.config.js) 的注释里，改动该文件前务必先读：

1. **必须输出 IIFE 普通脚本，不能用默认的 app 构建。**
   默认 app 构建产出 `<script type="module">`，而 **IE11 不执行 module 脚本**，
   页面会永远停在「正在载入」。
   所以这里用 **lib 模式**（`formats: ['iife']`、`fileName: () => 'app.js'`），
   **文件名不带 hash、脚本不带 `type=module`**，
   HTML 由项目**自己手写**在 `public/index.html` 里。
2. **必须用 Terser，且必须关掉 Rollup 的几个代码生成开关。**
   - `minify: 'terser'`：esbuild 会为了 es2015 把字符串拼接改写成模板字符串，
     在 IE11 上是**语法错误**（`terserOptions` 里 `ecma: 5` 锁死）。
   - `rollupOptions.output.generatedCode` 里 `symbols: false` 等全部关闭：
     Rollup 默认会给入口模块注入
     `Object.defineProperty(exports, Symbol.toStringTag, ...)`，
     而 **IE11 没有 `Symbol`**，那行会在加载时抛 `ReferenceError`，
     整个脚本不执行（同样表现为永远「正在载入」）。

其余配置：`target: 'es5'`、`cssCodeSplit: false`、`sourcemap: false`、
`modulePreload: false`、`outDir: 'dist'`（默认 `emptyOutDir: true`，会把
`public/` 里的 `index.html`、`style.css`、图标一并复制进 `dist/`）。

> 因为源码本身就是纯 ES5，**不需要 polyfill，也不需要 nomodule 双包**。

### 手写的 index.html

[`public/index.html`](public/index.html) 是**手工维护**的：
顶部导航是静态 `<a href="#/...">`，末尾用普通脚本引入：

```html
<script src="/app.js"></script>
```

并且注释里说明了图标为什么带 `?v=2`（IE 的 favicon 缓存按 URL 记，
刷页面不会更新，只有 URL 变了才会重新拉）。

## 代码结构

```
frontend-se/
├── src/
│   ├── app.js          入口：路由与挂载
│   ├── router.js       基于 hash 的极简路由（IE11 友好，不需要 history 回退）
│   ├── api.js          XMLHttpRequest 取数层 + 主站地址常量（不用 fetch/Promise）
│   ├── dom.js          h() 建节点与工具函数
│   ├── img.js          图片处理
│   ├── md.js           极简 Markdown 渲染
│   ├── prefs.js        本地偏好
│   ├── se.css          SE 版样式（只用 CSS2.1）
│   └── views/          11 个视图（首页 / 论坛 / 作品 / 搜索 / 帖子 / 用户 / 通知 / 设置 / 互动 / 作品详情…）
├── public/             index.html（手写，不用 module 脚本）、style.css、图标
├── vite.config.js      lib 模式 → IIFE 的构建配置（IE11 关键）
├── package.json        依赖与脚本
└── package-lock.json   锁定的依赖树
```

### 技术约束一览

| 方面 | SE 版的做法 | 原因 |
| --- | --- | --- |
| 模块系统 | **无**（全局脚本） | IE11 不支持 ESM |
| 框架 | **无**（手写 DOM） | 体积与兼容性 |
| 路由 | **hash 路由**（`#/works`） | 不需要服务端 history 回退，老浏览器更稳 |
| 网络 | **`XMLHttpRequest` + 回调** | 不用 `fetch` / `Promise` |
| 样式 | **CSS2.1**（`se.css`） | 避开 IE11 对现代 CSS 的支持缺口 |
| 构建 | **lib → IIFE + Terser** | 见上文两个坑 |
| 功能 | **只读浏览** | 定位如此，交互留给主站 |

## 与其它部分的关系

- **与主站前端**：**互相独立、不共享源码**，只共用同一套后端接口与同一个登录令牌键。
- **与后端**：`BASE = '/api'`，同源相对路径；实测通过反代后响应的
  `Content-Type` 可能是 `text/html`，所以 `api.js` **先尝试 JSON 解析而不依赖该头**，
  解析失败才报错（避免视图拿到 `null` 崩溃）。
- **与 `deploy/`**：构建产物 `frontend-se/dist/`（`app.js` + `style.css` + 手写
  `index.html` + 图标）需要**单独一个 nginx `server` 块或子路径**来托管；
  [`../deploy/nginx.conf.example`](../deploy/nginx.conf.example) 里对此**未展开示例**。
  它同样需要把 `/api` 反代到后端。

## 相关文档

- [`../frontend/README.md`](../frontend/README.zh-CN.md) —— 主站前端
- [`../README.md`](../README.zh-CN.md) —— 项目总览
- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.zh-CN.md) —— 两个前端的对比与构建产物差异
- [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.zh-CN.md) —— `VITE_SITE_ORIGIN` 等前端变量
- [`../deploy/README.md`](../deploy/README.zh-CN.md) —— 部署方式
