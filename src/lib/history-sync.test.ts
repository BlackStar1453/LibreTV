import { describe, expect, it } from 'vitest';
import { emptySyncState, mergeSync as mergeAt, type SyncPayload, type SyncState } from './history-sync';
import type { HistoryEntry, ProgressEntry } from './db';

const h = (id: string, timestamp: number, playbackPosition = 0): HistoryEntry => ({
  id,
  sourceKey: id.split('_')[0],
  vodId: id.split('_')[1],
  title: id,
  episodeIndex: 0,
  totalEpisodes: 10,
  playbackPosition,
  duration: 1000,
  timestamp,
});
const p = (key: string, updatedAt: number, position = 0): ProgressEntry => ({ key, position, duration: 1000, updatedAt });
// 固定「现在」，避免小时间戳的删除标记被 30 天过期清理掉
const mergeSync = (s: SyncState, pl: SyncPayload) => mergeAt(s, pl, 1000);
const payload = (over: Partial<SyncPayload>): SyncPayload => ({
  history: [],
  progress: [],
  deleted: { history: {}, progress: {} },
  ...over,
});

describe('历史同步合并', () => {
  it('新记录并入空状态', () => {
    const s = mergeSync(emptySyncState(), payload({ history: [h('a_1', 100)], progress: [p('a_1_0', 100, 60)] }));
    expect(s.history['a_1'].timestamp).toBe(100);
    expect(s.progress['a_1_0'].position).toBe(60);
  });

  it('同一条记录时间戳新的胜出，旧的不覆盖', () => {
    let s = mergeSync(emptySyncState(), payload({ history: [h('a_1', 200, 600)] }));
    s = mergeSync(s, payload({ history: [h('a_1', 100, 30)] }));
    expect(s.history['a_1'].playbackPosition).toBe(600);
    s = mergeSync(s, payload({ history: [h('a_1', 300, 900)] }));
    expect(s.history['a_1'].playbackPosition).toBe(900);
  });

  it('删除标记比记录新时删掉记录，并挡住旧记录被同步回来', () => {
    let s = mergeSync(emptySyncState(), payload({ history: [h('a_1', 100)], progress: [p('a_1_0', 100)] }));
    s = mergeSync(s, payload({ deleted: { history: { a_1: 150 }, progress: { a_1_0: 150 } } }));
    expect(s.history['a_1']).toBeUndefined();
    expect(s.progress['a_1_0']).toBeUndefined();
    // 另一台设备还带着旧记录来同步，不应复活
    s = mergeSync(s, payload({ history: [h('a_1', 100)], progress: [p('a_1_0', 100)] }));
    expect(s.history['a_1']).toBeUndefined();
    expect(s.progress['a_1_0']).toBeUndefined();
  });

  it('删除之后重新观看（更新的记录）可以复活', () => {
    let s = mergeSync(emptySyncState(), payload({ deleted: { history: { a_1: 150 }, progress: {} } }));
    s = mergeSync(s, payload({ history: [h('a_1', 200)] }));
    expect(s.history['a_1'].timestamp).toBe(200);
    expect(s.deleted.history['a_1']).toBeUndefined();
  });

  it('删除标记比记录旧时不删', () => {
    let s = mergeSync(emptySyncState(), payload({ history: [h('a_1', 300)] }));
    s = mergeSync(s, payload({ deleted: { history: { a_1: 200 }, progress: {} } }));
    expect(s.history['a_1'].timestamp).toBe(300);
  });

  it('历史只保留最新 100 条', () => {
    const many = Array.from({ length: 105 }, (_, i) => h(`s_${i}`, i + 1));
    const s = mergeSync(emptySyncState(), payload({ history: many }));
    expect(Object.keys(s.history)).toHaveLength(100);
    expect(s.history['s_0']).toBeUndefined();
    expect(s.history['s_104']).toBeDefined();
  });

  it('不合法的条目被忽略', () => {
    const bad = payload({
      history: [{ id: 'x' } as unknown as HistoryEntry, h('a_1', 100)],
      progress: [{ key: 'k', updatedAt: 'no' } as unknown as ProgressEntry],
    });
    const s = mergeSync(emptySyncState(), bad);
    expect(Object.keys(s.history)).toEqual(['a_1']);
    expect(Object.keys(s.progress)).toEqual([]);
  });
});
