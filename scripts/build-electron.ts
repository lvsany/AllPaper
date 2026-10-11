import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-electron', { recursive: true });
for (const entry of ['electron/main.ts', 'electron/preload.ts']) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: `dist-electron/${entry.endsWith('main.ts') ? 'main' : 'preload'}.cjs`,
    external: ['electron', 'better-sqlite3'],
    sourcemap: true
  });
}
