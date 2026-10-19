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
  expect(await projects.note(project.id)).toBe('');
  await projects.saveNote(project.id, '- 点子 A\n');
  const next = await projects.appendToNote(project.id, '> 摘录\n>\n> [@k#a1]');
  expect(next).toBe('- 点子 A\n\n> 摘录\n>\n> [@k#a1]\n');
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

it('renames and deletes a note, and lists a preview and last-edited time', async () => {
  const projects = new ProjectStore(root);
  const a = await projects.create('第一篇');
  const b = await projects.create('第二篇');
  await projects.saveNote(a.id, '# 大标题\n\n- 要点一\n');
  const renamed = await projects.rename(a.id, '  改名后  ');
  expect(renamed.name).toBe('改名后');
  await expect(projects.rename(a.id, '   ')).rejects.toThrow('标题');
  const listed = await projects.list();
  expect(listed.map((p) => p.name)).toEqual(['改名后', '第二篇']);
  expect(listed[0]).toMatchObject({ preview: '大标题 要点一' });
  expect(Date.parse(listed[0].updatedAt!)).toBeGreaterThan(0);
  await projects.remove(b.id);
  expect((await projects.list()).map((p) => p.id)).toEqual([a.id]);
  await expect(projects.note(b.id)).rejects.toThrow('找不到项目');
});
