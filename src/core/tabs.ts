export type Screen = 'library' | 'projects' | 'schedule' | 'memo' | 'settings';

export const SCREENS: ReadonlyArray<{ id: Screen; label: string }> = [
  { id: 'library', label: '文献库' },
  { id: 'projects', label: '项目笔记' },
  { id: 'schedule', label: '日程' },
  { id: 'memo', label: '备忘录' },
  { id: 'settings', label: '设置' }
];

export type Tab =
  | { id: string; kind: 'screen'; screen: Screen }
  | { id: string; kind: 'paper'; paperId: string; title: string; anchor?: string };

export interface TabsState { tabs: Tab[]; activeId?: string }

/** Open papers beyond this many are dropped, oldest first (never the active one). */
export const MAX_PAPER_TABS = 12;

export const screenTabId = (screen: Screen) => `screen:${screen}`;
export const paperTabId = (paperId: string) => `paper:${paperId}`;
export const screenLabel = (screen: Screen) => SCREENS.find((s) => s.id === screen)?.label ?? screen;

export function initialTabs(): TabsState {
  return { tabs: SCREENS.map((s): Tab => ({ id: screenTabId(s.id), kind: 'screen', screen: s.id })), activeId: screenTabId('library') };
}

/** Most recently opened pages sit at the top; reopening an already open page just activates it. */
export function openScreen(state: TabsState, screen: Screen): TabsState {
  const id = screenTabId(screen);
  if (state.tabs.some((tab) => tab.id === id)) return { ...state, activeId: id };
  return { tabs: [{ id, kind: 'screen', screen }, ...state.tabs], activeId: id };
}

export function openPaper(state: TabsState, paper: { id: string; title: string }, anchor?: string): TabsState {
  const id = paperTabId(paper.id);
  const existing = state.tabs.find((tab) => tab.id === id);
  if (existing && existing.kind === 'paper') {
    return { tabs: state.tabs.map((tab) => tab.id === id && tab.kind === 'paper' ? { ...tab, title: paper.title, anchor } : tab), activeId: id };
  }
  let tabs: Tab[] = [{ id, kind: 'paper', paperId: paper.id, title: paper.title, anchor }, ...state.tabs];
  let papers = tabs.filter((tab) => tab.kind === 'paper');
  while (papers.length > MAX_PAPER_TABS) {
    const oldest = papers.at(-1)!;
    tabs = tabs.filter((tab) => tab.id !== oldest.id);
    papers = papers.slice(0, -1);
  }
  return { tabs, activeId: id };
}

export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { ...state, tabs };
  // like a browser: the page below takes over, else the one above, else nothing
  const next = tabs[index] ?? tabs[index - 1];
  return { tabs, activeId: next?.id };
}

export function activate(state: TabsState, id: string): TabsState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state;
}

export const closedScreens = (state: TabsState): Screen[] =>
  SCREENS.map((s) => s.id).filter((screen) => !state.tabs.some((tab) => tab.id === screenTabId(screen)));

export function removePaper(state: TabsState, paperId: string): TabsState {
  return closeTab(state, paperTabId(paperId));
}

/** Reads a saved state, ignoring anything malformed. */
export function parseTabs(raw: string | null | undefined): TabsState | undefined {
  if (!raw) return undefined;
  try {
    const data = JSON.parse(raw) as { tabs?: unknown[]; activeId?: unknown };
    const screens = new Set<string>(SCREENS.map((s) => s.id));
    const tabs: Tab[] = [];
    for (const item of data.tabs ?? []) {
      const tab = item as Partial<Tab> & { screen?: string; paperId?: string; title?: string; anchor?: string };
      if (tab.kind === 'screen' && tab.screen && screens.has(tab.screen)) tabs.push({ id: screenTabId(tab.screen as Screen), kind: 'screen', screen: tab.screen as Screen });
      else if (tab.kind === 'paper' && typeof tab.paperId === 'string' && typeof tab.title === 'string') tabs.push({ id: paperTabId(tab.paperId), kind: 'paper', paperId: tab.paperId, title: tab.title });
    }
    const unique = tabs.filter((tab, index) => tabs.findIndex((other) => other.id === tab.id) === index);
    const activeId = typeof data.activeId === 'string' && unique.some((tab) => tab.id === data.activeId) ? data.activeId : unique[0]?.id;
    return { tabs: unique, activeId };
  } catch { return undefined; }
}
