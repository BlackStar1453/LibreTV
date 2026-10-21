'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/client-api';
import { cn } from '@/lib/utils';
import type { CollectionItem, CollectionResponse, CollectionSource, CollectionStatus } from '@/lib/collection/types';
import { DoubanCard } from './video-card';

const TABS: { key: CollectionStatus; label: string }[] = [
  { key: 'wish', label: '想看' },
  { key: 'doing', label: '在看' },
  { key: 'done', label: '看过' },
];
/** 看过动辄上千条，按批渲染，避免一次挂上千张卡片 */
const PAGE = 48;
/** 各来源的界面差异集中在这里：豆瓣填公开主页链接，NeoDB 粘贴 Access Token */
export const SOURCE_UI: Record<CollectionSource, { label: string; rebindLabel: string; emptyText: string }> = {
  douban: { label: '豆瓣', rebindLabel: '更换账号', emptyText: '这里还没有条目。若豆瓣上有标记，请确认「我看」已设为公开' },
  neodb: { label: 'NeoDB', rebindLabel: '更换 token', emptyText: '这里还没有条目（只同步电影与剧集）' },
};
export const collectionQueryKey = (source: CollectionSource) => ['my-collection', source] as const;

/** 片单数据：同步在服务端后台进行，期间轮询以刷新进度与结果 */
export function useCollection(source: CollectionSource) {
  return useQuery({
    queryKey: collectionQueryKey(source),
    queryFn: ({ signal }) => api.collection(source, signal),
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function subtitleOf(item: CollectionItem): string {
  return [item.year, item.markedAt.slice(0, 10)].filter(Boolean).join(' · ');
}

/** 片单页中一个来源的内容：未绑定显示导入引导，已绑定显示 想看 / 在看 / 看过，点卡片按片名搜资源 */
export function CollectionPanel({ source, onPick }: { source: CollectionSource; onPick: (title: string) => void }) {
  const query = useCollection(source);

  if (query.isLoading) return <p className="text-sm text-faint py-8 text-center">加载中…</p>;
  // 未登录由全局登录框处理
  if (query.error instanceof ApiError && query.error.status === 401) {
    return <p className="text-sm text-faint py-8 text-center">登录后查看片单</p>;
  }
  if (query.isError) return <p className="text-sm text-danger py-8">片单加载失败：{query.error.message}</p>;

  const data = query.data!;
  if (!data.userId) return <Onboarding source={source} data={data} />;
  return <CollectionView source={source} data={data} onPick={onPick} />;
}

/* ---------- 导入引导 ---------- */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-accent text-on-accent text-xs flex items-center justify-center">{n}</span>
      <div className="text-sm text-muted leading-relaxed pt-0.5">{children}</div>
    </li>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  );
}

function Onboarding({ source, data }: { source: CollectionSource; data: CollectionResponse }) {
  return (
    <div className="border border-line rounded-xl p-5 max-w-2xl">
      {source === 'douban' ? (
        <>
          <h3 className="text-base font-medium text-content mb-1">导入豆瓣片单</h3>
          <p className="text-sm text-faint mb-4">只需要你的豆瓣主页链接，不需要登录豆瓣。大约 1 分钟。</p>
          <ol className="space-y-3 mb-5">
            <Step n={1}>
              打开 <ExtLink href="https://www.douban.com/mine/">我的豆瓣主页</ExtLink>（手机上可在豆瓣 App「我的 → 个人主页 → 分享 → 复制链接」），复制地址栏里的链接。
            </Step>
            <Step n={2}>
              确认豆瓣「设置 → 隐私」中，「我看」对所有人公开。设为私密时这里读不到数据。
            </Step>
            <Step n={3}>把链接粘贴到下面，点「绑定」。之后会自动定时同步。</Step>
          </ol>
          <DoubanBindForm />
        </>
      ) : data.managedByEnv ? (
        <>
          <h3 className="text-base font-medium text-content mb-1">NeoDB 连接失败</h3>
          <p className="text-sm text-danger">{data.bindError ?? '正在连接…'}</p>
          <p className="text-sm text-faint mt-2">token 由服务器的 .env（NEODB_TOKEN）配置，请联系站点管理员更新。</p>
        </>
      ) : (
        <>
          <h3 className="text-base font-medium text-content mb-1">导入 NeoDB 片单</h3>
          <p className="text-sm text-faint mb-4">NeoDB 需要一个访问令牌（token）来读取你的标记。大约 2 分钟。</p>
          <ol className="space-y-3 mb-5">
            <Step n={1}>
              打开 <ExtLink href="https://neodb.social/account/login">neodb.social</ExtLink> 并登录。没有账号的话，可以直接用 Mastodon、邮箱或 Bluesky 登录，会自动创建。
            </Step>
            <Step n={2}>
              登录后打开 <ExtLink href="https://neodb.social/developer/">NeoDB 开发者页面</ExtLink>，点「Test Access Token」展开，再点
              「Generate」。token 只显示这一次，重新生成会让旧的失效。
            </Step>
            <Step n={3}>复制生成的 token，粘贴到下面，点「保存」。token 只保存在本站服务器上，不会再显示出来。</Step>
          </ol>
          {data.bindError && <p className="text-sm text-danger mb-3">上次连接失败：{data.bindError}</p>}
          <NeodbTokenForm />
        </>
      )}
    </div>
  );
}

function useBind(source: CollectionSource, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: string): Promise<void> => {
      await (source === 'douban' ? api.bindDouban(v) : api.bindNeodb(v));
    },
    onSuccess: () => {
      onDone?.();
      return queryClient.invalidateQueries({ queryKey: collectionQueryKey(source) });
    },
  });
}

function DoubanBindForm({ initial = '', onDone }: { initial?: string; onDone?: () => void }) {
  const [value, setValue] = useState(initial);
  const bind = useBind('douban', onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        bind.mutate(value);
      }}
    >
      <div className="flex gap-2">
        <input
          className="input flex-1 min-w-0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://www.douban.com/people/xxxx/"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={bind.isPending || !value.trim()}>
          {bind.isPending ? '绑定中…' : '绑定'}
        </button>
      </div>
      {bind.isError && <p className="mt-2 text-sm text-danger">{bind.error.message}</p>}
    </form>
  );
}

function NeodbTokenForm({ onDone }: { onDone?: () => void }) {
  const [value, setValue] = useState('');
  const bind = useBind('neodb', onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        bind.mutate(value);
      }}
    >
      <div className="flex gap-2">
        <input
          className="input flex-1 min-w-0"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="粘贴 NeoDB token"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={bind.isPending || !value.trim()}>
          {bind.isPending ? '校验中…' : '保存'}
        </button>
      </div>
      {bind.isError && <p className="mt-2 text-sm text-danger">{bind.error.message}</p>}
    </form>
  );
}

/* ---------- 已绑定的片单 ---------- */

function CollectionView({ source, data, onPick }: { source: CollectionSource; data: CollectionResponse; onPick: (title: string) => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CollectionStatus>('wish');
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState(false);

  const sync = useMutation({
    mutationFn: () => api.syncCollection(source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionQueryKey(source) }),
  });

  const items = data.lists[tab];
  const last = data.lastResult;
  const syncing = data.syncing || sync.isPending;
  const ui = SOURCE_UI[source];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
        <span className="text-faint truncate min-w-0">
          账号 {data.userId}
          {' · '}
          {syncing ? (
            <span className="text-muted">同步中…</span>
          ) : last ? (
            <span className={last.ok ? '' : 'text-danger'} title={last.error}>
              上次同步 {formatTime(last.at)}
              {last.ok ? '' : ` · 失败：${last.error}`}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn-ghost btn-sm" disabled={syncing} onClick={() => sync.mutate()}>
            立即同步
          </button>
          {!data.managedByEnv && (
            <button className="btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>
              {editing ? '取消' : ui.rebindLabel}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mb-4 max-w-lg">
          {source === 'douban' ? (
            <DoubanBindForm initial={data.userId ?? ''} onDone={() => setEditing(false)} />
          ) : (
            <>
              <p className="text-xs text-faint mb-2">换成另一个账号的 token 会清空当前片单并重新同步。</p>
              <NeodbTokenForm onDone={() => setEditing(false)} />
            </>
          )}
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
          {syncing ? `正在从${ui.label}同步…` : last?.ok ? ui.emptyText : '暂无数据，可点击「立即同步」'}
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
    </div>
  );
}
