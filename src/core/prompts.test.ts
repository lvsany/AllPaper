import { describe, expect, it } from 'vitest';
import { answerToNoteMarkdown, extractParagraphRefs, parseGlossary, paperContext, segmentAnswer } from './prompts';
import type { Paragraph } from '../shared/types';

const para = (order: number, text: string, type: Paragraph['type'] = 'paragraph'): Paragraph => ({ id: `p${order}`, paperId: 'x', order, type, html: text, text, sectionPath: [] });

describe('assistant prompts', () => {
  it('parses the glossary format', () => {
    expect(parseGlossary('agent = 智能体\nBigCodeBench = 保留\n# comment\nswarm=群体')).toEqual([
      { en: 'agent', zh: '智能体', keep: false }, { en: 'BigCodeBench', zh: undefined, keep: true }, { en: 'swarm', zh: '群体', keep: false }
    ]);
  });

  it('numbers paper paragraphs and skips references', () => {
    const ctx = paperContext({ title: 't', citekey: 'k', paragraphs: [para(0, 'Intro', 'heading'), para(1, 'Body text.'), para(2, 'Ref entry', 'references')] });
    expect(ctx.text).toBe('[P0] ## Intro\n[P1] Body text.');
  });

  it('verifies [P] citations against the paper (A2)', () => {
    expect(extractParagraphRefs('a [P3] b [P5, P7] c [P3][P9]')).toEqual([3, 5, 7, 9]);
    const segments = segmentAnswer('Claim [P3] and [P99].', 10);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'ref', 'text', 'unverified', 'text']);
    expect(answerToNoteMarkdown('Claim [P3] and [P99].', 'wang2025x', 10)).toBe('Claim [@wang2025x#P3] and .');
  });
});
