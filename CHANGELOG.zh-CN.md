> English version: [CHANGELOG.md](CHANGELOG.zh-CN.md) · 本文件为中文版

# 更新日志（CHANGELOG）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式。

## [0.1.0] - 首次开源

这是 KitterHub 面向公众开源的第一版。仓库内容来自站内正在运行的代码，
在开源前做了完整的敏感信息清理与文档补齐。

### 新增

- **完整后端源码**（FastAPI + SQLAlchemy + SQLite）：用户与鉴权、作品投稿、论坛帖子与评论、
  工作室、私信与群聊、通知、经验等级、徽章、敏感词与举报、风纪委员会、后台管理、
  公开 API、Pages 静态托管、pickCat 头像工具集成、Socket.IO 实时通信。
- **React 主站前端**：React 18 + Vite + `@material/web`，中英双语、深浅色主题、响应式布局。
- **SE 精简版前端**：无框架、纯 ES5、面向 IE11 的只读版本。
- **文档**：
  - `README.md` —— 项目介绍、功能清单、技术栈、目录结构、本地启动、配置、API 概览、部署。
  - `docs/ARCHITECTURE.md` —— 整体架构、请求链路、鉴权流程、各目录职责。
  - `docs/DEVELOPMENT.md` —— 本地开发细节、代码规范、i18n 与新增接口/页面的流程。
  - `docs/CONFIGURATION.md` —— 全部环境变量速查表（含默认值与是否必填）。
  - `docs/API.md` —— 从路由代码整理的完整接口清单。
  - `docs/DATABASE.md` —— 数据表、字段、外键与关系图。
  - `docs/MODERATION.md` —— 内容治理与风纪委员会规则详解。
  - `docs/SECURITY.md` —— 安全实践与漏洞上报方式。
  - `docs/FAQ.md` —— 常见问题。
  - `backend/README.md`、`frontend/README.md`、`frontend-se/README.md`、`deploy/README.md`。
- **部署示例**：`deploy/` 下的 nginx 与 systemd 模板（域名一律为 `example.com` 占位符）。
- **界面截图**：`docs/screenshots/`（已逐张确认不含真实用户信息）。
- 增补 `.gitignore`，覆盖密钥、数据库、上传目录、构建产物与备份目录。

### 未包含（功能层面）

- **风纪委员会的考试与任期模块——设计中，未合并**：
  「答题入会（题库 100 题 / 随机抽 20 题 / 答对 ≥15 题通过）」「60 天任期」
  「任期内标记 >50 条免审核免答题连任」「委员标记 ≥1 票违规即隐藏并送管理员复审」
  这几条规则只存在于重构中间目录 `tmp_stage2/`，**未接入 `app/main.py`**，
  题库文件在当前仓库中也不存在，因此**不是本版本已实现的功能**。
  前端 `Committee.jsx` / `CommitteeExam.jsx` 已按这些规则预先写好界面，
  但对应后端接口未提供，相关界面在当前版本不可用。
  当前版本实际生效的是「LV3 申请 + 管理员审批」与「满 3 票无违规恢复」。
  详见 `README.md` 的「1.1 功能状态」与 `docs/MODERATION.md`。

### 变更（相对站内私有版本）

- **所有真实域名、服务器 IP、隧道地址、管理员邮箱改为环境变量或 `example.com` 占位符**：
  - 新增配置项 `NIMAO_SITE_URL`、`NIMAO_PAGES_DOMAIN`、`NIMAO_SUPPORT_EMAIL`、
    `NIMAO_PICKCAT_API_BASE`；`CLOUD_HOST` 默认值改为占位符。
  - GitHub OAuth 回调地址不再写死，默认由 `NIMAO_SITE_URL` 推导。
  - 前端支持 `VITE_SUPPORT_EMAIL`、`VITE_PAGES_DOMAIN`；SE 版支持 `VITE_SITE_ORIGIN`。
- **移除硬编码的兜底凭据与身份标识**：
  - `NIMAO_EMAIL_FIXED_CODE` 的默认值由固定验证码改为空（原默认值可被用来绕过邮箱注册验证）。
  - `NIMAO_RESEND_API_KEY` 默认值由假的 `re_` 前缀占位改为空。
  - `IP_REGION_PIN_EXEMPT_UIDS` 中写死的真实用户 uid 默认值改为空。
  - `IP_REGION_ADMIN_FIXED` 的默认属地改为空。
- **支持 `.env` 文件**：新增可选依赖 `python-dotenv`，`backend/.env` 现在会被真正读取
  （此前 `.env.example` 声称可用，但代码并未加载它）。
- **从开源版本中移除**（见「未包含」）。
- `requirements.txt` 补充说明性注释，并修正与代码实际 import 的对应关系。

### 移除（安全原因）

- `.forensics/` 整目录：含服务器 SSH 私钥、管理员令牌、凭据文件、密钥脚本、
  数据库备份与内部审计日志。
- 所有 `*.db`（含根目录 `nimao.db`、`backend/nimao.db` 及各备份库）：含真实用户数据与密码哈希。
- `frontend/public/donate/{wechat,alipay}.png`：站长本人的收款二维码。
- `frontend/public/.well-known/dsh-verify-*.txt` 与 `frontend/public/26f5…d.txt`：站点验证令牌文件。
- `.apkbuild/`（Android SDK 缓存）、`.git/`（原始提交历史）、`node_modules/`、`.venv/`、`dist/`。
- 源码中的备份文件 `*.bak` / `*.bak2` / `*.bak3`。

### 未包含（有意排除，需要时请自行补充）

- `cloud/` —— 自建 Scratch 云变量服务（`server.py` + 部署脚本）。
  后端已有对接代码（`app/cloudvars.py`），但没有这个服务时云变量功能不可用。
- `extensions/kitten4-kitterhub/` —— 浏览器扩展。
- `proxy/` —— 内网代理与 WireGuard 相关脚本与安装包。
- `tmp_stage2/` —— 重构过程中的中间产物。
- `backend/migrate_*.py`、`backend/test_*.py`、`backend/*.log` —— 一次性迁移脚本与手工测试脚本
  （见 `docs/DATABASE.md` 关于如何自行编写迁移的说明）。
- `.forensics/design/` 下的其余截图 —— 多数含真实用户名、头像与帖子内容。

### 安全

- 开源前对目标仓库做了两轮敏感信息扫描（文件名 + 文件内容），
  清理项与残留项记录在项目维护者的交付报告中。
- 新增 `docs/SECURITY.md`，明确密钥管理、上传限制、后台鉴权与漏洞上报渠道。
