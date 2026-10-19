import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { slugify } from '../core/bibliography';
import { notePreview } from '../core/note-preview';
import type { DraftDocument, Project } from '../shared/projects';

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

/** A project is a folder with one note (`note.md`) and one paper draft. */
export class ProjectStore {
  constructor(private readonly root: string) {}

  private get dir() { return join(this.root, 'projects'); }
  private path(project: Project | string) { return join(this.dir, typeof project === 'string' ? project : project.id); }

  async list(): Promise<Project[]> {
    const projects: Project[] = [];
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.dir, entry.name);
      const project = await readJson<Project | undefined>(join(dir, 'project.json'), undefined);
      if (!project?.id) continue;
      const note = join(dir, 'note.md');
      const updatedAt = await stat(note).then((info) => info.mtime.toISOString(), () => project.createdAt);
      const preview = notePreview(await readFile(note, 'utf8').catch(() => ''));
      projects.push({ id: project.id, name: project.name, createdAt: project.createdAt, updatedAt, preview });
    }
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async rename(id: string, name: string): Promise<Project> {
    const project = await this.find(id);
    const clean = name.trim();
    if (!clean) throw new Error('标题不能为空');
    const next = { id: project.id, name: clean, createdAt: project.createdAt };
    await writeFile(join(this.path(project), 'project.json'), JSON.stringify(next, null, 2));
    return { ...project, name: clean };
  }

  /** Deletes the project with its note and its paper draft. */
  async remove(id: string): Promise<void> {
    const project = await this.find(id);
    await rm(this.path(project), { recursive: true, force: true });
  }

  async create(name: string): Promise<Project> {
    const clean = name.trim() || '未命名项目';
    const project: Project = { id: `${slugify(clean)}-${randomUUID().slice(0, 6)}`, name: clean, createdAt: new Date().toISOString() };
    const dir = this.path(project);
    await mkdir(join(dir, 'drafts', 'paper-v1'), { recursive: true });
    await writeFile(join(dir, 'project.json'), JSON.stringify(project, null, 2));
    await writeFile(join(dir, 'note.md'), '');
    return project;
  }

  private async find(id: string): Promise<Project> {
    const project = (await this.list()).find((item) => item.id === id);
    if (!project) throw new Error('找不到项目');
    return project;
  }

  /** The project's single note. Projects from earlier versions get their idea cards folded into it. */
  async note(id: string): Promise<string> {
    const project = await this.find(id);
    const file = join(this.path(project), 'note.md');
    try { return await readFile(file, 'utf8'); } catch { /* first open */ }
    const ideasDir = join(this.path(project), 'ideas');
    const ideas: string[] = [];
    try {
      for (const name of (await readdir(ideasDir)).sort()) {
        if (!name.endsWith('.json')) continue;
        const idea = await readJson<{ title?: string; oneLiner?: string } | undefined>(join(ideasDir, name), undefined);
        if (idea?.oneLiner || idea?.title) ideas.push(`- ${idea.oneLiner || idea.title}`);
      }
    } catch { /* no legacy ideas */ }
    const markdown = ideas.length ? `## 点子\n\n${ideas.join('\n')}\n` : '';
    await writeFile(file, markdown);
    return markdown;
  }

  async saveNote(id: string, markdown: string): Promise<void> {
    const project = await this.find(id);
    await writeFile(join(this.path(project), 'note.md'), markdown);
  }

  async appendToNote(id: string, markdown: string): Promise<string> {
    const current = await this.note(id);
    const next = `${current.replace(/\s*$/, '')}\n\n${markdown.trim()}\n`;
    await this.saveNote(id, next);
    return next;
  }

  async draft(id: string): Promise<DraftDocument> {
    const project = await this.find(id);
    const fallback: DraftDocument = { id: 'paper-v1', blocks: [], storyline: {}, outline: [] };
    return readJson(join(this.path(project), 'drafts', 'paper-v1', 'draft.json'), fallback);
  }

  async saveDraft(id: string, draft: DraftDocument): Promise<DraftDocument> {
    const project = await this.find(id);
    const dir = join(this.path(project), 'drafts', 'paper-v1');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'draft.json'), JSON.stringify(draft, null, 2));
    await writeFile(join(dir, 'zh.md'), draft.blocks.map((block) => block.zhText).join('\n\n'));
    await writeFile(join(dir, 'en.md'), draft.blocks.map((block) => block.enText).join('\n\n'));
    return draft;
  }
}
