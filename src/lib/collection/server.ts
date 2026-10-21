import path from 'node:path';
import { fetchUpstream } from '../fetch-utils';
import { createDoubanProvider, DOUBAN_HEADERS } from './douban-provider';
import { createNeodbProvider, NEODB_ORIGIN } from './neodb-provider';
import { createNeodbBinder, type NeodbBindStatus } from './neodb-binding';
import { createCollectionService, type CollectionService } from './service';
import type { CollectionProvider, CollectionSource } from './types';

/**
 * 服务端单例（每个数据源一个）。Next.js 中 instrumentation 与各 Route Handler 是不同的打包产物，
 * 模块级变量不共享，因此挂在 globalThis 上，保证调度器与 API 用同一个实例（同一把同步锁）。
 */

/** 调度器检查间隔：每次检查由 planSync 决定是否真正同步 */
export const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

const KEY = Symbol.for('libretv.collectionServices');
const BINDER_KEY = Symbol.for('libretv.neodbBinder');
type GlobalWithService = typeof globalThis & {
  [KEY]?: Partial<Record<CollectionSource, CollectionService>>;
  [BINDER_KEY]?: ReturnType<typeof createNeodbBinder>;
};

async function fetchDoubanJson(url: string): Promise<unknown> {
  const res = await fetchUpstream(url, { timeoutMs: 10000, retries: 1, headers: DOUBAN_HEADERS });
  if (res.status === 400 || res.status === 404) throw new Error('豆瓣用户不存在，或「我看」未设为公开');
  if (res.status === 403 || res.status === 429) throw new Error(`豆瓣限流（${res.status}），稍后自动重试`);
  if (!res.ok) throw new Error(`豆瓣请求失败（${res.status}）`);
  return res.json();
}

function neodbToken(): string | null {
  return process.env.NEODB_TOKEN?.trim() || null;
}

async function fetchNeodbJson(url: string): Promise<unknown> {
  const token = neodbToken();
  if (!token) throw new Error('未配置 NEODB_TOKEN');
  const res = await fetchUpstream(url, {
    timeoutMs: 10000,
    retries: 1,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('NEODB_TOKEN 无效或已被重新生成，请更新 .env');
  if (res.status === 429) throw new Error('NeoDB 限流（429），稍后自动重试');
  if (!res.ok) throw new Error(`NeoDB 请求失败（${res.status}）`);
  return res.json();
}

/**
 * 各来源的服务端差异集中在这里。翻页间隔：豆瓣较长以降低被限流的概率；NeoDB 是带 token 的官方接口，可以短一些
 */
const SOURCES: Record<CollectionSource, { createProvider: () => CollectionProvider; pageDelayMs: number }> = {
  douban: { createProvider: () => createDoubanProvider(fetchDoubanJson), pageDelayMs: 2000 },
  neodb: { createProvider: () => createNeodbProvider(fetchNeodbJson), pageDelayMs: 500 },
};

export function getCollectionService(source: CollectionSource): CollectionService {
  const g = globalThis as GlobalWithService;
  const services = (g[KEY] ??= {});
  if (!services[source]) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const { createProvider, pageDelayMs } = SOURCES[source];
    services[source] = createCollectionService({
      filePath: path.join(dataDir, `${source}-collection.json`),
      provider: createProvider(),
      delay: () => new Promise((r) => setTimeout(r, pageDelayMs)),
      now: () => Date.now(),
    });
  }
  return services[source];
}

/** 确保 NeoDB 已按当前 token 绑定（详见 neodb-binding.ts） */
function ensureNeodbBound(): Promise<NeodbBindStatus> {
  const g = globalThis as GlobalWithService;
  g[BINDER_KEY] ??= createNeodbBinder({
    getToken: neodbToken,
    fetchUsername: async () => {
      const me = (await fetchNeodbJson(`${NEODB_ORIGIN}/api/me`)) as { username?: string };
      if (!me?.username) throw new Error('NeoDB /api/me 未返回用户名');
      return me.username;
    },
    service: getCollectionService('neodb'),
    now: () => Date.now(),
  });
  return g[BINDER_KEY].ensure();
}

/**
 * 来源是否可用于同步：豆瓣恒可用（绑定靠用户填 ID）；NeoDB 需配置 token 且校验通过。
 * API 与调度器在使用某个来源前统一调用这里，调用方不需要区分来源。
 */
export function checkSourceReady(source: CollectionSource): Promise<NeodbBindStatus> {
  return source === 'neodb' ? ensureNeodbBound() : Promise.resolve({ configured: true, error: null });
}
