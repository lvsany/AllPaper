import { describe, expect, it } from 'vitest';
import { MAX_PAPER_TABS, closeTab, closedScreens, initialTabs, openPaper, openScreen, parseTabs, removePaper, type TabsState } from './tabs';

const ids = (state: ReturnType<typeof initialTabs>) => state.tabs.map((t) => t.id);

describe('page tabs', () => {
  it('starts with every main page, library active', () => {
    const state = initialTabs();
    expect(ids(state)).toEqual(['screen:library', 'screen:projects', 'screen:schedule', 'screen:memo', 'screen:settings']);
    expect(state.activeId).toBe('screen:library');
  });

  it('puts a newly opened paper on top and reuses an open one', () => {
    let state = openPaper(initialTabs(), { id: 'a', title: 'Paper A' });
    state = openPaper(state, { id: 'b', title: 'Paper B' });
    expect(ids(state).slice(0, 2)).toEqual(['paper:b', 'paper:a']);
    state = openPaper(state, { id: 'a', title: 'Paper A' }, 'P12');
    expect(ids(state).slice(0, 2)).toEqual(['paper:b', 'paper:a']); // no reordering
    expect(state.activeId).toBe('paper:a');
    expect(state.tabs.find((t) => t.id === 'paper:a')).toMatchObject({ anchor: 'P12' });
  });

  it('closing the active page activates the one below, then the one above', () => {
    let state = openPaper(openPaper(initialTabs(), { id: 'a', title: 'A' }), { id: 'b', title: 'B' }); // b, a, library…
    state = closeTab(state, 'paper:b');
    expect(state.activeId).toBe('paper:a');
    state = closeTab(state, 'screen:settings'); // closing a background page keeps the active one
    expect(state.activeId).toBe('paper:a');
    let only: TabsState = { tabs: [{ id: 'screen:memo', kind: 'screen', screen: 'memo' }], activeId: 'screen:memo' };
    only = closeTab(only, 'screen:memo');
    expect(only).toEqual({ tabs: [], activeId: undefined });
  });

  it('can reopen a closed main page and lists which are closed', () => {
    let state = closeTab(initialTabs(), 'screen:schedule');
    expect(closedScreens(state)).toEqual(['schedule']);
    state = openScreen(state, 'schedule');
    expect(ids(state)[0]).toBe('screen:schedule');
    expect(closedScreens(state)).toEqual([]);
  });

  it('keeps at most a dozen papers, dropping the oldest', () => {
    let state = initialTabs();
    for (let i = 0; i < MAX_PAPER_TABS + 3; i += 1) state = openPaper(state, { id: String(i), title: `P${i}` });
    const papers = state.tabs.filter((t) => t.kind === 'paper');
    expect(papers).toHaveLength(MAX_PAPER_TABS);
    expect(papers.at(-1)!.id).toBe('paper:3');
    expect(state.activeId).toBe(`paper:${MAX_PAPER_TABS + 2}`);
  });

  it('drops a deleted paper and ignores corrupt saved data', () => {
    expect(ids(removePaper(openPaper(initialTabs(), { id: 'a', title: 'A' }), 'a'))).not.toContain('paper:a');
    expect(parseTabs('not json')).toBeUndefined();
    const restored = parseTabs(JSON.stringify({ tabs: [{ kind: 'screen', screen: 'memo' }, { kind: 'screen', screen: 'nope' }, { kind: 'paper', paperId: 'x', title: 'X' }, { kind: 'paper' }], activeId: 'missing' }))!;
    expect(ids(restored)).toEqual(['screen:memo', 'paper:x']);
    expect(restored.activeId).toBe('screen:memo');
  });
});
