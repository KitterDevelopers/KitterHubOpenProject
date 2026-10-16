# Content Moderation

> 中文版: [MODERATION.zh-CN.md](MODERATION.zh-CN.md)

This document has two parts: what the code in **this repository actually does**, and the rules that exist as a design but are **not merged into this version**. Do not quote the second part as a feature.

## Part 1 — Behaviour in this version

### 1.1 Screening before publication

Every work, post and comment is matched against the sensitive-word list (`sensitive_words`) before it becomes publicly visible.

- A hit is written into `content_reviews` with `source = 'sensitive'`, and the content is hidden at the same time.
- The author is told the submission is under review rather than being silently ignored.
- A user flagged with `sensitive_exempt` (set per account by an administrator) bypasses this check.
- The word list is editable at runtime from the admin console, and the desk exposes queue statistics.
- Code: `backend/app/sensitive.py`, the review helpers used by the routers, and the admin endpoints under `/api/admin/sensitive-*`.

### 1.2 Reports

Any member can report content. Each report is a row in `reports` with a target, a reason and a status.

- Reports are counted per target. Once a target passes the hide threshold, the content is hidden automatically (the threshold is enforced in the report handling code).
- The count per target and the reporter's own history are both exposed to administrators: `target_total` / `target_pending` and `reporter_total` / `reporter_dismissed`. That is what makes serial reporters and repeat offenders visible instead of just "a report arrived".
- Reporting is rate-limited by the normal request limits; abusive reporting is handled by administrators.
- Code: `backend/app/routers/reports.py` and the admin reports desk.

### 1.3 Discipline committee

Committee members are community members with the required level, approved by an administrator.

- **Patrol queue.** Committee members work through a queue of content that needs review.
- **Hide and escalate.** A committee member can hide content (`POST /committee/hide`, with a daily limit) and send it to an administrator for a final decision.
- **Voting.** On queue items, members vote. Enough "no violation" votes restore the content automatically — the threshold in this version is **three**.
- **Statistics** are exposed for the committee dashboard.
- **Everything is reversible.** Administrators can review, re-decide, restore or remove any outcome.
- Code: `backend/app/committee.py`, mounted in `backend/app/main.py`.

### 1.4 Audit trail

Hiding, restoring, approving, rejecting, banning, quota changes and every other administrative action are written to the audit tables with the actor, the action, the target and a human-readable detail string. The admin console exposes that trail, which is the reason a mistaken decision is recoverable rather than permanent.

### 1.5 What the state columns mean

`content_reviews` carries both a legacy `status` (`pending` / `approved` / `rejected`) and a newer pair `review_state` + `source`. New code should reason about `review_state` and `source` — `pending` with `source = 'committee'` is not the same thing as `pending` with `source = 'sensitive'`, and the sensitive-word desk must only count the latter. The badge next to a queue and the queue's own list **must be produced by the same query**; otherwise the number and the list disagree.

## Part 2 — Designed, not merged

The following rules are **not active in this version**. They exist as staged code outside the running import graph (in a `tmp_stage2/` staging directory that is not part of this export) and as a pre-built front end that expects endpoints which are not served here:

- **Committee entry examination** — a 100-question bank, 20 questions drawn per attempt, 15 correct to pass.
- **Terms of office** — 60-day committee terms, and an exemption from re-examination for members whose marks exceed a threshold.
- **Single-vote hiding** — hiding content on a single committee member's violation mark, instead of the current hide-and-escalate flow.
- **Additional committee tables** — the data model for the above.

They are recorded here so the documentation does not claim more than the code does. The question bank itself is not present in this repository. Treat this section as a roadmap.

## For administrators

1. Keep the sensitive-word list short and specific. A broad list hides legitimate work and burns your reviewers' attention.
2. Read the counts, not just the report: a target reported once by an account with a long history of dismissed reports is a different situation from a target reported five times by five accounts.
3. Use the audit trail when reversing a decision, and add a reason — future-you will not remember why.
4. Remember that hiding is not deleting. Almost every automatic action here can be undone, and that is deliberate.
