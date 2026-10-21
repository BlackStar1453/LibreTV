import { describe, expect, it, vi } from 'vitest';
import { fetchAll, fetchNewSince, planSync, runSync } from './sync';
import type { CollectionItem, CollectionProvider, CollectionState, CollectionStatus } from './types';

function item(id: string): CollectionItem {
  return { id, title: `t${id}`, cover: '', isTv: false, markedAt: '2026-10-01 00:00:00', url: '' };
}

/** 用固定数组模拟分页接口：pageSize 条一页 */
function fakeProvider(data: Partial<Record<CollectionStatus, CollectionItem[]>>, pageSize = 2): CollectionProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'douban',
    pageSize,
    calls,
    async fetchPage(_userId, status, start) {
      calls.push(`${status}@${start}`);
      const all = data[status] ?? [];
      return { items: all.slice(start, start + pageSize), total: all.length };
    },
  };
}

const noDelay = async () => {};

describe('fetchAll', () => {
  it('翻页直到取满 total', async () => {
    const p = fakeProvider({ wish: ['1', '2', '3', '4', '5'].map(item) });
    const items = await fetchAll(p, 'u', 'wish', noDelay);
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(p.calls).toEqual(['wish@0', 'wish@2', 'wish@4']);
  });

  it('遇到空页提前结束（total 虚高时不死循环）', async () => {
    const p = fakeProvider({ wish: ['1'].map(item) });
    p.fetchPage = vi.fn(async (_u, _s, start) => ({ items: start === 0 ? [item('1')] : [], total: 99 }));
    const items = await fetchAll(p, 'u', 'wish', noDelay);
    expect(items).toHaveLength(1);
  });

  it('按 id 去重（翻页期间新增标记导致条目错位）', async () => {
    const p = fakeProvider({});
    p.fetchPage = vi.fn(async (_u, _s, start) =>
      start === 0 ? { items: [item('1'), item('2')], total: 3 } : { items: [item('2'), item('3')], total: 3 }
    );
    const items = await fetchAll(p, 'u', 'wish', noDelay);
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

describe('fetchNewSince', () => {
  it('遇到已知条目即停止，新条目放在前面', async () => {
    const p = fakeProvider({ done: ['9', '8', '1', '2', '3'].map(item) });
    const merged = await fetchNewSince(p, 'u', 'done', ['1', '2', '3'].map(item), noDelay);
    expect(merged.map((i) => i.id)).toEqual(['9', '8', '1', '2', '3']);
    expect(p.calls).toEqual(['done@0', 'done@2']);
  });

  it('本地为空时等价于全量', async () => {
    const p = fakeProvider({ done: ['1', '2', '3'].map(item) });
    const merged = await fetchNewSince(p, 'u', 'done', [], noDelay);
    expect(merged.map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

function emptyState(userId: string | null = 'u'): CollectionState {
  return {
    userId,
    lists: { wish: [], doing: [], done: [] },
    lastAttemptAt: null,
    lastFullAt: null,
    lastResult: null,
  };
}

describe('planSync', () => {
  const at = (s: string) => new Date(s).getTime();

  it('未绑定 ID 不同步', () => {
    expect(planSync(emptyState(null), at('2026-10-21T10:00:00+08:00'))).toBe('none');
  });

  it('从未全量过 → 全量', () => {
    expect(planSync(emptyState(), at('2026-10-21T10:00:00+08:00'))).toBe('full');
  });

  it('首次全量失败后不立即重试，满 6 小时再补全量', () => {
    const s = { ...emptyState(), lastAttemptAt: at('2026-10-21T10:00:00+08:00') };
    expect(planSync(s, at('2026-10-21T10:30:00+08:00'))).toBe('none');
    expect(planSync(s, at('2026-10-21T16:00:00+08:00'))).toBe('full');
  });

  it('凌晨 3-5 点且今天还没全量 → 全量', () => {
    const s = { ...emptyState(), lastFullAt: at('2026-10-20T03:10:00+08:00'), lastAttemptAt: at('2026-10-21T02:00:00+08:00') };
    expect(planSync(s, at('2026-10-21T03:30:00+08:00'))).toBe('full');
  });

  it('今天凌晨已全量 → 不重复全量', () => {
    const s = { ...emptyState(), lastFullAt: at('2026-10-21T03:05:00+08:00'), lastAttemptAt: at('2026-10-21T03:05:00+08:00') };
    expect(planSync(s, at('2026-10-21T04:30:00+08:00'))).toBe('none');
  });

  it('距上次同步满 6 小时 → 快速同步', () => {
    const s = { ...emptyState(), lastFullAt: at('2026-10-21T03:05:00+08:00'), lastAttemptAt: at('2026-10-21T03:05:00+08:00') };
    expect(planSync(s, at('2026-10-21T09:06:00+08:00'))).toBe('quick');
    expect(planSync(s, at('2026-10-21T09:00:00+08:00'))).toBe('none');
  });

  it('凌晨窗口按北京时间判断，与服务器时区无关', () => {
    const s = { ...emptyState(), lastFullAt: at('2026-10-20T03:10:00+08:00'), lastAttemptAt: at('2026-10-21T02:00:00+08:00') };
    // UTC 19:30 = 北京次日 03:30
    expect(planSync(s, at('2026-10-20T19:30:00Z'))).toBe('full');
    // UTC 21:30 = 北京次日 05:30，刚出窗口，且距上次尝试不足 6 小时
    expect(planSync(s, at('2026-10-20T21:30:00Z'))).toBe('none');
  });
});

describe('runSync', () => {
  it('全量：三个列表都镜像豆瓣（本地多出的条目被删除）', async () => {
    const p = fakeProvider({ wish: [item('1')], doing: [], done: [item('5')] });
    const prev = { ...emptyState(), lists: { wish: [item('1'), item('old')], doing: [item('d')], done: [] } };
    const next = await runSync(prev, p, 'full', 1000, noDelay);
    expect(next.lists.wish.map((i) => i.id)).toEqual(['1']);
    expect(next.lists.doing).toEqual([]);
    expect(next.lists.done.map((i) => i.id)).toEqual(['5']);
    expect(next.lastFullAt).toBe(1000);
    expect(next.lastAttemptAt).toBe(1000);
    expect(next.lastResult).toEqual({ at: 1000, mode: 'full', ok: true });
  });

  it('快速：想看/在看全量，看过只增量', async () => {
    const p = fakeProvider({ wish: [item('2')], doing: [], done: [item('9'), item('5')] });
    const prev = { ...emptyState(), lastFullAt: 1, lists: { wish: [item('1')], doing: [], done: [item('5'), item('gone')] } };
    const next = await runSync(prev, p, 'quick', 2000, noDelay);
    expect(next.lists.wish.map((i) => i.id)).toEqual(['2']);
    // 增量不做删除对齐，'gone' 留到每日全量时清理
    expect(next.lists.done.map((i) => i.id)).toEqual(['9', '5', 'gone']);
    expect(next.lastFullAt).toBe(1);
    expect(next.lastAttemptAt).toBe(2000);
  });

  it('本地有数据而豆瓣返回空列表（多半是设为私密）→ 视为失败，不清空', async () => {
    const p = fakeProvider({ wish: [], doing: [], done: [] });
    const prev = { ...emptyState(), lists: { wish: [item('1')], doing: [], done: [item('2')] } };
    const next = await runSync(prev, p, 'full', 4000, noDelay);
    expect(next.lists).toEqual(prev.lists);
    expect(next.lastResult?.ok).toBe(false);
    expect(next.lastResult?.error).toContain('私密');
  });

  it('本地本来就空的列表返回空是正常的（如「在看」为空）', async () => {
    const p = fakeProvider({ wish: [item('1')], doing: [], done: [] });
    const next = await runSync(emptyState(), p, 'full', 5000, noDelay);
    expect(next.lastResult?.ok).toBe(true);
  });

  it('失败时保留全部旧数据，只记录错误', async () => {
    const p = fakeProvider({});
    p.fetchPage = vi.fn(async () => {
      throw new Error('豆瓣限流');
    });
    const prev = { ...emptyState(), lists: { wish: [item('1')], doing: [], done: [item('2')] } };
    const next = await runSync(prev, p, 'full', 3000, noDelay);
    expect(next.lists).toEqual(prev.lists);
    expect(next.lastFullAt).toBeNull();
    // 失败也记为一次尝试，避免每次调度检查都重试打满豆瓣
    expect(next.lastAttemptAt).toBe(3000);
    expect(next.lastResult).toEqual({ at: 3000, mode: 'full', ok: false, error: '豆瓣限流' });
  });
});
