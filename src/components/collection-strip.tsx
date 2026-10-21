'use client';

import Link from 'next/link';
import type { CollectionItem } from '@/lib/collection/types';
import { useCollection } from './collection-section';
import { DoubanCard } from './video-card';

/** 首页最多展示的「在看」条数，更多去片单页 */
const MAX_ITEMS = 12;

/**
 * 首页片单入口：合并豆瓣与 NeoDB 的「在看」（按片名去重）横排展示；
 * 两个来源都没导入时只显示一行导入提示，完整片单在 /collection。
 */
export function CollectionStrip({ onPick }: { onPick: (title: string) => void }) {
  const douban = useCollection('douban');
  const neodb = useCollection('neodb');
  // 加载中或未登录（401 由全局登录框处理）时不占位
  if (!douban.data || !neodb.data) return null;

  if (!douban.data.userId && !neodb.data.userId) {
    return (
      <Link
        href="/collection"
        className="mb-8 flex items-center justify-between gap-3 border border-dashed border-line rounded-xl px-4 py-3 text-sm text-muted hover:text-content hover:border-accent transition-colors"
      >
        <span>导入你的豆瓣 / NeoDB 片单，想看的片在这里一点就能搜</span>
        <span className="shrink-0 text-accent">去导入 →</span>
      </Link>
    );
  }

  const seen = new Set<string>();
  const doing: CollectionItem[] = [];
  for (const it of [...douban.data.lists.doing, ...neodb.data.lists.doing]) {
    if (seen.has(it.title)) continue;
    seen.add(it.title);
    doing.push(it);
  }

  return (
    <section aria-label="在看" className="mb-8">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-medium text-content">在看</h2>
        <Link href="/collection" className="text-xs text-accent hover:underline">
          全部片单 →
        </Link>
      </div>
      {doing.length === 0 ? (
        <p className="text-sm text-faint">片单里暂时没有「在看」的条目</p>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
          {doing.slice(0, MAX_ITEMS).map((item) => (
            <div key={item.id} className="w-28 shrink-0">
              <DoubanCard item={item} onClick={() => onPick(item.title)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
