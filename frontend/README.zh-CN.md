> English version: [README.md](README.zh-CN.md) · 本文件为中文版

# frontend/ —— 主站前端

KitterHub 的完整功能前端：React 18 + Vite，中英双语、深浅色主题、响应式布局。

后端接口见 [`../backend/`](../backend/README.zh-CN.md)；
面向 IE11 的只读精简版见 [`../frontend-se/`](../frontend-se/README.zh-CN.md)。

## 职责

社区站点的**全部交互功能**：首页与发现流、作品投稿与试玩、论坛帖子与评论、
工作室、私信与群聊、通知、经验等级中心、个人主页与设置、
实名认证流程、以及完整的**后台管理界面**（`/admin`）。

它是**单页应用（SPA）**，路由用 `react-router-dom` 的 history 模式，
因此部署时 nginx 必须把未知路径回退到 `index.html`。

## 环境要求

- **Node.js 18+**（推荐 20 LTS），随附 npm

## 依赖

见 [`package.json`](package.json)。

**运行时依赖**

| 包 | 用途 |
| --- | --- |
| `react` / `react-dom` ^18.3.1 | UI 框架 |
| `react-router-dom` ^6.28.0 | 前端路由（history 模式） |
| `axios` ^1.7.9 | HTTP 客户端 |
| `socket.io-client` ^4.8.1 | 实时通信（私信 / 通知） |
| `@material/web` ^2.2.0 | Material Web Components（界面组件） |
| `@lit/react` ^1.0.6 | 把 Lit 组件包成 React 组件（配合 `@material/web`） |
| `lucide-react` ^0.469.0 | 图标库 |
| `fflate` ^0.8.3 | 压缩/解压（客户端处理） |
| `qrcode-generator` ^2.0.4 | 二维码生成（分享等） |

**开发依赖**

| 包 | 用途 |
| --- | --- |
| `vite` ^5.4.11 | 构建工具与开发服务器 |
| `@vitejs/plugin-react` ^4.3.4 | React 插件 |
| `jsqr` ^1.4.0 | 二维码识别（扫码登录） |
| `puppeteer-core` ^25.12.0 | 无头浏览器脚本（辅助工具） |

> 本项目**不使用重型 UI 框架**（如 MUI/AntD），界面组件直接用
> `@material/web` 的 Web Components，图标用 `lucide-react`。
> 国际化也是**自研的轻量实现**，不引 i18n 库。

## 开发

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173（vite.config.js 里写死 port: 5173 且 host: true）
```

### 后端地址是怎么定的（重要）

**不需要**在 `vite.config.js` 里配代理。地址的唯一决策点在
[`src/api/base.js`](src/api/base.js)：

```js
const DEV_API = 'http://localhost:8000/api';
export const API_BASE = import.meta.env.VITE_API_URL || (isViteDev() ? DEV_API : '/api');
```

优先级：

1. **`VITE_API_URL`**（构建时注入，最高优先）；
2. **开发模式**（页面端口是 `5173` 或 `5273`）→ 直连本机 `http://localhost:8000/api`；
3. **其它情况（含生产）** → **同源相对路径 `/api`**。

> 设计说明：生产默认同源 `/api` 是**刻意的**。源码注释记录了一次真实事故——
> 默认值曾经写死 `http://localhost:8000/api`，由于「本地 build + scp 上传 dist」
> 的流程里没有设置 `VITE_API_URL`，打出的包把 `localhost:8000` 写进了产物，
> 一上线**所有用户的浏览器都去连自己电脑的 8000 端口**，整站接口全部 Network Error。
>
> 所以：**不要在代码里写死后端主机名**。
> Socket.IO 地址由同一常量推导（去掉 `/api` 后缀，见 `base.js` 的 `SOCKET_URL`）。

## 构建

```bash
npm run build      # → frontend/dist/
npm run preview    # 本地预览构建产物
```

`vite.config.js` **没有指定 `build.outDir`**，因此用 Vite 默认的 `dist/`。

部署时把 `dist/` 内容作为 nginx 站点根目录；因为用的是 history 路由，
需要配置 `try_files $uri $uri/ /index.html;`
（[`../deploy/nginx.conf.example`](../deploy/nginx.conf.example) 已包含）。

### 构建时可注入的前端变量

前端变量用 **`VITE_` 前缀**，只在**构建时**注入，运行期无法更改：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `VITE_API_URL` | 空 → 同源 `/api` | 覆盖后端基址 |
| `VITE_SUPPORT_EMAIL` | `support@example.com` | 页脚展示的支持邮箱 |
| `VITE_PAGES_DOMAIN` | `pages.example.com` | Pages 托管域名展示 |

（另见 [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.zh-CN.md) 的前端变量小节。）

## 代码结构

```
frontend/
├── src/
│   ├── main.jsx           应用入口
│   ├── App.jsx            路由表与全局布局（★ 新增页面在这里加 <Route>）
│   ├── api/               axios 客户端、Socket.IO 客户端、后端地址唯一来源（base.js）
│   ├── pages/             60 个页面组件（含 admin/ 后台，7 个文件）
│   ├── components/        67 个可复用组件（顶栏、页脚、卡片、评论、聊天、Markdown、裁剪器等）
│   ├── context/           React Context（Auth、主题模式等）
│   ├── chat/              聊天状态与通知偏好
│   ├── i18n/              自研国际化：index.jsx + dict/（28 个词条文件）+ server.js
│   ├── pickcat/           pickCat 头像工具面板与同步
│   ├── styles/            全局 CSS 与主题变量
│   └── ui/                Material Web 组件封装
├── public/                静态资源（图标、帮助页、社区规则 md、引导文档、地理数据）
├── index.html             页面模板
├── vite.config.js         开发服务器 5173
├── package.json           依赖与脚本
└── package-lock.json      锁定的依赖树
```

## 路由

路由**集中声明**在 [`src/App.jsx`](src/App.jsx) 的 `<Routes>` 里，用
`BrowserRouter` + `react-router-dom`。新增页面只需加一行：

```jsx
<Route path="/my-page" element={<MyPage />} />
```

常用的包装组件（决定"谁能进这个页面"）：

| 包装 | 含义 |
| --- | --- |
| `<ProtectedRoute>` | 需要登录 |
| `<CreationGate>` | 需要登录且需要有发布内容的权限 |
| `<ConfirmProvider>` | 提供 `confirm()` 弹窗能力（后台页面常用） |

`<Route path="*">` 兜底到 404 页面。

## 国际化（i18n）

自研实现，**不引第三方 i18n 库**，入口是
[`src/i18n/index.jsx`](src/i18n/index.jsx)：

- 词条按模块分文件放在 [`src/i18n/dict/`](src/i18n/dict/)（共 28 个文件），
  每个文件导出 `{ zh: {...}, en: {...} }`；
- 用 `import.meta.glob('./dict/*.js', { eager: true })` **自动收集**，
  所以**新增词条文件不需要改注册表**；
- 缺词条时的回退顺序：**当前语言 → 中文 → key 本身**
  （页面会直接显示 key，方便一眼看出漏翻）；
- 支持占位符：词条里写 `{name}`，`t('key', { name })` 传入；
- 语言选择存在 `localStorage` 的 `nimao_lang` 键。

用法：

```jsx
const { t } = useI18n();
t('common.save');              // 取词条
t('auth.welcomeBack', { name }); // 带占位符
```

> ⚠️ **当前只支持 `zh` 与 `en` 两种**，而且是硬编码的：
> `LANGS` 数组与 `setLang()` / `readInitialLang()` 里的校验都显式只认这两个值。
> **新增语言需要改代码**，步骤见 [`../docs/FAQ.md`](../docs/FAQ.zh-CN.md) 的 Q6。

另外 [`src/i18n/server.js`](src/i18n/server.js) 负责把**后端返回的中文错误提示**
用正则翻译成英文——后端只回中文 `detail`，文案不在后端硬编码英文。

## 样式

`src/styles/` 放全局 CSS 与主题变量（CSS 自定义属性，驱动深浅色主题切换）。
组件样式以局部 `<style>` / 内联样式配合全局变量为主。

## 与其它部分的关系

- **对后端**：一切数据都来自 `API_BASE`（默认同源 `/api`），
  实时消息走 `SOCKET_URL`（同源 `/socket.io`）。
- **对 `frontend-se/`**：两者是**互相独立**的实现，**不共享源码**，
  只共用同一套后端接口。SE 版是无框架的 ES5 只读版本，面向 IE11。
- **对 `deploy/`**：构建产物 `dist/` 交给 nginx 托管，
  由 nginx 把 `/api` 与 `/socket.io` 反代到后端。

## 相关文档

- [`../README.md`](../README.zh-CN.md) —— 项目总览与本地启动
- [`../docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.zh-CN.md) —— 代码规范、新增页面/接口流程
- [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.zh-CN.md) —— 前端与后端环境变量
- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.zh-CN.md) —— 前端如何与后端衔接
- [`../deploy/README.md`](../deploy/README.zh-CN.md) —— 构建产物的部署方式
