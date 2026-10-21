import path from 'node:path';
import { fetchUpstream } from '../fetch-utils';
import { createDoubanProvider, DOUBAN_HEADERS } from './douban-provider';
import { createCollectionService, type CollectionService } from './service';

/**
 * 服务端单例。Next.js 中 instrumentation 与各 Route Handler 是不同的打包产物，
 * 模块级变量不共享，因此挂在 globalThis 上，保证调度器与 API 用同一个实例（同一把同步锁）。
 */

/** 翻页间隔，降低被豆瓣限流的概率 */
const PAGE_DELAY_MS = 2000;
/** 调度器检查间隔：每次检查由 planSync 决定是否真正同步 */
export const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

const KEY = Symbol.for('libretv.collectionService');
type GlobalWithService = typeof globalThis & { [KEY]?: CollectionService };

async function fetchDoubanJson(url: string): Promise<unknown> {
  const res = await fetchUpstream(url, { timeoutMs: 10000, retries: 1, headers: DOUBAN_HEADERS });
  if (res.status === 400 || res.status === 404) throw new Error('豆瓣用户不存在，或「我看」未设为公开');
  if (res.status === 403 || res.status === 429) throw new Error(`豆瓣限流（${res.status}），稍后自动重试`);
  if (!res.ok) throw new Error(`豆瓣请求失败（${res.status}）`);
  return res.json();
}

export function getCollectionService(): CollectionService {
  const g = globalThis as GlobalWithService;
  if (!g[KEY]) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    g[KEY] = createCollectionService({
      filePath: path.join(dataDir, 'douban-collection.json'),
      provider: createDoubanProvider(fetchDoubanJson),
      delay: () => new Promise((r) => setTimeout(r, PAGE_DELAY_MS)),
      now: () => Date.now(),
    });
  }
  return g[KEY];
}
