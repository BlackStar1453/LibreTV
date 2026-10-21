import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { checkSourceReady, getCollectionService, isNeodbManagedByEnv, saveNeodbToken } from '@/lib/collection/server';
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
  const managedByEnv = source === 'neodb' && (await isNeodbManagedByEnv());
  return NextResponse.json({
    ...state,
    syncing: service.isSyncing(),
    configured: bind.configured,
    bindError: bind.error,
    managedByEnv,
  });
}

/**
 * 绑定 / 更换账号，保存后后台全量同步。
 * 豆瓣：body.userId 接受纯 ID 或主页链接；NeoDB：body.token 为 Access Token，校验通过才保存，响应不回传 token。
 */
export async function PUT(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const source = parseCollectionSource(req);
  if (!source) return jsonError('未知的收藏来源', 400);

  let body: { userId?: string; token?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('请求格式错误', 400);
  }

  if (source === 'neodb') {
    if (!body.token) return jsonError('请粘贴 NeoDB token', 400);
    try {
      const bind = await saveNeodbToken(String(body.token));
      return NextResponse.json({ ok: true, bindError: bind.error });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'NeoDB token 保存失败', 400);
    }
  }

  const input = String(body.userId ?? '');
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
