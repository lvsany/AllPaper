import { describe, expect, it } from 'vitest';
import { addDays, agenda, daysBetween, eventsByDate, relativeLabel, sanitizeEvents, toDateKey, type ScheduleEvent } from './schedule';

const ev = (id: string, date: string, extra: Partial<ScheduleEvent> = {}): ScheduleEvent => ({ id, title: id, date, kind: 'other', done: false, ...extra });

describe('schedule helpers', () => {
  it('does date arithmetic on local calendar days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-11', '2026-12-31')).toBe(81);
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(relativeLabel('2026-10-12', '2026-10-11')).toBe('明天');
    expect(relativeLabel('2026-10-08', '2026-10-11')).toBe('3 天前');
  });

  it('orders a day with all-day events first, then by time', () => {
    const map = eventsByDate([ev('b', '2026-10-11', { time: '15:00' }), ev('a', '2026-10-11', { time: '09:30' }), ev('c', '2026-10-11')]);
    expect(map.get('2026-10-11')!.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('separates overdue, upcoming and finished events', () => {
    const events = [ev('late', '2026-10-01'), ev('lateDone', '2026-10-02', { done: true }), ev('today', '2026-10-11'), ev('soon', '2026-10-15'), ev('far', '2027-01-01')];
    const result = agenda(events, '2026-10-11');
    expect(result.overdue.map((e) => e.id)).toEqual(['late']);
    expect(result.groups.map((g) => g.date)).toEqual(['2026-10-11', '2026-10-15', '2027-01-01']);
    expect(result.done.map((e) => e.id)).toEqual(['lateDone']);
  });

  it('discards malformed entries when loading a file', () => {
    const loaded = sanitizeEvents([{ id: '1', title: 'ok', date: '2026-10-11', time: '9:5', kind: 'x' }, { id: 2 }, null, { id: '3', title: 't', date: 'bad' }]);
    expect(loaded).toEqual([{ id: '1', title: 'ok', date: '2026-10-11', time: undefined, kind: 'other', notes: undefined, done: false, projectId: undefined }]);
  });
});
