import type { DraftBlock } from '../core/draft';

export interface Project {
  id: string;
  /** Also the title of the project's note. */
  name: string;
  createdAt: string;
  /** Last time the note was saved. */
  updatedAt?: string;
  preview?: string;
}

export interface DraftDocument {
  id: string;
  blocks: DraftBlock[];
  storyline: Record<string, string>;
  outline: Array<{ id: string; title: string; points: string[] }>;
}
