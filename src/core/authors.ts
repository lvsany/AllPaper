import type { Author } from '../shared/types';
import { splitName } from './arxiv-id';

/** "Wang, Lin; Chen Yu" / one per line / "A and B"  ->  authors. */
export function parseAuthors(text: string): Author[] {
  return text.split(/\n|;|\s+and\s+/i).map((part) => part.trim()).filter(Boolean).map((part) => {
    if (part.includes(',')) {
      const [family, given] = part.split(',').map((x) => x.trim());
      return { family, ...(given ? { given } : {}) };
    }
    return splitName(part);
  });
}

export const formatAuthors = (authors: Author[]): string =>
  authors.map((a) => a.given ? `${a.family}, ${a.given}` : a.family).join('; ');
