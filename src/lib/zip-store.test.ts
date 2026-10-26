import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { crc32, buildStoredZip } from './zip-store';

describe('crc32', () => {
  it('与标准校验值一致', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildStoredZip', () => {
  it('生成的 zip 能被系统 unzip 解出，内容与中文文件名原样还原', () => {
    const md = new TextEncoder().encode('# 星际穿越\n\n![00:00:01](images/00-00-01.jpg)\n');
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const zip = buildStoredZip([
      { path: 'notes.md', data: md },
      { path: 'images/00-00-01.jpg', data: jpg },
    ]);

    const dir = mkdtempSync(path.join(tmpdir(), 'zip-store-'));
    try {
      const file = path.join(dir, 'out.zip');
      writeFileSync(file, zip);
      execFileSync('unzip', ['-q', file, '-d', path.join(dir, 'x')]);
      expect(readFileSync(path.join(dir, 'x', 'notes.md'), 'utf8')).toContain('# 星际穿越');
      expect(new Uint8Array(readFileSync(path.join(dir, 'x', 'images', '00-00-01.jpg')))).toEqual(jpg);
      // -t 校验 CRC
      expect(execFileSync('unzip', ['-t', file]).toString()).toContain('No errors');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
