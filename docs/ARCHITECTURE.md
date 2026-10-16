# Architecture

> 中文版: [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)

## The shape of it

```
                    ┌──────────────────────────────┐
   browser ────────►│  nginx (one host, one config)│
                    └───────┬──────────────┬───────┘
                            │              │
                 /api, /socket.io      static files
                            │              │
                    ┌───────▼──────┐  ┌────▼─────────────┐
                    │  FastAPI app │  │ frontend/ dist   │
                    │  + socketio  │  │ frontend-se/ dist│
                    └───────┬──────┘  └──────────────────┘
                            │
                   ┌────────▼─────────┐
                   │ SQLite (one file)│
                   └──────────────────┘
```

One host runs everything: nginx terminates TLS, serves the built clients as static files, and proxies `/api` and `/socket.io` to a single Python process managed by systemd. The database is one SQLite file on local disk.

## The three clients

| Client | Path | Why it exists |
|---|---|---|
| Main web app | `frontend/` | React 18 + Vite + Material Web. The full experience. |
| SE edition | `frontend-se/` | No framework, ES5, IIFE bundle. For very old browsers, including IE11. Read-and-participate only: no creation tools. |
| Admin console | inside `frontend/` | Routes under `/admin`, guarded by role checks on every API call. |

## Request flow

1. The browser calls `/api/...`.
2. nginx proxies to the Python process on `127.0.0.1:8000`.
3. FastAPI resolves the route, then the `get_db` dependency opens a session from the connection pool.
4. Authentication reads the `Authorization: Bearer <jwt>` header, verifies the signature with `NIMAO_SECRET_KEY`, and loads the user.
5. The handler works through SQLAlchemy models and returns a Pydantic schema.
6. The session is closed by the dependency, even on error. **Nothing may bypass this** — a session that is not returned to the pool eventually takes the whole site down.

## Authentication

- Local accounts: passwords are hashed on write; login issues a JWT with an expiry (`NIMAO_TOKEN_EXPIRE`, minutes).
- Email registration: a verification code is generated, stored with a purpose and an expiry, and delivered over SMTP or Resend.
- GitHub: optional OAuth login and account binding. Callback URL must match `NIMAO_GITHUB_REDIRECT_URI` exactly.
- Admin access is a **role on the user record**, checked per route by `get_current_admin`. Admin actions are written to an audit log.

## Realtime

`python-socketio` is mounted alongside the HTTP app. Chat conversations, message delivery and read state travel over the socket; notifications are persisted in the database and pushed to connected clients. Setting `NIMAO_CHAT_ENABLED=0` disables chat REST endpoints (they answer 503) and drops chat socket events, while notifications keep working.

## Content moderation

Screening happens **before** publication: works, posts and comments are matched against the sensitive-word list and, on a hit, written into the review table and hidden. Reports, committee actions and administrator decisions all write to the same review table plus an audit log, so every state change is traceable and reversible. Details in [MODERATION.md](MODERATION.md).

## Static site hosting

The back end can serve small user-authored static sites from a directory on disk (`NIMAO_PAGES_ROOT`), exposed on a separate domain (`NIMAO_PAGES_DOMAIN`). Uploads, versions, rollback and deletion are handled by `app/pages_sites.py`. This directory must never contain anything private — see [SECURITY.md](SECURITY.md).

## Files worth knowing

| File | Responsibility |
|---|---|
| `backend/app/main.py` | Application assembly, router mounting, socket app, middleware |
| `backend/app/config.py` | Every setting, read once from the environment |
| `backend/app/models.py` | SQLAlchemy models — the schema lives here |
| `backend/app/database.py` | Engine, session factory, `create_all` on start |
| `backend/app/routers/` | One module per API area |
| `frontend/src/styles/global.css` | All design tokens and shared CSS |
| `frontend/src/i18n/dict/` | Chinese and English strings |
