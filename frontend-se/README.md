# SE edition

> 中文版: [README.zh-CN.md](README.zh-CN.md)

A second, deliberately primitive client: **no framework, ES5 only, almost no CSS**. It exists so that people on very old devices — including IE11 — can still read and take part.

## What it is and is not

**It is not read-only.** Signing in, browsing, commenting, liking and favouriting all work.

**It is minimal on purpose.** No creation tools, no admin console, no rich editor. If you need those, use the main client.

## Build

```bash
npm install
npm run build        # writes dist/index.html, dist/app.js and dist/style.css
```

The build is **Vite lib mode emitting an IIFE**, with `target: 'es5'`, terser at `ecma: 5`, and `modulePreload: false`. CSS is a static file in `public/` — lib mode does not bundle CSS referenced from HTML.

## The acceptance test

Do not judge ES5 compatibility by eye, and do not grep for banned keywords. Parse the artefact:

```bash
npm run build
node ../.forensics/verify/ie_check.mjs      # acorn.parse(bundle, { ecmaVersion: 5 })
```

If that parse fails, an old browser will fail too.

## Three traps that already broke this build

1. **`<script type="module">`** — IE never executes it, and the page just sits there. Fixed by lib mode + IIFE output.
2. **Rollup injecting `Object.defineProperty(exports, Symbol.toStringTag, …)`** — IE11 has no `Symbol`, so the bundle throws on load. Fixed with:
   ```js
   output: {
     generatedCode: {
       symbols: false, constBindings: false, arrowFunctions: false,
       objectShorthand: false, reservedNamesAsProps: false,
     },
   }
   ```
3. **esbuild rewriting `'a' + b` into a template literal** — template literals are not ES5. Fixed by keeping `target: 'es5'` and minifying with terser rather than esbuild.

## Layout

```
src/
  app.js        boot, routing, auth state, top bar
  api.js        XHR helpers (no fetch, no promises where avoidable)
  dom.js        small DOM helpers
  router.js     hash-free path routing
  prefs.js      local preferences (preview mode, page size, images)
  md.js         minimal markdown renderer for forum content
  img.js        image toggling
  views/        one file per screen (home, forum, works, post, work, user, search, login, settings, notifications)
public/
  index.html    hand-written shell, plain <script src="/app.js">
  style.css     the entire stylesheet
```

## Notes

- Requests go through XHR rather than `fetch`, and the JSON parse does not trust `Content-Type`.
- The token lives in `localStorage`; a 401 is surfaced as "please sign in".
- Image display can be toggled off, which matters on slow connections.
- The player degrades automatically on Trident/MSIE: it shows a click-to-open link instead of an inline embed.
