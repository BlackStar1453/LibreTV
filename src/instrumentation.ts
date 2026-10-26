/** Next.js 服务启动钩子：仅 Node 运行时启动收藏（豆瓣 / NeoDB）定时同步 */
export async function register() {
  // 必须写成 `=== 'nodejs'` 条件块：next dev 也会为 edge 编译本文件，只有这种写法能让
  // webpack 整段剔除下面的动态 import（含 node:dns），提前 return 的写法会导致 dev 全站 500
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // dev:noauth 与常驻服务共用 data/，由常驻服务负责同步，避免两个实例重复拉取
    if (process.env.LIBRETV_NO_SCHEDULER === '1') return;
    // dev 热重载会重复执行 register，用全局标记防止叠加多个定时器
    const flag = Symbol.for('libretv.collectionScheduler');
    const g = globalThis as typeof globalThis & { [flag]?: boolean };
    if (g[flag]) return;
    g[flag] = true;

    const { checkSourceReady, getCollectionService, SCHEDULER_INTERVAL_MS } = await import('./lib/collection/server');
    const { COLLECTION_SOURCES } = await import('./lib/collection/types');
    const tick = () => {
      for (const source of COLLECTION_SOURCES) {
        // 来源未配置或校验失败时跳过，避免每轮记一次失败
        checkSourceReady(source)
          .then((ready) => (ready.configured && !ready.error ? getCollectionService(source).tick() : undefined))
          .catch((err) => console.error(`[collection] ${source} 定时同步异常`, err));
      }
    };
    // 启动后稍等再检查，避开冷启动高峰
    setTimeout(tick, 15 * 1000).unref();
    setInterval(tick, SCHEDULER_INTERVAL_MS).unref();
  }
}
