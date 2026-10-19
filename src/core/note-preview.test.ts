import { describe, expect, it } from 'vitest';
import { notePreview, relativeTime } from './note-preview';

describe('note list helpers', () => {
  it('previews the plain text of a note', () => {
    expect(notePreview('# 标题\n\n- 第一条 **重点**\n> 引文 [@k#a1]\n- [ ] 待办')).toBe('标题 第一条 重点 引文 待办');
    expect(notePreview('')).toBe('');
    expect(notePreview('x'.repeat(200), 10)).toBe('xxxxxxxxxx…');
  });
  it('words a last-edited time', () => {
    const now = new Date('2026-10-19T12:00:00Z').getTime();
    expect(relativeTime('2026-10-19T11:59:40Z', now)).toBe('刚刚');
    expect(relativeTime('2026-10-19T11:30:00Z', now)).toBe('30 分钟前');
    expect(relativeTime('2026-10-19T07:00:00Z', now)).toBe('5 小时前');
    expect(relativeTime('2026-10-18T09:00:00Z', now)).toBe('昨天');
    expect(relativeTime('2026-10-15T09:00:00Z', now)).toBe('4 天前');
    expect(relativeTime('2026-09-01T09:00:00Z', now)).toBe('09-01');
    expect(relativeTime('2025-09-01T09:00:00Z', now)).toBe('2025-09-01');
  });
});
