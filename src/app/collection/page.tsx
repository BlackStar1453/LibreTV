'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { CollectionPanel, SOURCE_UI, useCollection } from '@/components/collection-section';
import { COLLECTION_SOURCES, type CollectionSource } from '@/lib/collection/types';
import { cn } from '@/lib/utils';

/** 片单页：豆瓣 / NeoDB 两个来源分标签展示；未导入的来源显示导入引导 */
export default function CollectionPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-content mb-1">我的片单</h1>
        <p className="text-sm text-muted mb-6">
          导入你在豆瓣或 NeoDB 上的「想看 / 在看 / 看过」，点任意一部即可在本站搜索播放。数据保存在本站服务器，并自动定时同步。
        </p>
        <Suspense>
          <CollectionTabs />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

function CollectionTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('source');
  const source: CollectionSource = raw === 'neodb' ? 'neodb' : 'douban';

  return (
    <>
      <div role="tablist" className="flex gap-1 border-b border-line mb-5">
        {COLLECTION_SOURCES.map((s) => (
          <SourceTab
            key={s}
            source={s}
            active={s === source}
            onClick={() => router.replace(s === 'douban' ? '/collection' : `/collection?source=${s}`, { scroll: false })}
          />
        ))}
      </div>
      <CollectionPanel source={source} onPick={(title) => router.push(`/?s=${encodeURIComponent(title)}`)} />
    </>
  );
}

/** 标签上标出是否已导入，方便一眼看出还差哪个 */
function SourceTab({ source, active, onClick }: { source: CollectionSource; active: boolean; onClick: () => void }) {
  const { data } = useCollection(source);
  const bound = !!data?.userId;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-sm -mb-px border-b-2 transition-colors flex items-center gap-1.5',
        active ? 'border-accent text-content' : 'border-transparent text-muted hover:text-content'
      )}
    >
      {SOURCE_UI[source].label}
      {data && !bound && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-chip text-faint">未导入</span>}
    </button>
  );
}
