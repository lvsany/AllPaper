import { describe, expect, it } from 'vitest';
import { citekeyBase, nextCitekey, paperToBibtex, parseBibtex } from './bibliography';
import type { Paper } from '../shared/types';

describe('bibliography', () => {
  it('generates stable citekeys and alphabetical collision suffixes', () => {
    expect(citekeyBase([{ family: 'Vaswani' }], 2017, 'Attention Is All You Need')).toBe('vaswani2017attention');
    expect(nextCitekey('vaswani2017attention', ['vaswani2017attention', 'vaswani2017attentiona'])).toBe('vaswani2017attentionb');
  });
  it('round trips the open BibTeX metadata format', () => {
    const paper: Paper = { id: '1', citekey: 'li2024swarm', title: 'Swarm Software Engineering', authors: [{ family: 'Li', given: 'Ming' }], year: 2024, venue: 'ICSE', doi: '10.1/x', arxivCategories: [], contentSource: 'none', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: '2026-01-01' };
    const parsed = parseBibtex(paperToBibtex(paper));
    expect(parsed[0]).toMatchObject({ citekey: paper.citekey, title: paper.title, year: 2024, venue: 'ICSE' });
  });
  it('reads real-world .bib files: one-line entries, quotes, nested braces, comments', () => {
    const bib = `@comment{ignored}
@string{ICSE = "ICSE"}
@InProceedings{Wang2024,
  author  = "Wang, Lin and Chen, Yu",
  title   = {{SWE}-bench: Can LMs Resolve {GitHub} Issues?},
  booktitle = ICSE,
  year = 2024, eprint = {2310.06770}, archivePrefix = {arXiv}}
@article{li2023, title={A \& B}, author={Li, Wei}, journal={TSE}, doi={10.1/x}, eprint={12345}, archiveprefix={PubMed}}`;
    const [a, b] = parseBibtex(bib);
    expect(a).toMatchObject({ citekey: 'Wang2024', title: 'SWE-bench: Can LMs Resolve GitHub Issues?', year: 2024, venue: 'ICSE', arxivId: '2310.06770' });
    expect(a.authors).toEqual([{ family: 'Wang', given: 'Lin' }, { family: 'Chen', given: 'Yu' }]);
    expect(b).toMatchObject({ citekey: 'li2023', title: 'A & B', venue: 'TSE', arxivId: undefined });
  });
});
