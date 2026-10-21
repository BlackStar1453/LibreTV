import { describe, expect, it, vi } from 'vitest';
import { createDoubanProvider, extractDoubanUserId, parseDoubanInterests } from './douban-provider';

function interest(id: string, opts: { type?: string; title?: string; rating?: number | null; myStar?: number; time?: string } = {}) {
  return {
    id: Number(id) * 10,
    create_time: opts.time ?? '2026-10-18 17:27:53',
    status: 'mark',
    rating: opts.myStar ? { value: opts.myStar, max: 5 } : null,
    subject: {
      id,
      title: opts.title ?? `片名${id}`,
      year: '2026',
      type: opts.type ?? 'movie',
      url: `https://movie.douban.com/subject/${id}/`,
      cover_url: `https://img9.doubanio.com/view/photo/m_ratio_poster/public/p${id}.jpg`,
      rating: opts.rating === null ? null : { value: opts.rating ?? 9.2, max: 10 },
    },
  };
}

describe('parseDoubanInterests', () => {
  it('把豆瓣 interests 映射为收藏条目', () => {
    const page = parseDoubanInterests({
      total: 2,
      interests: [interest('1', { title: '你能看到一切', myStar: 4 }), interest('2', { type: 'tv', rating: null })],
    });
    expect(page.total).toBe(2);
    expect(page.items[0]).toEqual({
      id: '1',
      title: '你能看到一切',
      cover: 'https://img9.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg',
      year: '2026',
      rating: '9.2',
      isTv: false,
      markedAt: '2026-10-18 17:27:53',
      myRating: 4,
      url: 'https://movie.douban.com/subject/1/',
    });
    expect(page.items[1].isTv).toBe(true);
    expect(page.items[1].rating).toBeUndefined();
    expect(page.items[1].myRating).toBeUndefined();
  });

  it('跳过缺少 subject 的条目（豆瓣下架/隐藏）', () => {
    const page = parseDoubanInterests({ total: 2, interests: [interest('1'), { id: 9, subject: null }] });
    expect(page.items.map((i) => i.id)).toEqual(['1']);
  });

  it('响应缺少 interests 时抛错，不当成空列表', () => {
    expect(() => parseDoubanInterests({ msg: 'rate_limit' })).toThrow();
  });
});

describe('extractDoubanUserId', () => {
  it.each([
    ['157618520', '157618520'],
    ['https://www.douban.com/people/157618520/?_i=2587436YNLAMeJ', '157618520'],
    ['https://movie.douban.com/people/ahbei/wish', 'ahbei'],
    ['  ahbei  ', 'ahbei'],
  ])('%s → %s', (input, expected) => {
    expect(extractDoubanUserId(input)).toBe(expected);
  });

  it.each(['', 'https://example.com/x', 'a b', '../etc'])('非法输入 %s 返回 null', (input) => {
    expect(extractDoubanUserId(input)).toBeNull();
  });
});

describe('createDoubanProvider', () => {
  it('按状态与偏移请求 rexxar 接口', async () => {
    const fetchJson = vi.fn<(url: string) => Promise<unknown>>(async () => ({ total: 0, interests: [] }));
    const provider = createDoubanProvider(fetchJson);
    await provider.fetchPage('157618520', 'done', 50);
    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.pathname).toBe('/rexxar/api/v2/user/157618520/interests');
    expect(url.searchParams.get('status')).toBe('done');
    expect(url.searchParams.get('type')).toBe('movie');
    expect(url.searchParams.get('start')).toBe('50');
    expect(provider.pageSize).toBe(50);
  });

  it('wish/doing 映射为豆瓣的 mark/doing', async () => {
    const fetchJson = vi.fn<(url: string) => Promise<unknown>>(async () => ({ total: 0, interests: [] }));
    const provider = createDoubanProvider(fetchJson);
    await provider.fetchPage('u', 'wish', 0);
    await provider.fetchPage('u', 'doing', 0);
    expect(new URL(fetchJson.mock.calls[0][0]).searchParams.get('status')).toBe('mark');
    expect(new URL(fetchJson.mock.calls[1][0]).searchParams.get('status')).toBe('doing');
  });
});
