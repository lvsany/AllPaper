import { describe, expect, it } from 'vitest';
import { createArxivApi } from './arxiv-api';

const reply = (status: number, body = '', headers: Record<string, string> = {}) => new Response(body, { status, headers });

function harness(responses: Response[]) {
  const sleeps: number[] = [];
  const times: number[] = [];
  let clock = 0;
  const api = createArxivApi({
    fetchImpl: (async () => { times.push(clock); return responses.shift() ?? reply(500); }) as unknown as typeof fetch,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    now: () => clock
  });
  return { api, sleeps, times };
}

describe('arXiv API client', () => {
  it('retries a 429 after the server asked and then succeeds', async () => {
    const h = harness([reply(429, '', { 'retry-after': '7' }), reply(429), reply(200, '<feed/>')]);
    const notes: string[] = [];
    const result = await h.api.get('https://export.arxiv.org/api/query?id_list=1', (m) => notes.push(m));
    expect(result).toEqual({ ok: true, status: 200, text: '<feed/>' });
    expect(h.sleeps).toContain(7000); // honours Retry-After
    expect(h.sleeps).toContain(10_000); // then backs off
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('限流');
  });

  it('spaces consecutive requests at least three seconds apart', async () => {
    const h = harness([reply(200, 'a'), reply(200, 'b'), reply(200, 'c')]);
    await Promise.all([h.api.get('u1'), h.api.get('u2'), h.api.get('u3')]);
    expect(h.times[1] - h.times[0]).toBeGreaterThanOrEqual(3000);
    expect(h.times[2] - h.times[1]).toBeGreaterThanOrEqual(3000);
  });

  it('gives up with the status after the retries are used', async () => {
    const h = harness([reply(429), reply(429), reply(429), reply(429)]);
    expect(await h.api.get('u')).toEqual({ ok: false, status: 429, text: '' });
  });

  it('does not retry other errors', async () => {
    const h = harness([reply(404)]);
    expect(await h.api.get('u')).toEqual({ ok: false, status: 404, text: '' });
    expect(h.times).toHaveLength(1);
  });
});
