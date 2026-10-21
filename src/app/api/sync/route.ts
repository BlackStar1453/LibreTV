import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { emptySyncState, mergeSync, type SyncPayload, type SyncState } from '@/lib/history-sync';

export const runtime = 'nodejs';

function filePath(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'history-sync.json');
}

async function load(): Promise<SyncState> {
  try {
    return { ...emptySyncState(), ...(JSON.parse(await fs.readFile(filePath(), 'utf8')) as SyncState) };
  } catch {
    return emptySyncState();
  }
}

async function save(state: SyncState): Promise<void> {
  const file = filePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state));
  await fs.rename(tmp, file);
}

// 串行化读-合并-写，避免两台设备同时同步时互相覆盖
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** 读取合并后的同步状态 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  return NextResponse.json(await serial(load));
}

/** 上传本机历史/进度/删除标记，返回合并后的完整状态 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  let payload: SyncPayload;
  try {
    payload = (await req.json()) as SyncPayload;
  } catch {
    return jsonError('请求格式错误', 400);
  }
  const merged = await serial(async () => {
    const next = mergeSync(await load(), payload);
    await save(next);
    return next;
  });
  return NextResponse.json(merged);
}
