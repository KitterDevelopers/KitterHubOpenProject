> English version: [MODERATION.md](MODERATION.zh-CN.md) · 本文件为中文版

# 内容治理机制（MODERATION）

本文说明 KitterHub 的内容治理流程：敏感词、举报、风纪委员会、管理员复审，
以及每一步在代码里的位置。

> **重要前提**：本文分两部分。
>
> - **第一部分「当前运行中的行为」**写的都是**当前版本实际在跑**的逻辑，
>   每条都给出代码位置（`文件:函数`），可以直接对照源码核实。
> - **第二部分「设计完成但未合并到当前版本」**写的规则**尚未生效**。
>   它们目前只存在于重构中间目录 `tmp_stage2/`，没有接入 `backend/app/main.py`，
>   且 `tmp_stage2/` **不属于本次开源导出的内容**（题库文件在本仓库中也不存在）。
>   请把它们当作**路线图**，而不是现有功能。
>
> 功能状态的速览表见 [`../README.md`](../README.zh-CN.md) 的「1.1 功能状态」。

## 目录

- [第一部分：当前运行中的行为](#第一部分当前运行中的行为)
  - [1. 参与角色](#1-参与角色)
  - [2. 敏感词](#2-敏感词)
  - [3. 举报](#3-举报)
  - [4. 风纪委员会](#4-风纪委员会)
  - [5. 管理员复审](#5-管理员复审)
  - [6. 审计日志](#6-审计日志)
  - [7. 被隐藏内容的作者可见性](#7-被隐藏内容的作者可见性)
  - [8. 状态与阈值的完整清单](#8-状态与阈值的完整清单)
- [第二部分：设计完成但未合并到当前版本](#第二部分设计完成但未合并到当前版本)
  - [9. 未合并的规则](#9-未合并的规则)
  - [10. 未合并部分的代码现状](#10-未合并部分的代码现状)
  - [11. 已预置但不可用的前端界面](#11-已预置但不可用的前端界面)

---

# 第一部分：当前运行中的行为

## 1. 参与角色

| 角色 | 判定依据 | 能做治理相关的什么 |
| --- | --- | --- |
| 普通用户 | 已登录 | 举报内容；若内容被隐藏且自己是作者，可申诉 |
| 在职风纪委员 | `users.committee_status == "active"` | 看巡逻队列、「隐藏 + 送审」（每天上限 20）、对**待审**内容投「无违规」 |
| 管理员 | `users.role == "admin"` | 复审队列（通过＝恢复 / 驳回＝维持隐藏并可追加处罚）、审批委员申请、停职/复职 |

- `committee.is_member()` 与 `committee.require_member()` 负责委员身份判定，
  所有委员接口的第一行都是 `require_member(current)`
  （`backend/app/committee.py:is_member` / `require_member`）。
- 管理员的判定在 `backend/app/deps.py:get_current_admin`：
  它建立在 `get_active_user` 之上，`user.role != "admin"` 直接 403。
- 委员身份也会在对外用户信息里以 `committee` 布尔字段暴露
  （`backend/app/serializers.py:user_brief`），但不暴露申请/停职等状态。

> 委员**不是**管理员：委员不能删除内容、不能处罚用户、看不到举报人是谁
> （`backend/app/committee.py` 顶部注释「风纪委员的权限边界（有意收紧）」）。

## 2. 敏感词

### 2.1 词库

- 敏感词**存在数据库**（`sensitive_words` 表，模型 `models.SensitiveWord`），
  管理员可在后台增删，改完立即生效（有 60 秒缓存）。
- 代码内置词库 `SENSITIVE_WORDS` 是一个**空列表**，只作为「表为空时的种子位」存在
  （`backend/app/sensitive.py:SENSITIVE_WORDS`）。
- 读取入口 `get_db_words()` 带 60 秒缓存；无 db 句柄时（Socket 聊天场景）
  用上次缓存，从未加载过则回退到内置列表。

### 2.2 检测与命中后的动作

- 检测函数：
  - `sensitive.find_sensitive(text, db)` —— 返回命中的词列表（不区分大小写，用于提示具体是哪个词）。
  - `sensitive.contains_sensitive(text, db)` —— 布尔包装。
  - `sensitive.hits(text, user, db)` —— **投稿链路专用**：若用户
    `users.sensitive_exempt` 为真则直接返回空列表（豁免用户发布的内容不受敏感词审核）。
- 覆盖范围（`backend/app/routers/`）：
  - 作品标题 + 简介（`works.py:create_work`，命中 → `status = "pending"`）；
  - 帖子标题 + 正文（`posts.py`，命中 → 待审）；
  - 作品评论（`works.py`，命中 → `status = "pending"`）；
  - 帖子评论（`posts.py`，命中 → 待审）。
- **用户名、昵称、工作室名命中是直接拒绝**，不入审议库
  （`routers/auth.py`、`routers/users.py`、`app/studio_core.py`）。

### 2.3 入审议库

命中后的统一动作在 `backend/app/serializers.py:queue_sensitive_review()`：

1. 写入一条 `ContentReview`，其中
   `sensitive_words` = 命中词（最多取前 10 个，逗号分隔）、`status = "pending"`、
   `source` 取模型默认值 `"sensitive"`；
2. **通知作者**：「你的内容《…》因包含敏感词（…）已被隐藏，等待管理员审核」。

调用方负责**先把内容状态改成隐藏态**，然后调用该函数并 commit
（例如 `routers/works.py` 里先 `status = "pending"` 建稿，再
`serializers.queue_sensitive_review(...)`）。

> 注意（代码细节）：`queue_sensitive_review` 本身不写 `reviewer_id`
> 与 `resolved_by`，这两列留给管理员裁决时填写。

## 3. 举报

### 3.1 可以举报什么

`backend/app/routers/reports.py:REPORT_TYPES` 定义了合法目标类型：

`work`、`post`、`studio`、`work_comment`、`post_comment`，
以及为兼容历史数据保留的泛化类型 `comment`
（新客户端**不应**再传 `comment`：它靠「先查帖子评论、再查稿件评论」猜测，
两表 id 相同时会指错对象）。

### 3.2 举报流程

`backend/app/routers/reports.py:create_report`：

- 登录用户即可举报；`reason` 缺省为 `"其他"`。
- `reports` 表有唯一约束 `uq_report (reporter_id, target_type, target_id)`：
  **同一个人对同一目标只能举报一次**。重复举报直接返回
  `{"ok": true, "already": true}`，不报错也不新建记录。
- 新记录的 `status` 默认为 `"pending"`（`models.Report`）。

### 3.3 ≥3 次举报 → 自动下架待审

同一 `create_report` 中：

```python
if target_type in ("work", "post"):
    pending_count = db.query(models.Report).filter_by(
        target_type=target_type, target_id=target_id).count()
    if pending_count >= 3:
        ...
```

- **适用范围**：只有 `work` 与 `post` 会触发自动下架；
  **评论区、工作室被举报不会触发这条自动下架**。
- **口径**：计数是**该目标上全部举报记录的总数**（变量名虽叫 `pending_count`，
  但查询没有过滤 `status`），即「累计被举报 ≥3 次」。
- 命中后的动作：
  - `work`：若当前是 `published`，置为 `pending`（下架待审），并通知作者
    「因多次举报已被暂时下架，等待管理员复核」。
  - `post`：**不改帖子状态**，只给作者发通知「多次被举报，管理员将尽快复核」。
    帖子的隐藏由管理员处理。

> ⚠️ 与 README 第 2.8 节的措辞差异：帖子在这一步**不会**被自动下架，
> 只是发通知。README 中「作品自动下架为待审；帖子给作者发通知由管理员复核」
> 的描述是准确的，本文此处给出的是代码级细节。

## 4. 风纪委员会

全部实现在 `backend/app/committee.py`，路由前缀 `/api/committee`，
共 **6 个端点**（`/me`、`/apply`、`/queue`、`/hide`、`/vote`、`/mine`）。

### 4.1 申请入会（LV3 + 管理员审批）

- 门槛 `MIN_LEVEL = 3`，判定走 `serializers.check_level(db, current, MIN_LEVEL, ...)`。
- `POST /committee/apply`：
  - 已是 `active` → 400「你已经是在职风纪委员了」；
  - 已 `pending` → 400「你已经提交过申请，请等管理员审批」；
  - 已 `suspended` → 400「你当前处于停职状态」；
  - 申请理由必填（截断到 500 字符）；
  - 通过后写 `users.committee_status = "pending"`、`committee_reason`、`committee_at`，
    并**通知所有管理员**。
- 状态取值与中文标签（`STATUS_LABEL`）：
  `pending` 审核中 / `active` 在职 / `rejected` 未通过 / `suspended` 已停职。
- `GET /committee/me` 返回本人状态、是否可申请（`can_apply`）、原因说明
  （`reason`，例如「需要 LV3（你当前 LV2）」）与执法统计。
- 管理员侧审批：`routers/admin.py:review_committee_application`
  （`decision` 为 `approve` / `reject`，通过则 `committee_status = "active"`），
  以及 `suspend_committee_member` 做停职/复职。

### 4.2 巡逻队列

`GET /committee/queue`（需在职委员身份）返回三段内容：

1. **`items`** —— 被举报的（按举报数从多到少，**全部**进）。
2. **`items`** —— 正常内容**随机抽样**补足（评论为主，掺一些稿件/帖子），
   按 `limit` 控制总量（默认 20，允许 1–50）。
   常量：`RANDOM_QUEUE_SIZE = 12`（正常内容抽样规模）。
3. **`pending`** —— **已隐藏、正等管理员裁决**的送审记录（最多 20 条）。
   这些内容因已隐藏不会出现在上面两段里，但委员需要能对它们投「无违规」，
   所以单独列出来。

排除规则（三段都适用）：**自己的内容不进队列**、已隐藏的不进普通队列、
已经在复审队列里的不重复进。

其他返回字段：`reported_count`、`vote_threshold`、`daily_left`、`daily_limit`。

> 队列来源常量 `QUEUE_SOURCES = ("committee", "sensitive")`：
> 送审记录既包括委员「隐藏 + 送审」，也包括系统命中敏感词后自动写的记录。

### 4.3 委员核心动作：隐藏 + 送审

`POST /committee/hide`（`hide_and_escalate`）：

- 目标类型必须在 `TARGET_TYPES = ("work", "post", "work_comment", "post_comment")` 内。
- **必须写明理由**（截断 200 字符），理由是给管理员看的。
- 每日额度 `DAILY_HIDE_LIMIT = 20` 条；`_daily_hidden()` 按「今天 0 点起、
  `source == "committee"`、`reviewer_id == 我`」计数，用完返回 400。
- 校验：内容不存在 → 404；**不能处理自己发布的内容** → 400；
  内容已是隐藏态 → 400；已在复审队列 → 400。
- 动作：把内容置为隐藏态（作品/帖子 → `pending`，评论 → `pending`），
  写一条 `ContentReview(source="committee", status="pending", reviewer_id=我, reviewer_note=理由)`，
  并**通知所有管理员**。
- 返回 `review_id` 与剩余额度 `daily_left`。

### 4.4 「无违规」投票：满 3 票即恢复

- 阈值 `VOTE_THRESHOLD = 3`（站长规则：「3 位风纪委员都选择无违规的话就算无违规」）。
- `POST /committee/vote`（`vote_no_violation`）：
  - **只有「待审」内容能投**：即该目标上存在未处理举报（`reports.status == "pending"`），
    或存在等管理员裁决的送审记录；否则 400「这条内容当前不在待审状态，不需要投票」。
    （所以纯随机巡逻到的正常内容没有「投票」按钮。）
  - **不能对自己发布的内容投票**；**同一人对同一目标只能投一票**
    （`committee_votes` 表唯一约束 `uq_committee_vote (voter_id, target_type, target_id)`）。
  - 投票人昵称在**委员会内部公开**（`vote_state()` 返回 `voters` 列表），管理端也用它。
- 满票后的判定 `_clear_by_vote()` 依次做四件事：
  1. **恢复展示**：作品/帖子 → `published`，评论 → `active`；
  2. 把还在等待的送审记录按「内容没问题」结掉：
     `status = "approved"`，并把 `resolved_by` 标为 `"committee_vote"`，
     写 `handled_at`；
  3. 该内容上**尚未处理的举报一并驳回**：`status = "dismissed"`，
     `note = "3 位风纪委员判定无违规"`；
  4. **通知作者**（内容已恢复正常展示）与**通知举报人**（举报已驳回）。

### 4.5 委员的执法统计与「误判」口径

`stats_of()` 的口径（代码注释里明确区分了两种情况）：

| 字段 | 含义 |
| --- | --- |
| `total` | 我累计送审条数（`source == "committee"` 且 `reviewer_id == 我`） |
| `today` | 我今天送审的条数（用于对比 `daily_limit`） |
| `pending` | 我的送审里还没结的 |
| `upheld` | 管理员**维持隐藏**（`status == "rejected"`）＝ 我判对了 |
| `revoked` | 管理员判定「内容没问题」（`status == "approved"` 且 `resolved_by != "committee_vote"`）＝ **误判** |
| `overturned` | 被 **3 位委员投票**判定无违规（`resolved_by == "committee_vote"`）＝ **不算误判**，单独计 |
| `daily_limit` | 每日隐藏上限 |

> 这个区分很重要：如果投票翻案也算成送审人误判，「大家都不敢隐藏，机制就废了」。
> 管理员可在后台看到每个委员的送审与误判数，并据此停职。
> 委员自己也能通过 `GET /committee/mine` 看到每条送审记录的裁决结果。

## 5. 管理员复审

### 5.1 队列

`GET /api/admin/sensitive-reviews`（`routers/admin.py:list_sensitive_reviews`）：

- `status`：`pending` / `approved` / `rejected` / `all`（默认 `pending`）。
- `source`：`sensitive`（敏感词命中）/ `committee`（委员送审）/ `all`（默认 `sensitive`）。
  **两类来源共用同一张 `content_reviews` 表、同一套裁决接口**，
  所以管理员只需要看一个队列，不会出现两套处理逻辑行为不一致。
- 每条返回：目标信息、`sensitive_words` 列表、`status`、处罚字段、`source`、
  送审委员、`reviewer_note`、`resolved_by`，以及（委员送审的）
  `votes` 投票进度 —— 由 `committee.vote_state()` 现算。

### 5.2 通过（`POST /api/admin/sensitive-reviews/{id}/approve`）

- 把内容恢复展示：作品/帖子 → `published`，评论 → `active`。
- 记录 `status = "approved"`、`handled_at`、`handled_by = 管理员`。
- 写管理员操作日志 `sensitive_approve`，并通知作者「已通过审核并恢复展示」。
- 若目标内容已不存在：把记录关成 `rejected` 并返回
  `{"ok": false, "detail": "目标内容已不存在，记录已关闭"}`。

### 5.3 驳回（`POST /api/admin/sensitive-reviews/{id}/reject`）

- **内容处理**：作品/帖子 → `rejected`（不展示，**作者可见可申诉**）；
  **评论 → 直接删除**。
- **可追加处罚**（`body.penalty`）：
  - `warn` → 记「警告」；
  - `mute` → 设置 `users.ban_until = 现在 + days`，`ban_reason = "敏感词内容：<标题>"`，
    记「禁言 N 天」。
- 记录 `status = "rejected"`、`handled_at`、`handled_by`，并在详情里保留处罚摘要。
- 目标不存在时同样关闭记录并返回 `ok: false`。

### 5.4 举报的处理

`routers/reports.py`：管理员把举报改为 `handled`（已处理）或 `dismissed`（已驳回），
写入 `handled_by` / `handled_at` / `note`，并记录一行管理员操作日志
（`report_handled` / `report_dismissed`），然后通知举报人处理结果。

## 6. 审计日志

系统有**两套并行的留痕**：

### 6.1 `audit_logs` —— 请求级自动审计

`backend/app/audit.py` 是中间件，自动记录以下请求（其余不记，避免噪音）：

- `/api/admin/**` 的 `POST` / `PATCH` / `PUT` / `DELETE`；
- `/api/auth/**` 的 `POST`（**含失败的登录/注册尝试**）；
- `/api/users/me/password`、`/api/users/me/deactivate` 的 `POST`。

每条记录：操作人 id（从 JWT `sub` 解析）、用户名快照（截断 60 字符）、
方法、路径（截断 300 字符）、状态码、来源 IP、时间。
设计上**审计失败绝不影响业务**（整段包在 try/except 里）。

### 6.2 `admin_logs` —— 业务级操作留痕

`serializers.log_admin_action()` 写入 `admin_logs`：管理员 id、动作名
（如 `sensitive_approve`、`report_handled`、`committee_approve`、
`committee_suspend`）、目标类型与 id、说明文字。管理端各面板展示的就是这一套。

## 7. 被隐藏内容的作者可见性

内容被隐藏后**不是对所有人都消失**，作者仍然能看到并申诉：

- **详情页**（`routers/works.py`）：若 `work.status != "published"`，
  只有作者本人或管理员能打开，其他人一律 404「稿件不存在或未发布」。
- **创作中心**（作品列表接口）：不传 `status` 参数时作者能看到自己的
  **待审 / 未过审**内容；个人主页则只显示已发布（`status=published`）。
- **申诉**：`routers/works.py` 的申诉接口要求 `status in ("pending", "rejected")`
  （「仅被下架或驳回的稿件可申诉」），作者填写申诉理由提交。
- 同理，帖子也有「作者或管理员可见未发布内容」的判定
  （`routers/posts.py`）。

此外，敏感词命中与委员送审都会**通知作者**（`serializers.queue_sensitive_review()`、
`committee.hide_and_escalate()` 里通过 `notify_user`），
管理员裁决后还会再通知一次结果，以及「3 票判无违规」时的恢复通知。

## 8. 状态与阈值的完整清单

### 8.1 内容状态

| 模型 | 字段 | 隐藏态（不对外展示） | 展示态 |
| --- | --- | --- | --- |
| `Work` / `Post` | `status` | `pending`（待审/下架）、`rejected`（驳回）、`scheduled`（定时未到） | `published` |
| `WorkComment` / `PostComment` | `status` | `pending` | `active` |

> 公开接口只返回 `published`
> （`routers/public.py` 明确「只返回 status == 'published' 的稿件」）。
> 综合的「是否隐藏」判定见 `committee._hidden()`：
> `status` 为 `pending` / `rejected` / `hidden` 之一即视为不可见。

### 8.2 代码里的常量

| 常量 | 值 | 位置 | 含义 |
| --- | --- | --- | --- |
| 举报自动下架阈值 | `3` | `routers/reports.py:create_report`（字面量，非常量） | 作品/帖子累计被举报 ≥3 次 → 下架待审 |
| `MIN_LEVEL` | `3` | `app/committee.py` | 申请风纪委员的等级门槛 |
| `DAILY_HIDE_LIMIT` | `20` | `app/committee.py` | 委员每人每天最多隐藏条数 |
| `RANDOM_QUEUE_SIZE` | `12` | `app/committee.py` | 巡逻队列里正常内容的随机抽样规模 |
| `VOTE_THRESHOLD` | `3` | `app/committee.py` | 「无违规」票数达到多少即判定无违规 |
| `QUEUE_SOURCES` | `("committee", "sensitive")` | `app/committee.py` | 进入委员会审议库的来源 |
| `TARGET_TYPES` | `("work", "post", "work_comment", "post_comment")` | `app/committee.py` | 委员可处理/可投票的目标类型 |

> ⚠️ 两个「3」不是同一个 3：举报阈值是**同一内容的举报条数**，
> 无违规阈值是**不同的风纪委员人数**。

### 8.3 关键数据表

| 表 | 模型 | 作用 |
| --- | --- | --- |
| `sensitive_words` | `SensitiveWord` | 敏感词库（后台可增删） |
| `reports` | `Report` | 举报记录，唯一约束防重复举报 |
| `content_reviews` | `ContentReview` | 送审/复审队列；`source` 区分 `sensitive` / `committee` |
| `committee_votes` | `CommitteeVote` | 「无违规」投票，唯一约束防重复投票 |
| `admin_logs` | `AdminLog` | 管理员业务操作留痕 |
| `audit_logs` | `AuditLog` | 请求级自动审计（后台写操作、登录、改密） |

字段细节见 [`DATABASE.md`](DATABASE.zh-CN.md)，接口清单见 [`API.md`](API.zh-CN.md)。

---

# 第二部分：设计完成但未合并到当前版本

> 本节描述的是**路线图**，不是现有功能。
> 这些规则**目前不影响线上行为**，请不要据此判断系统当前如何工作。

## 9. 未合并的规则

以下四条规则来自站长需求，在重构中已经写成了代码，但**没有合并进当前版本**：

| # | 规则 | 设计值 |
| --- | --- | --- |
| 1 | **答题入会**：先通过考试才能申请成为风纪委员 | 题库 100 题；每次随机抽 20 题；答对 ≥15 题通过，获得一次申请机会；再走管理员审批 |
| 2 | **60 天任期** | 委员上任即开始 60 天任期，任期内展示「已标记 n / 50」进度 |
| 3 | **标记 >50 免审连任** | 任期届满时，任期内标记条数 **> 50** → 免审核、免答题自动连任；未超过 → 需重新答题通过后免审核连任 |
| 4 | **标记 ≥1 票违规即隐藏** | 委员对内容标记「违规」，**≥1 票**即先隐藏并送管理员复审（对照：当前版本是委员手动「隐藏 + 送审」）；**≥3 票「无违规」**则恢复展示 |

对照当前版本实际生效的规则：

- 入会：**只有**「LV3 + 管理员审批」，**没有**考试前置（见 [§4.1](#41-申请入会lv3--管理员审批)）。
- 任期：**没有**任期概念，委员在位直到被停职（`committee_status` 只有状态，没有到期时间）。
- 违规判定：当前是委员**手动**「隐藏 + 送审」；「≥1 票违规自动隐藏」不存在。
- 无违规恢复：`VOTE_THRESHOLD = 3`，这一条**两边一致**，已在 [§4.4](#44-无违规投票满-3-票即恢复) 生效。

## 10. 未合并部分的代码现状

- 这些逻辑位于**重构中间目录 `tmp_stage2/`**，涉及文件包括
  `committee_models.py`、`committee_routes.py`、`committee_svc.py`、
  `committee_admin_block.py`、`migrate_committee_v2.py`。
- **`tmp_stage2/` 不属于本次开源导出**（见 [`../CHANGELOG.md`](../CHANGELOG.zh-CN.md)
  的「未包含」一节），因此上述文件**在本仓库中并不存在**。
- 它们**没有接入** `backend/app/main.py`：该文件只 `include_router(committee.router)`，
  而 `committee.router` 来自 `backend/app/committee.py`，其中不含考试与任期逻辑。
- 设计中的常量（供对照，**当前不生效**）：
  `TERM_DAYS = 60`、`RENEW_MARK_THRESHOLD = 50`、`EXAM_TOTAL_QUESTIONS = 100`、
  `EXAM_DRAW = 20`、`EXAM_PASS = 15`、`VIOLATION_HIDE_VOTES = 1`、
  `CLEAN_RESTORE_VOTES = 3`。
- 设计中还规划了四张新表：`committee_members`、`committee_marks`、
  `committee_applications`、`committee_exam_attempts`。
  **当前数据库里没有这四张表**（现存的是 `committee_votes`，见 [§8.3](#83-关键数据表)）。
- 设计中的考试题库文件（`committee_bank.QUESTIONS`，100 题）
  **在当前仓库中不存在**，因此相关接口即使被挂载也无法出题。

## 11. 已预置但不可用的前端界面

前端**已经按未合并的规则写好了界面与文案**，但后端没有提供对应接口，
因此这些界面在当前版本**不可用**：

| 前端文件 | 内容 |
| --- | --- |
| `frontend/src/pages/Committee.jsx` | 委员会首页：标注了「考试 100 题库随机抽 20 题、答对 ≥15 题获得申请机会」「任期 60 天、标记 n/50 进度」 |
| `frontend/src/pages/CommitteeExam.jsx` | 考试页与「任期届满后重新答题续任」流程 |
| `frontend/src/i18n/dict/committee.js` | 考试/任期/续任相关词条，含 `committee.termTitle`、`committee.termProgress`、`committee.termAutoRenewHint` 等 |
| `frontend/src/components/TopBar.jsx` | 入口注释写明「先考试（100 题库抽 20 题）→ 申请 → 管理员审批」 |

涉及但**后端未提供**的接口（设计中）：`/committee/exam`（GET 出卷 / POST 交卷）、
以及续任相关端点。当前 `/api/committee` 只有 [§4](#4-风纪委员会) 列出的 6 个端点。

---

## 相关文档

- [`../README.md`](../README.zh-CN.md) —— 「1.1 功能状态」速览表与第 9 节治理机制概览
- [`API.md`](API.zh-CN.md) —— 全部接口清单（含 `/api/committee` 与 `/api/admin/sensitive-reviews`）
- [`DATABASE.md`](DATABASE.zh-CN.md) —— `reports`、`content_reviews`、`committee_votes` 等表结构
- [`SECURITY.md`](SECURITY.zh-CN.md) —— 后台鉴权、审计与密钥管理
- [`ARCHITECTURE.md`](ARCHITECTURE.zh-CN.md) —— 请求链路与鉴权分层
