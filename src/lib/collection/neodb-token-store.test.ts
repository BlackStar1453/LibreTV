import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNeodbTokenStore } from './neodb-token-store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neodb-token-'));
  file = path.join(dir, 'sub', 'neodb-token.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('NeoDB token 存储', () => {
  it('未配置任何 token', async () => {
    const store = createNeodbTokenStore({ filePath: file, envToken: () => null });
    await store.load();
    expect(store.get()).toBeNull();
    expect(store.origin()).toBeNull();
  });

  it('网页保存的 token 落盘（权限 0600），新实例可读回', async () => {
    const store = createNeodbTokenStore({ filePath: file, envToken: () => null });
    await store.save('  abc123  ');
    expect(store.get()).toBe('abc123');
    expect(store.origin()).toBe('page');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);

    const reopened = createNeodbTokenStore({ filePath: file, envToken: () => null });
    await reopened.load();
    expect(reopened.get()).toBe('abc123');
  });

  it('.env 优先，且此时不允许网页修改', async () => {
    const store = createNeodbTokenStore({ filePath: file, envToken: () => 'from-env' });
    await store.load();
    expect(store.get()).toBe('from-env');
    expect(store.origin()).toBe('env');
    await expect(store.save('other')).rejects.toThrow('.env');
  });

  it('文件损坏时视为未配置，不抛错', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{oops');
    const store = createNeodbTokenStore({ filePath: file, envToken: () => null });
    await store.load();
    expect(store.get()).toBeNull();
  });
});
