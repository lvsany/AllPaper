/**
 * Undo/redo for a document whose state is replaced as a whole. Call `record` with the state *before* each user
 * change; consecutive changes with the same key (typing in one place) within `groupMs` form a single step.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | undefined;
  private lastAt = 0;

  constructor(private readonly limit = 200, private readonly groupMs = 1000, private readonly now: () => number = Date.now) {}

  record(before: T, key?: string): void {
    const at = this.now();
    const grouped = key !== undefined && key === this.lastKey && at - this.lastAt < this.groupMs;
    this.lastKey = key;
    this.lastAt = at;
    if (grouped) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    this.lastKey = undefined;
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = undefined;
    return next;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}
