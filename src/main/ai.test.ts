import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, AnthropicProvider, OpenAiCompatibleProvider, createProvider } from './ai';

let server: Server;
let base: string;
const seen: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: any }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      if (req.headers['x-api-key'] === 'bad' || req.headers.authorization === 'Bearer bad') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid x-api-key' } }));
        return;
      }
      if (req.url === '/v1/messages') {
        if (!body.stream) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ content: [{ type: 'text', text: '你好' }], usage: { input_tokens: 11, output_tokens: 3 } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 21 } } })}\n\n`);
        for (const piece of ['你', '好', '世界']) res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: piece } })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 4 } })}\n\n`);
        res.end();
        return;
      }
      if (req.url === '/v1/chat/completions') {
        if (!body.stream) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const piece of ['a', 'b']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 2 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('model providers', () => {
  it('sends Anthropic requests with the key header and reads usage', async () => {
    const provider = new AnthropicProvider('sk-test', base);
    const result = await provider.complete({ model: 'claude-haiku-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toEqual({ text: '你好', inputTokens: 11, outputTokens: 3 });
    const sent = seen.at(-1)!;
    expect(sent.headers['x-api-key']).toBe('sk-test');
    expect(sent.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent.body).toMatchObject({ model: 'claude-haiku-5-5', system: 'sys', stream: false });
  });

  it('streams Anthropic text deltas', async () => {
    const chunks: string[] = [];
    const result = await new AnthropicProvider('sk-test', `${base}/v1`).complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], onDelta: (t) => chunks.push(t) });
    expect(chunks).toEqual(['你', '好', '世界']);
    expect(result).toEqual({ text: '你好世界', inputTokens: 21, outputTokens: 4 });
  });

  it('talks to OpenAI-compatible servers, streaming and not', async () => {
    const provider = new OpenAiCompatibleProvider('k', `${base}/v1`);
    expect((await provider.complete({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] })).text).toBe('ok');
    expect(seen.at(-1)!.body.messages[0]).toEqual({ role: 'system', content: 's' });
    const chunks: string[] = [];
    const streamed = await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'x' }], onDelta: (t) => chunks.push(t) });
    expect(chunks.join('')).toBe('ab');
    expect(streamed).toMatchObject({ inputTokens: 8, outputTokens: 2 });
  });

  it('reports a rejected key as an auth error', async () => {
    await expect(new AnthropicProvider('bad', base).complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toMatchObject({ code: 'auth' });
    await expect(new AnthropicProvider('bad', base).complete({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toBeInstanceOf(AiError);
  });

  it('is not configured without a key', () => {
    expect(createProvider({ provider: 'anthropic' })).toBeUndefined();
    expect(createProvider({ provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' })).toBeDefined();
  });
});
