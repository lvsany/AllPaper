import { describe, expect, it } from 'vitest';
import { decodePosition, encodePosition } from './reading-position';

describe('reading position', () => {
  it('round trips a block and how far into it', () => {
    expect(decodePosition(encodePosition({ blockId: 'S2.p3.1', fraction: 0.4204 }))).toEqual({ blockId: 'S2.p3.1', fraction: 0.42 });
    expect(encodePosition({ blockId: 'x', fraction: 3 })).toBe('x@1.000');
  });
  it('reads positions saved by older versions and ignores junk', () => {
    expect(decodePosition('S1.p1.1')).toEqual({ blockId: 'S1.p1.1', fraction: 0 });
    expect(decodePosition('b12@abc')).toEqual({ blockId: 'b12', fraction: 0 });
    expect(decodePosition(undefined)).toBeUndefined();
  });
});
