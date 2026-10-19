import { describe, expect, it } from 'vitest';
import { formatAuthors, parseAuthors } from './authors';

describe('author text', () => {
  it('reads both name orders and several separators', () => {
    expect(parseAuthors('Wang, Lin; Chen Yu\nvan der Berg, Anna and Plato')).toEqual([
      { family: 'Wang', given: 'Lin' }, { family: 'Yu', given: 'Chen' }, { family: 'van der Berg', given: 'Anna' }, { family: 'Plato' }
    ]);
    expect(parseAuthors('  ')).toEqual([]);
  });
  it('round trips through the display form', () => {
    const authors = [{ family: 'Wang', given: 'Lin' }, { family: 'Plato' }];
    expect(parseAuthors(formatAuthors(authors))).toEqual(authors);
  });
});
