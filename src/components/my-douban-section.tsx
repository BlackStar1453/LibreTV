'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import type { CollectionItem, CollectionResponse, CollectionStatus } from '@/lib/collection/types';
import { DoubanCard } from './video-card';

const TABS: { key: CollectionStatus; label: string }[] = [
  { key: 'wish', label: '想看' },
  { key: 'doing', label: '在看' },
  { key: 'done', label: '看过' },
];
/** 看过动辄上千条，按批渲染，避免首页一次挂上千张卡片 */
const PAGE = 48;
const QUERY_KEY = ['my-douban'] as const;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function subtitleOf(item: CollectionItem): string {
  return [item.year, item.markedAt.slice(0, 10)].filter(Boolean).join(' · ');
}

/** 首页「我的豆瓣」：同步自豆瓣账号的想看 / 在看 / 看过，点卡片按片名搜资源 */
export function MyDoubanSection({ onPick }: { onPick: (title: string) => void }) {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => api.collection(signal),
    // 同步在服务端后台进行，期间轮询以刷新进度与结果
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });

  if (query.isLoading) return null;
  // 未登录由全局登录框处理，这里静默隐藏
  if (query.error instanceof ApiError && query.error.status === 401) return null;
  if (query.isError) {
    return (
      <Shell>
        <p className="text-sm text-faint py-4">「我的豆瓣」加载失败：{query.error.message}</p>
      </Shell>
    );
  }
  const data = query.data!;
  if (!data.userId) {
    return (
      <Shell>
        <BindForm />
      </Shell>
    );
  }
  return <CollectionView data={data} onPick={onPick} />;
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section aria-label="我的豆瓣" className="mb-8">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-medium text-content">我的豆瓣</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function BindForm({ initial = '', onDone }: { initial?: string; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial);
  const bind = useMutation({
    mutationFn: (v: string) => api.bindDouban(v),
    onSuccess: () => {
      onDone?.();
      return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return (
    <form
      className="border border-dashed border-line rounded-xl p-4 max-w-lg"
      onSubmit={(e) => {
        e.preventDefault();
        bind.mutate(value);
      }}
    >
      <p className="text-sm text-muted mb-3">
        填写豆瓣个人主页链接或数字 ID，同步你的想看 / 在看 / 看过。需在豆瓣「设置 → 隐私」中将「我看」设为公开。
      </p>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.douban.com/people/xxxx/"
        />
        <button type="submit" className="btn-primary" disabled={bind.isPending || !value.trim()}>
          {bind.isPending ? '绑定中…' : '绑定'}
        </button>
      </div>
      {bind.isError && <p className="mt-2 text-sm text-danger">{bind.error.message}</p>}
    </form>
  );
}

function CollectionView({ data, onPick }: { data: CollectionResponse; onPick: (title: string) => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CollectionStatus>('wish');
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState(false);

  const sync = useMutation({
    mutationFn: () => api.syncCollection(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const items = data.lists[tab];
  const last = data.lastResult;
  const syncing = data.syncing || sync.isPending;

  const status = syncing ? (
    <span className="text-muted">同步中…</span>
  ) : last ? (
    <span className={last.ok ? 'text-faint' : 'text-danger'} title={last.error}>
      上次同步 {formatTime(last.at)}
      {last.ok ? '' : ` · 失败：${last.error}`}
    </span>
  ) : null;

  return (
    <Shell
      actions={
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="truncate">{status}</span>
          <button className="btn-ghost btn-sm shrink-0" disabled={syncing} onClick={() => sync.mutate()}>
            立即同步
          </button>
          <button className="btn-ghost btn-sm shrink-0" onClick={() => setEditing((v) => !v)}>
            {editing ? '取消' : '更换 ID'}
          </button>
        </div>
      }
    >
      {editing && (
        <div className="mb-4">
          <BindForm initial={data.userId ?? ''} onDone={() => setEditing(false)} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs transition-colors',
              t.key === tab ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
            )}
            onClick={() => {
              setTab(t.key);
              setShown(PAGE);
            }}
          >
            {t.label} {data.lists[t.key].length}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">
          {syncing
            ? '正在从豆瓣同步…'
            : last?.ok
              ? '这里还没有条目。若豆瓣上有标记，请确认「我看」已设为公开'
              : '暂无数据，可点击「立即同步」'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
            {items.slice(0, shown).map((item) => (
              <DoubanCard key={item.id} item={item} subtitle={subtitleOf(item)} onClick={() => onPick(item.title)} />
            ))}
          </div>
          {shown < items.length && (
            <div className="text-center mt-4">
              <button className="btn-ghost btn-sm" onClick={() => setShown((n) => n + PAGE)}>
                加载更多（{items.length - shown}）
              </button>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
