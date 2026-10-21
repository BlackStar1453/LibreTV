import type { HistoryEntry, ProgressEntry } from './db';

/**
 * 多设备观看历史 / 进度同步（本地补丁，非上游功能）：
 * 服务端存一份合并状态，各设备定期双向同步；同一条记录以时间戳新者为准，
 * 删除以「删除标记」传播，避免被仍持有旧记录的设备同步回来。
 */

export interface SyncState {
  history: Record<string, HistoryEntry>;
  progress: Record<string, ProgressEntry>;
  /** 删除标记：id/key → 删除时间 */
  deleted: { history: Record<string, number>; progress: Record<string, number> };
}

export interface SyncPayload {
  history: HistoryEntry[];
  progress: ProgressEntry[];
  deleted: { history: Record<string, number>; progress: Record<string, number> };
}

// 与 db.ts 的 MAX_HISTORY 保持一致；不直接引用，避免服务端加载 Dexie
export const MAX_SYNC_HISTORY = 100;
export const MAX_SYNC_PROGRESS = 2000;
/** 删除标记保留 30 天，足够覆盖长期不在线的设备 */
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;

export function emptySyncState(): SyncState {
  return { history: {}, progress: {}, deleted: { history: {}, progress: {} } };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validHistory(e: HistoryEntry): boolean {
  return !!e && typeof e.id === 'string' && typeof e.sourceKey === 'string' && typeof e.vodId === 'string' && isNum(e.timestamp);
}

function validProgress(e: ProgressEntry): boolean {
  return !!e && typeof e.key === 'string' && isNum(e.position) && isNum(e.updatedAt);
}

function mergeTable<T>(
  records: Record<string, T>,
  tombstones: Record<string, number>,
  incoming: T[],
  incomingDeleted: Record<string, number>,
  idOf: (e: T) => string,
  timeOf: (e: T) => number,
  valid: (e: T) => boolean
): void {
  for (const [id, at] of Object.entries(incomingDeleted || {})) {
    if (!isNum(at)) continue;
    const cur = records[id];
    if (cur && timeOf(cur) > at) continue;
    delete records[id];
    tombstones[id] = Math.max(tombstones[id] ?? 0, at);
  }
  for (const e of incoming || []) {
    if (!valid(e)) continue;
    const id = idOf(e);
    const t = timeOf(e);
    if ((tombstones[id] ?? -Infinity) >= t) continue;
    const cur = records[id];
    if (cur && timeOf(cur) >= t) continue;
    records[id] = e;
    delete tombstones[id];
  }
}

function keepNewest<T>(records: Record<string, T>, limit: number, timeOf: (e: T) => number): Record<string, T> {
  const entries = Object.entries(records);
  if (entries.length <= limit) return records;
  return Object.fromEntries(entries.sort((a, b) => timeOf(b[1]) - timeOf(a[1])).slice(0, limit));
}

function pruneTombstones(t: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(t).filter(([, at]) => now - at < TOMBSTONE_TTL_MS));
}

export function mergeSync(state: SyncState, payload: SyncPayload, now = Date.now()): SyncState {
  const next: SyncState = {
    history: { ...state.history },
    progress: { ...state.progress },
    deleted: { history: { ...state.deleted.history }, progress: { ...state.deleted.progress } },
  };
  mergeTable(next.history, next.deleted.history, payload.history, payload.deleted?.history,
    (e) => e.id, (e) => e.timestamp, validHistory);
  mergeTable(next.progress, next.deleted.progress, payload.progress, payload.deleted?.progress,
    (e) => e.key, (e) => e.updatedAt, validProgress);
  next.history = keepNewest(next.history, MAX_SYNC_HISTORY, (e) => e.timestamp);
  next.progress = keepNewest(next.progress, MAX_SYNC_PROGRESS, (e) => e.updatedAt);
  next.deleted.history = pruneTombstones(next.deleted.history, now);
  next.deleted.progress = pruneTombstones(next.deleted.progress, now);
  return next;
}
