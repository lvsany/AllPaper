import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoItem, MemoInput } from '../shared/types';

export interface SecretCipher {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(encoded: string): string;
}

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

/**
 * Memos live in the library (`memos.json`). The values of secret memos (API keys…) never do:
 * they are encrypted with the system keychain and kept in the app's own data directory, so
 * syncing, backing up or committing the library cannot leak them.
 */
export class MemoStore {
  constructor(private readonly root: string, private readonly secretsFile: string, private readonly cipher: SecretCipher) {}
  private get file() { return join(this.root, 'memos.json'); }

  private async items(): Promise<MemoItem[]> {
    const raw = await readJson<{ items?: MemoItem[] }>(this.file, {});
    return (raw.items ?? []).filter((item) => typeof item?.id === 'string' && typeof item.title === 'string');
  }
  private secrets() { return readJson<Record<string, string>>(this.secretsFile, {}); }

  async list(): Promise<MemoItem[]> {
    const secrets = await this.secrets();
    return (await this.items())
      .map((item) => ({ ...item, hasSecret: item.kind === 'secret' ? Boolean(secrets[item.id]) : undefined }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(input: MemoInput): Promise<MemoItem> {
    if (!input.id || !input.title.trim() && !input.content.trim() && input.secret === undefined) throw new Error('备忘录不能为空');
    const items = await this.items();
    const item: MemoItem = {
      id: input.id, kind: input.kind, title: input.title.trim(), content: input.content,
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean), updatedAt: new Date().toISOString()
    };
    const secrets = await this.secrets();
    if (input.kind === 'secret' && input.secret !== undefined) {
      if (!this.cipher.available()) throw new Error('系统钥匙串不可用，无法安全地保存密钥。');
      if (input.secret) secrets[input.id] = this.cipher.encrypt(input.secret); else delete secrets[input.id];
      await writeFile(this.secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    }
    const index = items.findIndex((existing) => existing.id === input.id);
    if (index >= 0) items[index] = item; else items.push(item);
    await writeFile(this.file, JSON.stringify({ version: 1, items }, null, 2));
    return { ...item, hasSecret: item.kind === 'secret' ? Boolean(secrets[item.id]) : undefined };
  }

  async remove(id: string): Promise<void> {
    await writeFile(this.file, JSON.stringify({ version: 1, items: (await this.items()).filter((item) => item.id !== id) }, null, 2));
    const secrets = await this.secrets();
    if (secrets[id]) { delete secrets[id]; await writeFile(this.secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 }); }
  }

  async reveal(id: string): Promise<string> {
    const encoded = (await this.secrets())[id];
    if (!encoded) throw new Error('没有保存过这个密钥的值。');
    return this.cipher.decrypt(encoded);
  }
}
