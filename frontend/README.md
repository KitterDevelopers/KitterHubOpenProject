# Front end

> 中文版: [README.zh-CN.md](README.zh-CN.md)

The main web client: React 18, Vite, and Material Web components, with all styling driven by design tokens.

## Requirements

Node.js 18+ and npm.

## Install and run

```bash
npm install

# point the client at a local API
echo "VITE_API_URL=http://127.0.0.1:8000/api" > .env.local

npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
```

In a production build the API base is the relative path `/api`, so the client and the API must be served from the same origin (nginx does this in the reference deployment).

## Layout

```
src/
  App.jsx                routes, layout shell, global providers
  main.jsx               entry point
  pages/                 one directory per page (works, forum, studios, chat, settings, admin, …)
  components/            shared components
  context/               auth and other React contexts
  i18n/                  the translation layer and dict/ dictionaries
  styles/global.css      every design token and all shared CSS
  api/                   HTTP client and API base resolution
```

## Text and translation

Every user-visible string lives in `src/i18n/dict/*.js` as a pair of `zh` and `en` exports and is read through `t('some.key')`. After touching any dictionary:

```bash
node .forensics/check_i18n_parity.mjs
```

It must print **0 gaps**. A one-sided key is a broken build, not a warning.

## Design rules

These are enforced by review, not by tooling, so please check them before opening a pull request:

| Rule | Detail |
|---|---|
| Colour | Only through tokens (`--md-sys-color-*`). No literal hex in a component. |
| Corners | `var(--radius)` (12px) rectangles. Pills only for chips, badges, progress and switch tracks. |
| Icons | No emoji. Inline SVG or the existing icon components. |
| Fonts | No external font services — the system stack only. |
| Layout | No horizontal scrolling between 320px and 1920px; tap targets at least 44px. |
| Images | `height: Npx; width: auto`. Setting both distorts non-square art. |
| Motion | Transitions are fine; they must not move layout or leave an element in a new resting position. Respect `prefers-reduced-motion`. |

## Talking to the API

All requests go through the shared client in `src/api/`. Do not build URLs by hand inside a page. The base URL resolves in this order: `VITE_API_URL` → a development default → the relative `/api` path in production.

Authentication is a JWT kept by the auth context and sent as `Authorization: Bearer <token>`.

## Building and deploying

```bash
npm run build
# dist/ now contains index.html and assets/index-*.{js,css}
```

Copy `dist/index.html` and the hashed files from `dist/assets/` to the web root, then reload nginx. Two things that have bitten us:

- **Version the asset URL.** Browsers cache `assets/index-abc.js` by URL; if the filename does not change, users keep the old bundle. Vite's hashed filenames handle this — do not disable them.
- **Serve over HTTP, not `file://`.** Opening `dist/index.html` directly breaks API calls and dynamic imports.

## Common problems

| Symptom | Cause |
|---|---|
| Blank page, no requests in the network tab | Opened over `file://`, or the API base points nowhere |
| Everything 401s | Token missing or expired; check the auth context |
| i18n check fails | A key exists in one language only — add the missing string |
| Old UI after a deploy | Cached bundle; check that the asset hash changed |
