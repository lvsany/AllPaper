import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoInput, MemoRow } from '../shared/types';

export interface SecretCipher {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(encoded: string): string;
}

interface StoredRow { id: string; name: string; note: string; secret: boolean; value?: string; updatedAt: string }

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

/**
 * A table of names and values (API keys, skill names…). Rows live in the library
 * (`memos.json`) but the value of a secret row never does: it is encrypted with the
 * system keychain and kept in the app's own data directory, so syncing, backing up
 * or committing the library cannot leak it.
 */
export class MemoStore {
  constructor(private readonly root: string, private readonly secretsFile: string, private readonly cipher: SecretCipher) {}
  private get file() { return join(this.root, 'memos.json'); }

  private async rows(): Promise<StoredRow[]> {
    const raw = await readJson<{ rows?: StoredRow[]; items?: Array<{ id: string; kind: string; title: string; content: string; updatedAt: string }> }>(this.file, {});
    if (raw.rows) return raw.rows.filter((row) => typeof row?.id === 'string');
    // first version of the memo page: titled notes and secrets
    return (raw.items ?? []).map((item) => ({
      id: item.id, name: item.title, secret: item.kind === 'secret', updatedAt: item.updatedAt,
      note: item.kind === 'secret' ? item.content : '', value: item.kind === 'secret' ? undefined : item.content
    }));
  }
  private secrets() { return readJson<Record<string, string>>(this.secretsFile, {}); }
  private writeRows(rows: StoredRow[]) { return writeFile(this.file, JSON.stringify({ version: 2, rows }, null, 2)); }
  private writeSecrets(secrets: Record<string, string>) { return writeFile(this.secretsFile, JSON.stringify(secrets, null, 2), { mode: 0o600 }); }

  async list(): Promise<MemoRow[]> {
    const secrets = await this.secrets();
    return (await this.rows()).map((row) => row.secret
      ? { id: row.id, name: row.name, note: row.note, secret: true, hasValue: Boolean(secrets[row.id]), updatedAt: row.updatedAt }
      : { id: row.id, name: row.name, note: row.note, secret: false, value: row.value ?? '', updatedAt: row.updatedAt });
  }

  async save(input: MemoInput): Promise<MemoRow> {
    const rows = await this.rows();
    const secrets = await this.secrets();
    const row: StoredRow = { id: input.id, name: input.name.trim(), note: input.note, secret: input.secret, updatedAt: new Date().toISOString() };

    if (input.secret) {
      if (input.value !== undefined) {
        if (!this.cipher.available()) throw new Error('系统钥匙串不可用，无法安全地保存密钥。');
        if (input.value) secrets[input.id] = this.cipher.encrypt(input.value); else delete secrets[input.id];
        await this.writeSecrets(secrets);
      }
    } else {
      row.value = input.value ?? rows.find((r) => r.id === input.id)?.value ?? '';
      if (secrets[input.id]) { delete secrets[input.id]; await this.writeSecrets(secrets); }
    }
    const index = rows.findIndex((existing) => existing.id === input.id);
    if (index >= 0) rows[index] = row; else rows.push(row);
    await this.writeRows(rows);
    return input.secret
      ? { id: row.id, name: row.name, note: row.note, secret: true, hasValue: Boolean(secrets[row.id]), updatedAt: row.updatedAt }
      : { id: row.id, name: row.name, note: row.note, secret: false, value: row.value, updatedAt: row.updatedAt };
  }

  async remove(id: string): Promise<void> {
    await this.writeRows((await this.rows()).filter((row) => row.id !== id));
    const secrets = await this.secrets();
    if (secrets[id]) { delete secrets[id]; await this.writeSecrets(secrets); }
  }

  async reveal(id: string): Promise<string> {
    const row = (await this.rows()).find((r) => r.id === id);
    if (row && !row.secret) return row.value ?? '';
    const encoded = (await this.secrets())[id];
    if (!encoded) throw new Error('还没有填写这一行的密钥。');
    return this.cipher.decrypt(encoded);
  }
}
