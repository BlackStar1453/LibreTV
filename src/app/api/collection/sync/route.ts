import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { getCollectionService } from '@/lib/collection/server';
import { parseCollectionSource } from '@/lib/collection/types';

export const runtime = 'nodejs';

/** 立即同步（?source=douban|neodb）：后台全量，接口立即返回，前端轮询 GET /api/collection 观察进度 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const source = parseCollectionSource(req);
  if (!source) return jsonError('未知的收藏来源', 400);

  const service = getCollectionService(source);
  const state = await service.getState();
  if (!state.userId) return jsonError(source === 'neodb' ? 'NeoDB 尚未绑定，请检查 NEODB_TOKEN' : '尚未绑定豆瓣 ID', 400);

  service.sync('full').catch((err) => console.error('[collection] 立即同步异常', err));
  return NextResponse.json({ syncing: true }, { status: 202 });
}
