# 常见问题（FAQ）

面向「刚 clone 下来想跑起来」和「想自己部署一套」的人。
每条答案都对应代码里的实现，涉及文件的地方给出了路径，方便自行核实。

> 更细的开发问题见 [`DEVELOPMENT.md`](DEVELOPMENT.md)，
> 治理规则见 [`MODERATION.md`](MODERATION.md)。

## 目录

- [Q1. 我需要准备什么环境？](#q1-我需要准备什么环境)
- [Q2. 怎么在本地把整套跑起来？](#q2-怎么在本地把整套跑起来)
- [Q3. 数据库在哪？怎么初始化 / 改表结构？](#q3-数据库在哪怎么初始化--改表结构)
- [Q4. 忘了 `NIMAO_SECRET_KEY`，后端起不来怎么办？](#q4-忘了-nimao_secret_key后端起不来怎么办)
- [Q5. 第一个管理员账号怎么来？](#q5-第一个管理员账号怎么来)
- [Q6. 怎么加一种语言？](#q6-怎么加一种语言)
- [Q7. 为什么会有个「SE 版」？它和主站什么关系？](#q7-为什么会有个se-版它和主站什么关系)
- [Q8. 怎么新增一个页面？](#q8-怎么新增一个页面)
- [Q9. 怎么新增一个接口？](#q9-怎么新增一个接口)
- [Q10. 图标和图片是从哪来的？](#q10-图标和图片是从哪来的)
- [Q11. 怎么部署到服务器？](#q11-怎么部署到服务器)
- [Q12. 能商用吗？许可证是什么？](#q12-能商用吗许可证是什么)
- [Q13. 风纪委员会为什么点进去用不了？](#q13-风纪委员会为什么点进去用不了)
- [Q14. 上传图片报 413 / 上传失败？](#q14-上传图片报-413--上传失败)
- [Q15. 「你的账号还未激活」是什么意思？](#q15-你的账号还未激活是什么意思)

---

## Q1. 我需要准备什么环境？

- **Python 3.10+**（推荐 3.11 / 3.12）
- **Node.js 18+**（推荐 20 LTS），随附 npm
- Git
- **不需要单独装数据库**：默认用 SQLite（`backend/nimao.db`）

## Q2. 怎么在本地把整套跑起来？

两个终端，一个后端一个前端。

**后端**（`backend/`）：

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

# ★ 必填：不配这个后端会拒绝启动（见 Q4）
# Windows PowerShell
$env:NIMAO_SECRET_KEY = "随便一段至少32字符的随机字符串"
# macOS / Linux
export NIMAO_SECRET_KEY="随便一段至少32字符的随机字符串"

python run.py
# → Uvicorn running on http://127.0.0.1:8000
```

也可以复制 `backend/.env.example` 为 `backend/.env` 再填——后端会用
`python-dotenv` 读取它（真实环境变量优先于 `.env`）。

**前端**（`frontend/`）：

```bash
cd frontend
npm install
npm run dev
# → http://127.0.0.1:5173
```

开发模式下前端会自动直连本机后端 `http://localhost:8000/api`
（判定依据：页面端口是 `5173` 或 `5273`，见 `frontend/src/api/base.js`）。
**不需要**在 `vite.config.js` 里配代理。

自测后端是否活着：

```bash
curl "http://127.0.0.1:8000/api/public/works?limit=1"
```

> 后端**只监听 `127.0.0.1:8000`**（`backend/run.py` 写死），这是刻意的：
> 公网流量应统一经 nginx 进来。**不要**改成 `0.0.0.0`。

## Q3. 数据库在哪？怎么初始化 / 改表结构？

- **位置**：默认 `backend/nimao.db`（SQLite）。
  由 `NIMAO_DATABASE_URL` 决定，默认值是
  `sqlite:///<backend 目录>/nimao.db`（`backend/app/config.py`）。
- **初始化**：**不需要手动建库**。后端启动时 `main.py` 会调用
  `app/database.py` 的 `init_db()`，由 SQLAlchemy 按 `app/models.py`
  的模型 `create_all()` 自动建表。
- **改表结构（重要）**：`create_all()` **只建不存在的表，不会修改已有表的字段**。
  所以给已有表加列**不会自动生效**，必须自己写迁移。
  详见 [`DATABASE.md`](DATABASE.md) 与 [`DEVELOPMENT.md`](DEVELOPMENT.md)。
  开发期最省事的做法是删掉 `nimao.db` 让 SQLAlchemy 重建
  （**会丢数据**，仅限开发库）。
- **数据表全貌**：共 **50 张表**，清单见 [`DATABASE.md`](DATABASE.md)。
- **迁移脚本**：`backend/migrate_*.py` 这类一次性迁移脚本**未包含在开源版本中**
  （见 [`../CHANGELOG.md`](../CHANGELOG.md)），需要时请参照
  [`DATABASE.md`](DATABASE.md) 自行编写。

## Q4. 忘了 `NIMAO_SECRET_KEY`，后端起不来怎么办？

这是**刻意设计**。`backend/app/config.py` 启动时就会检查，只要满足任一条就抛
`RuntimeError` 拒绝启动：

- 没有设置；
- 等于内置占位符 `replace-me-with-a-random-32-plus-byte-secret`；
- 长度**短于 32 字符**。

生成一个合规的：

```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```

> 注意：这个密钥同时用于 **JWT 签名**，并且是**云变量票据密钥的默认回退值**
> （`CLOUD_SECRET` 未单独配置时）。轮换它会让所有已登录用户掉线。
> 详见 [`SECURITY.md`](SECURITY.md) 第 1 节。

## Q5. 第一个管理员账号怎么来？

**代码里没有自动创建管理员的逻辑**——没有「第一个注册用户自动变成管理员」这种引导
（`users.role` 的默认值是 `"user"`）。所以首次部署需要一个**带外步骤**先把某个账号提权：

```bash
# 1) 先在网站上正常注册一个账号
# 2) 然后在部署机上直接改数据库（路径以 NIMAO_DATABASE_URL 为准）
sqlite3 backend/nimao.db "UPDATE users SET role='admin' WHERE username='<你的账号>';"
```

改完重新登录（或刷新），就能进 `/admin` 了。
后台也有「改角色」的界面，但它本身要求调用者已经是管理员。

> 「未确认」：仓库文档里没有给出统一的管理员初始化脚本或推荐流程，
> 上面是通用做法。执行前请先确认你的实际数据库路径。

## Q6. 怎么加一种语言？

要改代码——**当前只支持中文与 English 两种**，不是配置项。

语言清单硬编码在 `frontend/src/i18n/index.jsx` 的 `LANGS` 数组里，
并且 `setLang()` 与 `readInitialLang()` 都**显式只接受 `'zh'` 和 `'en'`**
（`if (next !== 'zh' && next !== 'en') return;`）。

所以新增语言的步骤大致是：

1. 在 `frontend/src/i18n/dict/*.js` 的每个词条对象里增加新语言的键
   （每个文件的结构是 `export default { zh: {...}, en: {...} }`，
   `index.jsx` 里用 `for (const loc of ['zh', 'en'])` 收集——**这一行也要加**）；
2. 在 `LANGS` 数组里加一项 `{ code: 'xx', label: '…', htmlLang: '…' }`；
3. 放宽 `setLang()` / `readInitialLang()` 的语言校验；
4. `frontend/src/i18n/server.js` 负责把后端返回的中文错误提示翻译成英文，
   新语言若要覆盖后端提示，也需要在这里处理。

> 词条文件会被 `import.meta.glob('./dict/*.js')` **自动收集**，
> 所以**新增词条文件本身不需要改注册表**——但新增*语言*需要（见上面第 1、2 步）。

## Q7. 为什么会有个「SE 版」？它和主站什么关系？

SE = **Simplified Edition（精简版）**，是**给老浏览器（含 IE11）的只读版本**，
无框架、纯 ES5（`frontend-se/package.json` 的 `description` 与 `browserslist: ["ie 11"]`）。

- 它是**独立的一份前端**，不共享 `frontend/` 的源码，只共用后端接口。
- 构建方式很不一样：`frontend-se/vite.config.js` 用 **lib 模式输出 IIFE 普通脚本**
  （`app.js` + `style.css`），HTML 是手写在 `frontend-se/public/index.html` 里的。
  原因写在配置注释里：**IE11 不执行 `<script type="module">`**，
  用默认 app 构建会让页面永远停在「正在载入」。
- 功能上是**只读**的：浏览首页、论坛、作品、帖子、用户等，不做投稿与互动。
- 它指向主站的地址由 `VITE_SITE_ORIGIN` 决定（默认 `https://example.com`）。

细节见 [`../frontend-se/README.md`](../frontend-se/README.md)。

## Q8. 怎么新增一个页面？

前端路由是**集中声明**的，在 `frontend/src/App.jsx` 的 `<Routes>` 里加一行即可，
没有额外的路由注册表：

```jsx
import MyPage from './pages/MyPage';

// 在 <Routes> 内：
<Route path="/my-page" element={<MyPage />} />
```

几个现成的约定（照抄现有写法最稳）：

| 场景 | 用哪个包装组件 |
| --- | --- |
| 需要登录才能看 | `<ProtectedRoute>` |
| 需要登录且需要有发内容的权限（投稿/发帖/建工作室） | `<CreationGate>` |
| 后台页面 | `<ConfirmProvider><AdminApp /></ConfirmProvider>` |

页面组件放 `frontend/src/pages/`。文案一律走 i18n（`useI18n().t('key')`），
不要硬写中文——否则英文界面会漏。

## Q9. 怎么新增一个接口？

后端路由**按模块分文件**放在 `backend/app/routers/` 下，模块内只写**相对路径**，
统一前缀 `/api` 是在 `backend/app/main.py` 里挂的：

```python
app.include_router(r, prefix="/api")
```

新增接口的步骤：

1. 在合适的模块（或新建一个 `routers/xxx.py`）里定义 `router = APIRouter(...)`
   与处理函数；
2. 若是新模块，在 `main.py` 顶部 import 并加进 `include_router` 的列表；
3. 按安全要求选依赖：
   - 公开 → 不加依赖；
   - 需要登录 → `Depends(get_current_user)`；
   - **写操作 → `Depends(get_active_user)`**（这是全站写接口的标准闸门）；
   - 后台 → `Depends(get_current_admin)`；
4. 请求体校验优先用 `app/schemas.py` 里的 Pydantic 模型；
5. **同步更新 [`API.md`](API.md)**（该文件是从路由代码整理出来的接口清单）。

更完整的规范（含「不要做什么」）见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

## Q10. 图标和图片是从哪来的？

分三类：

1. **本项目自己的标识**：`frontend/public/kitter-logo.png`、`kitter-favicon.png`、
   `favicon.ico`、`manifest.webmanifest`。
2. **第三方品牌素材（版权属各自权利人）**：编程猫与各编辑器图标
   （`codemao-logo.png`、`kitten3.png`、`kitten4.png`、`kittenn.ico`、`coco.png`、
   `nemo.png`）、Scratch 图标（`scratch.png`）、编程猫等级徽章（`badge/codemao-lv*.png`）、
   pickCat 文字标识、支付渠道 LOGO（`donate/pay-*.png`）。
   **这些不因本项目的许可证而改变授权状态**，详见
   [`SECURITY.md`](SECURITY.md) 的「第三方素材与商标」一节。
3. **UI 图标**：主要来自 `lucide-react` 图标库（见 `frontend/package.json`）；
   界面组件用的是 `@material/web`（Material Web Components）。

> 站长的个人收款二维码**已从开源版本中移除**，`donate/` 下现在只剩支付渠道 LOGO。
> 界面截图在 `docs/screenshots/`（6 张，已确认不含真实用户信息）。

## Q11. 怎么部署到服务器？

推荐拓扑：**nginx 在最前面 → 反代到只监听 `127.0.0.1:8000` 的后端**，
前端构建产物由 nginx 直接托管。

`deploy/` 下有可直接参考的示例：

- `deploy/nginx.conf.example` —— 站点配置（静态 + `/api` + `/socket.io` + `/uploads/` + TLS）
- `deploy/kitterhub-backend.service.example` —— systemd 单元（密钥走 `EnvironmentFile`）

步骤概览：

```bash
# 后端
cd backend && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
sudo install -m 600 /dev/null /etc/kitterhub/backend.env   # 至少填 NIMAO_SECRET_KEY

# 前端构建
cd frontend && npm ci && npm run build          # → frontend/dist/
cd ../frontend-se && npm ci && npm run build    # → frontend-se/dist/（可选）

# 装服务
sudo cp deploy/kitterhub-backend.service.example /etc/systemd/system/kitterhub-backend.service
sudo systemctl daemon-reload && sudo systemctl enable --now kitterhub-backend
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/kitterhub.conf
sudo nginx -t && sudo systemctl reload nginx
```

⚠️ 示例配置里所有域名/IP 都是**占位符**（`example.com` 等），用前必须替换；
**`backend/private/`（护照/证件图）绝对不能被 nginx 挂载**。
完整说明与必须修改的占位符清单见 [`../deploy/README.md`](../deploy/README.md)，
注意事项见 [`SECURITY.md`](SECURITY.md) 第 8 节的加固清单。

## Q12. 能商用吗？许可证是什么？

**目前没有许可证**，所以：

> 在站长选定并替换之前，本仓库**未授予任何开源许可**，
> 默认「保留所有权利」，**任何人不得复制、修改或再分发**，更谈不上商用。

占位文件是 [`../LICENSE-待定.md`](../LICENSE-待定.md)，里面解释了为什么留空、
站长需要做什么，以及 MIT / Apache-2.0 / GPL-3.0 / AGPL-3.0 的粗略区别。

另外提醒：即使将来选了宽松许可证，**仓库内的第三方品牌素材
（编程猫、Scratch、支付渠道 LOGO 等）授权状态也不随之改变**，
商用前请自行确认（见 [`SECURITY.md`](SECURITY.md) 的「第三方素材与商标」）。

## Q13. 风纪委员会为什么点进去用不了？

因为**「答题入会 + 60 天任期」这套规则还没有合并进这个版本**，
但前端界面已经照着它预先写好了，所以会出现「有页面、没接口」的情况。

- 当前版本**真正生效**的是：LV3 申请 + 管理员审批、委员「隐藏 + 送审」（每天 20 条）、
  以及「满 3 票无违规即恢复」。
- **未生效**的是：答题入会（100 题库 / 抽 20 题 / 答对 ≥15 通过）、60 天任期、
  标记 >50 免审连任、标记 ≥1 票违规即隐藏。
  这些只存在于重构中间目录 `tmp_stage2/`，**没有接入 `app/main.py`**，
  且**不属于本次开源导出**（题库文件在本仓库中也不存在）。

详细对照见 [`MODERATION.md`](MODERATION.md) 第二部分，
功能状态速览表见 [`../README.md`](../README.md) 的「1.1 功能状态」。

## Q14. 上传图片报 413 / 上传失败？

**413 是 nginx 拦下的**，说明 `client_max_body_size` 小于你要传的文件。
应用层与 nginx 是**两道独立闸门，两层都要改**。

应用层默认上限（`backend/app/config.py`，可用环境变量覆盖）：

| 类型 | 默认上限 | 环境变量 |
| --- | --- | --- |
| 图片 | 3 MB | `NIMAO_MAX_UPLOAD_SIZE` |
| 视频 | 30 MB | `NIMAO_MAX_VIDEO_SIZE` |
| `.sb3` 作品包 | 50 MB | `NIMAO_SCRATCH_MAX_SIZE` |
| 护照/证件图 | 8 MB | `NIMAO_PASSPORT_MAX_SIZE` |

`deploy/nginx.conf.example` 给的是 `client_max_body_size 64m`。

其它常见原因：

- **「文件内容与声明格式不符」**：后端会校验**真实文件头**（magic bytes），
  扩展名对了但内容不是真图片也会被拒。
- **「存储空间不足」**：默认每用户 100MB 配额（`NIMAO_STORAGE_PER_USER_MB`），
  可在后台申请扩容。图片、视频、`.sb3` 都计入。

## Q15. 「你的账号还未激活」是什么意思？

这是**产品要求**，不是 bug：注册后必须先完成**实名/绑定**，否则**所有写操作**被拦下
（可以正常浏览）。

实现位置在 `backend/app/deps.py` 的 `get_active_user`：
当 `verify_state != "ok"` 时，除白名单路径外一律 403。

两条激活路径（**任选其一**）：

1. **上传护照个人信息页**，等管理员审核（`/verify` 页面）；
2. **绑定编程猫账号**——这条是**立即生效**的。

白名单（未激活时仍可访问）：登出、`/api/verify/`、
签订《友好条约》、绑定编程猫。这几个是「激活自己所必需」的接口，
漏掉任何一个都会把用户困在死循环里。

状态取值：`ok` / `awaiting_passport`（还没交材料）/ `pending_review`（等审核）/
`rejected`（未通过），见 `backend/app/routers/verify.py`。

---

## 还有问题？

- 想参与开发、提交代码：见 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- 开发规范与踩坑记录：见 [`DEVELOPMENT.md`](DEVELOPMENT.md)
- 环境变量完整清单：见 [`CONFIGURATION.md`](CONFIGURATION.md)
- 接口清单：见 [`API.md`](API.md)（站内全部）与 [`public-api.md`](public-api.md)（对外只读）
- 安全问题：见 [`SECURITY.md`](SECURITY.md) 第 9 节（⚠️ 上报邮箱目前是占位符）
