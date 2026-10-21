import fs from 'node:fs/promises';
import path from 'node:path';
import { planSync, runSync, type Delay } from './sync';
import type { CollectionProvider, CollectionState, SyncMode } from './types';

/**
 * 收藏同步服务：JSON 文件持久化 + 单飞同步。
 * 单用户站点，状态整体读写一个文件即可；写入串行化，并走临时文件 + rename，保证不会写出半截文件。
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
  /**
   * 触发同步。已有同步进行中时：结果等价则复用；若本次需要更多（快速→全量，或期间换绑了 ID），
   * 排队在当前同步结束后再跑一次，请求不会被吞掉。
   */
  sync(mode: SyncMode): Promise<CollectionState>;
  /** 调度器周期调用：按 planSync 判断是否需要同步 */
  tick(): Promise<void>;
}

export function emptyCollectionState(): CollectionState {
  return {
    userId: null,
    lists: { wish: [], doing: [], done: [] },
    lastAttemptAt: null,
    lastFullAt: null,
    lastResult: null,
  };
}

export function createCollectionService(opts: CollectionServiceOptions): CollectionService {
  let cache: CollectionState | null = null;
  let loading: Promise<CollectionState> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let tmpSeq = 0;
  let running: { promise: Promise<CollectionState>; mode: SyncMode; userId: string | null } | null = null;
  let queued: { promise: Promise<CollectionState>; mode: SyncMode } | null = null;

  async function readFromDisk(): Promise<CollectionState> {
    let text: string;
    try {
      text = await fs.readFile(opts.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyCollectionState();
      // 权限等其它错误：抛出而不是当作空状态，否则下次保存会覆盖真实数据
      throw err;
    }
    try {
      const parsed = JSON.parse(text) as Partial<CollectionState>;
      const empty = emptyCollectionState();
      return { ...empty, ...parsed, lists: { ...empty.lists, ...parsed.lists } };
    } catch {
      // 文件损坏：备份后从空状态开始，保留现场便于手工恢复
      await fs.rename(opts.filePath, `${opts.filePath}.corrupt-${opts.now()}`);
      return emptyCollectionState();
    }
  }

  function load(): Promise<CollectionState> {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
      loading = readFromDisk()
        .then((s) => (cache = s))
        .finally(() => {
          loading = null;
        });
    }
    return loading;
  }

  function save(state: CollectionState): Promise<void> {
    cache = state;
    const write = writing.then(async () => {
      await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
      const tmp = `${opts.filePath}.${process.pid}.${++tmpSeq}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state));
      await fs.rename(tmp, opts.filePath);
    });
    writing = write.catch(() => {});
    return write;
  }

  async function doSync(mode: SyncMode): Promise<CollectionState> {
    const before = await load();
    const next = await runSync(before, opts.provider, mode, opts.now(), opts.delay);
    // 同步期间换绑了 ID：丢弃旧账号的结果（新账号的同步已排队）
    const current = await load();
    if (current.userId !== before.userId) return current;
    await save(next);
    return next;
  }

  function start(mode: SyncMode): Promise<CollectionState> {
    const promise: Promise<CollectionState> = doSync(mode).finally(() => {
      if (running?.promise === promise) running = null;
    });
    running = { promise, mode, userId: cache?.userId ?? null };
    return promise;
  }

  function sync(mode: SyncMode): Promise<CollectionState> {
    if (!running) return start(mode);
    if (queued) {
      if (mode === 'full') queued.mode = 'full';
      return queued.promise;
    }
    const needsRerun = (mode === 'full' && running.mode === 'quick') || (cache?.userId ?? null) !== running.userId;
    if (!needsRerun) return running.promise;

    const entry = { mode, promise: null as unknown as Promise<CollectionState> };
    entry.promise = running.promise
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return start(entry.mode);
      });
    queued = entry;
    return entry.promise;
  }

  return {
    getState: load,

    isSyncing: () => running !== null || queued !== null,

    async setUserId(userId) {
      const prev = await load();
      if (prev.userId === userId) return prev;
      const next = { ...emptyCollectionState(), userId };
      await save(next);
      return next;
    },

    sync,

    async tick() {
      if (running || queued) return;
      const mode = planSync(await load(), opts.now());
      if (mode !== 'none') await sync(mode);
    },
  };
}
