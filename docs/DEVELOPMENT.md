# Development

> 中文版: [DEVELOPMENT.zh-CN.md](DEVELOPMENT.zh-CN.md)

## Getting a working local copy

```bash
# back end
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                       # then set NIMAO_SECRET_KEY
NIMAO_DOCS=1 NIMAO_EMAIL_CODE_ECHO=1 python run.py      # http://127.0.0.1:8000

# front end
cd ../frontend
npm install
echo "VITE_API_URL=http://127.0.0.1:8000/api" > .env.local
npm run dev                                # http://localhost:5173
```

Tables are created on first start and the database begins empty. To reach the admin console, register a normal account and promote it:

```bash
cd backend
python - <<'PY'
import sqlite3
c = sqlite3.connect("nimao.db")
c.execute("update users set role='admin' where id=1")
c.commit()
PY
```

## Adding an API endpoint

1. Find the right module in `backend/app/routers/` (or create one and mount it in `app/main.py`).
2. Add the request/response models to `app/schemas.py`.
3. Take a session through the dependency: `def handler(..., db: Session = Depends(get_db))`. **Never** open a session by hand inside a handler.
4. Read configuration from `app/config.py`, not from `os.environ`.
5. Return a schema, not an ORM object.
6. Check `/docs` (with `NIMAO_DOCS=1`) to see the generated signature.

## Adding a front-end page

1. Create `frontend/src/pages/MyPage.jsx`.
2. Register the route in `frontend/src/App.jsx`.
3. Add strings to the relevant file in `frontend/src/i18n/dict/` — **both** `zh` and `en`.
4. Run the parity check:

```bash
node .forensics/check_i18n_parity.mjs     # must report 0 gaps
```

5. Style with design tokens only. Check 320 / 390 / 768 / 1366 / 1920 px.

## Internationalisation

Dictionaries are plain objects with `zh` and `en` exports; components read them through `useI18n()` and `t('key')`. A key present in one language and missing in the other fails the parity check, which is treated as a broken build.

## Working on the SE edition

The SE edition must stay ES5. The acceptance test is a parse, not an opinion:

```bash
cd frontend-se
npm run build
node .forensics/verify/ie_check.mjs       # acorn.parse(bundle, { ecmaVersion: 5 })
```

Three traps that have already broken this build once:

- Vite emitting `<script type="module">` — IE never runs it. The build uses lib mode and IIFE output.
- Rollup injecting `Object.defineProperty(exports, Symbol.toStringTag, …)` — IE11 has no `Symbol`. Fixed by `output.generatedCode.symbols: false` and friends.
- esbuild rewriting `'a' + b` into a template literal. Fixed by `target: 'es5'` plus terser with `ecma: 5`.

Also: CSS for the SE edition is a static file in `frontend-se/public/`. Lib mode does not bundle CSS referenced from HTML.

## Database changes

- Back up first, with the timestamp in the filename.
- Rehearse the migration on a **copy** of the database, including `PRAGMA foreign_key_check`.
- Make migration scripts re-runnable (check whether the column already exists).
- Remember that SQLite reuses the largest deleted rowid unless the primary key is `AUTOINCREMENT`. If any table stores foreign ids for display, that matters.

## Mistakes that have cost real downtime

| Symptom | Cause | Fix |
|---|---|---|
| Every request times out after 30s | Connection pool exhausted by a session that was never closed | Return sessions through the dependency; add `pool_pre_ping` and `pool_recycle`; restart to recover |
| `/assets/*.css` 404, `/blog/` 403 after a deploy | Files copied with restrictive permissions | `chmod -R a+rX` on the web root |
| Page renders but no data | The client was opened over `file://` instead of a web server | Serve it over HTTP |
| Deploy "succeeds" but nothing changed | The static asset was cached by URL | Version the asset URL or hard-reload |

## Before opening a pull request

- `npm run build` (front end) and `ast.parse` (back end) both pass.
- `node .forensics/check_i18n_parity.mjs` reports 0 gaps.
- No secrets, no database files, no real user data in the diff.
