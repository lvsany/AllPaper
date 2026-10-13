import type { Author } from '../shared/types';

export interface ArxivRef { id: string; version?: string }

const NEW_STYLE = String.raw`\d{4}\.\d{4,5}`;
const OLD_STYLE = String.raw`[a-z][a-z-]*(?:\.[A-Z]{2})?/\d{7}`;
const ID = `(?:${NEW_STYLE}|${OLD_STYLE})`;

/** Accepts bare ids, `arXiv:` ids and arxiv.org / ar5iv abs, html and pdf links. */
export function parseArxivId(input: string): ArxivRef | undefined {
  const text = input.trim();
  const patterns = [
    new RegExp(`(?:arxiv\\.org|ar5iv(?:\\.labs\\.arxiv)?\\.org)/(?:abs|html|pdf)/(${ID})(v\\d+)?(?:\\.pdf)?`, 'i'),
    new RegExp(`^arxiv:\\s*(${ID})(v\\d+)?$`, 'i'),
    new RegExp(`^(${ID})(v\\d+)?$`)
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { id: match[1], version: match[2]?.toLowerCase() };
  }
  return undefined;
}

export function extractDoi(input: string): string | undefined {
  const match = input.trim().match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  return match?.[1].replace(/[.,;]+$/, '');
}

export interface ArxivMetadata {
  id: string; version?: string; title: string; authors: Author[]; abstract: string; year?: number;
  categories: string[]; doi?: string; journalRef?: string; comment?: string;
}

const decode = (value: string) => value
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');

export function splitName(name: string): Author {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? { given: parts.slice(0, -1).join(' '), family: parts.at(-1)! } : { family: parts[0] ?? 'Unknown' };
}

function parseEntry(entry: string): ArxivMetadata | undefined {
  const take = (tag: string) => {
    const value = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
    return value === undefined ? undefined : decode(value.replace(/\s+/g, ' ').trim());
  };
  const ref = parseArxivId(take('id') ?? '');
  const title = take('title');
  if (!ref || !title) return undefined;
  return {
    id: ref.id, version: ref.version, title,
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => splitName(decode(m[1]))),
    abstract: take('summary') ?? '',
    year: Number((take('published') ?? '').slice(0, 4)) || undefined,
    categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]),
    doi: take('arxiv:doi'), journalRef: take('arxiv:journal_ref'), comment: take('arxiv:comment')
  };
}

export function parseArxivFeed(xml: string): ArxivMetadata[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => parseEntry(m[1])).filter((m): m is ArxivMetadata => Boolean(m));
}

export function parseArxivAtom(xml: string): ArxivMetadata | undefined {
  return parseArxivFeed(xml)[0];
}

/** The arXiv paper a bibliography entry points at, from `eprint`, a link or an arXiv-issued DOI. */
export function arxivRefOf(fields: { arxivId?: string; url?: string; doi?: string }): ArxivRef | undefined {
  for (const value of [fields.arxivId, fields.url]) {
    const ref = value ? parseArxivId(value) : undefined;
    if (ref) return ref;
  }
  const issued = fields.doi?.match(/10\.48550\/arxiv\.(.+)$/i);
  return issued ? parseArxivId(issued[1]) : undefined;
}

const metaValues = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<meta name="${name}" content="([^"]*)"`, 'g'))].map((m) => decode(m[1]).replace(/\s+/g, ' ').trim());

/**
 * Metadata from an arxiv.org/abs page. Used when the export API is rate limited:
 * the abs page carries the same title, authors, abstract and subjects.
 */
export function parseArxivAbsPage(html: string): ArxivMetadata | undefined {
  const title = metaValues(html, 'citation_title')[0];
  const ref = parseArxivId(metaValues(html, 'citation_arxiv_id')[0] ?? '');
  if (!title || !ref) return undefined;
  const authors = metaValues(html, 'citation_author').map((full) => {
    const [family, given] = full.includes(',') ? full.split(',').map((part) => part.trim()) : [full.split(/\s+/).at(-1) ?? full, full.split(/\s+/).slice(0, -1).join(' ')];
    return { family, given: given || undefined };
  });
  const subjects = html.match(/class="tablecell subjects">([\s\S]*?)<\/td>/)?.[1] ?? '';
  const comment = html.match(/<td class="tablecell comments[^>]*>([\s\S]*?)<\/td>/)?.[1];
  return {
    id: ref.id, version: undefined, title, authors,
    abstract: metaValues(html, 'citation_abstract')[0] ?? '',
    year: Number((metaValues(html, 'citation_date')[0] ?? '').slice(0, 4)) || undefined,
    categories: [...subjects.matchAll(/\(([a-z-]+(?:\.[A-Za-z-]+)?)\)/g)].map((m) => m[1]),
    doi: metaValues(html, 'citation_doi')[0],
    comment: comment ? decode(comment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()) : undefined
  };
}
