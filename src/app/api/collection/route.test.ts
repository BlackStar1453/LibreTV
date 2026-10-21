/**
 * 「我的豆瓣」接口单测：鉴权、ID 校验、绑定后后台触发全量同步（请求本身不等同步完成）。
 * 服务层 mock 掉，不产生文件与网络 IO。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { GET, PUT } from './route';
import { POST } from './sync/route';

const state = vi.hoisted(() => ({
  authed: true,
  userId: null as string | null,
  syncCalls: [] as string[],
  sources: [] as string[],
  neodbConfigured: false,
  ensureCalls: 0,
  bindError: null as string | null,
}));

vi.mock('@/lib/api-guard', () => ({
  guardRequest: vi.fn(() => (state.authed ? null : NextResponse.json({ error: '未登录' }, { status: 401 }))),
  jsonError: (message: string, status: number) => NextResponse.json({ error: message }, { status }),
}));

vi.mock('@/lib/collection/server', () => ({
  ensureNeodbBound: async () => {
    state.ensureCalls++;
    return { configured: state.neodbConfigured, error: state.bindError };
  },
  getCollectionService: (source = 'douban') => (state.sources.push(source), {
    getState: async () => ({ userId: state.userId, lists: { wish: [], doing: [], done: [] }, lastAttemptAt: null, lastFullAt: null, lastResult: null }),
    isSyncing: () => false,
    setUserId: async (id: string) => {
      state.userId = id;
      return { userId: id };
    },
    // 永不 resolve：断言接口不等待同步完成
    sync: (mode: string) => {
      state.syncCalls.push(mode);
      return new Promise(() => {});
    },
  }),
}));

beforeEach(() => {
  state.authed = true;
  state.userId = null;
  state.syncCalls = [];
  state.sources = [];
  state.neodbConfigured = false;
  state.ensureCalls = 0;
  state.bindError = null;
});

const put = (body: unknown) =>
  PUT(new Request('http://x/api/collection', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

describe('/api/collection', () => {
  it('未登录返回 401', async () => {
    state.authed = false;
    expect((await GET(new Request('http://x/api/collection'))).status).toBe(401);
    expect((await put({ userId: '1' })).status).toBe(401);
    expect((await POST(new Request('http://x/api/collection/sync', { method: 'POST' }))).status).toBe(401);
  });

  it('GET 返回状态与 syncing 标记', async () => {
    const res = await GET(new Request('http://x/api/collection'));
    expect(await res.json()).toMatchObject({ userId: null, syncing: false });
  });

  it('PUT 接受主页链接，绑定后立即后台全量同步', async () => {
    const res = await put({ userId: 'https://www.douban.com/people/157618520/?_i=abc' });
    expect(res.status).toBe(200);
    expect(state.userId).toBe('157618520');
    expect(state.syncCalls).toEqual(['full']);
  });

  it('PUT 非法 ID 返回 400', async () => {
    const res = await put({ userId: '../etc' });
    expect(res.status).toBe(400);
    expect(state.userId).toBeNull();
  });

  it('POST /sync 未绑定时返回 400', async () => {
    const res = await POST(new Request('http://x/api/collection/sync', { method: 'POST' }));
    expect(res.status).toBe(400);
  });

  it('POST /sync 触发全量同步并立即返回 202', async () => {
    state.userId = 'u1';
    const res = await POST(new Request('http://x/api/collection/sync', { method: 'POST' }));
    expect(res.status).toBe(202);
    expect(state.syncCalls).toEqual(['full']);
  });

  it('GET 豆瓣恒为 configured，不触发 NeoDB 绑定', async () => {
    const res = await GET(new Request('http://x/api/collection'));
    expect(await res.json()).toMatchObject({ configured: true });
    expect(state.sources).toEqual(['douban']);
    expect(state.ensureCalls).toBe(0);
  });

  it('GET ?source=neodb 先确保绑定，再读 NeoDB 的状态', async () => {
    state.neodbConfigured = true;
    const res = await GET(new Request('http://x/api/collection?source=neodb'));
    expect(await res.json()).toMatchObject({ configured: true });
    expect(state.ensureCalls).toBe(1);
    expect(state.sources).toEqual(['neodb']);
  });

  it('GET ?source=neodb 未配置 token 时 configured=false', async () => {
    const res = await GET(new Request('http://x/api/collection?source=neodb'));
    expect(await res.json()).toMatchObject({ configured: false });
  });

  it('未知 source 返回 400', async () => {
    expect((await GET(new Request('http://x/api/collection?source=imdb'))).status).toBe(400);
    expect((await POST(new Request('http://x/api/collection/sync?source=imdb', { method: 'POST' }))).status).toBe(400);
  });

  it('PUT 不支持 NeoDB（靠 token 绑定）', async () => {
    const res = await PUT(
      new Request('http://x/api/collection?source=neodb', { method: 'PUT', body: JSON.stringify({ userId: 'x' }) })
    );
    expect(res.status).toBe(400);
    expect(state.userId).toBeNull();
  });

  it('POST /sync?source=neodb 同步 NeoDB', async () => {
    state.userId = 'yao';
    state.neodbConfigured = true;
    const res = await POST(new Request('http://x/api/collection/sync?source=neodb', { method: 'POST' }));
    expect(res.status).toBe(202);
    expect(state.sources).toContain('neodb');
    expect(state.syncCalls).toEqual(['full']);
  });

  it('GET ?source=neodb 返回 token 校验失败原因', async () => {
    state.neodbConfigured = true;
    state.bindError = 'NEODB_TOKEN 无效';
    const res = await GET(new Request('http://x/api/collection?source=neodb'));
    expect(await res.json()).toMatchObject({ configured: true, bindError: 'NEODB_TOKEN 无效' });
  });

  it('POST /sync?source=neodb 未配置或 token 无效时返回 400，不在后台失败', async () => {
    state.userId = 'yao';
    expect((await POST(new Request('http://x/api/collection/sync?source=neodb', { method: 'POST' }))).status).toBe(400);
    state.neodbConfigured = true;
    state.bindError = 'NEODB_TOKEN 无效';
    expect((await POST(new Request('http://x/api/collection/sync?source=neodb', { method: 'POST' }))).status).toBe(400);
    expect(state.syncCalls).toEqual([]);
  });
});
