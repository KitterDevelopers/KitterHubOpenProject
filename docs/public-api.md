# Public API

> 中文版: [public-api.zh-CN.md](public-api.zh-CN.md)

A small set of endpoints under `/api/public/*` is meant for callers outside the site itself. They require no authentication, they are read-only, and they are deliberately small — everything else lives behind a session.

Because these are the endpoints other people will code against, their **field-level contract is generated from the Pydantic response schemas**. Run the application with `NIMAO_DOCS=1` and read `/openapi.json` (or `/docs`) for the authoritative shape; this page only explains the shape of the agreement.

## Guarantees

- **No authentication required**, and no cookies or tokens are read.
- **Read-only.** There is no public write endpoint.
- **Stable field names.** Fields are added, not renamed. If a field must change, it is added alongside the old one and the old one is deprecated first.
- **Explicit pagination.** List responses accept `skip` and `limit` and return the items; ask for the total separately if you need it.
- **UTC timestamps**, ISO-8601 formatted.
- **JSON only**, UTF-8.

## Absolute URLs

Responses that contain links build them from `NIMAO_PUBLIC_BASE_URL` when it is set. When it is empty, the base is inferred from the incoming request host — which is convenient on a laptop and wrong behind a proxy if the header is not forwarded. **In production, set `NIMAO_PUBLIC_BASE_URL` explicitly.**

## Errors

Errors are JSON with a `detail` field, using ordinary status codes: `400` for a bad request, `404` for a missing resource, `429` when a rate limit is configured and exceeded, `503` when a subsystem is switched off.

## Rate limits

If `NIMAO_LIMIT_RATE` is enabled, public endpoints are subject to the same per-IP limit as the rest of the site (`NIMAO_RATE_LIMIT`, default 300 per minute). Cache responsibly: these endpoints hit the database.

## Example

```bash
curl -s "https://example.com/api/public/..." -H 'Accept: application/json'
```

Exact paths and response examples belong in the generated OpenAPI document, not in a hand-written markdown file that drifts away from the code. If you are integrating this project and something in `/openapi.json` is unclear, open an issue — the fix is better schema documentation, which benefits everyone.
