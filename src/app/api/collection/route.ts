import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { getCollectionService } from '@/lib/collection/server';
import { extractDoubanUserId } from '@/lib/collection/douban-provider';

export const runtime = 'nodejs';

/** 「我的豆瓣」状态：绑定的 ID、三个列表、上次同步结果 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const service = getCollectionService();
  const state = await service.getState();
  return NextResponse.json({ ...state, syncing: service.isSyncing() });
}

/** 绑定 / 更换豆瓣 ID：接受纯 ID 或主页链接，保存后后台全量同步 */
export async function PUT(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let input = '';
  try {
    const body = (await req.json()) as { userId?: string };
    input = String(body.userId ?? '');
  } catch {
    return jsonError('请求格式错误', 400);
  }
  const userId = extractDoubanUserId(input);
  if (!userId) return jsonError('无法识别豆瓣 ID，请填写数字 ID 或个人主页链接', 400);

  const service = getCollectionService();
  try {
    await service.setUserId(userId);
  } catch (err) {
    return jsonError(err instanceof Error ? `保存失败：${err.message}` : '保存失败', 500);
  }
  service.sync('full').catch((err) => console.error('[collection] 绑定后同步异常', err));
  return NextResponse.json({ userId });
}
