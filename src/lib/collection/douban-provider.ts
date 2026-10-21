import type { CollectionItem, CollectionPage, CollectionProvider, CollectionStatus } from './types';

/**
 * 豆瓣数据源：读用户公开的影视标记（m.douban.com rexxar 接口，免登录，每页最多 50 条）。
 * 用户在豆瓣把「我看」设为私密时接口返回空，界面会提示检查公开设置。
 */

const REXXAR = 'https://m.douban.com/rexxar/api/v2/user';
const PAGE_SIZE = 50;
const STATUS_MAP: Record<CollectionStatus, string> = { wish: 'mark', doing: 'doing', done: 'done' };

export const DOUBAN_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  Referer: 'https://m.douban.com/mine/movie',
  Accept: 'application/json',
};

interface RawInterest {
  create_time?: string;
  rating?: { value?: number } | null;
  subject?: {
    id?: string;
    title?: string;
    year?: string;
    type?: string;
    url?: string;
    cover_url?: string;
    rating?: { value?: number } | null;
  } | null;
}

export function parseDoubanInterests(data: unknown): CollectionPage {
  const d = data as { total?: number; interests?: RawInterest[] } | null;
  if (!d || !Array.isArray(d.interests)) throw new Error('豆瓣返回格式异常');

  const items: CollectionItem[] = [];
  for (const it of d.interests) {
    const s = it.subject;
    if (!s?.id || !s.title) continue;
    const rating = s.rating?.value;
    items.push({
      id: String(s.id),
      title: s.title,
      cover: s.cover_url ?? '',
      year: s.year || undefined,
      rating: rating ? rating.toFixed(1) : undefined,
      isTv: s.type === 'tv',
      markedAt: it.create_time ?? '',
      myRating: it.rating?.value || undefined,
      url: s.url ?? `https://movie.douban.com/subject/${s.id}/`,
    });
  }
  return { items, total: typeof d.total === 'number' ? d.total : items.length };
}

/** 接受纯 ID 或任意豆瓣个人主页链接；只允许字母数字及 . _ -，防止拼进 URL 时路径穿越 */
export function extractDoubanUserId(input: string): string | null {
  const raw = input.trim();
  const fromUrl = raw.match(/douban\.com\/people\/([^/?#]+)/);
  const id = fromUrl ? fromUrl[1] : raw;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || id.includes('..')) return null;
  return id;
}

export function createDoubanProvider(fetchJson: (url: string) => Promise<unknown>): CollectionProvider {
  return {
    name: 'douban',
    pageSize: PAGE_SIZE,
    async fetchPage(userId, status, start) {
      const sp = new URLSearchParams({
        type: 'movie',
        status: STATUS_MAP[status],
        start: String(start),
        count: String(PAGE_SIZE),
      });
      const data = await fetchJson(`${REXXAR}/${encodeURIComponent(userId)}/interests?${sp.toString()}`);
      return parseDoubanInterests(data);
    },
  };
}
