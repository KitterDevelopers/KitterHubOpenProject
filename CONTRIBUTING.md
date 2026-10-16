# 贡献指南（CONTRIBUTING）

感谢你愿意为 KitterHub 出一份力。本文档说明**怎么搭环境、代码怎么组织、提交前要过哪些检查**。
在动手之前，请先读 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)——本项目面向青少年用户，
对隐私与行为的要求比一般开源项目更严格。

---

## 1. 先决条件

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Python | **3.10+**（推荐 3.11 / 3.12） | 后端。代码使用了 `str \| None` 与 `dict[str, Any]` 写法，需要 3.10 及以上 |
| Node.js | **18+**（推荐 20 LTS） | 前端构建 |
| npm | 随 Node 附带 | 仓库里同时提供了 `package-lock.json`，也可用 `npm ci` |
| Git | 任意较新版本 | —— |

数据库用 SQLite，**不需要额外安装**。

## 2. 本地启动

```bash
git clone <你的仓库地址> KitterHub
cd KitterHub
```

后端（新开一个终端）：

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

# 必填：生成一个密钥（长度 ≥ 32）
cp .env.example .env
python -c "import secrets;print('NIMAO_SECRET_KEY=' + secrets.token_urlsafe(48))"
# 把输出写进 .env

python run.py          # http://127.0.0.1:8000
```

前端（再开一个终端）：

```bash
cd frontend
npm install
npm run dev            # http://127.0.0.1:5173
```

前端开发服务器会把 `/api` 请求转发到 `http://localhost:8000/api`
（见 `src/api/base.js` 中的 `isViteDev()`：当页面端口是 `5173` 或 `5273` 时直连本机后端）。

> 只跑 `npm run dev` 而不启动后端时，页面能打开但所有数据请求都会失败。
> 想只看界面，可以启动 **SE 版**（`frontend-se`），它同样依赖后端。

## 3. 仓库结构与职责

```
backend/app/            后端全部业务代码
  main.py               FastAPI 应用入口，挂载 Socket.IO、注册所有路由、建表
  config.py             全部配置项（读环境变量），改配置先看这里
  models.py             SQLAlchemy 数据模型
  schemas.py            Pydantic 请求/响应模型
  serializers.py        模型 → JSON 的序列化，以及通知/审计等公共写入
  deps.py               依赖注入：get_db / get_current_user / get_active_user / get_current_admin
  security.py           bcrypt 密码哈希 + JWT 签发校验
  routers/              按业务模块拆分的路由（约 50 个文件）
frontend/src/           React 主站
  api/                  axios 客户端与 Socket.IO 客户端
  pages/                页面级组件（一个文件 ≈ 一个路由）
  components/           可复用组件
  i18n/                 轻量国际化（见 §6）
  styles/               全局 CSS
frontend-se/src/        SE 精简版（无框架、纯 ES5、面向 IE11）
docs/                   项目文档
deploy/                 nginx / systemd 示例配置（全部使用 example.com 占位符）
```

细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 4. 代码规范

### 4.1 通用

- **注释与提交信息用中文**（与现有代码保持一致）；变量名、函数名用英文。
- 新增文件顶部写一句模块级 docstring，说明「这个文件负责什么」。
- **不要为了风格而大范围重排已有代码**，把改动控制在解决问题所需的最小范围。
- 保留现有注释中的「为什么」——本项目的历史注释记录了不少踩坑原因，删掉它们等于丢掉知识。

### 4.2 Python（后端）

- 遵循 PEP 8，4 空格缩进，行宽约 120。
- 类型标注尽量写；只用标准库与 `requirements.txt` 里的依赖，
  **新增第三方依赖必须在 PR 里说明理由并同步更新 `requirements.txt`**。
- 数据库会话一律通过 `Depends(get_db)` 获取，不要在路由里手工 `SessionLocal()`。
- 权限判断不要自己写：读接口用 `Depends(get_current_user)`，
  写接口用 `Depends(get_active_user)`，管理端用 `Depends(get_current_admin)`。
  `get_active_user` 已统一处理封禁与「账号未激活」的拦截。
- 抛错用 `HTTPException`，`detail` 写**给用户看的中文**。
- 所有涉及真实用户数据的操作要写审计：
  用 `serializers.log_admin_action(...)`（管理端）或 `audit` 模块。

### 4.3 JavaScript / JSX（前端）

- 主站：函数组件 + Hooks，函数名用 `PascalCase`（组件）/ `camelCase`（其他）。
- 组件目录下用 `index.jsx` 做入口是既有约定，新页面放在 `src/pages/`。
- **SE 版必须保持 ES5**：不用箭头函数、`let/const`、模板字符串、`Promise`、`fetch`、
  `class`；统一用 `h()` 构造函数建节点（见 `frontend-se/src/dom.js`）。
  改完 SE 版**务必真的跑一次构建**，并在 IE11 目标下确认产物里没有
  `=>`、`const `、`Symbol`、`type="module"`（原因见 `frontend-se/vite.config.js` 的注释）。
- 样式优先用现有 CSS 变量（`--md-sys-color-*`），不要硬编码颜色，否则深浅色主题会坏掉。

## 5. 添加一个新接口

1. 找到对应的路由文件（例如作品相关改 `backend/app/routers/works.py`）。
   确实是全新领域时，新建 `routers/xxx.py`，并在 `backend/app/main.py` 里注册：
   ```python
   from .routers import xxx
   app.include_router(xxx.router, prefix="/api")
   ```
   > 所有路由统一挂在 `/api` 下，定义时只写模块内的相对路径
   > （例如 `@router.get("/{work_id}")` + `prefix="/works"` → 实际路径 `/api/works/{work_id}`）。
2. 用 `response_model` 或 `schemas.py` 里的模型约束出入参。
3. 选对权限依赖（见 §4.2）。
4. 需要通知用户时用 `serializers.notify_user(...)`，别手写 `Notification` 行。
5. 补文档：更新 [`docs/API.md`](docs/API.md)。
6. 改动数据模型时，见 [`docs/DATABASE.md`](docs/DATABASE.md)：
   本项目**不使用 Alembic**，新库靠 `Base.metadata.create_all` 建表，
   已有库需要自己写 `migrate_*.py` 脚本。

## 6. 添加 i18n 词条

词条按业务分文件放在 `frontend/src/i18n/dict/*.js`，
每个文件同时导出 `zh` 与 `en` 两个对象，并由 `frontend/src/i18n/index.jsx`
通过 `import.meta.glob` 自动收集——**新增词条文件不需要改注册表**。

```js
// frontend/src/i18n/dict/example.js
export const zh = {
  'example.hello': '你好，{name}',
};
export const en = {
  'example.hello': 'Hello, {name}',
};
export default { zh, en };
```

组件里这样用：

```jsx
import { useI18n } from '../i18n';

function Demo() {
  const { t, isEn } = useI18n();
  return <p>{t('example.hello', { name: 'Kitter' })}</p>;
}
```

规则：

1. **中英必须成对**，key 完全一致，不能只加一边。
2. key 用 `模块.小驼峰` 命名（`auth.welcomeBack`），与文件名对应。
3. 占位符写 `{name}`，调用时用第二个参数传入。
4. 缺词条时的回退顺序是「当前语言 → 中文 → key 本身」，
   所以你会直接在页面上看到一个 key——那是漏翻的信号，不是 bug。
5. 后端返回的中文错误提示由 `frontend/src/i18n/server.js` 用正则翻译，
   新增常见错误时在那里补一条规则。

**成对性自检**（仓库不再附带原来的 `check_i18n_parity.mjs`，用下面这条等价命令）：

```bash
cd frontend
node -e "const fs=require('fs');const d='src/i18n/dict';let bad=0;for(const f of fs.readdirSync(d)){const s=fs.readFileSync(d+'/'+f,'utf8');const keys=l=>[...s.matchAll(new RegExp('^\\\\s*\\'([^\\']+)\\':','gm'))];const zh=new Set(keys(s).map(m=>m[1]));const i=s.indexOf('export const en');const en=new Set([...s.slice(i).matchAll(/^\\s*'([^']+)':/gm)].map(m=>m[1]));for(const k of zh)if(!en.has(k)){console.log(f,'缺少英文:',k);bad++}for(const k of en)if(!zh.has(k)){console.log(f,'缺少中文:',k);bad++}}console.log(bad?'不一致 '+bad+' 处':'全部成对');process.exit(bad?1:0)"
```

## 7. 添加一个页面（主站）

1. 在 `frontend/src/pages/` 新建组件。
2. 在 `frontend/src/App.jsx` 的路由表里注册路径。
3. 需要标题的，在 `src/i18n/dict/titles.js` 加词条。
4. 需要导航入口的，改 `src/components/TopBar.jsx` / `Footer.jsx`。
5. 需要新接口的，按 §5 加后端接口。

## 8. 提交前检查清单

- [ ] 后端能起来：`cd backend && python run.py`，`GET http://127.0.0.1:8000/api/public/...` 有正常返回。
- [ ] 前端能构建：`cd frontend && npm run build`（无报错）。
- [ ] SE 版能构建：`cd frontend-se && npm run build`（**并且**确认产物是 IIFE、无 `type="module"`）。
- [ ] i18n 中英成对（§6 的自检命令返回 0）。
- [ ] **没有把任何密钥/数据库/上传文件带进提交**：

  ```bash
  git status --short
  git diff --cached --name-only | findstr /I ".env .db .pem .key token"
  ```
  见 [`docs/SECURITY.md`](docs/SECURITY.md) 的「提交前自检」一节。
- [ ] 新增/变更的接口已同步到 `docs/API.md`。
- [ ] 涉及治理规则的改动已同步到 `docs/MODERATION.md` 与 `frontend/public/docs/`。

## 9. 提交信息与分支

提交信息采用简化的 Conventional Commits：

```
<type>(<scope>): <中文描述>
```

`type` 取值：`feat` / `fix` / `docs` / `refactor` / `perf` / `style` / `test` / `chore`。

示例：

```
feat(committee): 风纪委员「无违规」投票满 3 票自动恢复内容
fix(uploads): 修正护照图片超过 8MB 时返回 413 而非 500
docs(readme): 补充本地启动步骤
```

- 一个 PR 只做一件事；大改动请先开 issue 讨论。
- 分支名建议 `feat/xxx`、`fix/xxx`。
- PR 描述里写清：**改了什么 / 为什么 / 怎么验证**。

## 10. 不要提交这些

以下内容一旦推上远端就**无法撤回**，请务必确认 `.gitignore` 生效：

| 禁止提交 | 原因 |
| --- | --- |
| `.env`、`*.pem`、`*.key`、`id_*`、`*token*`、SSH 私钥 | 密钥泄露 |
| `*.db` / `*.sqlite*` / 数据库导出 | 含真实用户数据与密码哈希 |
| `backend/uploads/`、`backend/private/`、`backend/data/` | 真实用户上传内容、护照证件、IP 库 |
| `node_modules/`、`.venv/`、`dist/` | 体积大、可重建 |
| 服务器 IP、真实域名、内网地址 | 暴露基础设施 |
| 真实用户的用户名 / UID / 聊天记录截图 | 侵犯隐私 |

## 11. 许可证

在站长选定协议之前，本仓库没有授予任何开源许可（见 [`LICENSE-待定.md`](LICENSE-待定.md)）。
在协议确定后，你的贡献将按该协议授权。
