import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { getCollectionService } from '@/lib/collection/server';

export const runtime = 'nodejs';

/** 立即同步：后台全量，接口立即返回，前端轮询 GET /api/collection 观察进度 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const service = getCollectionService();
  const state = await service.getState();
  if (!state.userId) return jsonError('尚未绑定豆瓣 ID', 400);

  service.sync('full').catch((err) => console.error('[collection] 立即同步异常', err));
  return NextResponse.json({ syncing: true }, { status: 202 });
}
