# 开发指南（DEVELOPMENT）

本文面向**要改这个项目的人**：环境怎么搭、代码怎么组织、规范是什么、
i18n 和「新增一个接口 / 一个页面」具体怎么做。

- 只想把项目跑起来 → 看 [`../README.md`](../README.md) §6
- 想了解整体架构 → 看 [`ARCHITECTURE.md`](ARCHITECTURE.md)
- 环境变量全清单 → 看 [`CONFIGURATION.md`](CONFIGURATION.md)
- 提交流程与检查清单 → 看 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)

---

## 1. 环境

| 依赖 | 版本 |
| --- | --- |
| Python | 3.10+（推荐 3.11 / 3.12） |
| Node.js | 18+（推荐 20 LTS） |
| SQLite | 不需要安装 |

```bash
# 后端
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS / Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # Windows: copy .env.example .env
# 往 .env 里填 NIMAO_SECRET_KEY（≥32 字符），否则起不来
python run.py                     # http://127.0.0.1:8000

# 前端（另开一个终端）
cd frontend
npm install
npm run dev                       # http://127.0.0.1:5173
```

几个必须记住的点：

1. **`python run.py` 必须在 `backend/` 目录下执行**（入口是 `app.main:socket_app`，
   依赖当前工作目录在 `sys.path` 上）。
2. **后端固定监听 `127.0.0.1:8000`**，不要改成 `0.0.0.0`（见 §6 代码红线）。
3. **前端开发模式的 API 指向靠端口判断**：页面端口是 `5173` 或 `5273` 时才直连
   `http://localhost:8000/api`，其它端口会走同源 `/api` 而 404。
4. **首次启动自动建表**：`app/main.py` 导入时就调用 `init_db()`，
   在 `backend/` 下创建 `nimao.db` 并 `create_all`。不需要跑任何 SQL。
5. **不需要重启的场景**：`create_all` 只建**不存在**的表，
   所以**给已有表加字段不会生效**，要自己写迁移（见 [`DATABASE.md`](DATABASE.md)）。

### 1.1 想看接口文档

`/docs`、`/redoc`、`/openapi.json` 默认**关闭**（避免线上暴露路由面）。
本地调试在 `backend/.env` 里设：

```ini
NIMAO_DOCS=1
```

### 1.2 建议的调试手段

```bash
# 公开接口不需要登录，最适合验证后端是否正常
curl "http://127.0.0.1:8000/api/public/works?limit=1"

# 登录拿令牌
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"demo","password":"..."}'

# 带令牌
curl http://127.0.0.1:8000/api/auth/me -H "Authorization: Bearer $TOKEN"
```

## 2. 后端代码组织

```
backend/app/
  main.py          应用装配：init_db → FastAPI → 中间件 → include_router → 静态挂载 → Socket.IO
  config.py        全部配置项（唯一来源），启动期校验 SECRET_KEY
  database.py      engine / SessionLocal / Base / init_db()
  models.py        50 个 ORM 模型
  schemas.py       Pydantic 出入参
  serializers.py   模型 → JSON；notify_user / log_admin_action / queue_sensitive_review 等公共写入
  deps.py          get_db / get_current_user / get_active_user / get_current_admin / get_optional_user
  security.py      bcrypt + JWT
  routers/         HTTP 层（~50 个模块，373 个端点）
  <领域模块>.py     committee / chat_core / studio_core / sensitive / mailer / iplocate / switches / ...
```

**分层约定**：

- `routers/` 只做 HTTP 适配：解析入参 → 调领域模块 → 返回响应。
  复杂逻辑下沉到领域模块，能被多个路由复用的逻辑**必须**下沉。
- 跨模块的公共写入集中在 `serializers.py`（通知、审计、送审），不要到处手写模型行。
- 领域模块**直接用 SQLAlchemy 会话**，本项目没有 Repository 层（规模上不值得）。
- 所有路由统一挂在 `/api` 前缀下；模块内只写相对路径。

**不要**把真实域名、服务器 IP、密钥写进代码。需要对外地址时加到 `config.py`
并给一个 `example.com` 占位符作为默认值。

## 3. 前端代码组织

```
frontend/src/
  api/base.js         ★ 后端地址的唯一来源（client.js 与 socket.js 共用）
  api/client.js       axios 实例、Bearer 注入、401 拦截
  api/socket.js       Socket.IO 客户端
  pages/              67 个页面组件（一个文件 ≈ 一个路由）；后台在 pages/admin/
  components/         可复用组件
  context/            AuthContext、ThemeModeContext
  chat/               聊天状态与通知偏好
  i18n/               index.jsx（收集与 t()）+ dict/*.js（词条）+ server.js（后端提示翻译）
  pickcat/            头像工具面板
  styles/global.css   主题变量与全局样式
  ui/                 Material Web 组件封装（统一从这里 import）
```

```
frontend-se/src/
  app.js        入口与路由挂载
  router.js     基于 hash 的极简路由
  api.js        XMLHttpRequest 取数层 + SITE_ORIGIN 常量
  dom.js        h() 建节点
  md.js         极简 Markdown
  prefs.js      本地偏好
  se.css        样式（只用 CSS2.1）
  views/        10 个视图
```

## 4. 代码规范

### 4.1 通用

- 注释与提交信息用**中文**，标识符用英文，与现有代码保持一致。
- 新增文件顶部写模块级 docstring。
- **不要为了风格大范围重排已有代码**；改动控制在解决问题所需的最小范围。
- **保留既有注释里的「为什么」**。本项目的历史注释记录了大量踩坑原因
  （例如 `deps._LOCKED_ALLOW` 的死锁、`api/base.js` 的线上事故、
  `frontend-se/vite.config.js` 的 IE11 陷阱），删掉注释等于丢掉知识。

### 4.2 Python

- PEP 8；4 空格缩进；行宽约 120。
- 数据库会话一律 `Depends(get_db)`，不要手工 `SessionLocal()`。
- **权限依赖选对**（这是最容易出错的地方）：

  | 场景 | 用哪个 |
  | --- | --- |
  | 只读接口 | `Depends(get_current_user)` |
  | 任何写接口 | `Depends(get_active_user)` ← 它统一处理「封禁」和「账号未激活」 |
  | `/api/admin/*` | `Depends(get_current_admin)` |
  | 需要「登录则个性化、未登录也能看」 | `Depends(get_optional_user)` |

- 抛错用 `HTTPException`，`detail` 写**给用户看的中文**。
- 管理端的写操作要让审计中间件命中：**路径以 `/api/admin/` 开头即可自动记录**，
  另外用 `serializers.log_admin_action(...)` 记录业务级动作。
- 给用户发通知用 `serializers.notify_user(...)`，不要手写 `Notification`。
- 新增第三方依赖要说明理由，并同步更新 `requirements.txt`（只列**直接 import** 的包）。

### 4.3 JavaScript / JSX

- 主站：函数组件 + Hooks；组件 `PascalCase`，其它 `camelCase`。
- 需要 UI 组件时从 `src/ui` 引入（Material Web 的封装），不要直接引 `@material/web`。
- **不要新增 `innerHTML` / `dangerouslySetInnerHTML`**（见 §6 红线）。
- 颜色和圆角用 CSS 变量 `--md-sys-color-*` / `--md-sys-shape-*`，
  不要硬编码，否则深浅色主题和主题色切换会坏。
- **SE 版必须保持 ES5**：不用箭头函数、`let`/`const`、模板字符串、`Promise`、`fetch`、`class`。
  构建用 Vite 的 lib 模式 → IIFE，`target: es5`，Terser `ecma: 5`。

## 5. 常用开发任务

### 5.1 新增一个接口

1. 找到对应路由文件（作品 → `routers/works.py`）。全新领域就新建 `routers/xxx.py`：

   ```python
   from fastapi import APIRouter, Depends
   from sqlalchemy.orm import Session
   from .. import models
   from ..deps import get_db, get_current_user

   router = APIRouter(prefix="/xxx", tags=["xxx"])

   @router.get("/hello")
   def hello(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
       """一句话说明（会进 docs/API.md）。"""
       return {"msg": "hi"}
   ```

2. 在 `main.py` 里注册（**必须带 `prefix="/api"`**）：

   ```python
   from .routers import xxx
   app.include_router(xxx.router, prefix="/api")
   ```

   实际路径就是 `/api/xxx/hello`。

3. 用 `schemas.py` 里的模型或 `response_model` 约束出入参。
4. 涉及内容发布时别忘了敏感词检查（见 §5.4）。
5. 重启后端；想验证就开 `NIMAO_DOCS=1` 看 `/docs`。
6. **更新 [`API.md`](API.md)**。

### 5.2 新增一个页面（主站）

1. 在 `frontend/src/pages/` 新建组件。
2. 在 `frontend/src/App.jsx` 的路由表里注册路径。
3. 需要页面标题 → 在 `src/i18n/dict/titles.js` 加词条。
4. 需要导航入口 → 改 `src/components/TopBar.jsx` 或 `Footer.jsx`。
5. 需要新接口 → 按 §5.1 加后端。
6. 用 `client`（`src/api/client.js`）发请求，不要自己 new axios。

   ```js
   import client from '../api/client';
   const res = await client.get('/kh/home');
   ```

### 5.3 i18n：怎么加词条

词条按业务分文件放在 `frontend/src/i18n/dict/*.js`，
每个文件**同时导出 `zh` 与 `en`**，由 `index.jsx` 用 `import.meta.glob` 自动收集 ——
**新增词条文件不需要改任何注册表**。

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

```jsx
import { useI18n } from '../i18n';

function Demo() {
  const { t, lang, setLang, isEn } = useI18n();
  return <p>{t('example.hello', { name: 'Kitter' })}</p>;
}
```

规则：

1. **中英必须成对**，key 完全一致，不能只加一边。
2. key 命名 `模块.小驼峰`，与文件名对应（`auth.welcomeBack` 对应 `dict/auth.js`）。
3. 占位符写 `{name}`，调用时用第二个参数传值。
4. 回退顺序：**当前语言 → 中文 → key 本身**。
   页面直接显示一个 key，说明漏翻了，不是 bug。
5. 后端的中文错误提示由 `src/i18n/server.js` 用正则翻译成英文
   （设计原因：后端有 200 多处 `raise`，改造成错误码的改动面太大）。
   新增常见错误时在那里补一条规则。
6. 语言选择的存储键是 `localStorage['nimao_lang']`。

**成对性自检**（等价于原先私有仓库里的 `check_i18n_parity.mjs`，本仓库未包含该脚本）：

```bash
cd frontend
node -e "
const fs=require('fs'),d='src/i18n/dict';let bad=0;
for(const f of fs.readdirSync(d)){
  const s=fs.readFileSync(d+'/'+f,'utf8'), i=s.indexOf('export const en');
  const g=t=>[...t.matchAll(/^\s*'([^']+)':/gm)].map(m=>m[1]);
  const zh=new Set(g(s.slice(0,i))), en=new Set(g(s.slice(i)));
  for(const k of zh) if(!en.has(k)){console.log(f,'英文缺:',k);bad++;}
  for(const k of en) if(!zh.has(k)){console.log(f,'中文缺:',k);bad++;}
}
console.log(bad? '不一致 '+bad+' 处' : '全部成对'); process.exit(bad?1:0)"
```

### 5.4 新增一类需要审核的内容

参照作品 / 帖子 / 评论的现有做法：

1. 写入前调用 `sensitive.hits(文本, user, db)`（豁免用户会自动返回空）。
2. 命中时把内容状态设为**不可见**（作品/帖子的 `status` 用 `"pending"`，
   评论用 `"pending"` 而正常是 `"active"`）。
3. 命中时调用 `serializers.queue_sensitive_review(db, target_type, target_id, hits, user_id, title)`
   写入 `content_reviews`（`source="sensitive"`）。
4. 列表 / 搜索 / 聚合接口只输出已发布内容。
5. 若要把该类型纳入风纪委员会审议，需要**同时**把它加进：
   - `committee.TARGET_TYPES`
   - `committee._hidden` / `_hide` / 恢复逻辑
   - 前端的审议库展示

   详见 [`MODERATION.md`](MODERATION.md)。

### 5.5 新增一个运行期开关

`app/switches.py` 里的 `SWITCHES` 字典就是唯一注册表：

```python
SWITCHES = {
    "chat": (config.CHAT_ENABLED, "聊天功能", "说明文案"),
    # 新增一项：key -> (来自环境变量的默认值, 后台显示名, 说明)
}
```

- 默认值来自 `config` 的**环境变量**，所以没在后台动过时行为不变。
- 读开关用 `switches.enabled("key")`（带 10 秒进程内缓存；
  未知 key 一律返回 `False`，避免拼错时静默放行）。
- 后台写入用 `switches.set_value(db, key, value)`，会立刻失效缓存，下一个请求即生效。
- 后台界面会自动列出所有开关，通常不用改前端。

### 5.6 改数据模型

本项目**不使用 Alembic**：

- 全新数据库：`init_db()` → `create_all` 会自动建好（**含新表**）。
- 已有数据库：`create_all` **不会**改动已存在的表，加字段需要自己写迁移脚本。

写法建议（幂等，可重复执行）：

```python
# backend/migrate_add_xxx.py
import sqlite3, os
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nimao.db")
con = sqlite3.connect(DB)
cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
if "xxx" not in cols:
    con.execute("ALTER TABLE users ADD COLUMN xxx INTEGER DEFAULT 0")
    con.commit()
    print("added users.xxx")
con.close()
```

改完记得同步更新 [`DATABASE.md`](DATABASE.md)。

## 6. 代码红线

以下几条来自实际事故，请务必遵守：

1. **禁止新增 `innerHTML` / `dangerouslySetInnerHTML`**（防 XSS）。
   需要渲染富文本时用项目已有的 Markdown 组件。
2. **禁止把后端监听地址改回 `0.0.0.0`**。
   后端只在回环地址上监听，公网流量必须经 nginx ——
   否则 `X-Forwarded-For` 可被伪造，IP 归属、限流、审计全部失真。
3. **用户可控的 URL 一律校验**，不要把任意外部页面当可信 iframe
   （URL 型作品需管理员审核上架）。参考 `imageurl.py` 对图床域名的处理。
4. **新增写接口必须走鉴权**（`get_active_user` 或 `get_current_admin`）。
5. **`/api/admin/` 前缀不要乱改**：审计中间件依赖它自动记录管理端写操作。
6. **不要绕过 `serializers.py` 直接写通知/审计**，否则会漏字段或漏记。
7. **`backend/private/` 绝不能被 nginx 挂载**（护照等证件图）。

## 7. 调试与排错

| 现象 | 排查方向 |
| --- | --- |
| 后端起不来，`RuntimeError: NIMAO_SECRET_KEY ...` | 没配 `.env` 或密钥太短（§1） |
| `ModuleNotFoundError: No module named 'app'` | 不在 `backend/` 目录下执行的 |
| 前端有响应但数据为空 | 后端没起；或页面端口不是 5173/5273 |
| 浏览器 CORS 报错 | 后端 `config.CORS_ORIGINS` 只默认放行 `localhost:5173` / `127.0.0.1:5173` |
| 上传 413 | nginx `client_max_body_size` 小于应用上限（两层都要改） |
| 邮件接口报「邮件服务还没配置好」 | 正常：SMTP 与 Resend 都没配 |
| IP 属地为空 | 缺 `backend/data/ip2region_v4.xdb`（约 11MB，需自行下载），功能会降级 |
| 敏感词不生效 | 词库在数据库里而代码内置词表是空的，去后台「敏感词管理」加词 |
| 改了 `models.py` 但报「no such column」 | `create_all` 不改已有表，需要自己写迁移（§5.6） |
| SE 版页面一直停在「正在载入」 | 构建产物不是 IIFE，或被浏览器当 module 处理了（见 `frontend-se/vite.config.js` 注释） |

后端日志：

```bash
# 用 systemd 部署时
journalctl -u kitterhub-backend -f
# 本地直接 run.py 时看终端输出
```

## 8. 提交前自检

```bash
# 1) 后端能起来
cd backend && python run.py

# 2) 前端构建
cd frontend && npm run build

# 3) SE 版构建（改了才需要）
cd frontend-se && npm run build
#    确认产物是普通脚本、不是 module：
grep -c 'type="module"' dist/index.html     # 期望 0
grep -cE '=>|const |Symbol' dist/app.js      # 期望 0

# 4) i18n 成对（§5.3）

# 5) 没有把敏感文件带进提交
git status --short
git ls-files | grep -Ei "\.env$|\.db$|\.pem$|\.key$|token|cred|secret"
```

第 5 条最重要：**推上去就撤不回来了**。完整清单见 [`SECURITY.md`](SECURITY.md)。
