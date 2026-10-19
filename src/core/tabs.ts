export type Screen = 'library' | 'projects' | 'schedule' | 'memo' | 'settings';

/** The fixed entries at the top of the sidebar. They are never closed. */
export const SCREENS: ReadonlyArray<{ id: Screen; label: string }> = [
  { id: 'library', label: '文献库' },
  { id: 'projects', label: '项目笔记' },
  { id: 'schedule', label: '日程' },
  { id: 'memo', label: 'Keys' },
  { id: 'settings', label: '设置' }
];

/** Things the user opened and may want to come back to; listed under the fixed entries. */
export type Recent =
  | { id: string; kind: 'paper'; paperId: string; title: string; anchor?: string }
  | { id: string; kind: 'note'; projectId: string; title: string };

export interface TabsState {
  recents: Recent[];
  /** A `screen:<id>` for a fixed entry, or the id of one of `recents`. */
  activeId: string;
}

/** Keep at most this many recent pages; the oldest (never the active one) fall off. */
export const MAX_RECENTS = 15;

export const screenTabId = (screen: Screen) => `screen:${screen}`;
export const paperTabId = (paperId: string) => `paper:${paperId}`;
export const noteTabId = (projectId: string) => `note:${projectId}`;
export const screenLabel = (screen: Screen) => SCREENS.find((s) => s.id === screen)?.label ?? screen;

export const initialTabs = (): TabsState => ({ recents: [], activeId: screenTabId('library') });

export const activeScreen = (state: TabsState): Screen | undefined =>
  SCREENS.find((s) => screenTabId(s.id) === state.activeId)?.id;

export const activeRecent = (state: TabsState): Recent | undefined => state.recents.find((r) => r.id === state.activeId);

/** The fixed entry a recent page belongs to, so it can be shown as the "parent" of the active page. */
export const parentScreen = (recent: Recent | undefined): Screen | undefined =>
  recent?.kind === 'paper' ? 'library' : recent?.kind === 'note' ? 'projects' : undefined;

export function openScreen(state: TabsState, screen: Screen): TabsState {
  return { ...state, activeId: screenTabId(screen) };
}

function insert(state: TabsState, recent: Recent): TabsState {
  let recents = [recent, ...state.recents];
  while (recents.length > MAX_RECENTS) {
    const oldest = [...recents].reverse().find((r) => r.id !== recent.id)!;
    recents = recents.filter((r) => r.id !== oldest.id);
  }
  return { recents, activeId: recent.id };
}

/** New pages go on top; reopening one that is already listed just activates it (no reordering). */
export function openPaper(state: TabsState, paper: { id: string; title: string }, anchor?: string): TabsState {
  const id = paperTabId(paper.id);
  if (state.recents.some((r) => r.id === id)) {
    return { recents: state.recents.map((r) => r.id === id && r.kind === 'paper' ? { ...r, title: paper.title, anchor } : r), activeId: id };
  }
  return insert(state, { id, kind: 'paper', paperId: paper.id, title: paper.title, anchor });
}

export function openNote(state: TabsState, project: { id: string; name: string }): TabsState {
  const id = noteTabId(project.id);
  if (state.recents.some((r) => r.id === id)) {
    return { recents: state.recents.map((r) => r.id === id && r.kind === 'note' ? { ...r, title: project.name } : r), activeId: id };
  }
  return insert(state, { id, kind: 'note', projectId: project.id, title: project.name });
}

/** Closing the active page goes to the one below it, then the one above, then the library. */
export function closeRecent(state: TabsState, id: string): TabsState {
  const index = state.recents.findIndex((r) => r.id === id);
  if (index < 0) return state;
  const recents = state.recents.filter((r) => r.id !== id);
  if (state.activeId !== id) return { ...state, recents };
  const next = recents[index] ?? recents[index - 1];
  return { recents, activeId: next?.id ?? screenTabId('library') };
}

export function activate(state: TabsState, id: string): TabsState {
  const known = state.recents.some((r) => r.id === id) || SCREENS.some((s) => screenTabId(s.id) === id);
  return known ? { ...state, activeId: id } : state;
}

/** Reads a saved state, ignoring anything malformed. */
export function parseTabs(raw: string | null | undefined): TabsState | undefined {
  if (!raw) return undefined;
  try {
    const data = JSON.parse(raw) as { recents?: unknown[]; activeId?: unknown };
    const recents: Recent[] = [];
    for (const item of data.recents ?? []) {
      const r = item as { kind?: string; paperId?: unknown; projectId?: unknown; title?: unknown };
      if (typeof r.title !== 'string') continue;
      if (r.kind === 'paper' && typeof r.paperId === 'string') recents.push({ id: paperTabId(r.paperId), kind: 'paper', paperId: r.paperId, title: r.title });
      else if (r.kind === 'note' && typeof r.projectId === 'string') recents.push({ id: noteTabId(r.projectId), kind: 'note', projectId: r.projectId, title: r.title });
    }
    const unique = recents.filter((r, i) => recents.findIndex((o) => o.id === r.id) === i).slice(0, MAX_RECENTS);
    const valid = (id: unknown): id is string =>
      typeof id === 'string' && (unique.some((r) => r.id === id) || SCREENS.some((s) => screenTabId(s.id) === id));
    return { recents: unique, activeId: valid(data.activeId) ? data.activeId : screenTabId('library') };
  } catch { return undefined; }
}
