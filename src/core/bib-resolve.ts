import type { Author } from '../shared/types';

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (value: string) => new Set(normalize(value).split(' ').filter((t) => t.length > 1));

/** Jaccard similarity of the word sets of two titles, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface WorkLike { title: string; authors: Author[]; year?: number }

/**
 * Whether an arXiv search hit is the work a bibliography entry describes.
 * Strict on purpose: attaching the wrong paper's full text is worse than leaving metadata only.
 */
export function isSameWork(entry: WorkLike, candidate: WorkLike): boolean {
  if (titleSimilarity(entry.title, candidate.title) < 0.85) return false;
  const a = entry.authors[0]?.family;
  const b = candidate.authors[0]?.family;
  if (a && b && a !== 'Unknown' && normalize(a) !== normalize(b)) return false;
  if (entry.year && candidate.year && Math.abs(entry.year - candidate.year) > 3) return false;
  return true;
}

/** Same paper already in the library (by DOI, arXiv id or title)? */
export function isDuplicate(entry: { doi?: string; arxivId?: string; title: string }, other: { doi?: string; arxivId?: string; title: string }): boolean {
  if (entry.doi && other.doi && entry.doi.toLowerCase() === other.doi.toLowerCase()) return true;
  if (entry.arxivId && other.arxivId && entry.arxivId.replace(/v\d+$/, '') === other.arxivId.replace(/v\d+$/, '')) return true;
  return normalize(entry.title) === normalize(other.title);
}
