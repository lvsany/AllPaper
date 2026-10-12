import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const article = (title: string) => `<article class="ltx_document"><h1 class="ltx_title ltx_title_document">${title}</h1>
<section id="S1"><h2 class="ltx_title ltx_title_section">Introduction</h2>
${Array.from({ length: 6 }, (_, i) => `<div class="ltx_para"><p id="S1.p${i}.1" class="ltx_p">Paragraph ${i} of the paper.</p></div>`).join('')}
</section></article>`;

const fetched: string[] = [];
vi.mock('./arxiv', () => ({
  fetchArxivPaper: vi.fn(async (input: string) => {
    fetched.push(input);
    const id = input.replace(/v\d+$/, '');
    return {
      meta: { id, version: 'v1', title: `arXiv ${id}`, authors: [{ given: 'A', family: 'Wang' }], abstract: 'Abstract from arXiv.', year: 2024, categories: ['cs.SE'] },
      html: { source: 'arxiv-html', text: article(`arXiv ${id}`), url: `https://arxiv.org/html/${id}` },
      pdf: Buffer.from('%PDF-1.4 fake')
    };
  }),
  findArxivByTitle: vi.fn(async (work: { title: string }) => /Found by title/i.test(work.title) ? { id: '2401.00002', version: undefined } : undefined),
  findOpenAccessPdf: vi.fn(async () => undefined)
}));

import { PaperStore } from './paper-store';

const BIB = `
@inproceedings{wang2024eprint,
  title = {A paper with an eprint},
  author = {Wang, Lin and Chen, Yu},
  year = {2024}, booktitle = {ICSE}, eprint = {2401.00001}, archivePrefix = {arXiv}
}
@article{li2023found,
  title = {Found by title only},
  author = {Li, Wei},
  year = {2023}, journal = {TSE}, doi = {10.1109/TSE.2023.1}
}
@article{zhao2022nowhere,
  title = {A paywalled paper nobody can fetch},
  author = {Zhao, Qi},
  year = {2022}, journal = {Some Journal}
}
`;

let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'allpaper-bib-')); await mkdir(join(root, 'papers'), { recursive: true }); fetched.length = 0; });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const store = () => new PaperStore({ root, pauseMs: 0, onChanged: async () => undefined, onUsage: () => undefined, ai: () => undefined });

describe('BibTeX import with full text', () => {
  it('gets full text via eprint and via title, keeps the bib citekeys, and reports what is missing', async () => {
    const papers = store();
    const progress: Array<{ done?: number; total?: number }> = [];
    const results = await papers.importBibtex(BIB, (p) => progress.push(p));

    expect(results.map((r) => r.status)).toEqual(['full-text', 'full-text', 'metadata-only']);
    expect(results.map((r) => r.paper.citekey)).toEqual(['wang2024eprint', 'li2023found', 'zhao2022nowhere']);
    expect(fetched).toEqual(['2401.00001', '2401.00002']);
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3 });

    const first = (await papers.get(results[0].paper.id))!;
    expect(first.paper.contentSource).toBe('arxiv-html');
    expect(first.paper.venue).toBe('ICSE'); // the bib's venue wins over "arXiv"
    expect(first.paper.title).toBe('A paper with an eprint');
    expect(first.paragraphs.length).toBeGreaterThan(5);
    expect(first.pdfUrl).toBeDefined();

    const second = (await papers.get(results[1].paper.id))!;
    expect(second.paper.arxivId).toBe('2401.00002');
    expect(second.paper.doi).toBe('10.1109/TSE.2023.1');
  });

  it('skips entries that are already in the library', async () => {
    const papers = store();
    await papers.importBibtex(BIB);
    const again = await papers.importBibtex(BIB);
    expect(again.map((r) => r.status)).toEqual(['existing', 'existing', 'existing']);
    expect(await papers.list()).toHaveLength(3);
  });

  it('fills in papers that only had metadata, and imports an arXiv link over a metadata-only entry', async () => {
    const papers = store();
    const [, , missing] = await papers.importBibtex(BIB);
    expect(missing.paper.contentSource).toBe('none');
    expect(await papers.fetchMissingFullTexts()).toEqual({ total: 1, fetched: 0 });

    const stub = (await papers.importBibtex('@article{x2020stub, title = {Some stub}, author = {X, Y}, year = {2020}, eprint = {2402.00009}}')).at(0)!;
    expect(stub.status).toBe('full-text');
  });
});
