# Back end

> 中文版: [README.zh-CN.md](README.zh-CN.md)

The FastAPI application behind `/api`. One process, one SQLite file, no queue, no cache server.

## Requirements

- **Python 3.10+** (3.11 or 3.12 recommended)
- A writable directory for the database, uploads and any user-hosted static sites

## Install and run

```bash
python -m venv .venv
. .venv/bin/activate                  # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

cp .env.example .env                  # the only required value is NIMAO_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"

python run.py                         # http://127.0.0.1:8000
```

`run.py` starts uvicorn against `app.main:socket_app`, bound to `127.0.0.1:8000`, with `proxy_headers=True` and `forwarded_allow_ips="127.0.0.1"` so that logs, rate limits and audits see the real client address when nginx is in front.

Useful while developing: `NIMAO_DOCS=1` (exposes `/docs`) and `NIMAO_EMAIL_CODE_ECHO=1` (returns verification codes in the response instead of sending mail).

## Key dependencies

| Package | Used for |
|---|---|
| `fastapi`, `uvicorn[standard]` | HTTP application and server |
| `sqlalchemy` | ORM and session management |
| `pydantic` | Request/response validation |
| `python-socketio` | Realtime chat and notifications |
| `python-multipart` | File uploads |
| `python-dotenv` | Reading `backend/.env` in development |
| `passlib`/`bcrypt` or equivalent | Password hashing |

## Layout

```
app/
  main.py            application assembly, router mounting, socket app, middleware
  config.py          every setting, read once from the environment
  database.py        engine, session factory, create_all on start
  models.py          SQLAlchemy models (the schema)
  schemas.py         Pydantic request/response models
  serializers.py     shared response shaping
  routers/           one module per API area
  committee*.py      discipline committee
  sensitive.py       sensitive-word matching
  storage_quota.py   per-user storage accounting
  pages_sites.py     user-hosted static sites
  imageurl.py        image URL allow-list
run.py               entry point
requirements.txt
.env.example         every setting, documented
```

## Rules that keep it running

- **Never open a database session by hand inside a handler.** Use `Depends(get_db)`. A session that is not returned to the pool exhausts it and every later request times out — this has taken the whole site down before.
- **Never read `os.environ` in a router.** Add the setting to `config.py`.
- **Never return ORM objects.** Return Pydantic schemas so the response shape is explicit.
- **Mount routers in `main.py` only.**
- Migrations: back up first, rehearse on a copy, make the script re-runnable, run `PRAGMA foreign_key_check` afterwards.

## Database notes

- Tables are created automatically (`Base.metadata.create_all`); the file starts empty and **no administrator account is seeded**, so promote one yourself:
  ```sql
  update users set role = 'admin' where id = 1;
  ```
- The password column is **`hashed_password`**, and the "has a local password" flag is **`local_pwd_set`**. Scripts that write to a guessed column name fail silently.
- `works` and `posts` use `AUTOINCREMENT` on purpose: otherwise SQLite reuses the id of the largest deleted row and corrupts anything that stored that id.
- See [../docs/DATABASE.md](../docs/DATABASE.md) for the important tables.

## Email

Two providers, pick one: SMTP (`NIMAO_SMTP_*`) or Resend (`NIMAO_RESEND_API_KEY`). With neither configured, the email endpoints answer with an explicit configuration error rather than failing silently. `NIMAO_EMAIL_CODE_ECHO` and `NIMAO_EMAIL_FIXED_CODE` are development-only — never enable them where real users register.

## Security reminders

- `NIMAO_SECRET_KEY` is mandatory, at least 32 characters, and never committed.
- Identity documents live under `private/` and **must not** be served by the web server.
- Keep `NIMAO_DOCS=0` in production.
- See [../docs/SECURITY.md](../docs/SECURITY.md).
