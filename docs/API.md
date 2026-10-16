
### 认证与会话

*登录、注册、邮箱验证码、令牌刷新、GitHub OAuth、登出*

路由前缀：`/auth`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/auth/codemao/code` | 公开 | 免密码验证 · 第一步：给训练师编号发一个一次性校验码（同时把他的原签名带回去展示）。 |
| `POST` | `/auth/codemao/verify` | 公开 | 免密码验证 · 第二步：读回「我正在做什么」比对校验码，通过则直接登录/注册。 |
| `POST` | `/auth/email/send-code` | 公开 | 给邮箱发验证码。purpose=register 用于邮箱注册，purpose=reset 用于找回密码。 |
| `POST` | `/auth/forgot` | 公开 | 按账号绑定的邮箱发送重置验证码。 |
| `POST` | `/auth/github/authorize-url` | 公开 | 拿 GitHub 授权地址。 |
| `GET` | `/auth/github/callback` | 公开 | GitHub 授权后浏览器回到这里（注册在 GitHub 上的 Redirect URI 就是这个）。 |
| `POST` | `/auth/github/claim` | 公开 | 用回调给的一次性票据换登录态（或确认绑定完成）。 |
| `POST` | `/auth/github/exchange` | 公开 | 用 GitHub 回跳带来的 code 完成登录或绑定（前端直接回调时用）。 |
| `POST` | `/auth/login` | 公开 | — |
| `POST` | `/auth/login-codemao` | 公开 | 编程猫快捷登录：验证编程猫账号 -> 已绑定则登录；未绑定则自动注册并绑定（一站式注册）。已注销的旧绑定视同删除，自动开新账号。 |
| `GET` | `/auth/me` | 公开 | — |
| `POST` | `/auth/register` | 公开 | — |
| `POST` | `/auth/register-codemao` | 公开 | 用编程猫账号注册本站：验证编程猫账号 -> 创建本站账号并绑定，同步昵称/头像。 |
| `POST` | `/auth/reset_password` | 公开 | 校验邮箱验证码并设置新密码。 |

### 用户

*资料、头像、关注、收藏、历史、设置、隐私、经验等级、护照认证*

路由前缀：`/users`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/users` | 公开 | — |
| `GET` | `/users/blocks` | 公开 | 我的拉黑列表（须在 /{uid} 前注册避免被捕获）。 |
| `PATCH` | `/users/me` | 公开 | — |
| `POST` | `/users/me/bind-codemao` | 公开 | 绑定编程猫账号：验证账号 -> 绑定 uid 并同步昵称/头像。密码即用即弃。 |
| `GET` | `/users/me/bind_rewards` | 公开 | 经验中心的「绑定奖励」：三项各自的绑定/领取状态与能领多少。 |
| `POST` | `/users/me/bind_rewards/claim` | 公开 | 领取某一项绑定奖励。已领过 / 没绑定都会被拒。 |
| `GET` | `/users/me/codemao-works` | 公开 | 拉取当前用户绑定编程猫账号的作品列表，并**标出哪些已经在本站投过稿**。 |
| `GET` | `/users/me/codemao-works/{work_id}` | 公开 | 拉单个编程猫作品的详情，用来「选中即自动填好编辑器 + 播放地址」。 |
| `GET` | `/users/me/codemao_level` | 公开 | 读当前绑定的编程猫账号的作者等级 + 徽章 + 可领取状态。 |
| `POST` | `/users/me/codemao_level/claim` | 公开 | 一键把经验加满到编程猫等级对应的本站保底等级。 |
| `GET` | `/users/me/collections` | 公开 | — |
| `POST` | `/users/me/collections` | 公开 | — |
| `DELETE` | `/users/me/collections/{collection_id}` | 公开 | — |
| `GET` | `/users/me/comments` | 公开 | — |
| `POST` | `/users/me/deactivate` | 公开 | 注销账号（软注销）：校验密码后隐藏账号与内容。 |
| `POST` | `/users/me/email` | 公开 | 绑定 / 换绑邮箱：校验发到新邮箱的验证码（+ 设过密码的账号还要验当前密码）。 |
| `POST` | `/users/me/email/send-code` | 公开 | 给「准备绑定的新邮箱」发验证码。需要登录。 |
| `POST` | `/users/me/email/unbind` | 公开 | 解绑邮箱：写回不可达的占位地址。 |
| `GET` | `/users/me/favorites` | 公开 | — |
| `PUT` | `/users/me/featured` | 公开 | 设置个人主页精选稿件（最多 3 个，按传入顺序）。 |
| `GET` | `/users/me/folders` | 公开 | — |
| `POST` | `/users/me/folders` | 公开 | — |
| `DELETE` | `/users/me/folders/{folder_id}` | 公开 | — |
| `PATCH` | `/users/me/folders/{folder_id}` | 公开 | — |
| `POST` | `/users/me/github/unbind` | 公开 | 解绑 GitHub。 |
| `DELETE` | `/users/me/history` | 公开 | 清空浏览记录。 |
| `GET` | `/users/me/history` | 公开 | — |
| `DELETE` | `/users/me/history/{work_id}` | 公开 | 删除单条浏览记录。 |
| `GET` | `/users/me/interests` | 公开 | — |
| `PUT` | `/users/me/interests` | 公开 | — |
| `GET` | `/users/me/invite-code` | 公开 | 我还能不能补填邀请码 / 已经填的是谁（账号设置与经验中心那块卡片用）。 |
| `POST` | `/users/me/invite-code` | 公开 | 补填邀请码（注册后 24 小时内，且没填过）。 |
| `GET` | `/users/me/liked_by` | 公开 | 谁赞了我的内容（作品/帖子）：返回赞我的人 + 被赞内容。 |
| `GET` | `/users/me/likes` | 公开 | — |
| `POST` | `/users/me/logout_all` | 公开 | 退出所有设备：token 版本 +1，旧 token 全部失效。 |
| `GET` | `/users/me/notify_prefs` | 公开 | — |
| `PUT` | `/users/me/notify_prefs` | 公开 | — |
| `POST` | `/users/me/password` | 公开 | — |
| `GET` | `/users/me/recommend` | 公开 | 推荐关注：同领域标签 / 同工作室成员（排除已关注）。 |
| `GET` | `/users/me/scratch-quota` | 公开 | — |
| `POST` | `/users/me/scratch-quota/apply` | 公开 | — |
| `POST` | `/users/me/signin` | 公开 | 每日签到：+10 经验，并按等级发小鱼干（LV0 是 0 个）。一天只能签一次。 |
| `GET` | `/users/me/storage` | 公开 | 我的存储用量（含分类明细）/ 配额 / 能不能申请 / 待审与历史。 |
| `POST` | `/users/me/storage/apply` | 公开 | 提交扩容申请（剩余空间不足 50MB 才有资格）。 |
| `GET` | `/users/me/topic_subscriptions` | 公开 | — |
| `POST` | `/users/me/topic_subscriptions` | 公开 | 订阅/取消订阅话题：{topic, subscribe: bool}。 |
| `POST` | `/users/me/treaty` | 公开 | — |
| `POST` | `/users/me/unbind-codemao` | 公开 | 解绑编程猫账号（保留本站资料）。 |
| `GET` | `/users/me/weekly_report` | 公开 | — |
| `GET` | `/users/me/xp_center` | 公开 | 经验中心：等级 / 进度 / 经验来源明细 / 小鱼干与签到状态 / 等级说明表。 |
| `GET` | `/users/me/xp_detail` | 公开 | 经验中心：等级 / 进度 / 经验来源明细 / 小鱼干与签到状态 / 等级说明表。 |
| `GET` | `/users/{uid}` | 公开 | — |
| `DELETE` | `/users/{uid}/block` | 公开 | — |
| `POST` | `/users/{uid}/block` | 公开 | 拉黑用户：对方的内容全站不可见。 |
| `DELETE` | `/users/{uid}/follow` | 公开 | — |
| `POST` | `/users/{uid}/follow` | 公开 | — |
| `GET` | `/users/{uid}/followers` | 公开 | — |
| `GET` | `/users/{uid}/following` | 公开 | — |

### 作品

*投稿、列表、详情、编辑、删除、源码、试玩、系列*

路由前缀：`/works`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/works` | 公开 | — |
| `POST` | `/works` | 公开 | — |
| `GET` | `/works/editors` | 公开 | — |
| `GET` | `/works/favorites` | 公开 | — |
| `GET` | `/works/later` | 公开 | 稍后看列表：按 ids 顺序返回（逗号分隔），未发布/不存在自动跳过。 |
| `POST` | `/works/series` | 公开 | — |
| `GET` | `/works/series/list` | 公开 | — |
| `DELETE` | `/works/series/{series_id}` | 公开 | — |
| `GET` | `/works/series/{series_id}` | 公开 | — |
| `POST` | `/works/series/{series_id}/works` | 公开 | — |
| `DELETE` | `/works/series/{series_id}/works/{work_id}` | 公开 | — |
| `GET` | `/works/user/{uid}` | 公开 | 某个用户的稿件列表。 |
| `DELETE` | `/works/{work_id}` | 公开 | — |
| `GET` | `/works/{work_id}` | 公开 | 作品详情：可见性校验（已发布人人可见；审核中/被驳回仅作者或管理员可见）+ 播放地址 + 浏览量去重。 |
| `PATCH` | `/works/{work_id}` | 公开 | — |
| `POST` | `/works/{work_id}/appeal` | 公开 | 被下架/驳回的稿件申诉：提交理由，管理员可在后台查看。 |
| `GET` | `/works/{work_id}/comments` | 公开 | — |
| `POST` | `/works/{work_id}/comments` | 公开 | — |
| `DELETE` | `/works/{work_id}/comments/{comment_id}` | 公开 | — |
| `POST` | `/works/{work_id}/comments/{comment_id}/like` | 公开 | — |
| `POST` | `/works/{work_id}/comments/{comment_id}/pin` | 公开 | 作者置顶一条优质评论。 |
| `POST` | `/works/{work_id}/favorite` | 公开 | — |
| `POST` | `/works/{work_id}/feed` | 公开 | 给稿件投喂小鱼干（1 或 2 个）。 |
| `POST` | `/works/{work_id}/like` | 公开 | — |
| `GET` | `/works/{work_id}/likes` | 公开 | 谁赞了这个稿件（头像列表）。 |
| `GET` | `/works/{work_id}/ratings` | 公开 | — |
| `POST` | `/works/{work_id}/ratings` | 公开 | — |
| `GET` | `/works/{work_id}/related` | 公开 | 相关推荐：同分类稿件为主，不足时补热门稿件（排除自己）。 |
| `GET` | `/works/{work_id}/related` | 公开 | 猜你喜欢：同分类 / 共享标签 -> 按热度推荐。 |
| `GET` | `/works/{work_id}/stats` | 公开 | — |
| `POST` | `/works/{work_id}/view` | 公开 | — |

### 帖子与评论

*论坛帖子、评论、点赞、置顶、草稿发布*

路由前缀：`/posts`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/posts` | 公开 | — |
| `POST` | `/posts` | 公开 | — |
| `GET` | `/posts/topics` | 公开 | 热门话题统计。 |
| `DELETE` | `/posts/{post_id}` | 公开 | — |
| `GET` | `/posts/{post_id}` | 公开 | — |
| `PATCH` | `/posts/{post_id}` | 公开 | — |
| `GET` | `/posts/{post_id}/comments` | 公开 | — |
| `POST` | `/posts/{post_id}/comments` | 公开 | — |
| `DELETE` | `/posts/{post_id}/comments/{comment_id}` | 公开 | — |
| `POST` | `/posts/{post_id}/comments/{comment_id}/like` | 公开 | — |
| `POST` | `/posts/{post_id}/comments/{comment_id}/pin` | 公开 | 楼主置顶一条优质评论。 |
| `POST` | `/posts/{post_id}/favorite` | 公开 | 收藏帖子。 |
| `POST` | `/posts/{post_id}/favorite` | 公开 | — |
| `POST` | `/posts/{post_id}/feed` | 公开 | 给帖子投喂小鱼干（1 或 2 个）。 |
| `POST` | `/posts/{post_id}/like` | 公开 | — |
| `POST` | `/posts/{post_id}/pin` | 公开 | 作者置顶自己的帖子（最多 1 个）。 |
| `POST` | `/posts/{post_id}/poll/vote` | 公开 | — |
| `GET` | `/posts/{post_id}/versions` | 公开 | 编辑历史：作者本人（或管理员）查看自己的帖子历史版本。 |

### 草稿箱

*帖子 / 作品草稿的保存与恢复*

路由前缀：`/drafts`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/drafts` | 公开 | — |
| `POST` | `/drafts` | 公开 | 保存草稿：带 draft_id 则更新该草稿，否则新建一份草稿。 |
| `DELETE` | `/drafts/{draft_id}` | 公开 | — |
| `GET` | `/drafts/{draft_id}` | 公开 | — |
| `POST` | `/drafts/{draft_id}/duplicate` | 公开 | 复制一份草稿（另存为新草稿）。 |

### 搜索

*全站搜索、搜索建议、话题*

路由前缀：`/search`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/search` | 公开 | — |
| `GET` | `/search/hot` | 公开 | 热搜词（云端累计）。 |
| `GET` | `/search/sensitive/check` | 公开 | 敏感词实时检查：返回命中的词（前端输入时标红用）。 |
| `GET` | `/search/suggest` | 公开 | 搜索联想：热搜 + 标签 + 稿件标题。 |
| `GET` | `/search/users` | 公开 | @ 联想用的轻量用户搜索（按用户名/昵称模糊匹配）。 |

### 发现页

*推荐流、分类筛选、分页*

路由前缀：`/discover`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/discover/categories` | 公开 | — |
| `GET` | `/discover/feed` | 公开 | 关注的人的最新稿件与帖子，合并成动态流（支持分页，前端用「加载更多」翻页）。 |
| `GET` | `/discover/home` | 公开 | 编程猫式首页：轮播 Banner + 官方精选 + 大家都在玩 + 最新投稿 + 关注动态。 |
| `GET` | `/discover/posts/hot_today` | 公开 | 今日热帖：24 小时内按浏览/点赞综合排序。 |
| `GET` | `/discover/random` | 公开 | 随机来一个**已上架**作品（发现页「随机看看」用）。 |
| `GET` | `/discover/tags` | 公开 | — |
| `GET` | `/discover/works` | 公开 | — |
| `GET` | `/discover/works/hot_week` | 公开 | 本周黑马：近 7 天发布、按浏览/点赞/收藏综合增长排序（首页最下面；支持 limit 出 TOP50）。 |

### 首页聚合

*首页一次拉取所需的聚合数据*

路由前缀：`/kh`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/kh/home` | 公开 | 首页三大板块数据（匿名可访问，只读）。 |

### 通知

*通知列表、未读数、已读标记*

路由前缀：`/notifications`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/notifications` | 公开 | — |
| `POST` | `/notifications/delete_batch` | 公开 | 批量删除通知。 |
| `POST` | `/notifications/read_all` | 公开 | — |
| `GET` | `/notifications/types` | 公开 | 按显示名去重分组：如 3 个「工作室」类型合并成一组，返回组内全部 type。 |
| `GET` | `/notifications/unread_count` | 公开 | — |
| `DELETE` | `/notifications/{notification_id}` | 公开 | 删除单条通知。 |
| `POST` | `/notifications/{notification_id}/read` | 公开 | — |

### 私信与群聊

*会话、消息、群成员、免打扰、已读回执（受聊天总开关控制）*

路由前缀：`/chat`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/chat/blocks` | 公开 | — |
| `DELETE` | `/chat/blocks/{member_uid}` | 公开 | — |
| `POST` | `/chat/blocks/{member_uid}` | 公开 | — |
| `GET` | `/chat/discover` | 公开 | 可加入的群（不含工作室讨论区）。 |
| `DELETE` | `/chat/messages/{message_id}` | 公开 | 删除消息：本人；群内管理员可删他人消息（留痕为「已删除」）。 |
| `POST` | `/chat/messages/{message_id}/recall` | 公开 | — |
| `GET` | `/chat/threads` | 公开 | 我参与的会话列表（kind=all\|dm\|group）。 |
| `POST` | `/chat/threads/dm` | 公开 | 按对方 uid 打开（或创建）私聊。 |
| `POST` | `/chat/threads/group` | 公开 | — |
| `DELETE` | `/chat/threads/{thread_id}` | 公开 | — |
| `GET` | `/chat/threads/{thread_id}` | 公开 | — |
| `PATCH` | `/chat/threads/{thread_id}` | 公开 | 改群资料（群主/管理员）。 |
| `POST` | `/chat/threads/{thread_id}/join` | 公开 | — |
| `POST` | `/chat/threads/{thread_id}/leave` | 公开 | — |
| `PATCH` | `/chat/threads/{thread_id}/me` | 公开 | 我的会话设置：置顶 / 免打扰。 |
| `GET` | `/chat/threads/{thread_id}/media` | 公开 | 会话内的图片/语音（图片墙）。 |
| `DELETE` | `/chat/threads/{thread_id}/members/{member_uid}` | 公开 | 移出成员（群主可移出任何人；管理员只能移出普通成员）。 |
| `PATCH` | `/chat/threads/{thread_id}/members/{member_uid}` | 公开 | 设置成员禁言 / 管理员（群主或管理员）。 |
| `GET` | `/chat/threads/{thread_id}/messages` | 公开 | 分页拉消息（返回按时间正序；更早的消息用 before_id=本页第一条 id）。 |
| `POST` | `/chat/threads/{thread_id}/messages` | 公开 | REST 发送消息（Socket 未连接时的兜底通道）。 |
| `POST` | `/chat/threads/{thread_id}/mute-all` | 公开 | 全员禁言（群主）。minutes<=0 表示解除。 |
| `POST` | `/chat/threads/{thread_id}/read` | 公开 | — |
| `GET` | `/chat/threads/{thread_id}/search` | 公开 | 会话内消息搜索（转义 % 与 _，最多 50 条）。 |
| `GET` | `/chat/unread` | 公开 | 总未读（导航角标用）。 |
| `GET` | `/chat/users` | 公开 | 按昵称/账号/编号找人（用于发起私聊）。 |

### 好友与关注关系

*关注 / 粉丝 / 互关列表*

路由前缀：`/friends`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/friends` | 公开 | — |
| `GET` | `/friends/requests` | 公开 | — |
| `DELETE` | `/friends/{uid}` | 公开 | — |
| `POST` | `/friends/{uid}/accept` | 公开 | — |
| `POST` | `/friends/{uid}/request` | 公开 | — |

### 收藏夹

*收藏夹的增删改查与条目管理*

路由前缀：`/collections`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `DELETE` | `/collections/{collection_id}` | 公开 | — |
| `GET` | `/collections/{collection_id}` | 公开 | — |
| `POST` | `/collections/{collection_id}/items` | 公开 | — |
| `DELETE` | `/collections/{collection_id}/items/{work_id}` | 公开 | — |

### 互动

*点赞 / 投喂等表态*

路由前缀：`/reactions`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/reactions` | 公开 | — |
| `POST` | `/reactions` | 公开 | — |

### 工作室

*工作室的创建、成员、公告、审核、退出*

路由前缀：`/studios`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/studios` | 公开 | 工作室列表。sort: new 最新 / hot 最热（按总播放）/ members 成员最多。 |
| `POST` | `/studios` | 公开 | — |
| `GET` | `/studios/followed` | 公开 | — |
| `GET` | `/studios/{studio_id}` | 公开 | — |
| `PATCH` | `/studios/{studio_id}` | 公开 | — |
| `POST` | `/studios/{studio_id}/accept_transfer` | 公开 | — |
| `GET` | `/studios/{studio_id}/blacklist` | 公开 | — |
| `POST` | `/studios/{studio_id}/blacklist` | 公开 | — |
| `DELETE` | `/studios/{studio_id}/blacklist/{user_id}` | 公开 | — |
| `POST` | `/studios/{studio_id}/disband` | 公开 | — |
| `DELETE` | `/studios/{studio_id}/follow` | 公开 | — |
| `POST` | `/studios/{studio_id}/follow` | 公开 | — |
| `POST` | `/studios/{studio_id}/invite` | 公开 | — |
| `POST` | `/studios/{studio_id}/join` | 公开 | — |
| `POST` | `/studios/{studio_id}/leave` | 公开 | — |
| `DELETE` | `/studios/{studio_id}/members/{member_id}` | 公开 | — |
| `POST` | `/studios/{studio_id}/members/{member_id}/approve` | 公开 | — |
| `POST` | `/studios/{studio_id}/members/{member_id}/mute` | 公开 | — |
| `POST` | `/studios/{studio_id}/members/{member_id}/reject` | 公开 | — |
| `POST` | `/studios/{studio_id}/members/{member_id}/role` | 公开 | 注意：路径里的 member_id 实际是用户 id（保持与旧前端一致）。 |
| `POST` | `/studios/{studio_id}/rooms` | 公开 | 保留接口以兼容旧前端：现在一个工作室只有一个讨论群，成员自动同步。 |
| `DELETE` | `/studios/{studio_id}/rooms/{room_id}` | 公开 | — |
| `POST` | `/studios/{studio_id}/rooms/{room_id}/join` | 公开 | — |
| `POST` | `/studios/{studio_id}/rooms/{room_id}/leave` | 公开 | 退出讨论群但保留工作室成员身份；下次进入工作室会自动重新加入。 |
| `POST` | `/studios/{studio_id}/rooms/{room_id}/mute_all` | 公开 | — |
| `POST` | `/studios/{studio_id}/rooms/{room_id}/unmute_all` | 公开 | — |
| `POST` | `/studios/{studio_id}/transfer` | 公开 | — |
| `GET` | `/studios/{studio_id}/works` | 公开 | 作品墙。成员/管理员传 status=pending 看自己家的待审稿。 |
| `POST` | `/studios/{studio_id}/works` | 公开 | — |
| `DELETE` | `/studios/{studio_id}/works/{work_id}` | 公开 | — |
| `POST` | `/studios/{studio_id}/works/{work_id}/approve` | 公开 | — |
| `POST` | `/studios/{studio_id}/works/{work_id}/pin` | 公开 | 置顶/取消置顶作品墙稿件（最多 3 个）。 |
| `POST` | `/studios/{studio_id}/works/{work_id}/reject` | 公开 | 驳回投稿：保留记录并记下原因，作者可修改后重新投稿（旧版是直接删记录）。 |

### 活动与比赛

*接力赛等活动、参赛、投票、获奖*

路由前缀：`/admin/contests`、`/contests`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/admin/contests/{key}/award` | 公开 | 开奖发奖。幂等：每个获奖作品只发一次（靠 event_claims 的唯一约束兜底）。 |
| `GET` | `/admin/contests/{key}/preview` | 公开 | 开奖预览：最终名次 + 每个名次应发多少（不改任何数据）。 |
| `GET` | `/contests` | 公开 | — |
| `GET` | `/contests/{key}` | 公开 | — |
| `GET` | `/contests/{key}/my` | 公开 | — |

### 地图活动

*点亮家乡类活动的省份数据与领奖*

路由前缀：`/admin/map-event`、`/map-event`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/admin/map-event/award` | 公开 | — |
| `GET` | `/admin/map-event/preview` | 公开 | — |
| `GET` | `/map-event` | 公开 | — |
| `POST` | `/map-event/claim` | 公开 | — |
| `POST` | `/map-event/claim-all` | 公开 | — |
| `GET` | `/map-event/province/{region}` | 公开 | 某个省的完整榜单（含未点亮但有作品的省，页面自己判断怎么显示）。 |

### 站点事件

*站点级活动横幅与公告*

路由前缀：`/events`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/events` | 公开 | — |
| `GET` | `/events/{key}` | 公开 | 单个活动（活动页 /event/<key> 用）。找不到就 404 —— 页面据此显示「活动不存在」。 |

### 意见反馈

*向管理组提交反馈（可带图）*

路由前缀：`/feedback`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/feedback` | 公开 | 仅管理员可查看全部反馈。 |
| `POST` | `/feedback` | 公开 | — |
| `POST` | `/feedback/{feedback_id}/close` | 公开 | 管理员标记已处理 / 重新打开（body: {status: 'done'\|'open'}）。 |

### 举报与申诉

*内容举报、我的举报、处理进度*

路由前缀：`/reports`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/reports` | 公开 | 举报列表（后台）。状态/类型/具体对象/处理人/时间范围/关键词筛选 + 分页，总数走 X-Total-Count。 |
| `POST` | `/reports` | 公开 | — |
| `GET` | `/reports/me` | 公开 | 我的举报及处理进度。 |
| `POST` | `/reports/{report_id}/handle` | 公开 | 处理 / 驳回一条举报，可带处理备注（会一并告知举报人）。 |

### 委员资格答题

*题库、抽题、交卷、成绩*

路由前缀：`/admin/exam`、`/exam`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/admin/exam/attempts/{aid}` | 公开 | — |
| `POST` | `/admin/exam/attempts/{aid}/grade` | 公开 | — |
| `POST` | `/admin/exam/attempts/{aid}/reset` | 公开 | — |
| `GET` | `/admin/exam/exams` | 公开 | — |
| `POST` | `/admin/exam/exams` | 公开 | — |
| `DELETE` | `/admin/exam/exams/{eid}` | 公开 | — |
| `PUT` | `/admin/exam/exams/{eid}` | 公开 | — |
| `GET` | `/admin/exam/exams/{eid}/attempts` | 公开 | — |
| `POST` | `/admin/exam/exams/{eid}/close` | 公开 | — |
| `GET` | `/admin/exam/exams/{eid}/paper` | 公开 | — |
| `PUT` | `/admin/exam/exams/{eid}/paper` | 公开 | — |
| `POST` | `/admin/exam/exams/{eid}/publish` | 公开 | — |
| `GET` | `/admin/exam/exams/{eid}/stats` | 公开 | — |
| `GET` | `/admin/exam/exams/{eid}/students` | 公开 | — |
| `POST` | `/admin/exam/exams/{eid}/students` | 公开 | — |
| `GET` | `/admin/exam/grading` | 公开 | — |
| `GET` | `/admin/exam/questions` | 公开 | — |
| `POST` | `/admin/exam/questions` | 公开 | — |
| `POST` | `/admin/exam/questions/import` | 公开 | — |
| `DELETE` | `/admin/exam/questions/{qid}` | 公开 | — |
| `PUT` | `/admin/exam/questions/{qid}` | 公开 | — |
| `GET` | `/exam/attempts/{aid}` | 公开 | — |
| `PATCH` | `/exam/attempts/{aid}` | 公开 | — |
| `GET` | `/exam/attempts/{aid}/result` | 公开 | — |
| `POST` | `/exam/attempts/{aid}/submit` | 公开 | — |
| `GET` | `/exam/list` | 公开 | — |
| `GET` | `/exam/my` | 公开 | — |
| `POST` | `/exam/{exam_id}/start` | 公开 | — |

### 认证与审核

*护照 / 实名认证提交与审核、认证状态*

路由前缀：`/`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/admin/verify-docs/{uid}` | 公开 | 读取护照图片。私有目录不经 nginx，只能从这里流出去，且限管理员。 |
| `POST` | `/admin/verify-docs/{uid}/approve` | 公开 | — |
| `POST` | `/admin/verify-docs/{uid}/reject` | 公开 | 驳回：保留护照文件（便于复核），状态置 rejected，用户可重新上传。 |
| `POST` | `/admin/verify-docs/{uid}/reset` | 公开 | 把用户退回「待上传」并删除已存护照（例如材料传错、要彻底清掉时用）。 |
| `GET` | `/admin/verify-queue` | 公开 | 待处理的实名审核。awaiting_passport 排前面（还没交材料，可发提醒）。 |
| `POST` | `/verify/passport` | 公开 | 上传护照个人信息页。只有「待上传 / 被驳回」两种状态可以传。 |
| `GET` | `/verify/status` | 公开 | 我自己的激活状态（锁定时前端靠它决定显示哪一页 / 哪几条路）。 |

### 文件上传

*图片 / 视频 / 头像文件上传*

路由前缀：`/upload`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/upload` | 公开 | — |
| `POST` | `/upload/scratch` | 公开 | 上传 Scratch 作品文件（.sb3），返回直链 /uploads/games/xxx.sb3。 |
| `POST` | `/upload/video` | 公开 | — |

### 公开接口（无需登录）

*对外只读 API，供第三方 / 爬虫 / SE 版使用*

路由前缀：`/public`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/public/announcement` | 公开 | 当前生效的站点公告。**无需登录** —— 首页对所有人展示它。 |
| `GET` | `/public/sitemap.xml` | 公开 | — |
| `GET` | `/public/works` | 公开 | 首页作品列表。 |

### 后台管理

*用户 / 内容 / 举报 / 风纪委员会 / 系统开关等管理端接口*

路由前缀：`/admin`

| 方法 | 完整路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/admin/announcement` | 公开 | — |
| `POST` | `/admin/announcement` | 公开 | 设置公告：带 scheduled_at（未来时间）则定时发布，否则立即生效。 |
| `GET` | `/admin/audit/{uid}` | 公开 | — |
| `GET` | `/admin/audit_logs` | 公开 | 安全审计日志：自动记录的后台写操作 + 登录/改密等敏感请求（支持分页）。 |
| `GET` | `/admin/banners` | 公开 | — |
| `POST` | `/admin/banners` | 公开 | — |
| `DELETE` | `/admin/banners/{banner_id}` | 公开 | — |
| `PATCH` | `/admin/banners/{banner_id}` | 公开 | — |
| `GET` | `/admin/cloud/rooms` | 公开 | 有云数据的作品列表（带作品标题，方便后台认）。 |
| `GET` | `/admin/cloud/rooms/{work_id}` | 公开 | 某个作品当前的云变量（含写入者 uid / 昵称 / 时间）。 |
| `POST` | `/admin/cloud/rooms/{work_id}/clear` | 公开 | 清空某个作品的云数据（在线客户端会收到空值，等于重置）。 |
| `GET` | `/admin/cloud/stats` | 公开 | 云变量服务总览：在线连接、房间、变量数、日志条数、库大小。 |
| `GET` | `/admin/comments` | 公开 | 评论列表（帖子评论 + 稿件评论合并）。 |
| `POST` | `/admin/comments/batch` | 公开 | 评论批量删除。 |
| `DELETE` | `/admin/comments/{comment_id}` | 公开 | — |
| `POST` | `/admin/committee/applications/{uid}/review` | 公开 | 审批风纪委员申请：decision = approve / reject（可带 note）。 |
| `POST` | `/admin/committee/members/{uid}/suspend` | 公开 | 停职 / 恢复某个风纪委员（body.suspended = true / false，可带 note）。 |
| `GET` | `/admin/committee/overview` | 公开 | 后台「风纪委员会」页签要的一屏数据：待审申请、成员、送审队列、统计。 |
| `GET` | `/admin/export/comments.csv` | 公开 | 导出评论数据 CSV。 |
| `GET` | `/admin/export/logs.csv` | 公开 | 导出操作日志 CSV。 |
| `GET` | `/admin/export/posts.csv` | 公开 | 导出帖子数据 CSV。 |
| `GET` | `/admin/export/reports.csv` | 公开 | 导出举报数据 CSV。 |
| `GET` | `/admin/export/users.csv` | 公开 | 导出用户数据 CSV。 |
| `GET` | `/admin/export/works.csv` | 公开 | 导出稿件数据 CSV。 |
| `GET` | `/admin/featured` | 公开 | 官方精选作品列表（管理用，含全部稿件供检索）。 |
| `GET` | `/admin/logs` | 公开 | — |
| `POST` | `/admin/notify` | 公开 | 向全体用户发送系统通知。 |
| `GET` | `/admin/posts` | 公开 | 帖子列表：状态/分类/作者/精华/置顶筛选 + 排序 + 分页，总数走 X-Total-Count。 |
| `POST` | `/admin/posts/batch` | 公开 | 帖子批量：delete / hide / restore（与稿件批量同规则，删除走级联清理并通知作者）。 |
| `DELETE` | `/admin/posts/{post_id}` | 公开 | — |
| `PATCH` | `/admin/posts/{post_id}` | 公开 | 管理员直接改帖子（标题/正文/分类/话题/状态/置顶/加精）。同样不拦敏感词，只回报命中。 |
| `POST` | `/admin/posts/{post_id}/feature` | 公开 | — |
| `POST` | `/admin/posts/{post_id}/pin` | 公开 | — |
| `POST` | `/admin/posts/{post_id}/unfeature` | 公开 | — |
| `POST` | `/admin/posts/{post_id}/unpin` | 公开 | — |
| `GET` | `/admin/posts/{post_id}/versions` | 公开 | — |
| `GET` | `/admin/recycle` | 公开 | 回收站：被删除的内容，可恢复（支持类型/关键词筛选与分页）。 |
| `POST` | `/admin/recycle/{recycle_id}/restore` | 公开 | 恢复回收站内容（稿件恢复为发布，帖子恢复）。 |
| `POST` | `/admin/reports/batch` | 公开 | 举报批量处理。可带统一备注，并记录处理人与处理时间。 |
| `GET` | `/admin/review_queue` | 公开 | 审核队列：待审核稿件 + 定时稿件 + 待处理举报。 |
| `GET` | `/admin/scratch-quota/requests` | 公开 | 扩容申请列表。status=pending/approved/rejected/all。 |
| `POST` | `/admin/scratch-quota/requests/{request_id}/review` | 公开 | 审批扩容申请：通过（带新配额 MB）或驳回（可写理由）。申请人会收到通知。 |
| `GET` | `/admin/sensitive-reviews` | 公开 | 敏感词审核队列：被隐藏的内容 + 命中词，管理员审核通过后展示。 |
| `POST` | `/admin/sensitive-reviews/{review_id}/approve` | 公开 | 审核通过：恢复内容展示（作品/帖子 -> published，评论 -> active），通知作者。 |
| `POST` | `/admin/sensitive-reviews/{review_id}/reject` | 公开 | 审核不通过：内容保持隐藏（作品/帖子 -> rejected，评论删除），可一键追加惩罚，通知作者。 |
| `GET` | `/admin/sensitive-stats` | 公开 | 敏感词命中统计（依据举报理由 + 敏感词表）。 |
| `GET` | `/admin/sensitive-words` | 公开 | — |
| `POST` | `/admin/sensitive-words` | 公开 | 添加敏感词：支持英文逗号分隔的一长串，自动拆分为多个独立词（兼容中文逗号/空格/换行）。 |
| `GET` | `/admin/sensitive-words/stats` | 公开 | 敏感词命中统计：按审核队列中的命中词计数 + 各词审核结果。 |
| `DELETE` | `/admin/sensitive-words/{word_id}` | 公开 | — |
| `GET` | `/admin/stats` | 公开 | — |
| `GET` | `/admin/studios` | 公开 | — |
| `GET` | `/admin/studios/{studio_id}` | 公开 | 单个工作室的完整资料 + 计数（弹窗打开/操作后刷新用，不必重载整页）。 |
| `PATCH` | `/admin/studios/{studio_id}` | 公开 | 管理员直接编辑工作室资料（室里改不动的、或室长跑路了都能救）。 |
| `POST` | `/admin/studios/{studio_id}/ban` | 公开 | — |
| `POST` | `/admin/studios/{studio_id}/force_disband` | 公开 | 社区管理员强制解散工作室。 |
| `POST` | `/admin/studios/{studio_id}/freeze` | 公开 | — |
| `DELETE` | `/admin/studios/{studio_id}/invite` | 公开 | 清空邀请码：只能凭审核加入，不能再凭码进。 |
| `POST` | `/admin/studios/{studio_id}/invite` | 公开 | 重新生成邀请码（旧码立即失效）。 |
| `GET` | `/admin/studios/{studio_id}/members` | 公开 | 成员 / 待审申请列表。室长排最前，管理员次之，其余按加入时间。 |
| `DELETE` | `/admin/studios/{studio_id}/members/{user_id}` | 公开 | 把成员移出工作室（也用于驳回待审申请）。室长不能这样移，先转让。 |
| `POST` | `/admin/studios/{studio_id}/members/{user_id}/mute` | 公开 | 在工作室里禁言 / 解除禁言（不影响站内其它地方发言）。 |
| `POST` | `/admin/studios/{studio_id}/members/{user_id}/role` | 公开 | 管理员任免工作室管理员。室长本身要换请走 /transfer_owner。 |
| `POST` | `/admin/studios/{studio_id}/transfer_owner` | 公开 | 管理员强制转让室长：立即生效，不需要对方确认（与室长自己发起的「待确认」不同）。 |
| `POST` | `/admin/studios/{studio_id}/unban` | 公开 | — |
| `POST` | `/admin/studios/{studio_id}/unfreeze` | 公开 | — |
| `GET` | `/admin/switches` | 公开 | 站点开关当前状态。默认值来自环境变量，后台改过的会标 changed。 |
| `PATCH` | `/admin/switches/{key}` | 公开 | 打开/关闭一个站点开关。写入后立刻刷新进程缓存，无需重启。 |
| `GET` | `/admin/user-regions` | 公开 | 用户属地分布：给「按属地筛选」当选项，也能一眼看出用户都来自哪儿。 |
| `GET` | `/admin/users` | 公开 | 用户列表：关键词 + 角色/状态/登录/实名筛选 + 排序 + 分页。 |
| `GET` | `/admin/users/banned` | 公开 | 封禁用户列表（含到期提醒）。 |
| `POST` | `/admin/users/batch` | 公开 | 批量操作用户。一次最多 200 个，管理员账号与（对封禁类）自己会被跳过并回报。 |
| `DELETE` | `/admin/users/{uid}` | 公开 | 彻底删除账号 —— 像从来没存在过一样。 |
| `PATCH` | `/admin/users/{uid}` | 公开 | 管理员修改他人资料：昵称/简介/头像/临时封禁时间。每次修改都通知该用户。 |
| `POST` | `/admin/users/{uid}/ban` | 公开 | — |
| `GET` | `/admin/users/{uid}/delete-preview` | 公开 | 彻底删除前的预览：这个账号到底牵连多少东西（只统计，不动数据）。 |
| `GET` | `/admin/users/{uid}/detail` | 公开 | 用户详情：完整资料 + 内容统计 + 操作历史。 |
| `POST` | `/admin/users/{uid}/fish` | 公开 | 管理员授予用户小鱼干（可为负）。 |
| `POST` | `/admin/users/{uid}/force_logout` | 公开 | 强制下线：把 token_version +1，该用户手上所有 token 立刻失效（下次请求 401）。 |
| `POST` | `/admin/users/{uid}/purge` | 公开 | 一键清空用户内容：稿件下架、帖子/评论删除。 |
| `POST` | `/admin/users/{uid}/scratch-quota` | 公开 | 直接设置某个用户的账号存储配额（MB）。管理员手动调整用。 |
| `POST` | `/admin/users/{uid}/unban` | 公开 | — |
| `DELETE` | `/admin/users/{uid}/verify` | 公开 | — |
| `POST` | `/admin/users/{uid}/verify` | 公开 | — |
| `POST` | `/admin/users/{uid}/xp` | 公开 | 管理员加减用户经验（调整 xp_bonus）。 |
| `GET` | `/admin/verifications` | 公开 | — |
| `GET` | `/admin/works` | 公开 | 稿件列表：状态/分类/作者/精选/置顶/编辑器筛选 + 排序 + 分页，总数走 X-Total-Count。 |
| `POST` | `/admin/works/batch` | 公开 | 稿件批量：delete（彻底删）/ hide（下架待审）/ restore（重新上架）。 |
| `DELETE` | `/admin/works/{work_id}` | 公开 | — |
| `PATCH` | `/admin/works/{work_id}` | 公开 | 管理员直接改稿件资料（标题/简介/分类/标签/状态/封面/置顶/精选）。 |
| `POST` | `/admin/works/{work_id}/feature` | 公开 | — |
| `POST` | `/admin/works/{work_id}/pin` | 公开 | — |
| `POST` | `/admin/works/{work_id}/review` | 公开 | 稿件审核：approve 通过 / reject 驳回（通知作者）。 |
| `POST` | `/admin/works/{work_id}/unfeature` | 公开 | — |
| `POST` | `/admin/works/{work_id}/unpin` | 公开 | — |
| `GET` | `/admin/works/{work_id}/versions` | 公开 | — |
