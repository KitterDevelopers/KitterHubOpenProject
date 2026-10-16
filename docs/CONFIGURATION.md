# Configuration

> 中文版: [CONFIGURATION.zh-CN.md](CONFIGURATION.zh-CN.md)

Everything is configured through environment variables. Real environment variables take precedence over the `.env` file (`load_dotenv(override=False)`). The annotated template lives in [`../backend/.env.example`](../backend/.env.example).

**Only one variable is mandatory: `NIMAO_SECRET_KEY`.** Everything else has a usable default. If that key is missing, shorter than 32 characters, or still a placeholder, the application refuses to start.

## 1. Core

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_SECRET_KEY` | — (**required**) | Signing/encryption key for tokens. At least 32 characters. Generate with `python -c "import secrets;print(secrets.token_urlsafe(48))"`. |
| `NIMAO_TOKEN_EXPIRE` | `1440` | JWT lifetime in minutes (24 hours). |
| `NIMAO_DATABASE_URL` | `sqlite:///<backend>/nimao.db` | SQLAlchemy connection string. |
| `NIMAO_DOCS` | `0` | `1` exposes `/docs`, `/redoc` and `/openapi.json`. Keep `0` in production. |

## 2. Site identity

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_SITE_URL` | `https://example.com` | Public site URL: canonical links, share URLs, OAuth callbacks, SE edition links back. |
| `NIMAO_PAGES_DOMAIN` | `pages.example.com` | Hostname for user-hosted static sites (host name only). |
| `NIMAO_PAGES_ROOT` | `/srv/kitterhub/pages` | Directory where those static sites are written. |
| `NIMAO_SUPPORT_EMAIL` | `support@example.com` | Support address shown in the footer and legal pages. |
| `NIMAO_PUBLIC_BASE_URL` | *(empty)* | Prefix for absolute URLs in `/api/public/*`. Leave empty to infer from the request host. |
| `NIMAO_PICKCAT_API_BASE` | `https://example.com/pickcat-avatar/api/v1` | Upstream for the third-party PickCat community API proxy. |

## 3. GitHub OAuth (optional)

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_GITHUB_CLIENT_ID` | *(empty)* | From a GitHub OAuth app. Leave empty to disable GitHub login. |
| `NIMAO_GITHUB_CLIENT_SECRET` | *(empty)* | OAuth app secret. |
| `NIMAO_GITHUB_REDIRECT_URI` | `{NIMAO_SITE_URL}/api/auth/github/callback` | Must match the OAuth app exactly. |
| `NIMAO_GITHUB_FRONTEND_BASE` | `NIMAO_SITE_URL` | Where to send the browser after callback. |
| `NIMAO_GITHUB_SCOPE` | `read:user user:email` | Read-only profile scopes. |
| `NIMAO_GITHUB_OAUTH_BASE`, `NIMAO_GITHUB_API_BASE` | *(empty)* | Only for pointing at a fake GitHub while testing. |

## 4. Email (optional)

Two providers, pick one. With neither configured, the email endpoints return an explicit configuration error instead of failing silently.

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_MAIL_PROVIDER` | *(auto)* | `smtp` or `resend`; empty means "SMTP if configured, else Resend". |
| `NIMAO_SMTP_HOST` / `_PORT` | `smtp.example.com` / `465` | SMTP server. |
| `NIMAO_SMTP_USER` / `_PASS` | *(empty)* | Credentials. Use the provider's app password, not the account password. |
| `NIMAO_SMTP_SSL` | `1` | `1` for port 465 (implicit TLS), `0` for 587 (STARTTLS). |
| `NIMAO_RESEND_API_KEY` | *(empty)* | Resend API key. |
| `NIMAO_MAIL_FROM` / `_FROM_NAME` | `onboarding@resend.dev` / `KitterHub` | Sender identity. |
| `NIMAO_MAIL_SITE_URL`, `NIMAO_MAIL_LOGO` | *(empty)* | Optional button URL and header logo in outgoing mail. |
| `NIMAO_MAIL_OVERRIDE_TO` | *(empty)* | Development only: redirect every message to this address. |
| `NIMAO_EMAIL_REGISTER` | `1` | `0` disables email registration entirely. |
| `NIMAO_EMAIL_PRECHECK` | `1` | Format, disposable-domain and MX pre-checks (sends the address to a third-party service). |
| `NIMAO_MAIL_DAILY_LIMIT` | `80` | Maximum verification emails per day. |
| `NIMAO_EMAIL_CODE_ECHO` | `0` | **Development only**: return the code in the API response instead of sending mail. Never enable in production. |
| `NIMAO_EMAIL_FIXED_CODE` | *(empty)* | **Development only**: accept this fixed code for registration. Never enable in production. |

## 5. Rate limits and quotas (off by default)

`NIMAO_LIMIT_RATE` + `NIMAO_RATE_LIMIT` (default 300/minute per IP), `NIMAO_LIMIT_FREQ`, `NIMAO_LIMIT_DAILY` with `NIMAO_DAILY_POST_LIMIT` / `_COMMENT_LIMIT` / `_WORK_LIMIT`, `NIMAO_LIMIT_LOGIN` (failed-login lockout), `NIMAO_LIMIT_REG` (registration quota). Each is off unless set to `1`.

## 6. Feature switches

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_CHAT_ENABLED` | `1` | `0` disables private and group chat: chat REST answers 503 and chat socket events are dropped. Notifications keep working. |
| `NIMAO_CLOUD_ENABLED` | `1` | Self-hosted Scratch cloud-variable service. |
| `NIMAO_CLOUD_HOST` | `wss://example.com/cloud` | Public WebSocket address for that service. |
| `NIMAO_CLOUD_SECRET` | *(falls back to the secret key)* | Ticket signing key. |
| `NIMAO_CLOUD_TICKET_TTL` | `21600` | Ticket lifetime in seconds. |
| `NIMAO_CLOUD_ADMIN_URL` / `_ADMIN_KEY` | `http://127.0.0.1:9081` / *(empty)* | Admin interface of the cloud service (localhost only). |
| `NIMAO_SCRATCH_EMBED_BASE` | `https://turbowarp.org/embed` | Player used to run Scratch projects in the page. |

## 7. Uploads and storage

`NIMAO_MAX_UPLOAD_SIZE` (3 MB), `NIMAO_MAX_VIDEO_SIZE` (30 MB), `NIMAO_PASSPORT_MAX_SIZE` (8 MB), `NIMAO_SCRATCH_MAX_SIZE` (50 MB), `NIMAO_FEEDBACK_MEDIA_MAX` (6 images per feedback item), `NIMAO_STORAGE_PER_USER_MB` (100 MB default quota), `NIMAO_STORAGE_QUOTA_MAX_MB` (20 GB maximum requestable), `NIMAO_STORAGE_QUOTA_APPLY_REMAINING_MB` (20 MB — apply a pending quota when free space drops below this).

## 8. IP geolocation (offline)

| Variable | Default | Meaning |
|---|---|---|
| `NIMAO_IP2REGION_XDB` | `<backend>/data/ip2region_v4.xdb` | Offline ip2region database (~11 MB, download separately). Missing file degrades gracefully to empty values. |
| `NIMAO_IP_REGION_REFRESH` | `60` | Cache refresh in minutes. |
| `NIMAO_IP_REGION_ADMIN_FIXED` | *(empty)* | Fixed region string shown for admin accounts. |
| `NIMAO_IP_REGION_FIXED_UIDS`, `NIMAO_IP_REGION_PIN_EXEMPT_UIDS` | *(empty)* | Comma-separated user ids to always pin, and admin ids exempt from pinning. |

## Deployment tips

- In production, prefer systemd's `EnvironmentFile=` or a secret store over a `.env` file on disk.
- Set `NIMAO_SITE_URL` to the real public URL; several features build absolute links from it.
- Leave `NIMAO_EMAIL_CODE_ECHO` and `NIMAO_EMAIL_FIXED_CODE` empty in production — with either set, anyone who can read the API response can register.
- Third-party integrations (GitHub, the mail provider, the PickCat API, Turbowarp) need **your own** credentials; none are shipped here.
