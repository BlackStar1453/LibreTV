import { describe, expect, it } from 'vitest';
import {
  buildNotesMarkdown,
  buildWatchLink,
  formatNoteTime,
  imageFileName,
  notesExportBaseName,
  type NoteForExport,
} from './notes';

const base = {
  title: '星际穿越',
  totalEpisodes: 1,
  episodeIndex: 0,
  query: 'source=abc&id=42&index=0&title=%E6%98%9F',
};

function note(partial: Partial<NoteForExport>): NoteForExport {
  return { ...base, id: 'n', position: 0, text: '', createdAt: 0, hasImage: true, ...partial };
}

describe('formatNoteTime', () => {
  it('始终输出 HH:MM:SS：电影动辄超过一小时，统一宽度便于对齐', () => {
    expect(formatNoteTime(0)).toBe('00:00:00');
    expect(formatNoteTime(65.9)).toBe('00:01:05');
    expect(formatNoteTime(2535)).toBe('00:42:15');
    expect(formatNoteTime(3 * 3600 + 7)).toBe('03:00:07');
  });

  it('非法值兜底为 0', () => {
    expect(formatNoteTime(NaN)).toBe('00:00:00');
    expect(formatNoteTime(-3)).toBe('00:00:00');
  });
});

describe('imageFileName', () => {
  it('文件名不含冒号（Windows 不允许），单集影片不带集数前缀', () => {
    expect(imageFileName({ position: 2535, episodeIndex: 0, totalEpisodes: 1 })).toBe('00-42-15.jpg');
  });

  it('多集带两位集数前缀，整部汇总时不同集的同一时刻不会撞名', () => {
    expect(imageFileName({ position: 2535, episodeIndex: 2, totalEpisodes: 24 })).toBe('e03-00-42-15.jpg');
  });
});

describe('buildWatchLink', () => {
  it('在原播放参数上追加 position（取整秒），点开即从该时刻播放', () => {
    expect(buildWatchLink('http://localhost:8080', 'source=abc&id=42&index=0', 2535.7)).toBe(
      'http://localhost:8080/watch?source=abc&id=42&index=0&position=2535'
    );
  });

  it('覆盖原有 position，不会出现两个 position', () => {
    expect(buildWatchLink('http://x', 'source=a&position=10', 99)).toBe('http://x/watch?source=a&position=99');
  });

  it('position 为 0 时用 1：0 会被播放页当作「无参数」而回退到历史进度', () => {
    expect(buildWatchLink('http://x', 'source=a', 0)).toBe('http://x/watch?source=a&position=1');
  });
});

describe('notesExportBaseName', () => {
  it('单集：片名 笔记；多集按模式带集数或「全集」', () => {
    expect(notesExportBaseName({ title: '星际穿越', totalEpisodes: 1, episodeIndex: 0 }, 'episode')).toBe('星际穿越 笔记');
    expect(notesExportBaseName({ title: '漫长的季节', totalEpisodes: 12, episodeIndex: 2 }, 'episode')).toBe(
      '漫长的季节 第3集 笔记'
    );
    expect(notesExportBaseName({ title: '漫长的季节', totalEpisodes: 12, episodeIndex: 2 }, 'series')).toBe(
      '漫长的季节 全集 笔记'
    );
  });

  it('去掉文件系统非法字符', () => {
    expect(notesExportBaseName({ title: 'A/B:C*?', totalEpisodes: 1, episodeIndex: 0 }, 'episode')).toBe('A_B_C__ 笔记');
  });
});

describe('buildNotesMarkdown', () => {
  const origin = 'http://localhost:8080';

  it('单集：按时间排序，每条 = 可跳转时间戳 + 截图 + 评论（多行原样保留）', () => {
    const notes = [
      note({ id: 'b', position: 2535, text: '第二条' }),
      note({ id: 'a', position: 65, text: '第一行\n第二行' }),
    ];
    const { markdown, images } = buildNotesMarkdown(notes, { mode: 'episode', origin });
    expect(markdown).toBe(
      [
        '# 星际穿越',
        '',
        '共 2 条笔记',
        '',
        '## [00:01:05](http://localhost:8080/watch?source=abc&id=42&index=0&title=%E6%98%9F&position=65)',
        '',
        '![00:01:05](images/00-01-05.jpg)',
        '',
        '第一行',
        '第二行',
        '',
        '## [00:42:15](http://localhost:8080/watch?source=abc&id=42&index=0&title=%E6%98%9F&position=2535)',
        '',
        '![00:42:15](images/00-42-15.jpg)',
        '',
        '第二条',
        '',
      ].join('\n')
    );
    expect(images).toEqual([
      { noteId: 'a', path: 'images/00-01-05.jpg' },
      { noteId: 'b', path: 'images/00-42-15.jpg' },
    ]);
  });

  it('同一秒的两条截图文件名自动加序号，不互相覆盖', () => {
    const { images } = buildNotesMarkdown(
      [note({ id: 'a', position: 10, createdAt: 1 }), note({ id: 'b', position: 10.4, createdAt: 2 })],
      { mode: 'episode', origin }
    );
    expect(images.map((i) => i.path)).toEqual(['images/00-00-10.jpg', 'images/00-00-10-2.jpg']);
  });

  it('没有截图的笔记（截图失败）不输出图片行', () => {
    const { markdown, images } = buildNotesMarkdown([note({ position: 5, text: '只有文字', hasImage: false })], {
      mode: 'episode',
      origin,
    });
    expect(markdown).not.toContain('![');
    expect(images).toEqual([]);
  });

  it('多集单集导出：标题带集数', () => {
    const { markdown } = buildNotesMarkdown([note({ totalEpisodes: 12, episodeIndex: 2, position: 1, text: 'x' })], {
      mode: 'episode',
      origin,
    });
    expect(markdown.startsWith('# 星际穿越 · 第3集\n')).toBe(true);
  });

  it('整部汇总：按集分二级标题、集内按时间排序，条目降为三级标题', () => {
    const series = { totalEpisodes: 12 };
    const { markdown } = buildNotesMarkdown(
      [
        note({ ...series, id: 'c', episodeIndex: 4, position: 3, text: '五' }),
        note({ ...series, id: 'b', episodeIndex: 0, position: 9, text: '一b' }),
        note({ ...series, id: 'a', episodeIndex: 0, position: 2, text: '一a' }),
      ],
      { mode: 'series', origin }
    );
    const headings = markdown.split('\n').filter((l) => l.startsWith('#'));
    expect(headings.map((h) => h.replace(/\]\(.*\)/, ']'))).toEqual([
      '# 星际穿越',
      '## 第1集',
      '### [00:00:02]',
      '### [00:00:09]',
      '## 第5集',
      '### [00:00:03]',
    ]);
    expect(markdown).toContain('共 3 条笔记');
  });
});
