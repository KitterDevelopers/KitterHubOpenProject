# Security

> 中文版: [SECURITY.zh-CN.md](SECURITY.zh-CN.md)

## Reporting a vulnerability

Do **not** open a public issue. Contact the maintainers privately.

> ⚠️ The address shipped in this file is a placeholder: `security@example.com`. **Replace it with your own** before you publish a deployment — until you do, this repository has no working private reporting channel.

Please include: what you did, what happened, what you expected, and (if you have one) a minimal reproduction. You will get an acknowledgement as soon as a maintainer reads it.

## How this project handles secrets

- **Everything sensitive comes from environment variables.** The repository contains no keys, tokens, passwords or connection strings. `.env` is git-ignored; `.env.example` documents the names with empty values.
- **`NIMAO_SECRET_KEY` is mandatory** and must be at least 32 characters. The application refuses to start with a missing, short or placeholder value — that is a deliberate safeguard against shipping a weak signing key.
- **Never put a secret in a database row, a template, a log line or a commit message.** Rotate anything that has ever been committed; assume it is public.

## Authentication and authorisation

- Passwords are hashed before storage; the column is `hashed_password`. Verification uses a constant-time comparison.
- Sessions are JWTs signed with the secret key, with a configurable expiry (`NIMAO_TOKEN_EXPIRE`).
- Administrative routes require the `admin` role on the user record (`get_current_admin`). Role checks happen **per route**, not in the client.
- Email verification codes are stored with a purpose and an expiry, and the "echo the code in the response" switch is development-only.
- Login failures can be locked out with `NIMAO_LIMIT_LOGIN`; request rates can be limited with `NIMAO_LIMIT_RATE`.

## Uploads and files

- Each upload type has its own size ceiling (`NIMAO_MAX_UPLOAD_SIZE`, `NIMAO_MAX_VIDEO_SIZE`, `NIMAO_PASSPORT_MAX_SIZE`, `NIMAO_SCRATCH_MAX_SIZE`).
- Image URLs are validated against an allow-list before being stored, so a record cannot point at an arbitrary host.
- **Identity documents are the highest-risk files in the system.** They live under `backend/private/` and must never be reachable over HTTP. The example nginx configuration in `deploy/` repeats this warning in a comment — keep it there.
- User-hosted static sites are written under `NIMAO_PAGES_ROOT`. That directory is served; nothing private may ever be placed inside it.

## Deployment checklist

1. Serve everything over **HTTPS**; redirect HTTP to HTTPS.
2. Keep `NIMAO_DOCS=0` in production.
3. Leave `NIMAO_EMAIL_CODE_ECHO` and `NIMAO_EMAIL_FIXED_CODE` **empty**. With either set, anyone who can read an API response can register or take over an account.
4. Do not expose the back-end port publicly. Bind it to localhost and let nginx proxy to it.
5. Run the application as an unprivileged user with write access only to the database, the uploads directory and the pages root.
6. Set up database backups, and periodically **test a restore**.
7. Watch the connection pool: a request that never returns its session will exhaust it and take the site down. `pool_pre_ping` and `pool_recycle` help; monitoring active connections helps more.
8. Review the audit log after any incident.

## Third-party integrations

These are the external services this code can talk to. They are **integration targets, not project assets** — none of them are affiliated with this repository, and each needs your own credentials:

| Service | Used for | Needs |
|---|---|---|
| GitHub | OAuth login and account binding | An OAuth app (client id + secret) |
| SMTP provider (for example Aliyun enterprise mail) | Verification codes, password resets | Host, port, username, app password |
| Resend | The same, as an alternative to SMTP | An API key |
| Turbowarp | Playing Scratch projects in the page | Nothing (public embed URL) |
| PickCat community API | Optional avatar-tool proxy | Your own endpoint; see `NIMAO_PICKCAT_API_BASE` |
| An image CDN allow-list | Validating stored image URLs | The domains you actually use |

## What is deliberately not in this repository

The open-source export was scrubbed: no SSH keys, no API tokens, no administrator credentials, no databases, no real user content, no server paths and no infrastructure configuration. If you find something that looks like any of those, treat it as a security report and say so privately — it was a mistake.
