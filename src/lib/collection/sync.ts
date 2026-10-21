import type { CollectionItem, CollectionProvider, CollectionState, CollectionStatus, SyncMode } from './types';

/** 同步纯逻辑：分页拉取、增量合并、调度判断。无 IO，IO 由 provider 与调用方注入 */

export type Delay = () => Promise<void>;

const SIX_HOURS = 6 * 60 * 60 * 1000;
/** 每日全量窗口：北京时间凌晨 [3, 5) 点（固定 UTC+8，中国无夏令时，不依赖服务器时区） */
const FULL_WINDOW_START = 3;
const FULL_WINDOW_END = 5;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
/** 单列表最多翻页数，防止 total 异常时无限请求 */
const MAX_PAGES = 200;

/**
 * 从最新一页起逐页拉取并去重，直到取满 total、遇到空页，或 shouldStop 对某页返回 true。
 * 返回值包含触发停止的那一页里的条目，由调用方再过滤。
 */
async function paginate(
  provider: CollectionProvider,
  userId: string,
  status: CollectionStatus,
  delay: Delay,
  shouldStop: (pageItems: CollectionItem[]) => boolean = () => false
): Promise<CollectionItem[]> {
  const out: CollectionItem[] = [];
  const seen = new Set<string>();
  for (let page = 0, start = 0; page < MAX_PAGES; page++, start += provider.pageSize) {
    if (page > 0) await delay();
    const res = await provider.fetchPage(userId, status, start);
    for (const it of res.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    if (shouldStop(res.items) || (res.rawCount ?? res.items.length) === 0 || start + provider.pageSize >= res.total) break;
  }
  return out;
}

export function fetchAll(
  provider: CollectionProvider,
  userId: string,
  status: CollectionStatus,
  delay: Delay
): Promise<CollectionItem[]> {
  return paginate(provider, userId, status, delay);
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
  const fetched = await paginate(provider, userId, status, delay, (items) => items.some((i) => known.has(i.id)));
  return [...fetched.filter((i) => !known.has(i.id)), ...existing];
}

/** 北京时间的「第几天」与小时 */
function beijingClock(ms: number): { day: number; hour: number } {
  const shifted = ms + BEIJING_OFFSET;
  return { day: Math.floor(shifted / DAY), hour: new Date(shifted).getUTCHours() };
}

export function planSync(state: CollectionState, now: number): 'none' | SyncMode {
  if (!state.userId) return 'none';
  if (state.lastAttemptAt === null) return 'full';

  const { day, hour } = beijingClock(now);
  const inFullWindow = hour >= FULL_WINDOW_START && hour < FULL_WINDOW_END;
  const fullDoneToday = state.lastFullAt !== null && beijingClock(state.lastFullAt).day === day;
  // 窗口内全量失败后，间隔 30 分钟再试，窗口期内最多几次
  const retriedRecently = now - state.lastAttemptAt < 30 * 60 * 1000;
  if (inFullWindow && !fullDoneToday && !retriedRecently) return 'full';

  if (now - state.lastAttemptAt >= SIX_HOURS) return state.lastFullAt === null ? 'full' : 'quick';
  return 'none';
}

const STATUS_LABELS: Record<CollectionStatus, string> = { wish: '想看', doing: '在看', done: '看过' };

/**
 * 本地非空而数据源整列返回空：多半是标记被设为私密或接口异常，不能据此清空。
 * 「在看」看完最后一部清零是正常操作，不做此检查。
 */
function guardNotEmptied(label: string, status: CollectionStatus, prev: CollectionItem[], next: CollectionItem[]): void {
  if (prev.length > 0 && next.length === 0) {
    throw new Error(`${label}返回的「${STATUS_LABELS[status]}」列表为空，可能标记已设为私密，已保留旧数据`);
  }
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
    guardNotEmptied(provider.label, 'wish', prev.lists.wish, wish);
    await delay();
    const doing = await fetchAll(provider, userId, 'doing', delay);
    await delay();
    const done =
      mode === 'full'
        ? await fetchAll(provider, userId, 'done', delay)
        : await fetchNewSince(provider, userId, 'done', prev.lists.done, delay);
    guardNotEmptied(provider.label, 'done', prev.lists.done, done);
    return {
      ...prev,
      lists: { wish, doing, done },
      lastAttemptAt: now,
      lastFullAt: mode === 'full' ? now : prev.lastFullAt,
      lastResult: { at: now, mode, ok: true },
    };
  } catch (err) {
    return {
      ...prev,
      lastAttemptAt: now,
      lastResult: { at: now, mode, ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
}
