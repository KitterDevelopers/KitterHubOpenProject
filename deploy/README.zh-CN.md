> English version: [README.md](README.zh-CN.md) · 本文件为中文版

# deploy/ —— 部署示例

本目录放**与具体服务器无关**的部署模板。所有域名、IP、路径都是占位符，
用之前请全文替换成你自己的值。

> ⚠️ 这些文件是**示例**，不是开箱即用的配置。照抄上线前请至少读完
> 「[必须修改的占位符](#必须修改的占位符)」一节。

## 目录内容

| 文件 | 是什么 | 装到哪里 |
| --- | --- | --- |
| [`nginx.conf.example`](nginx.conf.example) | nginx 站点配置：静态前端 + `/api` 与 `/socket.io` 反代 + `/uploads/` 托管 + TLS | `/etc/nginx/conf.d/kitterhub.conf` |
| [`kitterhub-backend.service.example`](kitterhub-backend.service.example) | systemd 服务单元：用虚拟环境托管后端，密钥走 `EnvironmentFile` | `/etc/systemd/system/kitterhub-backend.service` |

## 必须先搞清楚的两条约定

这两条决定了整个部署拓扑，来自代码而不是习惯（见
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.zh-CN.md)）：

1. **后端只监听 `127.0.0.1:8000`**。`backend/run.py` 把 `host` 写死为 `127.0.0.1`，
   并设置 `forwarded_allow_ips="127.0.0.1"`（只信任本机 nginx 写入的
   `X-Forwarded-For` / `X-Real-IP`，这样日志、限流、审计才能拿到真实客户端 IP）。
   **不要**为了图省事改成 `0.0.0.0`，也不要在防火墙上放行 8000。
2. **`/api` 与 `/socket.io` 都反代到同一个 8000 端口**，由 nginx 按路径分流；
   前者是普通 HTTP，后者必须放行 WebSocket 升级（示例里已配好
   `Upgrade` / `Connection` 头与 3600s 长超时）。

另外一条安全红线：`backend/private/` 存的是护照/证件图，
**只能由后端校验权限后读取**（`backend/app/routers/verify.py`），
**绝不要**用 nginx 把它挂载出去。示例配置里对此有显式注释。

## 必须修改的占位符

| 占位符 | 出现在 | 替换为 |
| --- | --- | --- |
| `example.com` | nginx 的 `server_name`、证书路径 | 你的站点主域名 |
| `pages.example.com` | nginx 里被注释掉的 Pages 块 | 你的 Pages 托管域名（不用该功能就删掉整块） |
| `/srv/kitterhub` | nginx 的 `root` / `alias`、systemd 的 `WorkingDirectory` | 你的实际部署路径 |
| `/etc/kitterhub/backend.env` | systemd 的 `EnvironmentFile` | 你的环境变量文件路径 |
| `kitterhub` | systemd 的 `User` / `Group` | 运行服务的系统用户（建议专用低权限用户） |
| `/etc/letsencrypt/live/example.com/…` | nginx 的证书路径 | 你的证书实际路径 |
| `/srv/kitterhub/pages` | nginx 里被注释掉的 Pages `root` | 与 `NIMAO_PAGES_ROOT` **保持一致** |

顺带一提，`/var/www/certbot` 是 `certbot --webroot` 的默认挑战目录；
如果你用 `certbot --nginx`，可以把那一段 `location` 删掉。

## 安装步骤

前置：已经按 [`../README.md`](../README.zh-CN.md) 第 6 节把前后端跑通过一次，
并且已经构建了前端产物。

```bash
# 1) 后端：装依赖（用虚拟环境，别装进系统 Python）
cd /srv/kitterhub/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# 2) 环境变量：参考 backend/.env.example 写一份，权限收紧到 600
sudo install -d -m 700 /etc/kitterhub
sudo install -m 600 /dev/null /etc/kitterhub/backend.env
sudo editor /etc/kitterhub/backend.env
#    ★ 至少必须填 NIMAO_SECRET_KEY，否则后端拒绝启动。
#      生成：python -c "import secrets;print(secrets.token_urlsafe(48))"

# 3) 前端构建产物（在本地或服务器上构建都可以）
cd /srv/kitterhub/frontend && npm ci && npm run build        # → frontend/dist/
cd /srv/kitterhub/frontend-se && npm ci && npm run build     # → frontend-se/dist/（可选）

# 4) 装 systemd 单元
sudo cp deploy/kitterhub-backend.service.example /etc/systemd/system/kitterhub-backend.service
sudo editor /etc/systemd/system/kitterhub-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now kitterhub-backend
systemctl status kitterhub-backend
curl -s http://127.0.0.1:8000/api/public/works?limit=1     # 本地自测

# 5) 装 nginx 站点
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/kitterhub.conf
sudo editor /etc/nginx/conf.d/kitterhub.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 构建产物对应关系

示例里的静态路径与两个前端的实际构建输出一致（来自各自的 `vite.config.js`）：

| 前端 | 构建命令 | 输出目录 | nginx 里的位置 |
| --- | --- | --- | --- |
| `frontend/`（主站，React） | `npm run build` | `frontend/dist/` | 主 `server` 块的 `root` |
| `frontend-se/`（SE 精简版） | `npm run build` | `frontend-se/dist/`（`app.js` + `style.css` + 手写 `index.html`） | 需另配一个 `server` 块 / 子路径，示例未展开 |

> SE 版是给 IE11 等老浏览器的只读版本，构建成 **IIFE 普通脚本**（不是
> `type="module"`），细节与原因见 [`../frontend-se/README.md`](../frontend-se/README.zh-CN.md)。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 上传图片返回 **413** | nginx 的 `client_max_body_size` 小于应用层上限。应用层默认：图片 3MB、视频 30MB、`.sb3` 作品包 50MB（`backend/app/config.py`，可用环境变量调）。**两层都要改**，示例给的是 64m |
| 打开页面一直「正在载入」 | 若访问的是 SE 版，检查是否被当成了 module 脚本；SE 版必须加载 IIFE 产物 |
| 私信/通知不实时 | `/socket.io/` 的反代漏了 `Upgrade` / `Connection` 头，或被默认 60s 超时掐断 |
| 后端起不来，日志说 `NIMAO_SECRET_KEY` 未正确注入 | 没配 `/etc/kitterhub/backend.env`，或密钥短于 32 字符，或仍是 `.env.example` 里的占位值 |
| 后台接口全 403 | 当前账号 `role` 不是 `admin`（`backend/app/deps.py` 的 `get_current_admin`） |
| 用户 IP 属地全是空 | 没放 ip2region 离线库（约 11MB，`NIMAO_IP2REGION_XDB`）。该功能缺失时自动降级为空值，不影响启动 |

## 相关文档

- [`../README.md`](../README.zh-CN.md) —— 项目总览与本地启动
- [`../docs/CONFIGURATION.md`](../docs/CONFIGURATION.zh-CN.md) —— 全部环境变量速查表（含默认值与是否必填）
- [`../docs/SECURITY.md`](../docs/SECURITY.zh-CN.md) —— 密钥管理、上传限制、加固建议、漏洞上报
- [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.zh-CN.md) —— 请求链路与各目录职责
