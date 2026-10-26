# 0003 观影笔记：本机存储 + 自写 STORE zip 导出

## 背景
需要在播放页边看边记（暂停 → 截当前帧 → 写评论），看完导出类似 course2md 的图文 Markdown。

## 决定
- 截图用 canvas 绘制 `<video>` 当前帧：播放全部经 hls.js + MSE（blob 源），画布不会被跨域污染。
- 笔记只存本机 IndexedDB（Dexie v4 `notes` 表，截图存 Blob），暂不同步——截图体积大，同步接口当前只承载轻量的观看历史。
- 导出 zip = `notes.md` + `images/`；默认按集导出，可选整部汇总。
- zip 用自写的 STORE（不压缩）打包器 `src/lib/zip-store.ts`，不引入 fflate 等依赖：JPEG 已压缩，deflate 无收益。
- 回跳链接复用播放页现有 `position` 参数（优先于历史进度、换集自动清除），不新增 `t` 参数。
- 笔记输入框通过 portal 挂进 ArtPlayer 的 `$player` 节点，原生全屏与网页全屏下都可见。

## 后果
- 换浏览器 / 清站点数据会丢笔记，需在此之前导出。
- 桌面壳（WKWebView）未实现下载委托，导出在桌面 App 内可能无反应，需在浏览器中导出。
