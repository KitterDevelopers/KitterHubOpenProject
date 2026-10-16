# Database

> 中文版: [DATABASE.zh-CN.md](DATABASE.zh-CN.md)

The store is a single SQLite file created automatically on first start (`Base.metadata.create_all`). There are roughly fifty tables; this page covers the ones you actually need to understand. The model definitions in `backend/app/models.py` are the source of truth.

## Identity

### `users`

The account record: uid (primary key), nickname, hashed password, role (`user` / `admin`), avatar, bio, level and XP totals, email and verification state, GitHub binding, `sensitive_exempt` (bypasses word screening), ban state and reason, `local_pwd_set` (whether a local password has ever been set), storage quota, region, timestamps.

> Column names matter: the password column is **`hashed_password`** and the "has a local password" flag is **`local_pwd_set`**. Writing to a guessed name such as `password_hash` fails silently in naive scripts.

### `follows`, `blocks`

Directed relationships between users, with timestamps. Both are used for feeds and for visibility rules.

## Content

| Table | Holds |
|---|---|
| `works` | Published projects: title, description, cover, package URL, play URL, tags, author, counters, review state |
| `posts` | Forum threads: title, body, category, author, counters, pinned state, review state |
| `comments` | Comments on works and posts, addressed by `target_type` + `target_id` |
| `studios` | Studios: name, description, owner, join mode |
| `studio_members` | Membership and role inside a studio |
| `series` | Ordered collections of works |
| `likes`, `favorites`, `bookmarks` | Per-user reactions, each keyed by target type and id |

`works` and `posts` use `AUTOINCREMENT` primary keys deliberately: SQLite otherwise reuses the largest deleted row id, which silently corrupts any table that stores a content id for display or synchronisation.

## Messaging

| Table | Holds |
|---|---|
| `conversations`, `conversation_members` | One-to-one and group conversations |
| `messages` | Message bodies, sender, attachments, read state |
| `notifications` | The notification feed: type, actor, target, body, read flag |

## Moderation

### `content_reviews`

The single queue behind sensitive-word hits, reports, committee actions and administrator decisions.

Columns worth knowing: `target_type` (`work`, `post`, `work_comment`, `post_comment`), `target_id`, `sensitive_words`, `status` (`pending` / `approved` / `rejected`), `review_state` (for example `pending`, `hidden`, `admin_review`, `restored`, `rejected`), `source` (`sensitive`, `report`, `committee`), `penalty` and `penalty_detail`, `report_count`, and the actor/timestamp columns for hiding, reviewing and restoring.

Because both `status` and `review_state` exist, **any count shown next to a list must be produced by the same query as that list** — otherwise the badge and the list disagree and users see a red dot pointing at an empty page. `review_state`/`source` is the newer pair; new code should filter on those and treat `status` as legacy.

### Other moderation tables

| Table | Holds |
|---|---|
| `reports` | One row per user report, with target, reason, status and handling information |
| `sensitive_words` | The word list, with category and enabled flag |
| `committee_members` | Committee membership, application state, term information as implemented |
| `committee_votes` | Votes cast on a queue item (present when the committee subsystem is enabled) |
| `audit_logs` / `admin_logs` | Every administrative action: actor, action, target, detail, timestamp |

## Support tables

| Table | Holds |
|---|---|
| `banners` | Home-page carousel: title, `image_url`, `target_url`, `sort_order`, `enabled`, `color` (used as the flat background when there is no image) |
| `xp_events` | XP awards, with source and amount |
| `levels` / badge definitions | Level thresholds and badge metadata |
| `announcements` | Site-wide notices |
| `switches` | Feature toggles editable at runtime |
| `passports` | Identity documents submitted for verification — **never** expose this directory over HTTP |
| `storage_usage` | Per-user storage accounting |
| `email_codes` | Verification codes with purpose and expiry |

## Operational notes

- **Back up by copying the file** — but do it while the writer is quiet, or use `sqlite3 .backup`. Always verify a backup by restoring it somewhere and starting the app.
- **Migrations:** rehearse on a copy, keep the script re-runnable, and run `PRAGMA foreign_key_check` afterwards. The baseline for this project already contained orphan rows, so compare before and after rather than expecting zero.
- **Foreign keys** are declared in the models; enable enforcement per connection (`PRAGMA foreign_keys=ON`) if you rely on cascade behaviour.
- **Timestamps** are stored in UTC. Convert only for display.
