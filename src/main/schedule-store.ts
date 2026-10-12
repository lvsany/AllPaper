import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeEvents, type ScheduleEvent } from '../core/schedule';

/** The schedule is one small JSON file in the library, so it travels with the papers and notes. */
export class ScheduleStore {
  constructor(private readonly root: string) {}
  private get file() { return join(this.root, 'schedule.json'); }

  async list(): Promise<ScheduleEvent[]> {
    try { return sanitizeEvents(JSON.parse(await readFile(this.file, 'utf8')).events); } catch { return []; }
  }

  async save(events: unknown): Promise<ScheduleEvent[]> {
    const clean = sanitizeEvents(events);
    await writeFile(this.file, JSON.stringify({ version: 1, events: clean }, null, 2));
    return clean;
  }
}
