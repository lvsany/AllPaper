import { describe, expect, it } from 'vitest';
import { arxivRefOf, parseArxivFeed } from './arxiv-id';
import { isDuplicate, isSameWork, titleSimilarity } from './bib-resolve';

describe('bibliography resolution', () => {
  it('finds the arXiv id in eprint, url or an arXiv DOI', () => {
    expect(arxivRefOf({ arxivId: 'arXiv:2512.07404' })?.id).toBe('2512.07404');
    expect(arxivRefOf({ url: 'https://arxiv.org/abs/1706.03762v5' })).toEqual({ id: '1706.03762', version: 'v5' });
    expect(arxivRefOf({ doi: '10.48550/arXiv.2310.06770' })?.id).toBe('2310.06770');
    expect(arxivRefOf({ doi: '10.1145/3597503.3639187', url: 'https://doi.org/10.1145/3597503.3639187' })).toBeUndefined();
  });

  it('matches the same work despite punctuation and case, but not a different paper', () => {
    const entry = { title: 'SWE-bench: Can Language Models Resolve Real-World GitHub Issues?', authors: [{ family: 'Jimenez' }], year: 2024 };
    expect(titleSimilarity(entry.title, 'SWE-Bench: can language models resolve real-world Github issues')).toBeGreaterThan(0.95);
    expect(isSameWork(entry, { title: 'SWE-bench: Can Language Models Resolve Real-World GitHub Issues?', authors: [{ family: 'Jimenez' }], year: 2023 })).toBe(true);
    expect(isSameWork(entry, { title: 'SWE-bench Multimodal: Do AI Systems Generalize to Visual Software Domains?', authors: [{ family: 'Yang' }], year: 2024 })).toBe(false);
    expect(isSameWork(entry, { title: entry.title, authors: [{ family: 'Someone' }], year: 2024 })).toBe(false);
  });

  it('recognises duplicates by doi, arXiv id or title', () => {
    expect(isDuplicate({ doi: '10.1/ABC', title: 'a' }, { doi: '10.1/abc', title: 'b' })).toBe(true);
    expect(isDuplicate({ arxivId: '2512.07404v2', title: 'a' }, { arxivId: '2512.07404', title: 'b' })).toBe(true);
    expect(isDuplicate({ title: 'Attention Is All You Need' }, { title: 'attention is all you need.' })).toBe(true);
    expect(isDuplicate({ title: 'x' }, { title: 'y' })).toBe(false);
  });

  it('reads every entry of a feed', () => {
    const xml = '<feed><entry><id>http://arxiv.org/abs/2501.00001v1</id><title>A</title><author><name>X Y</name></author></entry><entry><id>http://arxiv.org/abs/2501.00002v1</id><title>B</title></entry></feed>';
    expect(parseArxivFeed(xml).map((m) => m.id)).toEqual(['2501.00001', '2501.00002']);
  });
});
