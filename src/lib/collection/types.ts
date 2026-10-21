/**
 * 「我的豆瓣」收藏同步的领域类型。
 * 数据源（豆瓣 / NeoDB）只需实现 CollectionProvider，界面与同步逻辑不感知来源。
 */

/** 收藏来源：豆瓣（填公开 ID）/ NeoDB（.env 配 token），各自独立同步与存储 */
export type CollectionSource = 'douban' | 'neodb';

/** 想看 / 在看 / 看过 */
export type CollectionStatus = 'wish' | 'doing' | 'done';

export interface CollectionItem {
  id: string;
  title: string;
  cover: string;
  year?: string;
  /** 站内评分（豆瓣 10 分制），无评分时省略 */
  rating?: string;
  isTv: boolean;
  /** 标记时间，来源原样（豆瓣为 'YYYY-MM-DD HH:mm:ss'，北京时间） */
  markedAt: string;
  /** 我的评分（5 星制） */
  myRating?: number;
  url: string;
}

export interface CollectionPage {
  items: CollectionItem[];
  total: number;
  /** 过滤前本页原始条数（数据源会滤掉非影视条目时提供），用于判断是否翻到末页 */
  rawCount?: number;
}

export interface CollectionProvider {
  name: CollectionSource;
  /** 界面与错误信息中的来源名，如「豆瓣」 */
  label: string;
  /** 列表被整列返回空时的可能原因提示 */
  emptyHint: string;
  pageSize: number;
  fetchPage(userId: string, status: CollectionStatus, start: number): Promise<CollectionPage>;
}

/** quick：想看/在看全量 + 看过增量；full：三个列表全量镜像 */
export type SyncMode = 'quick' | 'full';

export interface SyncResult {
  at: number;
  mode: SyncMode;
  ok: boolean;
  error?: string;
}

export interface CollectionState {
  userId: string | null;
  lists: Record<CollectionStatus, CollectionItem[]>;
  /** 上次同步尝试时间（任一模式、无论成败），用于 6 小时节流 */
  lastAttemptAt: number | null;
  /** 上次成功全量时间 */
  lastFullAt: number | null;
  lastResult: SyncResult | null;
}

/** GET /api/collection 响应 */
export interface CollectionResponse extends CollectionState {
  syncing: boolean;
  /** 数据源是否可用：豆瓣恒为 true；NeoDB 取决于是否配置了 NEODB_TOKEN */
  configured: boolean;
  /** 绑定失败原因（NeoDB token 无效等），无错误为 null */
  bindError: string | null;
  /** NeoDB token 由服务器 .env 配置，页面不能修改 */
  managedByEnv: boolean;
}

export const COLLECTION_SOURCES: readonly CollectionSource[] = ['douban', 'neodb'];

/** 解析请求的 ?source=，缺省为豆瓣；非法值返回 null */
export function parseCollectionSource(req: Request): CollectionSource | null {
  const raw = new URL(req.url).searchParams.get('source') ?? 'douban';
  return (COLLECTION_SOURCES as readonly string[]).includes(raw) ? (raw as CollectionSource) : null;
}
