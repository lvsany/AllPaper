/**
 * A reading position is the block at the top of the viewport plus how far into it (0..1),
 * stored as `S2.p3.1@0.420`. Unlike a pixel offset it survives font-size and window changes.
 */
export interface ReadingPosition { blockId: string; fraction: number }

export function encodePosition(position: ReadingPosition): string {
  return `${position.blockId}@${Math.min(1, Math.max(0, position.fraction)).toFixed(3)}`;
}

export function decodePosition(value: string | undefined): ReadingPosition | undefined {
  if (!value) return undefined;
  const at = value.lastIndexOf('@');
  if (at < 0) return { blockId: value, fraction: 0 }; // saved by older versions: block id only
  const fraction = Number(value.slice(at + 1));
  return { blockId: value.slice(0, at), fraction: Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0 };
}
