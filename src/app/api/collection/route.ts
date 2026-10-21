import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkSourceReady, getCollectionService } from '@/lib/collection/server';
import { extractDoubanUserId } from '@/lib/collection/douban-provider';
import { parseCollectionSource } from '@/lib/collection/types';

export const runtime = 'nodejs';

/** 收藏状态（?source=douban|neodb，缺省豆瓣）：绑定的 ID、三个列表、上次同步结果 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const source = parseCollectionSource(req);
  if (!source) return jsonError('未知的收藏来源', 400);

  const bind = await checkSourceReady(source);
  const service = getCollectionService(source);
  const state = await service.getState();
  return NextResponse.json({ ...state, syncing: service.isSyncing(), configured: bind.configured, bindError: bind.error });
}

/** 绑定 / 更换豆瓣 ID：接受纯 ID 或主页链接，保存后后台全量同步。NeoDB 由 NEODB_TOKEN 决定账号，不走这里 */
export async function PUT(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const source = parseCollectionSource(req);
  if (source !== 'douban') return jsonError('只有豆瓣需要填写 ID；NeoDB 请在 .env 配置 NEODB_TOKEN', 400);

  let input = '';
  try {
    const body = (await req.json()) as { userId?: string };
    input = String(body.userId ?? '');
  } catch {
    return jsonError('请求格式错误', 400);
  }
  const userId = extractDoubanUserId(input);
  if (!userId) return jsonError('无法识别豆瓣 ID，请填写数字 ID 或个人主页链接', 400);

  const service = getCollectionService('douban');
  try {
    await service.setUserId(userId);
  } catch (err) {
    return jsonError(err instanceof Error ? `保存失败：${err.message}` : '保存失败', 500);
  }
  service.sync('full').catch((err) => console.error('[collection] 绑定后同步异常', err));
  return NextResponse.json({ userId });
}
