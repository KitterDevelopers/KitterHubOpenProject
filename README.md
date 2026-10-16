# KitterHub

An open-source community platform for young creators — works, forum, studios, chat, notifications, XP levels, and content moderation. Built with FastAPI + SQLite on the back end and React 18 on the front end.

> 中文文档见 [README.zh-CN.md](README.zh-CN.md)（Chinese version: [README.zh-CN.md](README.zh-CN.md)）

**License:** MIT — see [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md) (the code is licensed, the name and logo are not).

---

## Table of contents

1. [What it is](#1-what-it-is)
2. [Features](#2-features)
3. [Tech stack](#3-tech-stack)
4. [Repository layout](#4-repository-layout)
5. [Run it locally](#5-run-it-locally)
6. [Configuration](#6-configuration)
7. [API overview](#7-api-overview)
8. [Content moderation](#8-content-moderation)
9. [The SE edition](#9-the-se-edition)
10. [Deployment](#10-deployment)
11. [Security](#11-security)
12. [Contributing](#12-contributing)
13. [Documentation index](#13-documentation-index)

---

## 1. What it is

KitterHub is a community site for teenagers who create things with code. Members publish works, write posts, join studios, chat, earn XP and badges, and take part in governing the community itself.

It was built and run in production for a period and is published here as a complete, self-contained project: the API, the web client, a no-framework edition for very old browsers, the moderation system, and the documentation needed to run all of it.

This repository contains **no user data**, no server configuration, and no credentials.

## 2. Features

### 2.1 Works

Members publish Scratch/Kitten projects with a cover, description and tags. Works can be played inline, liked, favourited, commented on, and collected into series. Every work has a detail page with playback, stats, and comments.

### 2.2 Forum

Threads with categories, rich text bodies, images, likes, bookmarks, comments, and pinned/official posts. Category feeds are paginated and sortable.

### 2.3 Studios

Collaborative groups with members, roles, works, announcements and their own feeds.

### 2.4 Chat

One-to-one and group conversations over WebSocket, with message history, read state, and image attachments. Chat can be switched off entirely by configuration, in which case the REST endpoints answer 503 and socket events are dropped while notifications keep working.

### 2.5 Notifications

A unified notification feed for likes, favourites, comments, follows, mentions, moderation actions and system messages, with an unread count, mark-as-read, and mark-all-read.

### 2.6 XP, levels and badges

Members earn XP from publishing, commenting and taking part. Levels LV0–LV7 are derived from XP with badge artwork per level. A dedicated XP centre shows history and progress.

### 2.7 Accounts and security

Local accounts with hashed passwords and JWT sessions, email registration with verification codes, password reset, GitHub OAuth login and account binding, login history, and per-user blocks. Administrators can review accounts, reset passwords, and ban or unban users.

### 2.8 Sensitive words and reports

Every submission — work, post, comment — is checked against the sensitive-word list before it becomes visible. A hit is queued for review and hidden in the meantime. Any member can report content; reports are queued, counted, and can auto-hide content once a threshold is reached.

### 2.9 Discipline committee

Members above a level threshold can apply to become committee members. Committee members work through a patrol queue, can hide content and escalate it to administrators for a final decision, and take part in votes: **enough "no violation" votes restore hidden content automatically**. Every action is written to an audit log and can be reviewed or reversed by an administrator.

### 2.10 Admin console

A complete back office: dashboard, works and post moderation queues, the reports desk, the sensitive-word desk, user management, storage quotas, recycle bin, featured content, committee overview, passport/identity review, announcements, and switches.

### 2.11 Internationalisation and theming

Every string exists in both Chinese and English (`frontend/src/i18n/dict/*.js`), with a parity check in `.forensics/check_i18n_parity.mjs`. Material 3 design tokens drive light and dark themes, and the theme follows the system by default.

### 2.12 The SE edition

`frontend-se/` is a second, deliberately minimal client: no framework, ES5 only, almost no CSS. It builds to a single IIFE bundle that runs in browsers as old as IE11, and it is not read-only — signing in, commenting, liking and favouriting all work. It has no creation tools.

### 2.13 Everything else

Email delivery over SMTP or Resend, offline IP-geolocation, storage quotas per user, image proxying with an allow-list, a small static-site hosting feature (KitterHub Pages), cloud variables for Scratch projects, and a proxy for the PickCat community API.

## 3. Tech stack

| Layer | Choices |
|---|---|
| Front end | React 18, Vite, `@material/web`, Material 3 design tokens, plain CSS variables |
| SE edition | No framework, ES5, built with Vite lib mode to an IIFE bundle |
| Back end | FastAPI, Starlette, SQLAlchemy (ORM), SQLite, Pydantic |
| Auth | JWT bearer tokens, hashed passwords, optional GitHub OAuth |
| Realtime | python-socketio over WebSockets |
| Email | SMTP or Resend (choose one) |
| Deploy | nginx + systemd on a single Linux host |

There is **no build step for the back end** and **no container requirement**. One host, one SQLite file, one nginx.

## 4. Repository layout

```
KitterHubOpenProject/
├── backend/                 FastAPI application
│   ├── app/
│   │   ├── main.py          application factory, router mounting, socket app
│   │   ├── config.py        all settings, read from environment variables
│   │   ├── models.py        SQLAlchemy models
│   │   ├── schemas.py       Pydantic request/response schemas
│   │   ├── serializers.py   shared response shaping
│   │   ├── database.py      engine, session factory, create_all
│   │   ├── committee*.py    discipline committee
│   │   ├── sensitive.py     sensitive-word matching
│   │   ├── storage_quota.py per-user storage accounting
│   │   └── routers/         one module per API area
│   ├── run.py               development / production entry point (uvicorn)
│   ├── requirements.txt     dependencies
│   └── .env.example         every setting, documented
├── frontend/                React client
│   ├── src/
│   │   ├── pages/           one directory per page
│   │   ├── components/      shared components
│   │   ├── styles/global.css  design tokens and all shared CSS
│   │   └── i18n/dict/       zh + en strings
│   └── vite.config.js
├── frontend-se/             the ES5 / IE11 edition
├── deploy/                  example nginx and systemd configuration
└── docs/                    architecture, API, database, moderation, security, FAQ
```

## 5. Run it locally

Requirements: **Python 3.10+**, **Node.js 18+**.

### Back end

```bash
cd backend
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

cp .env.example .env
# Edit .env: NIMAO_SECRET_KEY is the only required value.
python -c "import secrets; print(secrets.token_urlsafe(48))"

python run.py                 # http://127.0.0.1:8000
```

The SQLite database and all tables are created automatically on first start. If `NIMAO_SECRET_KEY` is missing, too short, or still a placeholder, **the application refuses to start** — that is deliberate.

Useful while developing:

```bash
NIMAO_DOCS=1                # exposes /docs, /redoc, /openapi.json
NIMAO_EMAIL_CODE_ECHO=1     # returns email verification codes in the API response
```

### Front end

```bash
cd frontend
npm install
echo "VITE_API_URL=http://127.0.0.1:8000/api" > .env.local
npm run dev                   # http://localhost:5173
```

The database starts empty: register an account, then promote it if you need the admin console:

```bash
cd backend
python - <<'PY'
import sqlite3
c = sqlite3.connect("nimao.db")
c.execute("update users set role='admin' where id=1")
c.commit()
PY
```

### SE edition

```bash
cd frontend-se
npm install
npm run build                 # produces dist/app.js (ES5, IIFE) + dist/index.html
```

## 6. Configuration

Everything is environment-driven; real environment variables win over `.env`. See [`backend/.env.example`](backend/.env.example) for the annotated list and [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the reference table.

The short version:

| Variable | Required | Purpose |
|---|---|---|
| `NIMAO_SECRET_KEY` | **yes** | JWT signing / encryption. At least 32 characters. |
| `NIMAO_DATABASE_URL` | no | Defaults to `sqlite:///…/nimao.db` |
| `NIMAO_SITE_URL` | no | Public site URL, used in canonical links and OAuth callbacks |
| `NIMAO_DOCS` | no | `1` exposes the OpenAPI docs (keep `0` in production) |
| `NIMAO_GITHUB_CLIENT_ID` / `_SECRET` | no | Enables GitHub login/binding |
| `NIMAO_SMTP_*` or `NIMAO_RESEND_API_KEY` | no | Email delivery; without either, email endpoints explain what is missing |
| `NIMAO_CHAT_ENABLED` | no | `0` switches chat off |
| `NIMAO_MAX_UPLOAD_SIZE`, `NIMAO_MAX_VIDEO_SIZE`, … | no | Upload limits |

## 7. API overview

All endpoints live under `/api`. Authentication is a bearer JWT: `Authorization: Bearer <token>`.

| Area | Prefix | Examples |
|---|---|---|
| Auth | `/api/auth` | register, login, refresh, logout, GitHub OAuth, email codes |
| Users | `/api/users` | profile, followers, following, blocks, avatar |
| Works | `/api/works` | create, update, list, detail, comments, likes |
| Posts | `/api/posts` | forum threads, comments, likes, bookmarks |
| Studios | `/api/studios` | create, members, works, announcements |
| Chat | `/api/chat` | conversations, history, send (WebSocket at `/socket.io`) |
| Notifications | `/api/notifications` | list, unread count, mark read |
| Search | `/api/search` | works, posts, users, combined |
| Admin | `/api/admin` | moderation queues, reports, users, stats, switches |

[docs/API.md](docs/API.md) contains the full endpoint index and [docs/public-api.md](docs/public-api.md) documents the two endpoints intended for external callers.

## 8. Content moderation

Three layers, all reversible, all audited:

1. **Before publication** — the sensitive-word list is applied to every work, post and comment. A hit is queued into the review database and hidden from public view until reviewed.
2. **Reports** — any member can report content. Reports are counted per target; enough reports hide the content automatically. Reporter history (including dismissed reports) is kept so abusive reporting can be recognised.
3. **Community review** — committee members work a patrol queue, can hide content and escalate it, and vote. Enough "no violation" votes restore the content automatically. Administrators can always override, restore, or reverse any decision.

Every transition is written to an audit log with the actor, the reason and the timestamp. The full rules — and the parts that are designed but not merged into this version — are documented in [docs/MODERATION.md](docs/MODERATION.md).

## 9. The SE edition

`frontend-se/` exists because a meaningful share of the audience browses on old devices. It is intentionally extreme:

- **ES5 only.** Verified by parsing the built bundle with `acorn` at `ecmaVersion: 5`, not by keyword blacklists.
- **IIFE, no modules.** Rollup's `Symbol.toStringTag` injection alone is enough to break IE11, so `generatedCode.symbols` and friends are switched off.
- **Almost no CSS**, no framework, no polyfills.
- **Not read-only.** Sign in, comment, like and favourite all work. There are no creation tools.

## 10. Deployment

The production shape is one Linux host running nginx and a systemd service, with SQLite on local disk. [deploy/](deploy/) contains an annotated nginx site configuration and a systemd unit to start from — all domains are written as `example.com`.

```bash
# back end
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
NIMAO_SECRET_KEY=… python run.py       # or let systemd inject the environment

# front end
cd frontend && npm ci && npm run build  # then serve dist/ from nginx
```

Two things worth doing on day one: put the application behind HTTPS, and keep `backend/private/` (identity documents) **out of anything nginx serves**.

## 11. Security

- Secrets live only in environment variables — never in the repository. `.env` is ignored by git.
- Passwords are hashed; JWTs are signed with `NIMAO_SECRET_KEY`.
- Admin endpoints are guarded by a role check, and admin actions are logged.
- Uploads are size-limited per type and image URLs are checked against an allow-list.
- This export was scrubbed: no keys, no tokens, no databases, no real user data, no server paths. See [docs/SECURITY.md](docs/SECURITY.md).

If you find a security problem, please report it privately — see [docs/SECURITY.md](docs/SECURITY.md) (the contact address there is a placeholder you should replace in your own deployment).

## 12. Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first; by taking part you agree to the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

House rules that are not negotiable in this codebase: no emoji as UI icons, rectangular 12px corners (pills only for chips, progress and switches), no external font services, and no horizontal scrolling from 320px to 1920px.

## 13. Documentation index

| Document | Contents |
|---|---|
| [README.zh-CN.md](README.zh-CN.md) | This README, in Chinese |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit together |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Working on the code, adding pages and endpoints, i18n |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable |
| [docs/API.md](docs/API.md) | Endpoint index |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables and relationships |
| [docs/MODERATION.md](docs/MODERATION.md) | Moderation rules, including what is not merged yet |
| [docs/SECURITY.md](docs/SECURITY.md) | Security practices and reporting |
| [docs/FAQ.md](docs/FAQ.md) | Common questions |
| [deploy/README.md](deploy/README.md) | Example nginx and systemd configuration |
| [backend/README.md](backend/README.md) | Back-end specifics |
| [frontend/README.md](frontend/README.md) | Front-end specifics |
| [frontend-se/README.md](frontend-se/README.md) | SE edition specifics |

> The `docs/` files are currently written in Chinese; English versions are being added alongside them as `*.md` (English) and `*.zh-CN.md` (Chinese).
