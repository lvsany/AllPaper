import type { Author, Paper } from '../shared/types';

const ignored = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'in', 'on', 'with', 'to', 'from', 'by', 'via']);
export function normalizeText(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function slugify(value: string): string { return normalizeText(value).replace(/\s+/g, '-').slice(0, 80) || 'paper'; }
export function citekeyBase(authors: Author[], year: number | undefined, title: string): string {
  const family = normalizeText(authors[0]?.family || 'unknown').replace(/\s/g, '') || 'unknown';
  const word = normalizeText(title).split(' ').find((item) => item && !ignored.has(item)) || 'paper';
  return `${family}${year ?? 'nd'}${word}`;
}
export function nextCitekey(base: string, existing: Iterable<string>): string {
  const used = new Set([...existing].map((key) => key.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 1; i <= 676; i += 1) { let value = i; let suffix = ''; while (value > 0) { value -= 1; suffix = String.fromCharCode(97 + (value % 26)) + suffix; value = Math.floor(value / 26); } const candidate = `${base}${suffix}`; if (!used.has(candidate.toLowerCase())) return candidate; }
  throw new Error('引用键冲突过多');
}
function escapeBib(value: string | undefined): string { return (value ?? '').replace(/[{}]/g, (item) => `\\${item}`).replace(/\n/g, ' '); }
export function paperToBibtex(paper: Paper): string {
  const fields: Array<[string, string | undefined]> = [
    ['title', paper.title], ['author', paper.authors.map((a) => a.given ? `${a.family}, ${a.given}` : a.family).join(' and ')],
    ['year', paper.year?.toString()], ['journal', paper.venue], ['doi', paper.doi], ['eprint', paper.arxivId], ['archivePrefix', paper.arxivId ? 'arXiv' : undefined], ['url', paper.url]
  ];
  return `@article{${paper.citekey},\n${fields.filter(([, value]) => value).map(([key, value]) => `  ${key} = {${escapeBib(value)}}`).join(',\n')}\n}`;
}
export function parseBibtex(input: string): Array<Partial<Paper> & { title: string; authors: Author[] }> {
  const items: Array<Partial<Paper> & { title: string; authors: Author[] }> = [];
  const entries = input.matchAll(/@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g);
  for (const match of entries) {
    const fields = new Map<string, string>();
    for (const field of match[3].matchAll(/(\w+)\s*=\s*[{"]([\s\S]*?)[}"]\s*,?/g)) fields.set(field[1].toLowerCase(), field[2].replace(/\s+/g, ' ').trim());
    const title = fields.get('title'); if (!title) continue;
    const authors = (fields.get('author') ?? 'Unknown').split(/\s+and\s+/i).map((full) => { const [family, given] = full.includes(',') ? full.split(',').map((part) => part.trim()) : [full.trim().split(/\s+/).at(-1) || full.trim(), full.trim().split(/\s+/).slice(0, -1).join(' ')]; return { family, given }; });
    const year = Number(fields.get('year')); const eprint = fields.get('eprint');
    items.push({ title: title.replace(/[{}]/g, ''), authors, citekey: match[2].trim(), year: Number.isFinite(year) ? year : undefined, venue: fields.get('journal') ?? fields.get('booktitle'), doi: fields.get('doi'), arxivId: eprint, url: fields.get('url'), abstract: fields.get('abstract') });
  }
  return items;
}
