import type { CollectionItem, CollectionProvider, CollectionState, CollectionStatus, SyncMode } from './types';

/** 同步纯逻辑：分页拉取、增量合并、调度判断。无 IO，IO 由 provider 与调用方注入 */

export type Delay = () => Promise<void>;

const SIX_HOURS = 6 * 60 * 60 * 1000;
/** 每日全量窗口：本地时间凌晨 [3, 5) 点 */
const FULL_WINDOW_START = 3;
const FULL_WINDOW_END = 5;
/** 单列表最多翻页数，防止 total 异常时无限请求 */
const MAX_PAGES = 200;

function pushUnique(target: CollectionItem[], seen: Set<string>, items: CollectionItem[]): void {
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    target.push(it);
  }
}

export async function fetchAll(
  provider: CollectionProvider,
  userId: string,
  status: CollectionStatus,
  delay: Delay
): Promise<CollectionItem[]> {
  const out: CollectionItem[] = [];
  const seen = new Set<string>();
  for (let page = 0, start = 0; page < MAX_PAGES; page++, start += provider.pageSize) {
    if (page > 0) await delay();
    const res = await provider.fetchPage(userId, status, start);
    pushUnique(out, seen, res.items);
    if (res.items.length === 0 || start + provider.pageSize >= res.total) break;
  }
  return out;
}

/** 从最新一页往后翻，遇到本地已有条目即停；新条目按豆瓣顺序置于前面 */
export async function fetchNewSince(
  provider: CollectionProvider,
  userId: string,
  status: CollectionStatus,
  existing: CollectionItem[],
  delay: Delay
): Promise<CollectionItem[]> {
  const known = new Set(existing.map((i) => i.id));
  const fresh: CollectionItem[] = [];
  const seen = new Set<string>();
  for (let page = 0, start = 0; page < MAX_PAGES; page++, start += provider.pageSize) {
    if (page > 0) await delay();
    const res = await provider.fetchPage(userId, status, start);
    const hitKnown = res.items.some((i) => known.has(i.id));
    pushUnique(fresh, seen, res.items.filter((i) => !known.has(i.id)));
    if (hitKnown || res.items.length === 0 || start + provider.pageSize >= res.total) break;
  }
  return [...fresh, ...existing];
}

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function planSync(state: CollectionState, now: number): 'none' | SyncMode {
  if (!state.userId) return 'none';
  if (state.lastQuickAt === null) return 'full';

  const hour = new Date(now).getHours();
  const inFullWindow = hour >= FULL_WINDOW_START && hour < FULL_WINDOW_END;
  const fullDoneToday = state.lastFullAt !== null && sameLocalDay(state.lastFullAt, now);
  // 窗口内同一天的失败重试也受 30 分钟检查间隔约束，最多几次
  const attemptedToday = state.lastResult?.mode === 'full' && sameLocalDay(state.lastResult.at, now);
  if (inFullWindow && !fullDoneToday && !(attemptedToday && now - state.lastQuickAt < 30 * 60 * 1000)) {
    return 'full';
  }

  if (now - state.lastQuickAt >= SIX_HOURS) return state.lastFullAt === null ? 'full' : 'quick';
  return 'none';
}

/** 执行一次同步并返回新状态；任一列表失败则整体放弃，保留旧数据 */
export async function runSync(
  prev: CollectionState,
  provider: CollectionProvider,
  mode: SyncMode,
  now: number,
  delay: Delay
): Promise<CollectionState> {
  const userId = prev.userId;
  if (!userId) return prev;
  try {
    const wish = await fetchAll(provider, userId, 'wish', delay);
    await delay();
    const doing = await fetchAll(provider, userId, 'doing', delay);
    await delay();
    const done =
      mode === 'full'
        ? await fetchAll(provider, userId, 'done', delay)
        : await fetchNewSince(provider, userId, 'done', prev.lists.done, delay);
    return {
      ...prev,
      lists: { wish, doing, done },
      lastQuickAt: now,
      lastFullAt: mode === 'full' ? now : prev.lastFullAt,
      lastResult: { at: now, mode, ok: true },
    };
  } catch (err) {
    return {
      ...prev,
      lastQuickAt: now,
      lastResult: { at: now, mode, ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
}
