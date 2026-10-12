import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
let secretsFile = '';
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'allpaper-memo-')); secretsFile = join(dir, 'userdata-secrets.json'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('MemoStore table', () => {
  it('stores plain rows in the library and returns their value', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher());
    await memos.save({ id: 'a', name: '常用 skills', note: '', secret: false, value: 'pdf, xlsx, docx' });
    expect(await memos.list()).toMatchObject([{ id: 'a', name: '常用 skills', secret: false, value: 'pdf, xlsx, docx' }]);
    expect(await memos.reveal('a')).toBe('pdf, xlsx, docx');
  });

  it('never writes a secret value into the library file and never lists it', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher());
    await memos.save({ id: 's', name: 'OpenAI', note: '翻译用', secret: true, value: 'sk-live-12345' });
    const [row] = await memos.list();
    expect(row).toMatchObject({ secret: true, hasValue: true });
    expect(row).not.toHaveProperty('value');
    expect(await readFile(join(dir, 'memos.json'), 'utf8')).not.toContain('sk-live-12345');
    expect(await readFile(secretsFile, 'utf8')).not.toContain('sk-live-12345');
    expect(await memos.reveal('s')).toBe('sk-live-12345');
  });

  it('keeps the secret when only the name or note changes', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher());
    await memos.save({ id: 's', name: 'K', note: '', secret: true, value: 'v1' });
    await memos.save({ id: 's', name: 'K renamed', note: 'x', secret: true });
    expect(await memos.reveal('s')).toBe('v1');
  });

  it('moves a value between the keychain and the library when the lock is toggled', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher());
    await memos.save({ id: 'r', name: 'K', note: '', secret: true, value: 'abc' });
    await memos.save({ id: 'r', name: 'K', note: '', secret: false, value: 'abc' });
    expect(await readFile(secretsFile, 'utf8')).not.toContain('abc');
    expect((await memos.list())[0]).toMatchObject({ secret: false, value: 'abc' });
    await memos.save({ id: 'r', name: 'K', note: '', secret: true, value: 'abc' });
    expect(await readFile(join(dir, 'memos.json'), 'utf8')).not.toContain('abc');
    expect(await memos.reveal('r')).toBe('abc');
  });

  it('removes a row together with its secret', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher());
    await memos.save({ id: 's', name: 'K', note: '', secret: true, value: 'v' });
    await memos.remove('s');
    expect(await memos.list()).toEqual([]);
    expect(JSON.parse(await readFile(secretsFile, 'utf8'))).toEqual({});
  });

  it('refuses to store a secret without a keychain instead of falling back to plain text', async () => {
    const memos = new MemoStore(dir, secretsFile, cipher(false));
    await expect(memos.save({ id: 's', name: 'K', note: '', secret: true, value: 'v' })).rejects.toThrow('钥匙串');
  });

  it('reads the first version of memos.json', async () => {
    await writeFile(join(dir, 'memos.json'), JSON.stringify({ version: 1, items: [
      { id: 't', kind: 'text', title: 'skills', content: 'pdf', tags: [], updatedAt: '2026-10-12T00:00:00Z' },
      { id: 'k', kind: 'secret', title: 'API', content: '控制台', tags: [], updatedAt: '2026-10-12T00:00:00Z' }
    ] }));
    const memos = new MemoStore(dir, secretsFile, cipher());
    expect(await memos.list()).toMatchObject([{ name: 'skills', secret: false, value: 'pdf' }, { name: 'API', secret: true, note: '控制台', hasValue: false }]);
  });
});
