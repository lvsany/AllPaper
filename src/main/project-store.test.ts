import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ProjectStore } from './project-store';

let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'allpaper-proj-')); await mkdir(join(root, 'projects'), { recursive: true }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('gives each project exactly one note and appends to it', async () => {
  const projects = new ProjectStore(root);
  const project = await projects.create('群智软件工程');
  expect(await projects.note(project.id)).toBe('# 群智软件工程\n\n');
  await projects.saveNote(project.id, '# 群智软件工程\n\n- 点子 A\n');
  const next = await projects.appendToNote(project.id, '> 摘录\n>\n> [@k#a1]');
  expect(next).toBe('# 群智软件工程\n\n- 点子 A\n\n> 摘录\n>\n> [@k#a1]\n');
  expect(await projects.list()).toHaveLength(1);
});

it('folds idea cards from older projects into the note', async () => {
  const projects = new ProjectStore(root);
  const project = await projects.create('旧项目');
  await rm(join(root, 'projects', project.id, 'note.md'));
  await mkdir(join(root, 'projects', project.id, 'ideas'), { recursive: true });
  await writeFile(join(root, 'projects', project.id, 'ideas', 'a.json'), JSON.stringify({ title: 't', oneLiner: '等预算比较多智能体' }));
  expect(await projects.note(project.id)).toContain('- 等预算比较多智能体');
});
