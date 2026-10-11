import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ensureLibraryLayout, hasLibraryLayout } from './library-layout';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
it('creates the portable local-first library layout', async () => {
  root = await mkdtemp(join(tmpdir(), 'allpaper-'));
  expect(await hasLibraryLayout(root)).toBe(false);
  await ensureLibraryLayout(root);
  expect(await hasLibraryLayout(root)).toBe(true);
});
