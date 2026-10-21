import { describe, expect, it, vi } from 'vitest';
import { createNeodbBinder } from './neodb-binding';
import type { CollectionService } from './service';

function fakeService(initialUserId: string | null) {
  let userId = initialUserId;
  const calls = { setUserId: [] as string[], sync: [] as string[] };
  const service = {
    getState: async () => ({ userId }),
    setUserId: async (id: string) => {
      calls.setUserId.push(id);
      userId = id;
    },
    sync: async (mode: string) => {
      calls.sync.push(mode);
    },
  } as unknown as CollectionService;
  return { service, calls };
}

function setup(opts: { token?: string | null; userId?: string | null; me?: () => Promise<string> } = {}) {
  const env = { token: opts.token === undefined ? 't1' : opts.token, now: 0 };
  const { service, calls } = fakeService(opts.userId ?? null);
  const fetchUsername = vi.fn(opts.me ?? (async () => 'yao'));
  const binder = createNeodbBinder({ getToken: () => env.token, fetchUsername, service, now: () => env.now });
  return { binder, env, calls, fetchUsername };
}

describe('NeoDB 绑定', () => {
  it('未配置 token：不请求，返回未配置', async () => {
    const { binder, fetchUsername } = setup({ token: null });
    expect(await binder.ensure()).toEqual({ configured: false, error: null });
    expect(fetchUsername).not.toHaveBeenCalled();
  });

  it('首次绑定：写入用户名并立即后台全量同步', async () => {
    const { binder, calls } = setup();
    expect(await binder.ensure()).toEqual({ configured: true, error: null });
    expect(calls.setUserId).toEqual(['yao']);
    expect(calls.sync).toEqual(['full']);
  });

  it('同一 token 只校验一次（并发调用也只请求一次）', async () => {
    const { binder, fetchUsername } = setup();
    await Promise.all([binder.ensure(), binder.ensure()]);
    await binder.ensure();
    expect(fetchUsername).toHaveBeenCalledTimes(1);
  });

  it('换成另一个账号的 token：按新用户名重新绑定（清空旧账号数据）', async () => {
    const { binder, calls } = setup({ userId: 'old' });
    await binder.ensure();
    expect(calls.setUserId).toEqual(['yao']);
    expect(calls.sync).toEqual(['full']);
  });

  it('token 仍属于已绑定账号：不重置、不额外同步', async () => {
    const { binder, calls } = setup({ userId: 'yao' });
    await binder.ensure();
    expect(calls.setUserId).toEqual([]);
    expect(calls.sync).toEqual([]);
  });

  it('token 无效：返回错误供界面展示，10 分钟内不重复请求', async () => {
    const { binder, env, fetchUsername } = setup({
      me: async () => {
        throw new Error('NEODB_TOKEN 无效');
      },
    });
    expect(await binder.ensure()).toEqual({ configured: true, error: 'NEODB_TOKEN 无效' });
    env.now = 9 * 60 * 1000;
    await binder.ensure();
    expect(fetchUsername).toHaveBeenCalledTimes(1);
    env.now = 11 * 60 * 1000;
    await binder.ensure();
    expect(fetchUsername).toHaveBeenCalledTimes(2);
  });

  it('运行中更换 token：重新校验', async () => {
    const { binder, env, fetchUsername } = setup();
    await binder.ensure();
    env.token = 't2';
    await binder.ensure();
    expect(fetchUsername).toHaveBeenCalledTimes(2);
  });
});
