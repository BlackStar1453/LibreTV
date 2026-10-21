import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCollectionService } from './service';
import type { CollectionItem, CollectionProvider } from './types';

function item(id: string): CollectionItem {
  return { id, title: `t${id}`, cover: '', isTv: false, markedAt: '', url: '' };
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'libretv-collection-'));
  file = path.join(dir, 'sub', 'collection.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function provider(fetchPage?: CollectionProvider['fetchPage']): CollectionProvider {
  return {
    name: 'douban',
    pageSize: 50,
    fetchPage: fetchPage ?? (async (_u, status) => ({ items: status === 'wish' ? [item('1')] : [], total: status === 'wish' ? 1 : 0 })),
  };
}

const opts = { delay: async () => {}, now: () => 1000 };

describe('createCollectionService', () => {
  it('文件不存在时返回未绑定的空状态', async () => {
    const svc = createCollectionService({ filePath: file, provider: provider(), ...opts });
    const s = await svc.getState();
    expect(s.userId).toBeNull();
    expect(s.lists.wish).toEqual([]);
  });

  it('文件损坏时退回空状态而不是崩溃', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{not json');
    const svc = createCollectionService({ filePath: file, provider: provider(), ...opts });
    expect((await svc.getState()).userId).toBeNull();
  });

  it('绑定 ID 后同步结果写入文件，新实例可读回', async () => {
    const svc = createCollectionService({ filePath: file, provider: provider(), ...opts });
    await svc.setUserId('u1');
    await svc.sync('full');
    const again = createCollectionService({ filePath: file, provider: provider(), ...opts });
    const s = await again.getState();
    expect(s.userId).toBe('u1');
    expect(s.lists.wish.map((i) => i.id)).toEqual(['1']);
    expect(s.lastResult?.ok).toBe(true);
  });

  it('更换 ID 时清空旧账号的列表与同步时间', async () => {
    const svc = createCollectionService({ filePath: file, provider: provider(), ...opts });
    await svc.setUserId('u1');
    await svc.sync('full');
    await svc.setUserId('u2');
    const s = await svc.getState();
    expect(s.userId).toBe('u2');
    expect(s.lists.wish).toEqual([]);
    expect(s.lastFullAt).toBeNull();
    expect(s.lastQuickAt).toBeNull();
  });

  it('同步进行中再次触发复用同一次同步，不并发打豆瓣', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchPage = vi.fn(async () => {
      await gate;
      return { items: [], total: 0 };
    });
    const svc = createCollectionService({ filePath: file, provider: provider(fetchPage), ...opts });
    await svc.setUserId('u1');
    const a = svc.sync('full');
    const b = svc.sync('full');
    expect(svc.isSyncing()).toBe(true);
    release();
    await Promise.all([a, b]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(svc.isSyncing()).toBe(false);
  });

  it('同步期间换绑 ID，旧同步结果不覆盖新账号', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchPage = vi.fn(async () => {
      await gate;
      return { items: [item('old')], total: 1 };
    });
    const svc = createCollectionService({ filePath: file, provider: provider(fetchPage), ...opts });
    await svc.setUserId('u1');
    const running = svc.sync('full');
    await svc.setUserId('u2');
    release();
    await running;
    const s = await svc.getState();
    expect(s.userId).toBe('u2');
    expect(s.lists.wish).toEqual([]);
  });

  it('tick 按 planSync 决定是否同步', async () => {
    const fetchPage = vi.fn(async () => ({ items: [], total: 0 }));
    const svc = createCollectionService({ filePath: file, provider: provider(fetchPage), ...opts });
    await svc.tick();
    expect(fetchPage).not.toHaveBeenCalled();
    await svc.setUserId('u1');
    await svc.tick();
    expect(fetchPage).toHaveBeenCalled();
  });
});
