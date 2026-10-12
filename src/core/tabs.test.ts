import { describe, expect, it } from 'vitest';
import { MAX_RECENTS, activate, activeRecent, activeScreen, closeRecent, initialTabs, openNote, openPaper, openScreen, parentScreen, parseTabs } from './tabs';

const ids = (state: ReturnType<typeof initialTabs>) => state.recents.map((r) => r.id);

describe('recent pages', () => {
  it('starts on the library with nothing listed', () => {
    const state = initialTabs();
    expect(state.recents).toEqual([]);
    expect(activeScreen(state)).toBe('library');
  });

  it('lists opened papers and notes newest first and reuses an open one without reordering', () => {
    let state = openPaper(initialTabs(), { id: 'a', title: 'Paper A' });
    state = openNote(state, { id: 'proj1', name: '群智软件工程' });
    state = openPaper(state, { id: 'b', title: 'Paper B' });
    expect(ids(state)).toEqual(['paper:b', 'note:proj1', 'paper:a']);
    state = openPaper(state, { id: 'a', title: 'Paper A' }, 'P12');
    expect(ids(state)).toEqual(['paper:b', 'note:proj1', 'paper:a']);
    expect(activeRecent(state)).toMatchObject({ id: 'paper:a', anchor: 'P12' });
  });

  it('opening a fixed entry keeps the recent list as it is', () => {
    const state = openScreen(openPaper(initialTabs(), { id: 'a', title: 'A' }), 'schedule');
    expect(activeScreen(state)).toBe('schedule');
    expect(ids(state)).toEqual(['paper:a']);
    expect(activate(state, 'paper:a').activeId).toBe('paper:a');
    expect(activate(state, 'paper:nope')).toBe(state);
  });

  it('closing the active page goes to the one below, then above, then the library', () => {
    let state = openPaper(openNote(openPaper(initialTabs(), { id: 'a', title: 'A' }), { id: 'p', name: 'N' }), { id: 'b', title: 'B' }); // b, note p, a
    state = closeRecent(state, 'paper:b');
    expect(state.activeId).toBe('note:p');
    state = closeRecent(state, 'paper:a'); // a background page: active stays
    expect(state.activeId).toBe('note:p');
    state = closeRecent(state, 'note:p');
    expect(state).toEqual({ recents: [], activeId: 'screen:library' });
  });

  it('shows which fixed entry an open page belongs to', () => {
    expect(parentScreen(activeRecent(openPaper(initialTabs(), { id: 'a', title: 'A' })))).toBe('library');
    expect(parentScreen(activeRecent(openNote(initialTabs(), { id: 'p', name: 'N' })))).toBe('projects');
    expect(parentScreen(undefined)).toBeUndefined();
  });

  it('caps the list, dropping the oldest', () => {
    let state = initialTabs();
    for (let i = 0; i < MAX_RECENTS + 3; i += 1) state = openPaper(state, { id: String(i), title: `P${i}` });
    expect(state.recents).toHaveLength(MAX_RECENTS);
    expect(state.recents.at(-1)!.id).toBe('paper:3');
    expect(state.activeId).toBe(`paper:${MAX_RECENTS + 2}`);
  });

  it('ignores corrupt or outdated saved data', () => {
    expect(parseTabs('not json')).toBeUndefined();
    const restored = parseTabs(JSON.stringify({
      recents: [{ kind: 'note', projectId: 'p', title: 'N' }, { kind: 'paper', paperId: 'x', title: 'X' }, { kind: 'paper' }, { kind: 'screen', screen: 'memo', title: 'm' }],
      activeId: 'missing'
    }))!;
    expect(ids(restored)).toEqual(['note:p', 'paper:x']);
    expect(restored.activeId).toBe('screen:library');
  });
});
