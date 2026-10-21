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
    localized_title?: { lang?: string; text?: string }[] | null;
    url?: string;
    cover_image_url?: string | null;
    rating?: number | null;
  } | null;
}

/** 简体优先的中文语言标签；都没有时退回任意 zh-*（繁体也比英文好搜） */
const ZH_PREFERENCE = ['zh-cn', 'zh-hans', 'zh'];

/** 片源都是中文站，按英文名搜不到，因此片名优先取中文译名 */
function chineseTitle(localized: { lang?: string; text?: string }[] | null | undefined): string | undefined {
  if (!localized?.length) return undefined;
  for (const lang of ZH_PREFERENCE) {
    const hit = localized.find((t) => t.lang?.toLowerCase() === lang && t.text);
    if (hit) return hit.text;
  }
  return localized.find((t) => t.lang?.toLowerCase().startsWith('zh') && t.text)?.text;
}

export function parseNeodbMarks(data: unknown): CollectionPage {
  const d = data as { count?: number; data?: RawMark[] } | null;
  if (!d || !Array.isArray(d.data)) throw new Error('NeoDB 返回格式异常');

  const items: CollectionItem[] = [];
  for (const m of d.data) {
    const s = m.item;
    const title = chineseTitle(s?.localized_title) || s?.display_title || s?.title;
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
