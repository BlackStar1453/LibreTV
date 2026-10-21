import type { CollectionItem, CollectionPage, CollectionProvider, CollectionStatus } from './types';

/**
 * NeoDB 数据源：读 token 所属用户的书架（/api/me/shelf，需 Bearer token，未授权 401）。
 * 书架不按分类过滤（接口只接受单个分类），拉全部后只保留电影 / 剧集。
 */

export const NEODB_ORIGIN = 'https://neodb.social';
const PAGE_SIZE = 50;
const SHELF_MAP: Record<CollectionStatus, string> = { wish: 'wishlist', doing: 'progress', done: 'complete' };
const VIDEO_CATEGORIES = new Set(['movie', 'tv']);

interface RawMark {
  created_time?: string;
  rating_grade?: number | null;
  item?: {
    uuid?: string;
    category?: string;
    title?: string;
    display_title?: string;
    url?: string;
    cover_image_url?: string | null;
    rating?: number | null;
  } | null;
}

export function parseNeodbMarks(data: unknown): CollectionPage {
  const d = data as { count?: number; data?: RawMark[] } | null;
  if (!d || !Array.isArray(d.data)) throw new Error('NeoDB 返回格式异常');

  const items: CollectionItem[] = [];
  for (const m of d.data) {
    const s = m.item;
    const title = s?.display_title || s?.title;
    if (!s?.uuid || !title || !VIDEO_CATEGORIES.has(s.category ?? '')) continue;
    items.push({
      id: s.uuid,
      title,
      cover: s.cover_image_url ?? '',
      rating: s.rating ? s.rating.toFixed(1) : undefined,
      isTv: s.category === 'tv',
      markedAt: m.created_time ?? '',
      // NeoDB 评分 1-10，界面按 5 星制
      myRating: m.rating_grade ? m.rating_grade / 2 : undefined,
      url: s.url ? new URL(s.url, NEODB_ORIGIN).toString() : `${NEODB_ORIGIN}/movie/${s.uuid}`,
    });
  }
  return { items, total: typeof d.count === 'number' ? d.count : d.data.length, rawCount: d.data.length };
}

export function createNeodbProvider(fetchJson: (url: string) => Promise<unknown>): CollectionProvider {
  return {
    name: 'neodb',
    label: 'NeoDB',
    pageSize: PAGE_SIZE,
    async fetchPage(_userId, status, start) {
      const sp = new URLSearchParams({ page: String(Math.floor(start / PAGE_SIZE) + 1), page_size: String(PAGE_SIZE) });
      const data = await fetchJson(`${NEODB_ORIGIN}/api/me/shelf/${SHELF_MAP[status]}?${sp.toString()}`);
      return parseNeodbMarks(data);
    },
  };
}
