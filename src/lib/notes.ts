/**
 * 观影笔记的纯逻辑：时间戳格式、截图文件名、回跳链接与 Markdown 汇总。
 * 存储（IndexedDB）与打包（zip）分别在 db.ts / zip-store.ts，这里不碰浏览器 API，便于单测。
 */

export type NotesExportMode = 'episode' | 'series';

export interface NoteForExport {
  id: string;
  title: string;
  episodeIndex: number;
  totalEpisodes: number;
  /** 记笔记时的播放秒数 */
  position: number;
  text: string;
  createdAt: number;
  /** 截图失败（极少数环境）时只存文字 */
  hasImage: boolean;
  /** 记笔记时播放页的查询串（不含 position），用来拼回跳链接 */
  query: string;
}

/** 始终 HH:MM:SS：电影动辄超过一小时，统一宽度便于在笔记里对齐 */
export function formatNoteTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

const isSeries = (n: { totalEpisodes: number }) => n.totalEpisodes > 1;

/** 截图文件名：不含冒号（Windows 非法）；多集带集数前缀，整部汇总时不同集同一时刻不撞名 */
export function imageFileName(n: Pick<NoteForExport, 'position' | 'episodeIndex' | 'totalEpisodes'>): string {
  const time = formatNoteTime(n.position).replace(/:/g, '-');
  const prefix = isSeries(n) ? `e${String(n.episodeIndex + 1).padStart(2, '0')}-` : '';
  return `${prefix}${time}.jpg`;
}

/** 回跳链接：沿用播放页已有的 position 参数（优先级高于历史进度，换集时自动清除） */
export function buildWatchLink(origin: string, query: string, position: number): string {
  const sp = new URLSearchParams(query);
  // 0 会被播放页当作「无参数」回退到历史进度，最小给 1 秒
  sp.set('position', String(Math.max(1, Math.floor(position))));
  return `${origin}/watch?${sp.toString()}`;
}

export function notesExportBaseName(
  n: Pick<NoteForExport, 'title' | 'totalEpisodes' | 'episodeIndex'>,
  mode: NotesExportMode
): string {
  const title = n.title.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
  if (!isSeries(n)) return `${title} 笔记`;
  return mode === 'series' ? `${title} 全集 笔记` : `${title} 第${n.episodeIndex + 1}集 笔记`;
}

export interface NotesMarkdownResult {
  markdown: string;
  /** 需要打包进 zip 的截图：笔记 id → zip 内相对路径 */
  images: { noteId: string; path: string }[];
}

const byTime = (a: NoteForExport, b: NoteForExport) => a.position - b.position || a.createdAt - b.createdAt;

export function buildNotesMarkdown(
  notes: NoteForExport[],
  opts: { mode: NotesExportMode; origin: string }
): NotesMarkdownResult {
  const images: NotesMarkdownResult['images'] = [];
  const usedNames = new Set<string>();
  const lines: string[] = [];
  const first = notes[0];
  if (!first) return { markdown: '', images };

  const episodeTitle = opts.mode === 'episode' && isSeries(first) ? ` · 第${first.episodeIndex + 1}集` : '';
  lines.push(`# ${first.title}${episodeTitle}`, '', `共 ${notes.length} 条笔记`, '');

  const pushNote = (n: NoteForExport, level: string) => {
    const time = formatNoteTime(n.position);
    lines.push(`${level} [${time}](${buildWatchLink(opts.origin, n.query, n.position)})`, '');
    if (n.hasImage) {
      // 同一秒记了多条：追加序号，不互相覆盖
      let name = imageFileName(n);
      for (let i = 2; usedNames.has(name); i++) name = imageFileName(n).replace(/\.jpg$/, `-${i}.jpg`);
      usedNames.add(name);
      const path = `images/${name}`;
      images.push({ noteId: n.id, path });
      lines.push(`![${time}](${path})`, '');
    }
    if (n.text.trim()) lines.push(n.text.trim(), '');
  };

  if (opts.mode === 'series' && isSeries(first)) {
    const episodes = [...new Set(notes.map((n) => n.episodeIndex))].sort((a, b) => a - b);
    for (const ep of episodes) {
      lines.push(`## 第${ep + 1}集`, '');
      notes.filter((n) => n.episodeIndex === ep).sort(byTime).forEach((n) => pushNote(n, '###'));
    }
  } else {
    [...notes].sort(byTime).forEach((n) => pushNote(n, '##'));
  }

  return { markdown: lines.join('\n'), images };
}
