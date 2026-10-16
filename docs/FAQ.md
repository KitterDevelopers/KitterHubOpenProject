# FAQ

> 中文版: [FAQ.zh-CN.md](FAQ.zh-CN.md)

## General

**What is this?**
A complete community platform for young creators: works, forum, studios, chat, notifications, XP levels and content moderation. It is the code behind a site that actually ran in production, published with no user data.

**Why is there no demo site?**
The project it came from has stopped running at full capacity. Run it locally — it takes a few minutes (see the [README](../README.md)).

**Can I use it commercially?**
Yes. The code is MIT licensed: use, modify, sell, ship it closed-source. The name and logo are **not** licensed — see [TRADEMARK.md](../TRADEMARK.md).

**Is there a hosted version I can just sign up to?**
No. This is the software, not a service.

## Running it

**What do I need?**
Python 3.10+ and Node.js 18+. No database server, no Docker.

**It refuses to start and mentions the secret key.**
`NIMAO_SECRET_KEY` is mandatory and must be at least 32 characters and not a placeholder. Generate one:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

This is deliberate: refusing to start is better than signing sessions with a weak key.

**The database is empty and there is no admin account.**
Tables are created automatically on first start, but no administrator is seeded. Register normally and promote that account:

```sql
update users set role = 'admin' where id = 1;
```

(The password column is `hashed_password`; if you scripted a column called `password_hash`, that is why nothing happened.)

**How do I see the API reference?**
Start with `NIMAO_DOCS=1` and open `/docs`. Keep it off in production.

**Registration fails because it cannot send email.**
Configure either SMTP (`NIMAO_SMTP_*`) or Resend (`NIMAO_RESEND_API_KEY`). For local work, set `NIMAO_EMAIL_CODE_ECHO=1` so the code comes back in the API response instead of being mailed.

**The front end loads but every request fails.**
It is being served from `file://`, or it has no API base URL. Use a real HTTP server, and set `VITE_API_URL` in `frontend/.env.local` for local development.

## Architecture

**Why SQLite?**
One host, one tenant. Backups are a file copy, and there is no server to operate. If you outgrow it, the SQLAlchemy layer means moving to PostgreSQL is mostly a connection string — but the raw SQL in migrations would need review.

**Why are there two front ends?**
A meaningful share of the audience browses on old devices. The SE edition is ES5, framework-free and runs as far back as IE11. The main client is a modern React app.

**Can the SE edition create content?**
No, on purpose. Signing in, commenting, liking and favouriting all work; creation does not.

**Why do reviews have both `status` and `review_state`?**
`status` is the older column; the committee work added `review_state` and `source`, which distinguish *why* something is pending. New code should use the newer pair — see [DATABASE.md](DATABASE.md).

## Contributing

**How do I add a language?**
Add the locale to the dictionary files under `frontend/src/i18n/dict/` and to the language switcher. Keep the key sets identical; the parity check (`node .forensics/check_i18n_parity.mjs`) must report 0 gaps.

**How do I add a page or an endpoint?**
See [DEVELOPMENT.md](DEVELOPMENT.md) — both are a short, mechanical procedure.

**The build fails on an i18n key.**
That is the parity check working: a key exists in one language and not the other. Add the missing string rather than deleting the check.

**Something in the SE build passes locally but breaks in a real old browser.**
Run the ES5 acceptance check: `node .forensics/verify/ie_check.mjs` parses the built bundle with `acorn` at `ecmaVersion: 5`. If that fails, the browser will fail too.

## Operations

**How do I deploy?**
nginx + systemd on one host, as shown in [deploy/](../deploy/). Put TLS in front, keep the application port on localhost.

**How do I back up?**
Copy the SQLite file (or use `sqlite3 .backup`), plus the uploads directory. Then actually restore one somewhere and start the app — a backup you have never restored is a guess.

**Everything started timing out at once.**
Almost certainly the database connection pool. A request that failed to return its session exhausts the pool and every later request waits for a connection until it times out. Restart to recover, then find the handler that opens a session outside the `get_db` dependency.

**A deploy reported success but the browser shows the old site.**
The static asset was cached by URL. Version the asset filename or query string, then hard-reload.
