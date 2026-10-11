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

export function parseArxivAtom(xml: string): ArxivMetadata | undefined {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return undefined;
  const take = (tag: string) => {
    const value = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
    return value === undefined ? undefined : decode(value.replace(/\s+/g, ' ').trim());
  };
  const url = take('id') ?? '';
  const ref = parseArxivId(url);
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
