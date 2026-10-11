import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const libraryDirectories = [
  'papers', 'projects', '.index', '.index/cache', '.index/vectors'
] as const;

export async function ensureLibraryLayout(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await Promise.all(libraryDirectories.map((part) => mkdir(join(root, part), { recursive: true })));
}

export async function hasLibraryLayout(root: string): Promise<boolean> {
  try {
    await Promise.all(libraryDirectories.map((part) => stat(join(root, part))));
    return true;
  } catch { return false; }
}
