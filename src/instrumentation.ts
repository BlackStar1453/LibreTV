/** Next.js 服务启动钩子：仅 Node 运行时启动「我的豆瓣」定时同步 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // dev 热重载会重复执行 register，用全局标记防止叠加多个定时器
  const flag = Symbol.for('libretv.collectionScheduler');
  const g = globalThis as typeof globalThis & { [flag]?: boolean };
  if (g[flag]) return;
  g[flag] = true;

  const { getCollectionService, SCHEDULER_INTERVAL_MS } = await import('./lib/collection/server');
  const service = getCollectionService();
  const tick = () => {
    service.tick().catch((err) => console.error('[collection] 定时同步异常', err));
  };
  // 启动后稍等再检查，避开冷启动高峰
  setTimeout(tick, 15 * 1000).unref();
  setInterval(tick, SCHEDULER_INTERVAL_MS).unref();
}
