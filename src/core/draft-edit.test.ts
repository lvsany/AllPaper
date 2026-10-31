import { describe, expect, it } from 'vitest';
import { columnText, documentFrom, emptyBlock, mergeInto, pasteInto, pasteSegments, setText, splitAt } from './draft-edit';
import { History } from './history';

let n = 0;
const id = () => `n${++n}`;
const block = (zh: string, en = '', locked = false) => ({ ...emptyBlock('a'), zhText: zh, enText: en, locked, status: locked ? 'locked' as const : 'synced' as const });

describe('bilingual editing, both columns', () => {
  it('splits a block in either column', () => {
    const [a, b] = splitAt(block('前半后半', 'first second'), 'zh', 2, 'b');
    expect([a.zhText, b.zhText]).toEqual(['前半', '后半']);
    expect(b.status).toBe('pending');
    const [c, d] = splitAt(block('中文', 'first second'), 'en', 6, 'c');
    expect([c.enText, d.enText]).toEqual(['first ', 'second']);
    expect([c.locked, d.locked]).toEqual([true, true]);
    expect(c.zhText).toBe('中文');
  });

  it('merges both columns into the block above', () => {
    const merged = mergeInto(block('上一段。', 'Above.'), block('下一段。', 'Below.'), 'en');
    expect(merged.block).toMatchObject({ zhText: '上一段。下一段。', enText: 'Above. Below.', status: 'pending' });
    expect(merged.caret).toBe('Above. '.length);
    const kept = mergeInto(block('甲', 'A'), block('乙', 'mine', true), 'zh');
    expect(kept.block).toMatchObject({ enText: 'A mine', locked: true, status: 'locked' });
    expect(kept.caret).toBe(1);
  });

  it('pastes paragraphs as blocks in the English column too', () => {
    const result = pasteInto(block('', 'Intro: |rest'), 'en', 7, 7, ['First.', '## Method', 'Last.'], id)!;
    expect(result.blocks.map((b) => b.enText)).toEqual(['Intro: First.', 'Method', 'Last.|rest']);
    expect(result.blocks[1]).toMatchObject({ type: 'heading', level: 2, locked: true });
    expect(result.blocks.every((b) => b.locked)).toBe(true);
    expect(result.caret).toBe('Last.'.length);
    expect(pasteInto(block('x'), 'en', 0, 0, ['one'], id)).toBeUndefined();
  });

  it('keeps a leading or trailing line break as a paragraph boundary', () => {
    expect(pasteSegments('one\ntwo.')).toEqual(['one', 'two.']);
    expect(pasteSegments('\n\n# Method\nText.')).toEqual(['', '# Method', 'Text.']);
    expect(pasteSegments('Alone.\n')).toEqual(['Alone.', '']);
    const result = pasteInto(block('', 'Existing.'), 'en', 9, 9, pasteSegments('\n# Method\nWe compare.'), id)!;
    expect(result.blocks.map((b) => b.enText)).toEqual(['Existing.', 'Method', 'We compare.']);
    expect(result.blocks[1]).toMatchObject({ type: 'heading', level: 1 });
  });

  it('turns # into a heading in English as well', () => {
    expect(setText(block(''), 'en', '# Introduction')).toMatchObject({ type: 'heading', level: 1, enText: 'Introduction', locked: true });
  });

  it('builds and copies a whole column', () => {
    const doc = documentFrom('zh', ['## 引言', '正文一。', '正文二。'], id);
    expect(doc.map((b) => b.type)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(columnText(doc, 'zh')).toBe('## 引言\n\n正文一。\n\n正文二。');
    expect(documentFrom('en', [], id)).toHaveLength(1);
  });
});

describe('undo history', () => {
  it('groups typing in one place, keeps structural edits separate, and redoes', () => {
    let clock = 0;
    const history = new History<string>(50, 1000, () => clock);
    history.record('', 'zh:a'); clock += 100;
    history.record('a', 'zh:a'); clock += 100; // still typing: same step
    history.record('ab', 'split');              // a structural edit is its own step
    expect(history.undo('ab|')).toBe('ab');
    expect(history.undo('ab')).toBe('');
    expect(history.undo('')).toBeUndefined();
    expect(history.redo('')).toBe('ab');
    expect(history.redo('ab')).toBe('ab|');
    clock += 5000;
    history.record('ab|', 'zh:a'); clock += 2000;
    history.record('ab|x', 'zh:a');             // a pause starts a new step
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });
});
