import { cp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { citekeyBase, nextCitekey, paperToBibtex, parseBibtex } from '../core/bibliography';
import { parseLatexmlHtml, placeholdersIntact, TRANSLATABLE } from '../core/arxiv-html';
import { hash } from '../core/draft';
import { translationSystem, translationUser, type GlossaryEntry } from '../core/prompts';
import type { Annotation, ImportResult, Paper, PaperBundle, Paragraph } from '../shared/types';
import type { SearchPaper } from '../core/deduplicate';
import { AiError, type AiProvider, type Completion } from './ai';
import { fetchArxivPaper, type ArxivDocument } from './arxiv';

const META = 'meta.json';
const CONTENT = 'content.json';
const TRANSLATIONS = 'translation.zh.json';
const ANNOTATIONS = 'annotations.json';
const TRANSLATE_CONCURRENCY = 4;

export interface TranslationEntry { zh: string; h: string; model: string; at: string }
export interface TranslateResult { translations: Record<string, string>; failed: string[]; error?: string }
export interface AiRuntime { provider: AiProvider; model: string; glossary: GlossaryEntry[] }

export interface PaperStoreDeps {
  root: string;
  onChanged(): Promise<void>;
  /** Returns undefined when no model service is configured. */
  ai(): AiRuntime | undefined;
  onUsage(task: string, completion: Pick<Completion, 'inputTokens' | 'outputTokens'>): void;
}

interface IndexEntry { paper: Paper; dir: string }

class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try { return await task(); } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
};

export class PaperStore {
  private index?: Map<string, IndexEntry>;
  private readonly bundles = new Map<string, { paragraphs: Paragraph[] }>();
  private readonly translationCache = new Map<string, Record<string, TranslationEntry>>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  private readonly limiter = new Semaphore(TRANSLATE_CONCURRENCY);

  constructor(private readonly deps: PaperStoreDeps) {}

  private get root() { return this.deps.root; }
  private get papersRoot() { return join(this.root, 'papers'); }

  private async load(): Promise<Map<string, IndexEntry>> {
    if (this.index) return this.index;
    const index = new Map<string, IndexEntry>();
    for (const entry of await readdir(this.papersRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const paper = await readJson<Paper | undefined>(join(this.papersRoot, entry.name, META), undefined);
      if (paper?.id) index.set(paper.id, { paper, dir: entry.name });
    }
    this.index = index;
    return index;
  }

  private async entry(id: string): Promise<IndexEntry> {
    const found = (await this.load()).get(id);
    if (!found) throw new Error('找不到文献');
    return found;
  }

  private dirPath(entry: IndexEntry) { return join(this.papersRoot, entry.dir); }

  async list(): Promise<Paper[]> {
    return [...(await this.load()).values()].map((entry) => entry.paper).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async get(id: string): Promise<PaperBundle | undefined> {
    const entry = (await this.load()).get(id);
    if (!entry) return undefined;
    let cached = this.bundles.get(id);
    if (!cached) {
      const content = await readJson<{ paragraphs?: Paragraph[] }>(join(this.dirPath(entry), CONTENT), {});
      cached = { paragraphs: content.paragraphs ?? [] };
      this.bundles.set(id, cached);
    }
    const hasPdf = await stat(join(this.dirPath(entry), 'paper.pdf')).then(() => true, () => false);
    const assetBase = `allpaper://paper/${encodeURIComponent(entry.dir)}/`;
    return { paper: entry.paper, paragraphs: cached.paragraphs, assetBase, pdfUrl: hasPdf ? `${assetBase}paper.pdf` : undefined };
  }

  // ---- translation -------------------------------------------------------

  private async entries(id: string): Promise<Record<string, TranslationEntry>> {
    const cached = this.translationCache.get(id);
    if (cached) return cached;
    const entry = await this.entry(id);
    const raw = await readJson<Record<string, TranslationEntry | string>>(join(this.dirPath(entry), TRANSLATIONS), {});
    const entries: Record<string, TranslationEntry> = {};
    for (const [key, value] of Object.entries(raw)) {
      entries[key] = typeof value === 'string' ? { zh: value, h: '', model: 'legacy', at: '' } : value;
    }
    this.translationCache.set(id, entries);
    return entries;
  }

  private sourceHash(paragraph: Paragraph): string { return hash(paragraph.masked ?? paragraph.text); }

  /** Cached translations that still match the current text of their paragraph. */
  async translations(id: string): Promise<Record<string, string>> {
    const bundle = await this.get(id);
    if (!bundle) return {};
    const entries = await this.entries(id);
    const byId = new Map(bundle.paragraphs.map((p) => [p.id, p]));
    const result: Record<string, string> = {};
    for (const [pid, value] of Object.entries(entries)) {
      const paragraph = byId.get(pid);
      if (paragraph && (!value.h || value.h === this.sourceHash(paragraph))) result[pid] = value.zh;
    }
    return result;
  }

  private persistTranslations(id: string): Promise<void> {
    const previous = this.writeChains.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const entry = await this.entry(id);
      await writeFile(join(this.dirPath(entry), TRANSLATIONS), JSON.stringify(this.translationCache.get(id) ?? {}, null, 2));
    });
    this.writeChains.set(id, next.catch(() => undefined));
    return next;
  }

  private async translateOne(runtime: AiRuntime, paragraph: Paragraph, id: string): Promise<string | undefined> {
    const key = `${id}:${paragraph.id}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.limiter.run(async () => {
      const source = paragraph.masked ?? paragraph.text;
      const system = translationSystem(runtime.glossary);
      const ask = async (extra = ''): Promise<{ text: string; usage: Completion }> => {
        const completion = await runtime.provider.complete({
          model: runtime.model, system,
          messages: [{ role: 'user', content: translationUser(source, paragraph.sectionPath) + extra }],
          maxTokens: Math.min(4000, Math.max(512, Math.ceil(source.length * 2) + 256))
        });
        this.deps.onUsage('阅读翻译', completion);
        return { text: cleanTranslation(completion.text), usage: completion };
      };
      let { text } = await ask();
      if (!placeholdersIntact(source, text)) {
        text = (await ask('\n\n（注意：上一次输出丢失或改动了 ⟦n⟧ 占位符。请务必原样保留所有 ⟦n⟧ 占位符。）')).text;
      }
      if (!placeholdersIntact(source, text)) {
        const missing = (source.match(/⟦\d+⟧/g) ?? []).filter((token) => !text.includes(token));
        text = `${text} ${missing.join(' ')}`.trim();
      }
      if (!text) return undefined;
      const entries = await this.entries(id);
      entries[paragraph.id] = { zh: text, h: this.sourceHash(paragraph), model: runtime.model, at: new Date().toISOString() };
      return text;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  async translate(id: string, paragraphIds?: string[], options: { force?: boolean; onEntry?: (paragraphId: string, zh: string) => void } = {}): Promise<TranslateResult> {
    const bundle = await this.get(id);
    if (!bundle) throw new Error('找不到文献');
    const runtime = this.deps.ai();
    if (!runtime) throw new AiError('尚未配置模型服务', 'not-configured');
    const cached = await this.translations(id);
    const wanted = paragraphIds ? new Set(paragraphIds) : undefined;
    const targets = bundle.paragraphs.filter((p) => TRANSLATABLE.has(p.type) && p.text && (!wanted || wanted.has(p.id)) && (options.force || !cached[p.id]));
    const failed: string[] = [];
    let firstError: AiError | undefined;
    let blocked = false;
    await Promise.all(targets.map(async (paragraph) => {
      if (blocked) { failed.push(paragraph.id); return; }
      try {
        const zh = await this.translateOne(runtime, paragraph, id);
        if (zh) { cached[paragraph.id] = zh; options.onEntry?.(paragraph.id, zh); }
      } catch (error) {
        failed.push(paragraph.id);
        const aiError = error instanceof AiError ? error : new AiError(error instanceof Error ? error.message : String(error), 'network');
        firstError ??= aiError;
        // A bad key or model name will fail every remaining paragraph the same way.
        if (['auth', 'not-configured', 'bad-request'].includes(aiError.code)) blocked = true;
      }
    }));
    if (targets.length) await this.persistTranslations(id);
    return { translations: cached, failed, error: firstError?.message };
  }

  // ---- annotations -------------------------------------------------------

  async annotations(id: string): Promise<Annotation[]> {
    const entry = await this.entry(id);
    return readJson<Annotation[]>(join(this.dirPath(entry), ANNOTATIONS), []);
  }

  private async saveAnnotations(id: string, list: Annotation[]): Promise<void> {
    const entry = await this.entry(id);
    await writeFile(join(this.dirPath(entry), ANNOTATIONS), JSON.stringify(list, null, 2));
  }

  async addAnnotation(id: string, input: Pick<Annotation, 'color' | 'quotedText' | 'prefix' | 'suffix' | 'paragraphId' | 'offsets' | 'comment'>): Promise<Annotation> {
    const annotation: Annotation = { ...input, id: randomUUID().slice(0, 8), paperId: id, view: 'reader', createdAt: new Date().toISOString() };
    await this.saveAnnotations(id, [...await this.annotations(id), annotation]);
    return annotation;
  }

  async updateAnnotation(id: string, annotationId: string, patch: Partial<Pick<Annotation, 'color' | 'comment'>>): Promise<Annotation> {
    const list = await this.annotations(id);
    const index = list.findIndex((item) => item.id === annotationId);
    if (index < 0) throw new Error('找不到批注');
    list[index] = { ...list[index], ...patch };
    await this.saveAnnotations(id, list);
    return list[index];
  }

  async deleteAnnotation(id: string, annotationId: string): Promise<void> {
    await this.saveAnnotations(id, (await this.annotations(id)).filter((item) => item.id !== annotationId));
  }

  // ---- import ------------------------------------------------------------

  private newDir(citekey: string, id: string) { return `${citekey}-${id.slice(0, 8)}`; }

  private async register(paper: Paper, dir: string, paragraphs: Paragraph[], source: string): Promise<void> {
    const path = join(this.papersRoot, dir);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, META), JSON.stringify(paper, null, 2));
    await writeFile(join(path, CONTENT), JSON.stringify({ source, paragraphs }, null, 2));
    await writeFile(join(path, ANNOTATIONS), '[]');
    await writeFile(join(path, TRANSLATIONS), '{}');
    (await this.load()).set(paper.id, { paper, dir });
    this.bundles.delete(paper.id);
    this.translationCache.delete(paper.id);
  }

  async importPdf(path: string): Promise<ImportResult> {
    const extracted = await extractPdf(path);
    const existing = await this.list();
    const paper: Paper = {
      id: randomUUID(), citekey: '', title: extracted.title || basename(path, extname(path)).replace(/[-_]/g, ' '),
      authors: extracted.authors.length ? extracted.authors : [{ family: 'Unknown' }], year: extracted.year, abstract: extracted.abstract,
      arxivCategories: [], contentSource: 'pdf', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString()
    };
    paper.citekey = nextCitekey(citekeyBase(paper.authors, paper.year, paper.title), existing.map((item) => item.citekey));
    const dir = this.newDir(paper.citekey, paper.id);
    await mkdir(join(this.papersRoot, dir), { recursive: true });
    await cp(path, join(this.papersRoot, dir, 'paper.pdf'));
    paper.pdfPath = join(this.papersRoot, dir, 'paper.pdf');
    const paragraphs = extracted.paragraphs.map((p) => ({ ...p, paperId: paper.id, id: `p${p.order}` }));
    await this.register(paper, dir, paragraphs, 'pdf');
    await this.afterChange();
    return { paper, warnings: extracted.warnings };
  }

  async importBibtex(text: string): Promise<ImportResult[]> {
    const existing = await this.list();
    const results: ImportResult[] = [];
    for (const parsed of parseBibtex(text)) {
      const taken = [...existing, ...results.map((r) => r.paper)].map((p) => p.citekey);
      const citekey = nextCitekey(parsed.citekey || citekeyBase(parsed.authors, parsed.year, parsed.title), taken);
      const paper: Paper = {
        id: randomUUID(), citekey, title: parsed.title, authors: parsed.authors, year: parsed.year, venue: parsed.venue, doi: parsed.doi,
        arxivId: parsed.arxivId, abstract: parsed.abstract, url: parsed.url, arxivCategories: [], contentSource: 'none', tags: [], collections: [],
        projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString()
      };
      await this.register(paper, this.newDir(citekey, paper.id), [], 'none');
      results.push({ paper, warnings: [] });
    }
    if (results.length) await this.afterChange();
    return results;
  }

  /** Fetches metadata, the structured HTML (arXiv, then ar5iv) and the PDF for an arXiv paper. */
  async importArxiv(input: string, onProgress?: (message: string) => void): Promise<ImportResult> {
    const doc = await fetchArxivPaper(input, onProgress);
    const existing = await this.list();
    const duplicate = existing.find((paper) => paper.arxivId === doc.meta.id);
    if (duplicate) return { paper: duplicate, warnings: ['该论文已在文献库中。'] };
    return this.storeArxiv(doc, existing, onProgress);
  }

  private async storeArxiv(doc: ArxivDocument, existing: Paper[], onProgress?: (message: string) => void): Promise<ImportResult> {
    const { meta } = doc;
    const warnings: string[] = [];
    const paper: Paper = {
      id: randomUUID(), citekey: '', title: meta.title, authors: meta.authors.length ? meta.authors : [{ family: 'Unknown' }], year: meta.year,
      venue: meta.journalRef || 'arXiv', doi: meta.doi, arxivId: meta.id, arxivCategories: meta.categories, abstract: meta.abstract,
      url: `https://arxiv.org/abs/${meta.id}${meta.version ?? ''}`, contentSource: 'none', tags: [], collections: [], projects: [],
      readStatus: 'unread', starred: false, addedAt: new Date().toISOString()
    };
    paper.citekey = nextCitekey(citekeyBase(paper.authors, paper.year, paper.title), existing.map((item) => item.citekey));
    const dir = this.newDir(paper.citekey, paper.id);
    const path = join(this.papersRoot, dir);
    await mkdir(join(path, 'assets'), { recursive: true });

    let paragraphs: Paragraph[] = [];
    let source = 'none';
    if (doc.html) {
      onProgress?.('正在解析正文…');
      const parsed = parseLatexmlHtml(doc.html.text, { paperId: paper.id, baseUrl: doc.html.url });
      if (parsed.paragraphs.length > 5) {
        paragraphs = parsed.paragraphs;
        source = doc.html.source;
        onProgress?.(`正在保存 ${parsed.images.length} 张图片…`);
        paragraphs = await localizeImages(paragraphs, parsed.images, join(path, 'assets'));
      } else warnings.push('HTML 版本正文过短，已改用 PDF 文字层。');
    }
    if (doc.pdf) {
      await writeFile(join(path, 'paper.pdf'), doc.pdf);
      paper.pdfPath = join(path, 'paper.pdf');
      if (!paragraphs.length) {
        const extracted = await extractPdf(join(path, 'paper.pdf'));
        paragraphs = extracted.paragraphs.map((p) => ({ ...p, paperId: paper.id, id: `p${p.order}` }));
        source = 'pdf';
        warnings.push(...extracted.warnings, '该论文没有可用的 HTML 版本，阅读视图由 PDF 文字层生成，段落与公式可能不准确。');
      }
    } else if (!paragraphs.length) warnings.push('未能获取全文（HTML 与 PDF 均不可用）。');
    paper.contentSource = source as Paper['contentSource'];
    await this.register(paper, dir, paragraphs, source);
    await this.afterChange();
    return { paper, warnings };
  }

  async importSearchRecord(record: SearchPaper): Promise<ImportResult> {
    const existing = await this.list();
    const duplicate = existing.find((paper) => (record.doi && paper.doi === record.doi) || (record.arxivId && paper.arxivId === record.arxivId) || paper.title.toLowerCase() === record.title.toLowerCase());
    if (duplicate) return { paper: duplicate, warnings: ['该论文已在文献库中。'] };
    const paper: Paper = {
      id: randomUUID(), citekey: '', title: record.title, authors: record.authors.length ? record.authors : [{ family: 'Unknown' }], year: record.year,
      venue: record.venue, doi: record.doi, arxivId: record.arxivId, arxivCategories: record.categories ?? [], abstract: record.abstract, url: record.url,
      contentSource: 'none', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString()
    };
    paper.citekey = nextCitekey(citekeyBase(paper.authors, paper.year, paper.title), existing.map((item) => item.citekey));
    await this.register(paper, this.newDir(paper.citekey, paper.id), [], 'none');
    await this.afterChange();
    return { paper, warnings: ['已入库元数据；此来源没有可自动获取的全文，可稍后拖入 PDF。'] };
  }

  async update(id: string, patch: Partial<Paper>): Promise<Paper> {
    const entry = await this.entry(id);
    const next = { ...entry.paper, ...patch, id: entry.paper.id, citekey: entry.paper.citekey, addedAt: entry.paper.addedAt };
    await writeFile(join(this.dirPath(entry), META), JSON.stringify(next, null, 2));
    entry.paper = next;
    await this.afterChange();
    return next;
  }

  async changeCitekey(id: string, requested: string): Promise<Paper> {
    const entry = await this.entry(id);
    const normalized = requested.trim().replace(/[^a-zA-Z0-9:_-]/g, '');
    if (!normalized) throw new Error('引用键不能为空');
    const taken = [...(await this.load()).values()].some((other) => other.paper.id !== id && other.paper.citekey.toLowerCase() === normalized.toLowerCase());
    if (taken) throw new Error('引用键已存在');
    const old = entry.paper.citekey;
    const next = { ...entry.paper, citekey: normalized };
    await writeFile(join(this.dirPath(entry), META), JSON.stringify(next, null, 2));
    entry.paper = next;
    await replaceCitations(this.root, old, normalized);
    this.bundles.clear();
    await this.afterChange();
    return next;
  }

  async exportBibtex(ids?: string[]): Promise<string> {
    const papers = await this.list();
    return `${papers.filter((paper) => !ids || ids.includes(paper.id)).map(paperToBibtex).join('\n\n')}\n`;
  }

  private async afterChange(): Promise<void> {
    await writeFile(join(this.root, 'library.bib'), await this.exportBibtex());
    await this.deps.onChanged();
  }

  invalidate(): void { this.index = undefined; this.bundles.clear(); this.translationCache.clear(); }
}

function cleanTranslation(text: string): string {
  return text.trim().replace(/^(?:译文|翻译)[:：]\s*/, '').replace(/^["“](.*)["”]$/s, '$1').trim();
}

async function localizeImages(paragraphs: Paragraph[], images: string[], assetsDir: string): Promise<Paragraph[]> {
  const mapping = new Map<string, string>();
  const queue = [...images];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !/^image\//.test(type)) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 15 * 1024 * 1024) continue;
        const ext = extname(new URL(url).pathname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
        const name = `${createHash('sha1').update(url).digest('hex').slice(0, 12)}${ext}`;
        await writeFile(join(assetsDir, name), bytes);
        mapping.set(url, `assets/${name}`);
      } catch { /* keep the remote URL; it still works online */ }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!mapping.size) return paragraphs;
  const rewrite = (html: string) => {
    let out = html;
    for (const [url, local] of mapping) out = out.split(`src="${escapeHtml(url).replace(/"/g, '&quot;')}"`).join(`src="${local}"`);
    return out;
  };
  return paragraphs.map((p) => ({ ...p, html: rewrite(p.html), slots: p.slots ? Object.fromEntries(Object.entries(p.slots).map(([k, v]) => [k, rewrite(v)])) : undefined }));
}

async function replaceCitations(root: string, oldKey: string, newKey: string): Promise<void> {
  const pattern = new RegExp(`@${escapeRegExp(oldKey)}(?=[#,\\]\\s])`, 'g');
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.index') continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(md|json)$/i.test(entry.name) && !['content.json', TRANSLATIONS].includes(entry.name)) {
        const source = await readFile(file, 'utf8');
        const next = source.replace(pattern, `@${newKey}`);
        if (next !== source) await writeFile(file, next);
      }
    }
  };
  await visit(root);
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function extractPdf(path: string): Promise<{ title?: string; authors: Paper['authors']; year?: number; abstract?: string; paragraphs: Paragraph[]; warnings: string[] }> {
  const warnings: string[] = [];
  let title = '';
  let authors: Paper['authors'] = [];
  let text = '';
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as any;
    const data = new Uint8Array(await readFile(path));
    const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
    const metadata = await doc.getMetadata();
    title = metadata.info?.Title || '';
    const authorString = metadata.info?.Author || '';
    authors = authorString ? authorString.split(/,|\sand\s/i).map((name: string) => ({ family: name.trim().split(/\s+/).at(-1) || 'Unknown', given: name.trim().split(/\s+/).slice(0, -1).join(' ') })) : [];
    for (let pageNo = 1; pageNo <= Math.min(doc.numPages, 40); pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      text += `\n${content.items.map((item: any) => item.str || '').join(' ')}`;
    }
  } catch (error) {
    warnings.push(`PDF 文字层解析失败：${error instanceof Error ? error.message : '未知错误'}。已保留原始 PDF，可在原版视图阅读。`);
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  const lines = clean.split(/(?<=[.!?。])\s+/).filter((line) => line.length > 35);
  if (!title) title = lines[0]?.slice(0, 180) || basename(path, extname(path));
  const yearMatch = clean.match(/\b(19|20)\d{2}\b/);
  const abstractMatch = clean.match(/abstract\s*[:.]?\s*(.{80,1300}?)(?=\s+(?:1\.?\s*)?(?:introduction|keywords)\b|$)/i);
  const paragraphs: Paragraph[] = lines.map((line, order) => ({ id: `p${order}`, paperId: '', order, type: 'paragraph', html: escapeHtml(line), text: line, masked: line, sectionPath: [] }));
  return { title, authors, year: yearMatch ? Number(yearMatch[0]) : undefined, abstract: abstractMatch?.[1]?.trim(), paragraphs, warnings };
}
