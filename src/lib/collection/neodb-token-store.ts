import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * NeoDB token 来源：.env 的 NEODB_TOKEN 优先，否则用片单页面填写、存在 data 目录的 token（见 ADR 0001）。
 * 读取是同步的（同步与绑定流程随处要用），因此使用前需先 load() 一次。
 */

export interface NeodbTokenStoreOptions {
  filePath: string;
  envToken: () => string | null;
}

export function createNeodbTokenStore(opts: NeodbTokenStoreOptions) {
  let fileToken: string | null = null;
  let loading: Promise<void> | null = null;

  async function readFile(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(opts.filePath, 'utf8')) as { token?: unknown };
      fileToken = typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : null;
    } catch {
      // 不存在或损坏：视为未配置，页面会引导重新填写
      fileToken = null;
    }
  }

  return {
    load(): Promise<void> {
      loading ??= readFile();
      return loading;
    },

    get(): string | null {
      return opts.envToken() || fileToken;
    },

    /** token 从哪来：env 时页面只读 */
    origin(): 'env' | 'page' | null {
      if (opts.envToken()) return 'env';
      return fileToken ? 'page' : null;
    },

    async save(token: string): Promise<void> {
      if (opts.envToken()) throw new Error('NeoDB token 已在 .env 中配置，请修改 .env');
      const value = token.trim();
      await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
      const tmp = `${opts.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ token: value }), { mode: 0o600 });
      await fs.rename(tmp, opts.filePath);
      loading = Promise.resolve();
      fileToken = value;
    },
  };
}
