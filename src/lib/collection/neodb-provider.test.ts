import { describe, expect, it, vi } from 'vitest';
import { createNeodbProvider, parseNeodbMarks } from './neodb-provider';

function mark(uuid: string, opts: { category?: string; title?: string; rating?: number | null; grade?: number | null; time?: string } = {}) {
  return {
    shelf_type: 'wishlist',
    created_time: opts.time ?? '2026-10-18T09:27:53Z',
    rating_grade: opts.grade ?? null,
    item: {
      uuid,
      id: `https://neodb.social/api/movie/${uuid}`,
      type: 'Movie',
      category: opts.category ?? 'movie',
      title: opts.title ?? `片名${uuid}`,
      display_title: opts.title ?? `片名${uuid}`,
      url: `/movie/${uuid}`,
      cover_image_url: `https://neodb.social/m/item/${uuid}.jpg`,
      rating: opts.rating === null ? null : (opts.rating ?? 8.75),
    },
  };
}

describe('parseNeodbMarks', () => {
  it('把 NeoDB 标记映射为收藏条目，评分换算为 5 星制', () => {
    const page = parseNeodbMarks({ count: 2, pages: 1, data: [mark('a1', { title: '你能看到一切', grade: 8 }), mark('b2', { category: 'tv', rating: null })] });
    expect(page.total).toBe(2);
    expect(page.items[0]).toEqual({
      id: 'a1',
      title: '你能看到一切',
      cover: 'https://neodb.social/m/item/a1.jpg',
      rating: '8.8',
      isTv: false,
      markedAt: '2026-10-18T09:27:53Z',
      myRating: 4,
      url: 'https://neodb.social/movie/a1',
    });
    expect(page.items[1].isTv).toBe(true);
    expect(page.items[1].rating).toBeUndefined();
    expect(page.items[1].myRating).toBeUndefined();
  });

  it('片名优先取简体中文（片源都是中文站，按英文名搜不到）', () => {
    const m = mark('a', { title: 'Aftersun' });
    const withLocal = (localized: { lang: string; text: string }[]) => ({ ...m, item: { ...m.item, localized_title: localized } });
    const titleOf = (localized: { lang: string; text: string }[]) =>
      parseNeodbMarks({ count: 1, data: [withLocal(localized)] }).items[0].title;
    expect(titleOf([{ lang: 'zh-tw', text: '日麗' }, { lang: 'en', text: 'Aftersun' }, { lang: 'zh-cn', text: '晒后假日' }])).toBe('晒后假日');
    expect(titleOf([{ lang: 'zh', text: '戀戀風塵' }, { lang: 'zh-hans', text: '恋恋风尘' }])).toBe('恋恋风尘');
    expect(titleOf([{ lang: 'zh-hk', text: '日麗' }])).toBe('日麗');
    expect(titleOf([{ lang: 'en', text: 'Aftersun' }])).toBe('Aftersun');
  });

  it('只保留电影 / 剧集，rawCount 记录过滤前条数，避免整页是书时被误判为末页', () => {
    const page = parseNeodbMarks({ count: 3, pages: 1, data: [mark('a'), mark('b', { category: 'book' }), mark('c', { category: 'tv' })] });
    expect(page.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(page.rawCount).toBe(3);
  });

  it('响应缺少 data 时抛错，不当成空列表', () => {
    expect(() => parseNeodbMarks({ detail: 'Unauthorized' })).toThrow();
  });
});

describe('createNeodbProvider', () => {
  it('状态映射到书架类型，偏移量换算为页码', async () => {
    const fetchJson = vi.fn(async () => ({ count: 0, pages: 0, data: [] }));
    const p = createNeodbProvider(fetchJson);
    await p.fetchPage('me', 'wish', 0);
    await p.fetchPage('me', 'doing', p.pageSize);
    await p.fetchPage('me', 'done', p.pageSize * 2);
    const urls = fetchJson.mock.calls.map((c) => new URL((c as unknown as [string])[0]));
    expect(urls.map((u) => u.pathname)).toEqual(['/api/me/shelf/wishlist', '/api/me/shelf/progress', '/api/me/shelf/complete']);
    expect(urls.map((u) => u.searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(urls[0].searchParams.get('page_size')).toBe(String(p.pageSize));
  });
});
