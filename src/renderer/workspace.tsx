import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AiStatus, Paper, Settings } from '../shared/types';
import type { Project } from '../shared/projects';
import type { CitationRef } from '../core/note-markdown';

export function authorsShort(paper: Paper): string {
  const first = paper.authors[0]?.family ?? 'Unknown';
  return `${first}${paper.authors.length > 2 ? ' et al.' : paper.authors.length === 2 ? ` & ${paper.authors[1].family}` : ''}${paper.year ? `, ${paper.year}` : ''}`;
}

interface Workspace {
  papers: Paper[];
  projects: Project[];
  currentProject?: Project;
  ai: AiStatus;
  settings: Settings;
  refreshPapers(): Promise<void>;
  refreshProjects(): Promise<void>;
  refreshAi(): Promise<void>;
  selectProject(id: string): void;
  createProject(name: string): Promise<Project>;
  /** Label shown on a citation chip. */
  labelOf(ref: CitationRef): string;
  paperByKey(key: string): Paper | undefined;
  openSettings(): void;
}

const Ctx = createContext<Workspace | undefined>(undefined);
const STORAGE_KEY = 'allpaper.currentProject';

export function WorkspaceProvider({ children, libraryReady, openSettings, settings }: { children: ReactNode; libraryReady: boolean; openSettings(): void; settings: Settings }) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? undefined; } catch { return undefined; }
  });
  const [ai, setAi] = useState<AiStatus>({ configured: false, provider: 'anthropic', mock: false });

  const refreshPapers = useCallback(async () => { if (libraryReady) setPapers(await window.allPaper.papers.list()); }, [libraryReady]);
  const refreshProjects = useCallback(async () => { if (libraryReady) setProjects(await window.allPaper.projects.list()); }, [libraryReady]);
  const refreshAi = useCallback(async () => { setAi(await window.allPaper.ai.status()); }, []);

  useEffect(() => { void refreshPapers(); void refreshProjects(); }, [refreshPapers, refreshProjects]);
  useEffect(() => { void refreshAi(); }, [refreshAi]);

  const selectProject = useCallback((id: string) => {
    setCurrentId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage unavailable */ }
  }, []);

  const createProject = useCallback(async (name: string) => {
    const project = await window.allPaper.projects.create(name);
    await refreshProjects();
    selectProject(project.id);
    return project;
  }, [refreshProjects, selectProject]);

  const value = useMemo<Workspace>(() => {
    const byKey = new Map(papers.map((paper) => [paper.citekey, paper]));
    return {
      papers, projects, ai, settings,
      currentProject: projects.find((project) => project.id === currentId) ?? projects[0],
      refreshPapers, refreshProjects, refreshAi, selectProject, createProject, openSettings,
      paperByKey: (key) => byKey.get(key),
      labelOf: (ref) => {
        const paper = byKey.get(ref.key);
        if (!paper) return ref.key;
        const label = authorsShort(paper);
        const paragraph = ref.anchor?.match(/^P(\d+)$/);
        if (paragraph) return `${label} ¶${paragraph[1]}`;
        if (ref.anchor) return `${label} ↗`;
        return ref.page ? `${label}, p.${ref.page}` : label;
      }
    };
  }, [papers, projects, ai, settings, currentId, refreshPapers, refreshProjects, refreshAi, selectProject, createProject, openSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const value = useContext(Ctx);
  if (!value) throw new Error('WorkspaceProvider is missing');
  return value;
}
