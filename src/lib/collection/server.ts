import path from 'node:path';
import { fetchUpstream } from '../fetch-utils';
import { createDoubanProvider, DOUBAN_HEADERS } from './douban-provider';
import { createNeodbProvider, NEODB_ORIGIN } from './neodb-provider';
import { createCollectionService, type CollectionService } from './service';
import type { CollectionSource } from './types';

/**
 * 服务端单例（每个数据源一个）。Next.js 中 instrumentation 与各 Route Handler 是不同的打包产物，
 * 模块级变量不共享，因此挂在 globalThis 上，保证调度器与 API 用同一个实例（同一把同步锁）。
 */

/** 翻页间隔：豆瓣较长以降低被限流的概率；NeoDB 是带 token 的官方接口，可以短一些 */
const PAGE_DELAY_MS: Record<CollectionSource, number> = { douban: 2000, neodb: 500 };
/** 调度器检查间隔：每次检查由 planSync 决定是否真正同步 */
export const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;

const KEY = Symbol.for('libretv.collectionServices');
type GlobalWithService = typeof globalThis & { [KEY]?: Partial<Record<CollectionSource, CollectionService>> };

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

export function getCollectionService(source: CollectionSource = 'douban'): CollectionService {
  const g = globalThis as GlobalWithService;
  const services = (g[KEY] ??= {});
  if (!services[source]) {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const delayMs = PAGE_DELAY_MS[source];
    services[source] = createCollectionService({
      filePath: path.join(dataDir, `${source}-collection.json`),
      provider: source === 'neodb' ? createNeodbProvider(fetchNeodbJson) : createDoubanProvider(fetchDoubanJson),
      delay: () => new Promise((r) => setTimeout(r, delayMs)),
      now: () => Date.now(),
    });
  }
  return services[source];
}

export function isNeodbConfigured(): boolean {
  return neodbToken() !== null;
}

/**
 * NeoDB 不需要用户填 ID：配置了 token 即视为绑定。首次使用时查询 token 所属用户名写入状态，
 * 之后的同步、节流与豆瓣共用同一套逻辑。失败只记日志，下次调用再试。
 */
export async function ensureNeodbBound(): Promise<void> {
  if (!isNeodbConfigured()) return;
  const service = getCollectionService('neodb');
  if ((await service.getState()).userId) return;
  try {
    const me = (await fetchNeodbJson(`${NEODB_ORIGIN}/api/me`)) as { username?: string };
    if (!me?.username) throw new Error('NeoDB /api/me 未返回用户名');
    await service.setUserId(me.username);
  } catch (err) {
    console.error('[collection] NeoDB 绑定失败', err);
  }
}
