import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaperStore } from './paper-store';
import type { AiProvider, CompleteRequest } from './ai';
import { parseLatexmlHtml } from '../core/arxiv-html';
import type { Paper } from '../shared/types';

const html = `<article class="ltx_document"><h1 class="ltx_title ltx_title_document">T</h1>
<section id="S1"><h2 class="ltx_title ltx_title_section">Intro</h2>
<div class="ltx_para"><p id="S1.p1.1" class="ltx_p">We use <math alttext="x" display="inline"><mi>x</mi></math> as in <cite class="ltx_cite"><a class="ltx_ref" href="#bib.bib1">Foo, 2020</a></cite>.</p></div>
<div class="ltx_para"><p id="S1.p2.1" class="ltx_p">Second paragraph about agents.</p></div></section></article>`;

class CountingProvider implements AiProvider {
  name = 'counting';
  calls: CompleteRequest[] = [];
  drop = false;
  async complete(request: CompleteRequest) {
    this.calls.push(request);
    const source = request.messages.at(-1)!.content.replace(/^（所在章节：[^）]*）\n/, '');
    return { text: this.drop ? '丢了占位符' : `译：${source}`, inputTokens: 1, outputTokens: 1 };
  }
}

let root = '';
let provider: CountingProvider;
const paper: Paper = {
  id: 'p1-0000-0000', citekey: 'foo2020test', title: 'T', authors: [{ family: 'Foo' }], arxivCategories: [], contentSource: 'arxiv-html',
  tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: '2026-01-01T00:00:00.000Z'
};

async function store(configured = true) {
  return new PaperStore({
    root, onChanged: async () => undefined, onUsage: () => undefined,
    ai: () => configured ? { provider, model: 'm', glossary: [] } : undefined
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'allpaper-store-'));
  provider = new CountingProvider();
  const dir = join(root, 'papers', 'foo2020test-p1-0000');
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, 'projects'), { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(paper));
  const { paragraphs } = parseLatexmlHtml(html, { paperId: paper.id, baseUrl: 'https://arxiv.org/html/1' });
  await writeFile(join(dir, 'content.json'), JSON.stringify({ source: 'arxiv-html', paragraphs }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('PaperStore translation', () => {
  it('translates each paragraph once and serves later requests from the cache', async () => {
    const papers = await store();
    const events: string[] = [];
    const first = await papers.translate(paper.id, undefined, { onEntry: (id) => events.push(id) });
    expect(first.failed).toEqual([]);
    expect(provider.calls).toHaveLength(4); // title, heading, two paragraphs
    expect(events).toHaveLength(4);
    expect(first.translations['S1.p1.1']).toBe('译：We use ⟦1⟧ as in ⟦2⟧.');

    const reopened = await store();
    expect(await reopened.translations(paper.id)).toEqual(first.translations);
    await reopened.translate(paper.id);
    expect(provider.calls).toHaveLength(4);
    expect(JSON.parse(await readFile(join(root, 'papers', 'foo2020test-p1-0000', 'translation.zh.json'), 'utf8'))['S1.p2.1'].model).toBe('m');
  });

  it('re-translates only when forced', async () => {
    const papers = await store();
    await papers.translate(paper.id, ['S1.p2.1']);
    await papers.translate(paper.id, ['S1.p2.1'], { force: true });
    expect(provider.calls).toHaveLength(2);
  });

  it('repairs a translation that lost its placeholders instead of dropping the formula', async () => {
    provider.drop = true;
    const papers = await store();
    const result = await papers.translate(paper.id, ['S1.p1.1']);
    expect(provider.calls).toHaveLength(2); // one retry
    expect(result.translations['S1.p1.1']).toContain('⟦1⟧');
    expect(result.translations['S1.p1.1']).toContain('⟦2⟧');
  });

  it('refuses to translate without a configured model instead of faking output', async () => {
    const papers = await store(false);
    await expect(papers.translate(paper.id)).rejects.toMatchObject({ code: 'not-configured' });
    expect(await papers.translations(paper.id)).toEqual({});
  });
});

describe('PaperStore annotations', () => {
  it('adds, edits and deletes annotations', async () => {
    const papers = await store();
    const made = await papers.addAnnotation(paper.id, { color: 'yellow', quotedText: 'agents', prefix: 'about ', suffix: '.', paragraphId: 'S1.p2.1', offsets: [26, 32] });
    await papers.updateAnnotation(paper.id, made.id, { comment: '重要', color: 'red' });
    expect((await papers.annotations(paper.id))[0]).toMatchObject({ comment: '重要', color: 'red', quotedText: 'agents' });
    await papers.deleteAnnotation(paper.id, made.id);
    expect(await papers.annotations(paper.id)).toEqual([]);
  });
});
