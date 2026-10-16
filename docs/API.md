# API Index

> 中文版: [API.zh-CN.md](API.zh-CN.md)

Every endpoint is served under `/api`. Authentication is a bearer JWT unless stated otherwise:

```
Authorization: Bearer <access_token>
```

Get a token with `POST /api/auth/login`. With `NIMAO_DOCS=1` the generated reference is available at `/docs` (Swagger UI) and `/openapi.json` — that output is always authoritative for field-level details; this page is the map, not the territory.

## Auth — `/api/auth`

Registration and sessions: `POST /register`, `POST /login`, `POST /logout`, `POST /refresh`, `GET /me`. Email flow: request a code, verify it, register, reset a password. GitHub flow: `GET /github/authorize`, `GET /github/callback`, plus binding and unbinding for an existing account.

## Users — `/api/users`

Profiles (`GET /{uid}`), self update, avatars, follow/unfollow, follower and following lists, blocks, login history, personal statistics, and account deletion requests.

## Works — `/api/works`

Publishing and editing works, cover and package upload, list and detail, play metadata, likes, favourites, comments, series, and per-user work listings. Submission goes through sensitive-word screening and may be queued for review.

## Posts and comments — `/api/posts`

Forum threads: create, edit, delete, list by category, detail, likes, bookmarks, pinning. Comments are addressed by target: creating, listing, editing, deleting and liking comments on both posts and works.

## Studios — `/api/studios`

Create and edit a studio, members and roles, join/leave requests, studio works, announcements, and studio feeds.

## Chat — `/api/chat`

Conversation list, message history, sending, read state, and the group-chat endpoints. Socket events are delivered over `/socket.io`. When `NIMAO_CHAT_ENABLED=0`, these REST endpoints answer **503** and chat socket events are dropped while notifications continue to work.

## Notifications — `/api/notifications`

List, unread count, mark one read, mark all read. Sources include likes, favourites, comments, follows, mentions, moderation outcomes and system messages.

## Search — `/api/search`

`GET /search` searches works, posts and users; there are also per-type search endpoints and a combined endpoint used by the search page. Public search requires no authentication.

## Discover — `/api/discover`

Home-page payload: featured works, recommended posts, latest submissions, followed-user activity, categories, and the banner list.

## XP, levels and badges — `/api/xp`

Current XP and level, XP history, the level table, badge ownership.

## Uploads and files — `/api/upload`

Image, video, Scratch package and passport uploads. Each has its own size limit (see `NIMAO_MAX_*`). Image URLs are validated against an allow-list before being stored.

## Public endpoints — `/api/public/*`

A small set of unauthenticated endpoints intended for external callers. Their field-level contract is documented in [public-api.md](public-api.md).

## Admin — `/api/admin`

Everything behind a role check, and every call is written to the audit log:

| Area | Examples |
|---|---|
| Dashboard | `/admin/stats` — users, works, posts, comments, pending queues, storage |
| Works | list, detail, approve, reject, hide, restore, feature, delete |
| Posts and comments | moderation lists, hide/restore, delete |
| Reports | `/admin/reports?status=pending` — target preview, report counts per target and per reporter, handle a report |
| Sensitive words | list, add/remove words, the review queue and its statistics |
| Users | list, detail, edit, ban/unban, reset password, storage quota, passport review, sensitive-word exemption |
| Committee | overview, applications, audit trail |
| Recycle bin | browse, restore, purge |
| System | switches, announcements, banners, maintenance toggles, logs |

## Conventions

- Successful deletes answer **204**; creations answer **201**.
- Errors are JSON with a `detail` field, in the user's language where a message is user-facing.
- Lists that can be paged accept `skip` and `limit`; some accept `with_total=true` to include a total count.
- Timestamps are UTC in the database and converted for display by the client.
