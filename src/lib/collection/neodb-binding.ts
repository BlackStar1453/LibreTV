import type { CollectionService } from './service';

/**
 * NeoDB 绑定：账号由 NEODB_TOKEN 决定，用户不填 ID。每个 token 用 /api/me 校验一次：
 * 用户名与已绑定的不同（首次配置或换了账号的 token）就重新绑定并立即全量同步；
 * 校验失败把原因交给界面展示，并在一段时间内不再重复请求。
 */

const RETRY_AFTER_MS = 10 * 60 * 1000;

export interface NeodbBindStatus {
  configured: boolean;
  /** token 校验失败的原因（如 token 无效），成功时为 null */
  error: string | null;
}

export interface NeodbBinderOptions {
  getToken: () => string | null;
  fetchUsername: () => Promise<string>;
  service: CollectionService;
  now: () => number;
}

export function createNeodbBinder(opts: NeodbBinderOptions) {
  let checked: { token: string; at: number; promise: Promise<string | null> } | null = null;

  async function bind(): Promise<string | null> {
    try {
      const username = await opts.fetchUsername();
      if ((await opts.service.getState()).userId !== username) {
        await opts.service.setUserId(username);
        opts.service.sync('full').catch((err) => console.error('[collection] NeoDB 绑定后同步异常', err));
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  return {
    async ensure(): Promise<NeodbBindStatus> {
      const token = opts.getToken();
      if (!token) return { configured: false, error: null };
      const stale = !checked || checked.token !== token;
      if (stale) {
        checked = { token, at: opts.now(), promise: bind() };
      } else if (opts.now() - checked!.at >= RETRY_AFTER_MS && (await checked!.promise) !== null) {
        checked = { token, at: opts.now(), promise: bind() };
      }
      return { configured: true, error: await checked!.promise };
    },
  };
}
