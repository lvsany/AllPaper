export type EventKind = 'deadline' | 'reading' | 'experiment' | 'meeting' | 'other';

export interface ScheduleEvent {
  id: string;
  title: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Optional local time, `HH:MM`; events without one are all-day. */
  time?: string;
  kind: EventKind;
  notes?: string;
  done: boolean;
  projectId?: string;
}

export const EVENT_KINDS: ReadonlyArray<{ id: EventKind; label: string }> = [
  { id: 'deadline', label: '截止' },
  { id: 'reading', label: '阅读' },
  { id: 'experiment', label: '实验' },
  { id: 'meeting', label: '会议' },
  { id: 'other', label: '其他' }
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number) => String(n).padStart(2, '0');

export const toDateKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000);

export const weekdayOf = (key: string): string => WEEKDAYS[parseDateKey(key).getDay()];

export function compareEvents(a: ScheduleEvent, b: ScheduleEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.time ?? '';
  const tb = b.time ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1; // all-day first, then by time
  return a.title.localeCompare(b.title, 'zh');
}

export function eventsByDate(events: ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const map = new Map<string, ScheduleEvent[]>();
  for (const event of [...events].sort(compareEvents)) {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  return map;
}

export function relativeLabel(key: string, today: string): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
}

export interface Agenda {
  /** Unfinished events before today. */
  overdue: ScheduleEvent[];
  /** Unfinished events from today on, grouped by date. */
  groups: Array<{ date: string; events: ScheduleEvent[] }>;
  /** Finished events, most recent first. */
  done: ScheduleEvent[];
}

export function agenda(events: ScheduleEvent[], today: string): Agenda {
  const sorted = [...events].sort(compareEvents);
  return {
    overdue: sorted.filter((e) => !e.done && e.date < today),
    groups: [...eventsByDate(sorted.filter((e) => !e.done && e.date >= today))].map(([date, list]) => ({ date, events: list })),
    done: sorted.filter((e) => e.done).reverse()
  };
}

export function isOverdue(event: ScheduleEvent, today: string): boolean {
  return !event.done && event.date < today;
}

const KINDS = new Set<string>(EVENT_KINDS.map((k) => k.id));

/** Drops anything that is not a well-formed event, e.g. from a hand-edited file. */
export function sanitizeEvents(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) return [];
  const events: ScheduleEvent[] = [];
  for (const raw of value) {
    const item = raw as Partial<ScheduleEvent> | null;
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '')) continue;
    events.push({
      id: item.id, title: item.title, date: item.date!,
      time: typeof item.time === 'string' && /^\d{2}:\d{2}$/.test(item.time) ? item.time : undefined,
      kind: KINDS.has(item.kind ?? '') ? item.kind! : 'other',
      notes: typeof item.notes === 'string' ? item.notes : undefined,
      done: Boolean(item.done),
      projectId: typeof item.projectId === 'string' ? item.projectId : undefined
    });
  }
  return events;
}
