'use client';

import { useEffect } from 'react';
import { db, type HistoryEntry, type ProgressEntry } from '@/lib/db';
import type { SyncPayload, SyncState } from '@/lib/history-sync';

/**
 * 多设备观看历史 / 进度同步（本地补丁）：打开时拉一次，页面可见时每 15s 双向同步，
 * 切走时再推一次。本机删除 = 「上次同步时服务端有、现在本地没有」的记录，以删除标记上报。
 */

const INTERVAL_MS = 15_000;
const KNOWN_KEY = 'ltv_history_sync_known';

interface Known {
  history: string[];
  progress: string[];
}

function readKnown(): Known {
  try {
    const k = JSON.parse(localStorage.getItem(KNOWN_KEY) || '') as Known;
    return { history: k.history || [], progress: k.progress || [] };
  } catch {
    return { history: [], progress: [] };
  }
}

function writeKnown(k: Known): void {
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify(k));
  } catch {
    // 存储不可用时退化为只增不删
  }
}

async function buildPayload(): Promise<SyncPayload> {
  const [history, progress] = await Promise.all([db.history.toArray(), db.progress.toArray()]);
  const known = readKnown();
  const now = Date.now();
  const hIds = new Set(history.map((e) => e.id));
  const pKeys = new Set(progress.map((e) => e.key));
  return {
    history,
    progress,
    deleted: {
      history: Object.fromEntries(known.history.filter((id) => !hIds.has(id)).map((id) => [id, now])),
      progress: Object.fromEntries(known.progress.filter((k) => !pKeys.has(k)).map((k) => [k, now])),
    },
  };
}

async function applyState(state: SyncState): Promise<void> {
  await db.transaction('rw', db.history, db.progress, async () => {
    // 逐条在事务内比较，避免覆盖读取之后本机刚写入的更新进度
    for (const e of Object.values(state.history) as HistoryEntry[]) {
      const cur = await db.history.get(e.id);
      if (!cur || cur.timestamp < e.timestamp) await db.history.put(e);
    }
    for (const e of Object.values(state.progress) as ProgressEntry[]) {
      const cur = await db.progress.get(e.key);
      if (!cur || cur.updatedAt < e.updatedAt) await db.progress.put(e);
    }
    for (const [id, at] of Object.entries(state.deleted.history)) {
      const cur = await db.history.get(id);
      if (cur && cur.timestamp <= at) await db.history.delete(id);
    }
    for (const [key, at] of Object.entries(state.deleted.progress)) {
      const cur = await db.progress.get(key);
      if (cur && cur.updatedAt <= at) await db.progress.delete(key);
    }
  });
  writeKnown({ history: Object.keys(state.history), progress: Object.keys(state.progress) });
}

let inFlight = false;

async function syncOnce(keepalive = false): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await buildPayload()),
      credentials: 'same-origin',
      keepalive,
    });
    // 未登录（401）等情况静默跳过，登录后下一轮自然补上
    if (!res.ok || keepalive) return;
    await applyState((await res.json()) as SyncState);
  } catch {
    // 网络失败静默，下一轮重试
  } finally {
    inFlight = false;
  }
}

export function HistorySync() {
  useEffect(() => {
    void syncOnce();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void syncOnce();
    }, INTERVAL_MS);
    const onVisibility = () => void syncOnce(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return null;
}
