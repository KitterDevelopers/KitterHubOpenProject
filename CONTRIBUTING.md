# Contributing to KitterHub

> 中文版: [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)

Thanks for wanting to help. This document is short on purpose.

## Ground rules

- Be decent to other people. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Never** commit secrets. Keys, tokens, passwords and connection strings belong in environment variables only. `.env` is git-ignored — keep it that way.
- **Never** commit user data. No database files, no exports, no screenshots containing real nicknames, avatars, email addresses or admin panels with live data.
- One change per pull request. If you fix a bug and reformat a file, that is two pull requests.

## House style

These are not preferences, they are how the project looks:

| Rule | Detail |
|---|---|
| Corners | Rectangles use `var(--radius)` (12px). Pills/999px only for chips, badges, progress bars and switch tracks. |
| Colour | Always through the design tokens (`--md-sys-color-*`). Never a hard-coded hex in a component. |
| Icons | No emoji in the UI. Use inline SVG or the existing icon components. |
| Fonts | No external font services. System font stack only. |
| Layout | No horizontal scrolling from 320px to 1920px. Tap targets at least 44px. |
| Images | Set the height, let the width follow (`height: Npx; width: auto`). Forcing both distorts non-square images. |
| Text | Every user-visible string exists in **both** Chinese and English. |

## Text and translations

Strings live in `frontend/src/i18n/dict/*.js` as paired `zh` and `en` exports. After touching any dictionary file, run:

```bash
node .forensics/check_i18n_parity.mjs
```

The check must report **0 gaps**. A missing English string is a failing build, not a cosmetic issue.

## Back end

- FastAPI routers live in `backend/app/routers/`, one module per area.
- Read settings through `app/config.py`; do not read `os.environ` directly in a router.
- Wrap database access in the `get_db` dependency. Do not create engines or sessions inside request handlers — a leaked session exhausts the connection pool and takes the whole site down.
- Return Pydantic schemas, not raw ORM objects.
- Add a router only through `app/main.py`.

## Front end

- One directory per page under `frontend/src/pages/`.
- Shared components go in `frontend/src/components/`; shared CSS goes in `frontend/src/styles/global.css`.
- Never use raw `<button>` where an existing Material Web wrapper exists.
- Verify at 320px, 390px, 768px, 1366px and 1920px before opening a pull request.

## The SE edition

`frontend-se/` must stay runnable on very old browsers. The acceptance test is mechanical, not a judgement call:

```bash
cd frontend-se && npm run build
node .forensics/verify/ie_check.mjs    # parses the bundle with acorn at ecmaVersion 5
```

If that parse fails, the change is wrong — no matter how modern the browser you tested it in.

## Commits and pull requests

- Commit messages: `area: what changed`, for example `backend: fix report counters` or `docs: add English FAQ`.
- Describe **why** in the pull request body, and say how you verified it.
- Include the command you ran and its observable result (a status code, a count, a screenshot). "Looks fine" is not verification.

## Reporting problems

- Bugs and feature ideas: open an issue with steps to reproduce.
- Security problems: do not open a public issue. See [docs/SECURITY.md](docs/SECURITY.md).

## License

By contributing you agree that your work is released under the MIT license, see [LICENSE](LICENSE). The project name and logo are not covered by that license — see [TRADEMARK.md](TRADEMARK.md).
