import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { citekeyBase, nextCitekey, paperToBibtex, parseBibtex, slugify } from '../core/bibliography';
import type { ImportResult, Paper, PaperBundle, Paragraph } from '../shared/types';
import type { SearchPaper } from '../core/deduplicate';
import { MockAiProvider } from './ai';

const metaFile = 'meta.json';
export class PaperStore {
  constructor(private readonly root: string, private readonly onChanged: () => Promise<void>) {}
  private get papersRoot() { return join(this.root, 'papers'); }
  async list(): Promise<Paper[]> {
    const entries = await readdir(this.papersRoot, { withFileTypes: true }); const papers: Paper[] = [];
    for (const entry of entries) if (entry.isDirectory()) try { papers.push(JSON.parse(await readFile(join(this.papersRoot, entry.name, metaFile), 'utf8')) as Paper); } catch { /* ignore incomplete import */ }
    return papers.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  async get(id: string): Promise<PaperBundle | undefined> {
    const paper = (await this.list()).find((item) => item.id === id); if (!paper) return undefined;
    const dir = this.paperDir(paper); try { const content = JSON.parse(await readFile(join(dir, 'content.json'), 'utf8')) as { paragraphs: Paragraph[] }; return { paper, paragraphs: content.paragraphs }; } catch { return { paper, paragraphs: [] }; }
  }
  async translations(id:string):Promise<Record<string,string>>{const paper=(await this.list()).find(x=>x.id===id);if(!paper)return {};try{return JSON.parse(await readFile(join(this.paperDir(paper),'translation.zh.json'),'utf8')) as Record<string,string>;}catch{return {};}}
  async translate(id:string, paragraphIds?:string[]):Promise<Record<string,string>>{const bundle=await this.get(id);if(!bundle)throw new Error('找不到文献');const cached=await this.translations(id);const provider=new MockAiProvider();for(const p of bundle.paragraphs){if(paragraphIds&&!paragraphIds.includes(p.id))continue;if(cached[p.id]||['formula','code','references','figure','table'].includes(p.type))continue;cached[p.id]=await provider.translate(p,{});}await writeFile(join(this.paperDir(bundle.paper),'translation.zh.json'),JSON.stringify(cached,null,2));return cached;}
  private paperDir(paper: Paper) { return join(this.papersRoot, `${paper.citekey}-${paper.id.slice(0, 8)}`); }
  async importPdf(path: string): Promise<ImportResult> {
    const extracted = await extractPdf(path); const existing = await this.list();
    const initial: Paper = { id: randomUUID(), citekey: '', title: extracted.title || basename(path, extname(path)).replace(/[-_]/g, ' '), authors: extracted.authors.length ? extracted.authors : [{ family: 'Unknown' }], year: extracted.year, abstract: extracted.abstract, arxivCategories: [], contentSource: 'pdf', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString() };
    initial.citekey = nextCitekey(citekeyBase(initial.authors, initial.year, initial.title), existing.map((paper) => paper.citekey));
    const dir = this.paperDir(initial); await mkdir(dir, { recursive: true }); await cp(path, join(dir, 'paper.pdf')); initial.pdfPath = join(dir, 'paper.pdf');
    const paragraphs = extracted.paragraphs.map((paragraph) => ({ ...paragraph, paperId: initial.id, id: `${initial.id.slice(0, 8)}-p${paragraph.order}` }));
    await writeFile(join(dir, metaFile), JSON.stringify(initial, null, 2)); await writeFile(join(dir, 'content.json'), JSON.stringify({ source: 'pdf', paragraphs }, null, 2)); await writeFile(join(dir, 'annotations.json'), '[]'); await writeFile(join(dir, 'translation.zh.json'), '{}');
    await this.afterChange(); return { paper: initial, warnings: extracted.warnings };
  }
  async importBibtex(text: string): Promise<ImportResult[]> {
    const existing = await this.list(); const results: ImportResult[] = [];
    for (const parsed of parseBibtex(text)) {
      const id = randomUUID(); const citekey = nextCitekey(parsed.citekey || citekeyBase(parsed.authors, parsed.year, parsed.title), [...existing, ...results.map((result) => result.paper)].map((paper) => paper.citekey));
      const paper: Paper = { id, citekey, title: parsed.title, authors: parsed.authors, year: parsed.year, venue: parsed.venue, doi: parsed.doi, arxivId: parsed.arxivId, abstract: parsed.abstract, url: parsed.url, arxivCategories: [], contentSource: 'none', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString() };
      const dir = this.paperDir(paper); await mkdir(dir, { recursive: true }); await writeFile(join(dir, metaFile), JSON.stringify(paper, null, 2)); await writeFile(join(dir, 'content.json'), JSON.stringify({ source: 'none', paragraphs: [] }, null, 2)); results.push({ paper, warnings: [] });
    }
    if (results.length) await this.afterChange(); return results;
  }
  async importSearchRecord(record: SearchPaper): Promise<ImportResult> {
    const existing = await this.list();
    const duplicate = existing.find((paper) => (record.doi && paper.doi === record.doi) || (record.arxivId && paper.arxivId === record.arxivId) || paper.title.toLowerCase() === record.title.toLowerCase());
    if (duplicate) return { paper: duplicate, warnings: ['该论文已在文献库中。'] };
    const paper: Paper = { id: randomUUID(), citekey: '', title: record.title, authors: record.authors.length ? record.authors : [{ family: 'Unknown' }], year: record.year, venue: record.venue, doi: record.doi, arxivId: record.arxivId, arxivCategories: record.categories ?? [], abstract: record.abstract, url: record.url, contentSource: record.recordedParagraphs?.length ? 'arxiv-html' : 'none', tags: [], collections: [], projects: [], readStatus: 'unread', starred: false, addedAt: new Date().toISOString() };
    paper.citekey = nextCitekey(citekeyBase(paper.authors, paper.year, paper.title), existing.map((item) => item.citekey));
    const dir = this.paperDir(paper); await mkdir(dir, { recursive: true });
    const paragraphs: Paragraph[] = (record.recordedParagraphs ?? []).map((item, order) => ({ id: `${paper.id.slice(0, 8)}-p${order}`, paperId: paper.id, order, type: (item.type as Paragraph['type']) || 'paragraph', html: escapeHtml(item.text), text: item.text, sectionPath: item.sectionPath ?? [] }));
    await writeFile(join(dir, metaFile), JSON.stringify(paper, null, 2)); await writeFile(join(dir, 'content.json'), JSON.stringify({ source: paper.contentSource, paragraphs }, null, 2)); await writeFile(join(dir, 'annotations.json'), '[]'); await writeFile(join(dir, 'translation.zh.json'), '{}');
    await this.afterChange(); return { paper, warnings: record.recordedParagraphs?.length ? [] : ['已入库元数据；此来源尚未提供可获取全文。'] };
  }
  async update(id: string, patch: Partial<Paper>): Promise<Paper> {
    const paper = (await this.list()).find((item) => item.id === id); if (!paper) throw new Error('找不到文献');
    const next = { ...paper, ...patch, id: paper.id, citekey: paper.citekey, addedAt: paper.addedAt };
    await writeFile(join(this.paperDir(paper), metaFile), JSON.stringify(next, null, 2)); await this.afterChange(); return next;
  }
  async changeCitekey(id: string, requested: string): Promise<Paper> {
    const papers = await this.list(); const paper = papers.find((item) => item.id === id); if (!paper) throw new Error('找不到文献');
    const normalized = requested.trim().replace(/[^a-zA-Z0-9:_-]/g, ''); if (!normalized) throw new Error('引用键不能为空');
    if (papers.some((item) => item.id !== id && item.citekey.toLowerCase() === normalized.toLowerCase())) throw new Error('引用键已存在');
    const oldDir = this.paperDir(paper); const next = { ...paper, citekey: normalized };
    await writeFile(join(oldDir, metaFile), JSON.stringify(next, null, 2));
    await replaceCitations(this.root, paper.citekey, normalized); await this.afterChange(); return next;
  }
  async exportBibtex(ids?: string[]): Promise<string> { const papers = await this.list(); return `${papers.filter((paper) => !ids || ids.includes(paper.id)).map(paperToBibtex).join('\n\n')}\n`; }
  private async afterChange(): Promise<void> { await this.writeLibraryBib(); await this.onChanged(); }
  private async writeLibraryBib(): Promise<void> { await writeFile(join(this.root, 'library.bib'), await this.exportBibtex()); }
}

async function replaceCitations(root: string, oldKey: string, newKey: string): Promise<void> {
  const visit = async (dir: string): Promise<void> => { for (const entry of await readdir(dir, { withFileTypes: true })) { if (entry.name === '.index') continue; const file = join(dir, entry.name); if (entry.isDirectory()) await visit(file); else if (/\.(md|json)$/i.test(entry.name)) { const source = await readFile(file, 'utf8'); const next = source.replace(new RegExp(`@${escapeRegExp(oldKey)}(?=\\b|[#,\]])`, 'g'), `@${newKey}`); if (next !== source) await writeFile(file, next); } } };
  await visit(root);
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function extractPdf(path: string): Promise<{ title?: string; authors: Paper['authors']; year?: number; abstract?: string; paragraphs: Paragraph[]; warnings: string[] }> {
  const warnings: string[] = []; let title = ''; let authors: Paper['authors'] = []; let year: number | undefined; let text = '';
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as any; const data = new Uint8Array(await readFile(path)); const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise; const metadata = await doc.getMetadata();
    title = metadata.info?.Title || ''; const authorString = metadata.info?.Author || ''; authors = authorString ? authorString.split(/,|\sand\s/i).map((name: string) => ({ family: name.trim().split(/\s+/).at(-1) || 'Unknown', given: name.trim().split(/\s+/).slice(0, -1).join(' ') })) : [];
    for (let pageNo = 1; pageNo <= Math.min(doc.numPages, 40); pageNo += 1) { const page = await doc.getPage(pageNo); const content = await page.getTextContent(); text += `\n${content.items.map((item: any) => item.str || '').join(' ')}`; }
  } catch (error) { warnings.push(`PDF 文字层解析失败：${error instanceof Error ? error.message : '未知错误'}。已保留原始 PDF，可稍后在原版视图阅读。`); }
  const clean = text.replace(/\s+/g, ' ').trim(); const lines = clean.split(/(?<=[.!?。])\s+/).filter((line) => line.length > 35); if (!title) title = lines[0]?.slice(0, 180) || basename(path, extname(path));
  const yearMatch = clean.match(/\b(19|20)\d{2}\b/); year = yearMatch ? Number(yearMatch[0]) : undefined;
  const abstractMatch = clean.match(/abstract\s*[:.]?\s*(.{80,1300}?)(?=\s+(?:1\.?\s*)?(?:introduction|keywords)\b|$)/i); const abstract = abstractMatch?.[1]?.trim();
  const paperId = randomUUID(); const paragraphs = lines.map((line, order) => ({ id: `${paperId.slice(0, 8)}-p${order}`, paperId, order, type: 'paragraph' as const, html: escapeHtml(line), text: line, sectionPath: [], page: undefined }));
  return { title, authors, year, abstract, paragraphs, warnings };
}
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
