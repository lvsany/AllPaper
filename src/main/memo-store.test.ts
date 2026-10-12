import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoStore, type SecretCipher } from './memo-store';

const cipher = (available = true): SecretCipher => ({
  available: () => available,
  encrypt: (value) => Buffer.from(`enc:${[...value].reverse().join('')}`).toString('base64'),
  decrypt: (encoded) => [...Buffer.from(encoded, 'base64').toString().slice(4)].reverse().join('')
});

let dir = '';
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'allpaper-memo-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('MemoStore', () => {
  it('keeps plain memos in the library and lists newest first', async () => {
    const memos = new MemoStore(dir, join(dir, 'userdata-secrets.json'), cipher());
    await memos.save({ id: 'a', kind: 'text', title: '常用 skills', content: 'pdf\nxlsx', tags: ['工具'] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await memos.save({ id: 'b', kind: 'text', title: '实验备忘', content: 'x', tags: [] });
    expect((await memos.list()).map((m) => m.id)).toEqual(['b', 'a']);
    expect(JSON.parse(await readFile(join(dir, 'memos.json'), 'utf8')).items).toHaveLength(2);
  });

  it('never writes a secret value into the library file', async () => {
    const memos = new MemoStore(dir, join(dir, 'userdata-secrets.json'), cipher());
    const saved = await memos.save({ id: 's', kind: 'secret', title: 'OpenAI', content: '翻译用', tags: [], secret: 'sk-live-12345' });
    expect(saved.hasSecret).toBe(true);
    expect(await readFile(join(dir, 'memos.json'), 'utf8')).not.toContain('sk-live-12345');
    expect(await readFile(join(dir, 'userdata-secrets.json'), 'utf8')).not.toContain('sk-live-12345');
    expect(await memos.reveal('s')).toBe('sk-live-12345');
  });

  it('keeps the stored value when only the title changes and removes it on delete', async () => {
    const memos = new MemoStore(dir, join(dir, 'userdata-secrets.json'), cipher());
    await memos.save({ id: 's', kind: 'secret', title: 'K', content: '', tags: [], secret: 'v1' });
    await memos.save({ id: 's', kind: 'secret', title: 'K renamed', content: '', tags: [] });
    expect(await memos.reveal('s')).toBe('v1');
    await memos.remove('s');
    await expect(memos.reveal('s')).rejects.toThrow();
    expect(await memos.list()).toEqual([]);
  });

  it('refuses to store a secret without a keychain instead of falling back to plain text', async () => {
    const memos = new MemoStore(dir, join(dir, 'userdata-secrets.json'), cipher(false));
    await expect(memos.save({ id: 's', kind: 'secret', title: 'K', content: '', tags: [], secret: 'v' })).rejects.toThrow('钥匙串');
  });
});
