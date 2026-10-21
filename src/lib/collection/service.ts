import fs from 'node:fs/promises';
import path from 'node:path';
import { planSync, runSync, type Delay } from './sync';
import type { CollectionProvider, CollectionState, SyncMode } from './types';

/**
 * 收藏同步服务：JSON 文件持久化 + 单飞同步。
 * 单用户站点，状态整体读写一个文件即可；写入走临时文件 + rename 保证不会写出半截文件。
 */

export interface CollectionServiceOptions {
  filePath: string;
  provider: CollectionProvider;
  delay: Delay;
  now: () => number;
}

export interface CollectionService {
  getState(): Promise<CollectionState>;
  isSyncing(): boolean;
  setUserId(userId: string): Promise<CollectionState>;
  sync(mode: SyncMode): Promise<CollectionState>;
  /** 调度器周期调用：按 planSync 判断是否需要同步 */
  tick(): Promise<void>;
}

export function emptyCollectionState(): CollectionState {
  return {
    userId: null,
    lists: { wish: [], doing: [], done: [] },
    lastQuickAt: null,
    lastFullAt: null,
    lastResult: null,
  };
}

export function createCollectionService(opts: CollectionServiceOptions): CollectionService {
  let cache: CollectionState | null = null;
  let running: Promise<CollectionState> | null = null;

  async function load(): Promise<CollectionState> {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as CollectionState;
      cache = { ...emptyCollectionState(), ...parsed, lists: { ...emptyCollectionState().lists, ...parsed.lists } };
    } catch {
      cache = emptyCollectionState();
    }
    return cache;
  }

  async function save(state: CollectionState): Promise<void> {
    cache = state;
    await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
    const tmp = `${opts.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state));
    await fs.rename(tmp, opts.filePath);
  }

  async function doSync(mode: SyncMode): Promise<CollectionState> {
    const before = await load();
    const next = await runSync(before, opts.provider, mode, opts.now(), opts.delay);
    // 同步期间换绑了 ID：丢弃旧账号的结果
    const current = await load();
    if (current.userId !== before.userId) return current;
    await save(next);
    return next;
  }

  return {
    getState: load,

    isSyncing: () => running !== null,

    async setUserId(userId) {
      const prev = await load();
      if (prev.userId === userId) return prev;
      const next = { ...emptyCollectionState(), userId };
      await save(next);
      return next;
    },

    sync(mode) {
      if (!running) {
        running = doSync(mode).finally(() => {
          running = null;
        });
      }
      return running;
    },

    async tick() {
      if (running) return;
      const mode = planSync(await load(), opts.now());
      if (mode !== 'none') await this.sync(mode);
    },
  };
}
