/**
 * 「我的豆瓣」收藏同步的领域类型。
 * 数据源（豆瓣，日后 NeoDB）只需实现 CollectionProvider，界面与同步逻辑不感知来源。
 */

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
}

export interface CollectionProvider {
  name: string;
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
}
