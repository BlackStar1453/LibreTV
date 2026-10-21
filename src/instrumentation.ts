/** Next.js 服务启动钩子：仅 Node 运行时启动「我的豆瓣」定时同步 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getCollectionService, SCHEDULER_INTERVAL_MS } = await import('./lib/collection/server');
  const service = getCollectionService();
  const tick = () => {
    service.tick().catch((err) => console.error('[collection] 定时同步异常', err));
  };
  // 启动后稍等再检查，避开冷启动高峰
  setTimeout(tick, 15 * 1000);
  setInterval(tick, SCHEDULER_INTERVAL_MS).unref();
}
