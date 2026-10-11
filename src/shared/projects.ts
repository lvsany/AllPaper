import type { DraftBlock } from '../core/draft';

export interface Project { id: string; name: string; createdAt: string }

export interface DraftDocument {
  id: string;
  blocks: DraftBlock[];
  storyline: Record<string, string>;
  outline: Array<{ id: string; title: string; points: string[] }>;
}
