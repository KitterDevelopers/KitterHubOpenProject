# Changelog

> 中文版: [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md)

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — first open-source release

### Included

- **Back end** — FastAPI application with JWT authentication, email registration, GitHub OAuth, works, posts and comments, studios, chat over WebSockets, notifications, search, XP and levels, storage quotas, an admin API, and the discipline committee.
- **Front end** — React 18 + Vite client covering works, forum, studios, chat, notifications, XP centre, account and appearance settings, the admin console, and full Chinese/English localisation.
- **SE edition** — a no-framework ES5 client that builds to a single IIFE bundle and runs in browsers as old as IE11. Signing in, commenting, liking and favouriting work; there are no creation tools.
- **Content moderation** — sensitive-word screening before publication, a report queue with a hide threshold, the committee patrol and voting flow, and an audit log for every action.
- **Deployment examples** — annotated nginx site configuration and a systemd unit under [`deploy/`](deploy/).
- **Documentation** — architecture, development, configuration, API index, database reference, moderation rules, security notes and an FAQ, in English with Chinese alongside.

### Not included

- **Discipline-committee examination and terms of office.** The rules for sitting an exam to join the committee, 100-question bank sampling, 60-day terms, and single-vote hiding exist as a design and as staged code, but they are **not merged into this version** and are not part of this release. The running committee behaviour is: apply at the required level, administrator approval, patrol queue, hide-and-escalate, and automatic restore once enough "no violation" votes are cast. See [docs/MODERATION.md](docs/MODERATION.md).
- **User data, credentials and infrastructure.** No databases, no API keys, no server configuration, no deployment scripts that reference a real host.

### Notes for anyone deploying this

- The bug-report address in [docs/SECURITY.md](docs/SECURITY.md) is a placeholder. Replace it before publishing your own deployment.
- `NIMAO_SECRET_KEY` is the only mandatory setting. The application refuses to start without a proper value.
