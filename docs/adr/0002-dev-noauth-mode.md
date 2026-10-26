# 0002 开发免密模式 dev:noauth

## 背景
本机常驻的正式实例（`next start`，8080）设了密码，供局域网手机访问。本地调试、自动化验证时每个新浏览器 / WebView 都要先输密码；直接去掉 `PASSWORD` 也不行，未配置密码时所有接口返回 503。

## 决定
- 新增 `npm run dev:noauth`：`next dev` 只监听本机 `127.0.0.1:3000`（免密服务不暴露给局域网），`LIBRETV_DEV_NO_AUTH=1` 时 `sessionFromCookieHeader` 一律视为已登录（所有鉴权入口都经过它）。
- 只有 `NODE_ENV === 'development'` 才认这个开关；生产构建会把 NODE_ENV 内联为 `production`，正式实例即使误设了也不会放行。
- 构建目录用 `.next-dev`（`NEXT_DIST_DIR`），不覆盖正式实例正在用的 `.next`。
- 与正式实例共用 `data/`，便于看真实片单和历史；但设 `LIBRETV_NO_SCHEDULER=1` 关掉片单定时同步，由正式实例负责同步。

## 后果
- 手机无法访问 dev:noauth；要在手机上验证，仍走 8080 的正式实例（需要登录）。
- 在 dev:noauth 里的操作（观看历史同步、绑定账号等）会写进真实的 `data/`。
- `next dev` 会把 `next-env.d.ts` 的引用改成 `.next-dev`，下次 `npm run build` 时会自动改回来。
