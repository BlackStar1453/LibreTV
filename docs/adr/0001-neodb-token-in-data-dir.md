# 0001 NeoDB token 允许在网页中填写，存放在 data 目录

## 背景
NeoDB 的书架接口必须带 Bearer token。最初只支持在 `.env` 配置 `NEODB_TOKEN`，普通使用者（尤其在手机上）做不到，「简单快速导入片单」不成立。

## 决定
- 片单页面允许粘贴 token；服务端先用 `/api/me` 校验，通过后存入 `data/neodb-token.json`（权限 0600）。
- 接口永远不把 token 返回前端；读写都需要站点登录。
- `.env` 的 `NEODB_TOKEN` 优先：配置了它时网页不能修改 token。

## 后果
- token 以明文落在服务器磁盘上，安全性等同 `.env`；`data/` 已在 `.gitignore` 中。
- 换 token 即换账号：沿用 neodb-binding 的逻辑，按新用户名重新绑定并清空旧数据。
