# KitterHub 公开接口

> 给站外页面 / 合作方用的只读接口。无需鉴权、无需密钥、无需传 token。
> 数据结构变更会同步本文件；字段名是公开契约，不要依赖本文档以外的字段。

**Base URL**：`https://example.com`

---

## GET /api/public/works

首页作品列表（与站内首页「最新投稿 / 官方精选」同一批稿件）。

### 请求参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `section` | string | `newest` | `newest` 最新投稿 ｜ `featured` 官方精选。其他值返回 `422` |
| `limit` | number | `12` | 1~50，超出范围自动夹取 |

### 响应

```json
{
  "section": "newest",
  "count": 1,
  "items": [
    {
      "id": 1,
      "title": "示例作品标题",
      "description": "示例作品介绍，纯文本，可含换行",
      "cover": "https://example.com/uploads/example.jpg",
      "url": "https://example.com/works/1",
      "play_url": "https://player.example.com/player?type=2&workId=100000001",
      "author": {
        "uid": "10001",
        "name": "示例用户",
        "avatar": "https://cdn.example.com/avatar/example.png"
      }
    }
  ]
}
```

### 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | number | 作品 ID |
| `title` | string | 作品名 |
| `description` | string | 作品介绍，纯文本，可能含换行，可能为空串 |
| `cover` | string \| null | 封面图，绝对地址；无封面为 `null` |
| `url` | string | 作品页链接（KitterHub 站内） |
| `play_url` | string \| null | 直接游玩地址：编辑器作品为播放器链接（可 iframe），外链稿件为原作者网址 |
| `author.uid` | string | 作者 UID，个人主页 `{Base URL}/users/{uid}` |
| `author.name` | string | 作者名（昵称，无昵称时为用户名） |
| `author.avatar` | string \| null | 作者头像，绝对地址；未设置头像为 `null` |

---

## GET /api/public/announcement

当前生效的站点公告（首页顶部那条）。无需登录、无参数。

### 响应

```json
{ "announcement": "公告正文，纯文本；没有公告时为空串" }
```

### 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `announcement` | string | 当前生效的公告文本（纯文本，可能含换行）；未设置时为空串 |

> 定时公告（后台设置的「到点自动发布」）属于后台排期概念，不对外暴露；本接口只返回**此刻**该显示的那条。

---

## 约定

- 只返回**已上架**作品（审核中、被驳回、定时未到的不会出现）。
- `cover` / `author.avatar` / `play_url` 都可能为 `null`；站内头像未设置时显示首字母色块，调用方可自行占位。
- 跨域已放开：响应带 `Access-Control-Allow-Origin: *`，`OPTIONS` 预检返回 `204`，浏览器可直接 `fetch`。
- 响应带 `Cache-Control: public, max-age=60`。请自行缓存，不要高频轮询。
- 站点目前只有 **http**。如果你的页面是 https，浏览器会按「混合内容」拦截图片与请求；这种情况请改为服务端调用后转发。
- 引用时请注明来源 KitterHub，并保留指向 `url` 的链接。
