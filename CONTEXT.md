# CONTEXT

本 fork 在 LibreTV 上加的「我的片单」功能的领域术语。

- **片单（Collection）**：用户在外部影视记录站的标记，分 想看(wish) / 在看(doing) / 看过(done) 三个列表。
- **来源（Source）**：片单数据来自哪里，目前有 `douban`（豆瓣）与 `neodb`（NeoDB）。各来源独立同步、独立存储（`data/<source>-collection.json`）。
- **绑定（Bind）**：把一个来源和账号关联起来。豆瓣填公开的个人主页链接或 ID；NeoDB 填 Access Token（账号由 token 决定）。
- **单用户**：一个 LibreTV 实例每个来源只绑定一个账号；「其他人」指的是部署了自己实例、还没导入数据的使用者。

## 观影笔记

- **笔记（Note）**：看片时在某一时刻记下的一条评论 = 播放秒数 + 当前帧截图 + 文字。按「影片 + 集」归档，只存本机 IndexedDB（`notes` 表），不参与多设备同步。
- **导出（Export）**：打成 zip（`notes.md` + `images/`，md 用相对路径引用截图）。两种模式：**本集**（默认）与 **全集**（按集分二级标题汇总）。
- **回跳链接**：md 里的时间戳链接复用播放页已有的 `position` 参数，点开即从该时刻继续播放。
