import { describe, expect, it } from 'vitest';
import { citationsIn, docToMarkdown, excerptMarkdown, markdownToDoc } from './note-markdown';

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md));

describe('note markdown', () => {
  it('round-trips headings, paragraphs, lists and tasks', () => {
    const md = '# Title\n\nSome **bold** and *italic* text with `code`.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [ ] todo\n- [x] done\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('round-trips quotes with citation chips and keeps the anchor', () => {
    const md = excerptMarkdown({ quote: 'We match the budget.', translation: '我们匹配预算。', key: 'wang2025evaluating', anchor: 'a1b2' }) + '\n';
    const doc = markdownToDoc(md, (ref) => `label:${ref.key}`);
    const chip = JSON.stringify(doc).match(/"type":"citation","attrs":\{[^}]*\}/)?.[0];
    expect(chip).toContain('"anchor":"a1b2"');
    expect(chip).toContain('label:wang2025evaluating');
    expect(docToMarkdown(doc)).toBe(md);
  });

  it('keeps TeX math untouched and escapes literal markdown characters', () => {
    const md = 'The state $h_{t}$ uses a\\*b and \\_x.\n';
    expect(roundTrip(md)).toBe(md);
    expect(roundTrip(excerptMarkdown({ quote: 'value $H_{c}$ * 2', key: 'k' }) + '\n')).toContain('$H_{c}$');
  });

  it('handles code blocks, rules and page citations', () => {
    const md = '```ts\nconst a = 1;\n```\n\n---\n\nSee [@vaswani2017attention, p.5] and [link](https://arxiv.org).\n';
    expect(roundTrip(md)).toBe(md);
  });

  it('lists citations in a note', () => {
    expect(citationsIn('a [@one] b [@two#x9] c [@one]').map((c) => c.key)).toEqual(['one', 'two', 'one']);
  });

  it('turns an empty note into a single empty paragraph', () => {
    expect(markdownToDoc('').content).toEqual([{ type: 'paragraph' }]);
    expect(docToMarkdown(markdownToDoc(''))).toBe('\n');
  });
});
