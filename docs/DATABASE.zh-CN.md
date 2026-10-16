> English version: [DATABASE.md](DATABASE.zh-CN.md) · 本文件为中文版


#### `User`

- 表名：`users`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `uid` | `String(16)` | unique=True, index=True, nullable=True |
| `username` | `String(50)` | unique=True, index=True, nullable=False |
| `nickname` | `String(50)` | default='' |
| `email` | `String(120)` | unique=True, index=True, nullable=False |
| `hashed_password` | `String(255)` | nullable=False |
| `avatar_url` | `String(500)` | nullable=True |
| `cover_url` | `String(500)` | nullable=True |
| `show_cover` | `Boolean` | default=False |
| `show_level_badge` | `Boolean` | default=False |
| `show_codemao_badge` | `Boolean` | default=False |
| `badge_choice` | `String(10)` | nullable=True |
| `show_codemao_badge` | `Boolean` | default=False |
| `codemao_author_level` | `Integer` | default=0 |
| `codemao_level_at` | `DateTime` | nullable=True |
| `bio` | `Text` | default='' |
| `role` | `String(20)` | default='user' |
| `is_banned` | `Boolean` | default=False |
| `ban_until` | `DateTime` | nullable=True |
| `featured_work_ids` | `String(100)` | default='' |
| `is_deactivated` | `Boolean` | default=False |
| `deactivated_at` | `DateTime` | nullable=True |
| `notify_prefs` | `Text` | default='{}' |
| `treaty_signed_at` | `DateTime` | nullable=True |
| `verification_title` | `String(100)` | default='' |
| `verification_type` | `String(10)` | nullable=True |
| `interests` | `String(100)` | default='' |
| `xp_bonus` | `Integer` | default=0 |
| `invited_by` | `Integer` | nullable=True |
| `last_login_at` | `DateTime` | nullable=True |
| `codemao_uid` | `String(32)` | unique=True, index=True, nullable=True |
| `codemao_nickname` | `String(50)` | default='' |
| `codemao_avatar` | `String(500)` | nullable=True |
| `pickcat_uid` | `String(64)` | nullable=True, index=True |
| `pickcat_nickname` | `String(64)` | default='' |
| `pickcat_avatar` | `String(300)` | nullable=True |
| `pickcat_at` | `DateTime` | nullable=True |
| `codemao_xp_bonus` | `Integer` | default=0 |
| `codemao_xp_level` | `Integer` | default=0 |
| `bind_xp_codemao_at` | `DateTime` | nullable=True |
| `bind_xp_github_at` | `DateTime` | nullable=True |
| `bind_xp_email_at` | `DateTime` | nullable=True |
| `github_id` | `String(32)` | unique=True, index=True, nullable=True |
| `github_login` | `String(64)` | default='' |
| `github_avatar` | `String(500)` | nullable=True |
| `local_pwd_set` | `Integer` | default=0 |
| `verify_state` | `String(20)` | default='ok', index=True |
| `passport_file` | `String(200)` | nullable=True |
| `passport_at` | `DateTime` | nullable=True |
| `verify_reviewed_at` | `DateTime` | nullable=True |
| `verify_reviewed_by` | `Integer` | nullable=True |
| `verify_note` | `Text` | default='' |
| `reg_lang` | `String(8)` | nullable=True |
| `gender` | `String(10)` | nullable=True |
| `show_personal` | `Boolean` | default=True |
| `ip_region` | `String(50)` | default='' |
| `last_ip` | `String(64)` | nullable=True |
| `show_ip_region` | `Boolean` | default=True |
| `sensitive_exempt` | `Boolean` | default=False, server_default='0' |
| `scratch_quota_mb` | `Integer` | nullable=True |
| `storage_quota_mb` | `Integer` | nullable=True |
| `ip_region_at` | `DateTime` | nullable=True |
| `pending_email` | `String(120)` | nullable=True |
| `pending_email_at` | `DateTime` | nullable=True |
| `ban_reason` | `String(200)` | default='' |
| `committee_status` | `String(16)` | nullable=True |
| `committee_reason` | `Text` | default='' |
| `committee_at` | `DateTime` | nullable=True |
| `token_version` | `Integer` | default=0 |
| `fish_count` | `Integer` | default=0 |
| `last_fish_date` | `String(10)` | nullable=True |
| `signin_days` | `Integer` | default=0 |
| `xp_feed_given` | `Integer` | default=0 |
| `feed_xp_date` | `String(10)` | nullable=True |
| `feed_xp_today` | `Integer` | default=0 |
| `subscribed_topics` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |
| `posts` | `relationship -> 'Post'` | back_populates='author', cascade='all, delete-orphan' |
| `works` | `relationship -> 'Work'` | back_populates='author', cascade='all, delete-orphan' |

#### `Post`

- 表名：`posts`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `title` | `String(200)` | nullable=False |
| `content` | `Text` | nullable=False |
| `status` | `String(20)` | default='published' |
| `ip_region` | `String(50)` | default='' |
| `category` | `String(50)` | default='讨论' |
| `topics` | `String(200)` | default='' |
| `views` | `Integer` | default=0 |
| `is_pinned` | `Boolean` | default=False |
| `is_featured` | `Boolean` | default=False |
| `owner_pinned` | `Boolean` | default=False |
| `poll` | `Text` | default='' |
| `image_url` | `String(500)` | nullable=True |
| `feed_count` | `Integer` | default=0 |
| `created_at` | `DateTime` | default=now |
| `updated_at` | `DateTime` | default=now |
| `edited_at` | `DateTime` | nullable=True |
| `author` | `relationship -> 'User'` | back_populates='posts' |
| `comments` | `relationship -> 'PostComment'` | back_populates='post', cascade='all, delete-orphan' |

#### `Work`

- 表名：`works`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `title` | `String(200)` | nullable=False |
| `description` | `Text` | default='' |
| `ip_region` | `String(50)` | default='' |
| `work_type` | `String(20)` | default='url' |
| `source_url` | `String(500)` | nullable=True |
| `editor_code` | `String(20)` | nullable=True |
| `editor_work_id` | `String(100)` | nullable=True |
| `sb3_url` | `String(500)` | nullable=True |
| `sb3_sha256` | `String(64)` | nullable=True |
| `sb3_size` | `Integer` | default=0 |
| `cover_url` | `String(500)` | nullable=True |
| `category` | `String(50)` | default='其他' |
| `tags` | `String(200)` | default='' |
| `views` | `Integer` | default=0 |
| `is_pinned` | `Boolean` | default=False |
| `is_featured` | `Boolean` | default=False |
| `status` | `String(20)` | default='published' |
| `derived_from` | `Integer` | nullable=True |
| `is_repost` | `Boolean` | default=False |
| `original_url` | `String(500)` | default='' |
| `edited_at` | `DateTime` | nullable=True |
| `scheduled_at` | `DateTime` | nullable=True |
| `appeal` | `Text` | nullable=True |
| `feed_count` | `Integer` | default=0 |
| `created_at` | `DateTime` | default=now |
| `author` | `relationship -> 'User'` | back_populates='works' |
| `comments` | `relationship -> 'WorkComment'` | back_populates='work', cascade='all, delete-orphan' |

#### `PostComment`

- 表名：`post_comments`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `post_id` | `Integer` | nullable=False, index=True, ForeignKey('posts.id') |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `parent_id` | `Integer` | nullable=True, ForeignKey('post_comments.id') |
| `content` | `Text` | nullable=False |
| `image_url` | `String(500)` | nullable=True |
| `pinned` | `Boolean` | default=False |
| `ip_region` | `String(50)` | default='' |
| `status` | `String(20)` | default='active' |
| `created_at` | `DateTime` | default=now |
| `post` | `relationship -> 'Post'` | back_populates='comments' |
| `user` | `relationship -> 'User'` | — |
| `parent` | `relationship -> 'PostComment'` | — |

#### `WorkComment`

- 表名：`work_comments`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `work_id` | `Integer` | nullable=False, index=True, ForeignKey('works.id') |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `parent_id` | `Integer` | nullable=True, ForeignKey('work_comments.id') |
| `content` | `Text` | nullable=False |
| `image_url` | `String(500)` | nullable=True |
| `pinned` | `Boolean` | default=False |
| `ip_region` | `String(50)` | default='' |
| `status` | `String(20)` | default='active' |
| `created_at` | `DateTime` | default=now |
| `work` | `relationship -> 'Work'` | back_populates='comments' |
| `user` | `relationship -> 'User'` | — |
| `parent` | `relationship -> 'WorkComment'` | — |

#### `Like`

- 表名：`likes`
- 用途：通用点赞：target_type 取值 work / post。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `created_at` | `DateTime` | default=now |

#### `Favorite`

- 表名：`favorites`
- 用途：通用收藏：target_type 取值 work / post。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `folder_id` | `Integer` | nullable=True, ForeignKey('favorite_folders.id') |
| `created_at` | `DateTime` | default=now |

#### `FavoriteFolder`

- 表名：`favorite_folders`
- 用途：自定义收藏夹。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `name` | `String(50)` | nullable=False |
| `created_at` | `DateTime` | default=now |

#### `PlayHistory`

- 表名：`play_history`
- 用途：浏览/播放历史（最近玩过）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `work_id` | `Integer` | nullable=False, ForeignKey('works.id') |
| `viewed_at` | `DateTime` | default=now |
| `work` | `relationship -> 'Work'` | — |

#### `AdminLog`

- 表名：`admin_logs`
- 用途：管理员操作日志。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `admin_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `action` | `String(50)` | nullable=False |
| `target_type` | `String(20)` | nullable=True |
| `target_id` | `Integer` | nullable=True |
| `detail` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |
| `admin` | `relationship -> 'User'` | — |

#### `PasswordReset`

- 表名：`password_resets`
- 用途：找回密码（演示版：无邮件服务，重置码直接返回）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `code` | `String(64)` | unique=True, nullable=False |
| `expires_at` | `DateTime` | nullable=False |
| `used` | `Boolean` | default=False |
| `created_at` | `DateTime` | default=now |

#### `Banner`

- 表名：`banners`
- 用途：首页轮播 Banner（管理员管理）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `title` | `String(100)` | nullable=False |
| `image_url` | `String(500)` | default='' |
| `color` | `String(20)` | default='' |
| `target_type` | `String(20)` | default='none' |
| `target_id` | `Integer` | nullable=True |
| `target_url` | `String(500)` | nullable=True |
| `sort_order` | `Integer` | default=0 |
| `enabled` | `Boolean` | default=True |
| `created_at` | `DateTime` | default=now |

#### `Follow`

- 表名：`follows`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `follower_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `following_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `grp` | `String(20)` | default='' |
| `silent` | `Boolean` | default=False |
| `created_at` | `DateTime` | default=now |

#### `UserBlock`

- 表名：`user_blocks`
- 用途：拉黑用户：对方的内容全站不可见。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `blocker_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `blocked_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `created_at` | `DateTime` | default=now |

#### `ChatThread`

- 表名：`chat_threads`
- 用途：聊天会话（私聊与群聊统一）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `kind` | `String(10)` | nullable=False, default='dm', index=True |
| `title` | `String(100)` | default='' |
| `avatar_url` | `String(500)` | nullable=True |
| `announcement` | `Text` | default='' |
| `owner_id` | `Integer` | nullable=True, ForeignKey('users.id') |
| `studio_id` | `Integer` | nullable=True, index=True, ForeignKey('studios.id') |
| `mute_all_until` | `DateTime` | nullable=True |
| `last_message_at` | `DateTime` | nullable=True, index=True |
| `created_at` | `DateTime` | default=now |
| `owner` | `relationship -> 'User'` | — |

#### `ChatMember`

- 表名：`chat_members`
- 用途：会话成员（私聊两人、群聊多人统一）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `thread_id` | `Integer` | nullable=False, index=True, ForeignKey('chat_threads.id') |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `role` | `String(20)` | default='member' |
| `muted` | `Boolean` | default=False |
| `pinned` | `Boolean` | default=False |
| `notify_off` | `Boolean` | default=False |
| `last_read_message_id` | `Integer` | default=0 |
| `joined_at` | `DateTime` | default=now |
| `user` | `relationship -> 'User'` | — |

#### `ChatMessage`

- 表名：`chat_messages`
- 用途：聊天消息（私聊/群聊统一，归属于 thread_id）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `thread_id` | `Integer` | nullable=False, index=True, ForeignKey('chat_threads.id') |
| `sender_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `content` | `Text` | default='' |
| `image_url` | `String(500)` | nullable=True |
| `voice_url` | `String(500)` | nullable=True |
| `voice_duration` | `Integer` | nullable=True |
| `reply_to_id` | `Integer` | nullable=True |
| `recalled` | `Boolean` | default=False |
| `deleted` | `Boolean` | default=False |
| `created_at` | `DateTime` | default=now, index=True |
| `sender` | `relationship -> 'User'` | — |

#### `ChatDmIndex`

- 表名：`chat_dm_index`
- 用途：私聊去重索引：确保同一对用户只有一条私聊会话。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `thread_id` | `Integer` | nullable=False, ForeignKey('chat_threads.id') |
| `user_a` | `Integer` | nullable=False, ForeignKey('users.id') |
| `user_b` | `Integer` | nullable=False, ForeignKey('users.id') |

#### `Studio`

- 表名：`studios`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True, index=True |
| `name` | `String(100)` | nullable=False |
| `description` | `Text` | default='' |
| `announcement` | `Text` | default='' |
| `avatar_url` | `String(500)` | nullable=True |
| `cover_url` | `String(500)` | nullable=True |
| `owner_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `join_mode` | `String(20)` | default='open' |
| `category` | `String(20)` | default='综合', index=True |
| `status` | `String(20)` | default='active', index=True |
| `invite_code` | `String(20)` | nullable=True, index=True |
| `min_level` | `Integer` | default=0 |
| `multi_studio_only` | `Boolean` | default=False |
| `apply_required` | `Boolean` | default=False |
| `member_limit` | `Integer` | default=50 |
| `pending_owner_id` | `Integer` | nullable=True, index=True |
| `created_at` | `DateTime` | default=now, index=True |
| `owner` | `relationship -> 'User'` | — |

#### `StudioMember`

- 表名：`studio_members`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `studio_id` | `Integer` | nullable=False, index=True, ForeignKey('studios.id') |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `role` | `String(20)` | default='member' |
| `status` | `String(20)` | default='active' |
| `muted` | `Boolean` | default=False |
| `apply_note` | `Text` | default='' |
| `joined_at` | `DateTime` | default=now |
| `reviewed_at` | `DateTime` | nullable=True |
| `reviewed_by` | `Integer` | nullable=True |
| `user` | `relationship -> 'User'` | — |

#### `StudioWork`

- 表名：`studio_works`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `studio_id` | `Integer` | nullable=False, index=True, ForeignKey('studios.id') |
| `work_id` | `Integer` | nullable=False, index=True, ForeignKey('works.id') |
| `status` | `String(20)` | default='active' |
| `pinned` | `Boolean` | default=False |
| `reject_reason` | `Text` | default='' |
| `reviewed_at` | `DateTime` | nullable=True |
| `reviewed_by` | `Integer` | nullable=True |
| `added_at` | `DateTime` | default=now |
| `work` | `relationship -> 'Work'` | — |

#### `StudioBan`

- 表名：`studio_bans`
- 用途：工作室黑名单：被移出的用户禁止再次申请加入。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `studio_id` | `Integer` | nullable=False, index=True, ForeignKey('studios.id') |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `created_at` | `DateTime` | default=now |
| `user` | `relationship -> 'User'` | — |

#### `StudioFollow`

- 表名：`studio_follows`
- 用途：关注工作室：关注后收到工作室动态通知。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `studio_id` | `Integer` | nullable=False, index=True, ForeignKey('studios.id') |
| `created_at` | `DateTime` | default=now |

#### `Notification`

- 表名：`notifications`
- 用途：站内通知：点赞/评论/回复/关注等事件。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `actor_id` | `Integer` | nullable=True, ForeignKey('users.id') |
| `type` | `String(30)` | nullable=False |
| `target_type` | `String(20)` | nullable=True |
| `target_id` | `Integer` | nullable=True |
| `content` | `Text` | default='' |
| `is_read` | `Boolean` | default=False |
| `created_at` | `DateTime` | default=now |
| `actor` | `relationship -> 'User'` | — |

#### `SearchHot`

- 表名：`search_hot`
- 用途：热搜词：搜索时累加计数，云端展示。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `keyword` | `String(50)` | unique=True, index=True, nullable=False |
| `count` | `Integer` | default=1 |
| `updated_at` | `DateTime` | default=now |

#### `RecycleBin`

- 表名：`recycle_bin`
- 用途：内容回收站：删除的稿件/帖子暂存，可恢复。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `title` | `String(200)` | default='' |
| `reason` | `String(200)` | default='' |
| `deleted_by` | `Integer` | nullable=True |
| `created_at` | `DateTime` | default=now |

#### `Report`

- 表名：`reports`
- 用途：举报：对稿件/帖子/评论的举报，管理员审核处理。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `reporter_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `reason` | `String(50)` | default='其他' |
| `status` | `String(20)` | default='pending' |
| `created_at` | `DateTime` | default=now |
| `handled_by` | `Integer` | nullable=True, ForeignKey('users.id') |
| `handled_at` | `DateTime` | nullable=True |
| `note` | `String(200)` | default='' |
| `reporter` | `relationship -> 'User'` | — |
| `handler` | `relationship -> 'User'` | — |

#### `Draft`

- 表名：`drafts`
- 用途：草稿箱：帖子/稿件自动保存的草稿（同一类型可有多份）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `draft_type` | `String(20)` | nullable=False |
| `data` | `Text` | default='{}' |
| `updated_at` | `DateTime` | default=now |

#### `EventClaim`

- 表名：`event_claims`
- 用途：限时活动奖励的领取记录（例如「9 月 30 日当天登录送 300 经验 + 100 小鱼干」）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `event_key` | `String(60)` | nullable=False, index=True |
| `xp` | `Integer` | default=0 |
| `fish` | `Integer` | default=0 |
| `created_at` | `DateTime` | default=now, index=True |

#### `MapLight`

- 表名：`map_lights`
- 用途：「锦绣山河·点亮中国」里被点亮的省。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `event_key` | `String(60)` | nullable=False, index=True |
| `region` | `String(50)` | nullable=False |
| `first_at` | `DateTime` | default=now, nullable=False, index=True |
| `first_uid` | `String(32)` | default='' |
| `first_nickname` | `String(64)` | default='' |

#### `ScratchQuotaRequest`

- 表名：`scratch_quota_requests`
- 用途：账号存储扩容申请（原「Scratch 作品容量」申请，表名沿用不改，省一次迁移）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, index=True, ForeignKey('users.id') |
| `used_mb` | `Integer` | default=0 |
| `quota_mb` | `Integer` | default=0 |
| `message` | `Text` | default='' |
| `status` | `String(16)` | default='pending', index=True |
| `created_at` | `DateTime` | default=now, index=True |
| `reviewed_at` | `DateTime` | nullable=True |
| `reviewed_by` | `Integer` | nullable=True, ForeignKey('users.id') |
| `grant_mb` | `Integer` | nullable=True |
| `admin_note` | `Text` | default='' |

#### `SiteSetting`

- 表名：`site_settings`
- 用途：站点设置（键值对）：如全站公告。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `key` | `String(50)` | primary_key=True |
| `value` | `Text` | default='' |

#### `SensitiveWord`

- 表名：`sensitive_words`
- 用途：敏感词（存数据库，管理员可动态增删；builtin=1 表示内置词，可删除）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `word` | `String(50)` | unique=True, nullable=False |
| `builtin` | `Boolean` | default=False |
| `created_at` | `DateTime` | default=now |

#### `ContentReview`

- 表名：`content_reviews`
- 用途：内容复审队列：命中敏感词、或被风纪委员隐藏的内容，等管理员裁决。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `sensitive_words` | `String(200)` | default='' |
| `status` | `String(20)` | default='pending' |
| `penalty` | `String(50)` | default='' |
| `penalty_detail` | `String(200)` | default='' |
| `created_at` | `DateTime` | default=now |
| `handled_at` | `DateTime` | nullable=True |
| `handled_by` | `Integer` | nullable=True |
| `source` | `String(16)` | default='sensitive', index=True |
| `reviewer_id` | `Integer` | nullable=True, ForeignKey('users.id') |
| `reviewer_note` | `String(200)` | default='' |
| `resolved_by` | `String(16)` | default='' |

#### `CommitteeVote`

- 表名：`committee_votes`
- 用途：风纪委员对「待审内容」的投票（站长 2026-10-01）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `voter_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `created_at` | `DateTime` | default=now, index=True |

#### `Reaction`

- 表名：`reactions`
- 用途：表情回应：对稿件/帖子/评论快速回应。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `target_type` | `String(20)` | nullable=False |
| `target_id` | `Integer` | nullable=False |
| `emoji` | `String(10)` | nullable=False |
| `created_at` | `DateTime` | default=now |

#### `PostVersion`

- 表名：`post_versions`
- 用途：帖子编辑历史（保留最近版本，供管理员查看）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `post_id` | `Integer` | nullable=False, index=True, ForeignKey('posts.id') |
| `title` | `String(200)` | default='' |
| `content` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |

#### `WorkVersion`

- 表名：`work_versions`
- 用途：稿件编辑历史（保留最近版本，供管理员查看）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `work_id` | `Integer` | nullable=False, index=True, ForeignKey('works.id') |
| `title` | `String(200)` | default='' |
| `description` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |

#### `ChatBlock`

- 表名：`chat_blocks`
- 用途：私聊黑名单：屏蔽后对方无法再给你发私聊。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `blocker_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `blocked_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `created_at` | `DateTime` | default=now |

#### `Series`

- 表名：`series`
- 用途：稿件系列：作者把稿件归入系列。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `name` | `String(100)` | nullable=False |
| `description` | `Text` | default='' |
| `cover_url` | `String(500)` | nullable=True |
| `created_at` | `DateTime` | default=now |

#### `SeriesWork`

- 表名：`series_works`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `series_id` | `Integer` | nullable=False, ForeignKey('series.id') |
| `work_id` | `Integer` | nullable=False, ForeignKey('works.id') |
| `added_at` | `DateTime` | default=now |
| `work` | `relationship -> 'Work'` | — |

#### `Collection`

- 表名：`collections`
- 用途：公开精选集：把喜欢的稿件整理成可分享的专题。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `name` | `String(100)` | nullable=False |
| `description` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |

#### `CollectionItem`

- 表名：`collection_items`

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `collection_id` | `Integer` | nullable=False, ForeignKey('collections.id') |
| `work_id` | `Integer` | nullable=False, ForeignKey('works.id') |
| `added_at` | `DateTime` | default=now |
| `work` | `relationship -> 'Work'` | — |

#### `Friendship`

- 表名：`friendships`
- 用途：好友关系：双向各存一条 active 记录。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `friend_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `status` | `String(20)` | default='pending' |
| `created_at` | `DateTime` | default=now |

#### `WorkRating`

- 表名：`work_ratings`
- 用途：试玩评价：评分 + 快捷标签。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `work_id` | `Integer` | nullable=False, ForeignKey('works.id') |
| `user_id` | `Integer` | nullable=False, ForeignKey('users.id') |
| `score` | `Integer` | default=5 |
| `tags` | `String(100)` | default='' |
| `created_at` | `DateTime` | default=now |

#### `WorkView`

- 表名：`work_views`
- 用途：稿件浏览去重记录：同用户/同IP 30 分钟内只计一次浏览。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `work_id` | `Integer` | nullable=False, index=True, ForeignKey('works.id') |
| `user_id` | `Integer` | nullable=True |
| `ip` | `String(50)` | default='' |
| `viewed_at` | `DateTime` | default=now, index=True |

#### `Feedback`

- 表名：`feedbacks`
- 用途：用户反馈：报 Bug / 提建议（页脚「意见反馈」入口）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `user_id` | `Integer` | nullable=True, ForeignKey('users.id') |
| `kind` | `String(20)` | default='suggestion' |
| `title` | `String(120)` | default='' |
| `content` | `Text` | nullable=False |
| `contact` | `String(200)` | default='' |
| `status` | `String(20)` | default='open' |
| `reply` | `Text` | nullable=True |
| `media` | `Text` | default='' |
| `created_at` | `DateTime` | default=now |
| `handled_at` | `DateTime` | nullable=True |
| `user` | `relationship -> 'User'` | — |

#### `AuditLog`

- 表名：`audit_logs`
- 用途：安全审计日志：自动记录后台写操作 + 登录/改密/注销等敏感请求（含操作人与IP）。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `created_at` | `DateTime` | default=now, index=True |
| `user_id` | `Integer` | nullable=True |
| `username` | `String(60)` | default='' |
| `method` | `String(10)` | default='' |
| `path` | `String(300)` | default='' |
| `status` | `Integer` | default=0 |
| `ip` | `String(64)` | default='' |
| `detail` | `String(500)` | default='' |

#### `CodemaoCode`

- 表名：`codemao_codes`
- 用途：编程猫「免密码验证」登录的一次性校验码。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `codemao_uid` | `String(32)` | index=True, nullable=False |
| `code` | `String(32)` | nullable=False |
| `session_hash` | `String(64)` | index=True, nullable=False |
| `prev_doing` | `Text` | default='' |
| `attempts` | `Integer` | default=0, nullable=False |
| `created_at` | `DateTime` | default=now, index=True |
| `expires_at` | `DateTime` | nullable=False |
| `used_at` | `DateTime` | nullable=True |
| `request_ip` | `String(64)` | default='' |

#### `Upload`

- 表名：`uploads`
- 用途：上传文件登记表。

| 列 | 类型 | 约束 / 备注 |
| --- | --- | --- |
| `id` | `Integer` | primary_key=True |
| `owner_id` | `Integer` | index=True |
| `path` | `String(400)` | unique=True, index=True |
| `size` | `Integer` | default=0 |
| `kind` | `String(16)` | default='' |
| `created_at` | `DateTime` | default=datetime.utcnow, index=True |
