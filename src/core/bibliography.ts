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
interface RawEntry { type: string; key: string; fields: Map<string, string> }

/** Index just past the brace that closes the one opened at `open`. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return text.length;
}

const cleanValue = (value: string) => value
  .replace(/\\[&%$#_]/g, (m) => m[1]).replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}~]/g, (m) => m === '~' ? ' ' : '').replace(/\s+/g, ' ').trim();

function readFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const name = body.slice(i).match(/^[\s,]*([A-Za-z][\w-]*)\s*=\s*/);
    if (!name) { i += 1; continue; }
    i += name[0].length;
    let value = '';
    if (body[i] === '{') {
      const end = closeOf(body, i);
      value = body.slice(i + 1, end - 1);
      i = end;
    } else if (body[i] === '"') {
      let j = i + 1;
      let depth = 0;
      for (; j < body.length; j += 1) {
        if (body[j] === '\\') { j += 1; continue; }
        if (body[j] === '{') depth += 1;
        else if (body[j] === '}') depth -= 1;
        else if (body[j] === '"' && depth === 0) break;
      }
      value = body.slice(i + 1, j);
      i = j + 1;
    } else {
      const bare = body.slice(i).match(/^[^,\s}]+/);
      value = bare?.[0] ?? '';
      i += value.length;
    }
    fields.set(name[1].toLowerCase(), cleanValue(value));
  }
  return fields;
}

function readEntries(input: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const start = /@([A-Za-z]+)\s*[{(]/g;
  for (let match = start.exec(input); match; match = start.exec(input)) {
    const open = match.index + match[0].length - 1;
    const end = closeOf(input, open);
    start.lastIndex = end;
    if (/^(comment|string|preamble)$/i.test(match[1])) continue;
    const body = input.slice(open + 1, end - 1);
    const comma = body.indexOf(',');
    if (comma < 0) continue;
    entries.push({ type: match[1].toLowerCase(), key: body.slice(0, comma).trim(), fields: readFields(body.slice(comma + 1)) });
  }
  return entries;
}

export function parseBibtex(input: string): Array<Partial<Paper> & { title: string; authors: Author[] }> {
  const items: Array<Partial<Paper> & { title: string; authors: Author[] }> = [];
  for (const { key, fields } of readEntries(input)) {
    const title = fields.get('title');
    if (!title) continue;
    const authors = (fields.get('author') ?? 'Unknown').split(/\s+and\s+/i).map((full) => {
      const [family, given] = full.includes(',')
        ? full.split(',').map((part) => part.trim())
        : [full.trim().split(/\s+/).at(-1) || full.trim(), full.trim().split(/\s+/).slice(0, -1).join(' ')];
      return { family, given };
    });
    const year = Number(fields.get('year') ?? fields.get('date')?.slice(0, 4));
    const prefix = fields.get('archiveprefix') ?? fields.get('eprinttype');
    const eprint = fields.get('eprint');
    items.push({
      title, authors, citekey: key, year: Number.isFinite(year) && year > 0 ? year : undefined,
      venue: fields.get('journal') ?? fields.get('booktitle') ?? fields.get('journaltitle') ?? fields.get('publisher'),
      doi: fields.get('doi'), arxivId: eprint && (!prefix || /arxiv/i.test(prefix)) ? eprint : undefined,
      url: fields.get('url'), abstract: fields.get('abstract')
    });
  }
  return items;
}
