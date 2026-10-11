export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface CompleteRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** When set, the response is streamed and each text chunk is passed here. */
  onDelta?: (text: string) => void;
}

export interface Completion { text: string; inputTokens: number; outputTokens: number }

export interface AiProvider {
  readonly name: string;
  complete(request: CompleteRequest): Promise<Completion>;
}

export type AiErrorCode = 'not-configured' | 'auth' | 'rate-limit' | 'network' | 'bad-request' | 'server' | 'aborted';

export class AiError extends Error {
  constructor(message: string, readonly code: AiErrorCode) { super(message); this.name = 'AiError'; }
}

export interface ProviderConfig {
  provider: 'anthropic' | 'openai-compatible' | 'mock';
  baseUrl?: string;
  apiKey?: string;
}

const REQUEST_TIMEOUT_MS = 180_000;

function describeHttpError(status: number, body: string): AiError {
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? parsed.message ?? detail;
  } catch { /* keep raw text */ }
  if (status === 401 || status === 403) return new AiError(`API Key 无效或没有权限（${status}）：${detail}`, 'auth');
  if (status === 429) return new AiError(`请求过于频繁或额度用尽（429）：${detail}`, 'rate-limit');
  if (status === 404) return new AiError(`接口地址或模型名不存在（404）：${detail}`, 'bad-request');
  if (status >= 500) return new AiError(`模型服务暂时不可用（${status}）：${detail}`, 'server');
  return new AiError(`模型服务拒绝了请求（${status}）：${detail}`, 'bad-request');
}

async function post(url: string, init: { headers: Record<string, string>; body: unknown; signal?: AbortSignal }): Promise<Response> {
  let lastError: AiError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (init.signal?.aborted) throw new AiError('已取消', 'aborted');
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...init.headers }, body: JSON.stringify(init.body), signal });
      if (response.ok) return response;
      const error = describeHttpError(response.status, await response.text());
      if (error.code !== 'rate-limit' && error.code !== 'server') throw error;
      lastError = error;
      const wait = Number(response.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
    } catch (error) {
      if (error instanceof AiError) { if (error.code === 'rate-limit' || error.code === 'server') { lastError = error; continue; } throw error; }
      if (init.signal?.aborted) throw new AiError('已取消', 'aborted');
      lastError = new AiError(`无法连接模型服务：${error instanceof Error ? error.message : String(error)}`, 'network');
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError ?? new AiError('模型服务无响应', 'network');
}

/** Yields the `data:` payload of each server-sent event. */
async function* sseEvents(response: Response): AsyncGenerator<{ event?: string; data: string }> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary: number;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const data: string[] = [];
      let event: string | undefined;
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join('\n') };
    }
    if (done) break;
  }
}

const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  constructor(private readonly apiKey: string, baseUrl?: string) {
    this.base = (baseUrl?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  }
  private readonly base: string;

  async complete(request: CompleteRequest): Promise<Completion> {
    const stream = Boolean(request.onDelta);
    const response = await post(`${this.base}/v1/messages`, {
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      signal: request.signal,
      body: { model: request.model, max_tokens: request.maxTokens ?? 4096, system: request.system, messages: request.messages, stream }
    });
    if (!stream) {
      const json = await response.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (json.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
      return { text, inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? estimateTokens(text) };
    }
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const { data } of sseEvents(response)) {
      let event: { type?: string; delta?: { type?: string; text?: string }; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number }; error?: { message?: string } };
      try { event = JSON.parse(data); } catch { continue; }
      if (event.type === 'error') throw new AiError(event.error?.message ?? '模型服务返回错误', 'server');
      if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens ?? 0;
      if (event.type === 'message_delta') outputTokens = event.usage?.output_tokens ?? outputTokens;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        text += event.delta.text;
        request.onDelta?.(event.delta.text);
      }
    }
    return { text, inputTokens, outputTokens: outputTokens || estimateTokens(text) };
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai-compatible';
  private readonly base: string;
  constructor(private readonly apiKey: string, baseUrl?: string) {
    this.base = (baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async complete(request: CompleteRequest): Promise<Completion> {
    const stream = Boolean(request.onDelta);
    const messages = [...(request.system ? [{ role: 'system', content: request.system }] : []), ...request.messages];
    const send = (tokenField: 'max_tokens' | 'max_completion_tokens') => post(`${this.base}/chat/completions`, {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      signal: request.signal,
      body: { model: request.model, messages, [tokenField]: request.maxTokens ?? 4096, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }
    });
    let response: Response;
    try { response = await send('max_tokens'); } catch (error) {
      if (error instanceof AiError && error.code === 'bad-request' && /max_completion_tokens/.test(error.message)) response = await send('max_completion_tokens');
      else throw error;
    }
    if (!stream) {
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = json.choices?.[0]?.message?.content ?? '';
      return { text, inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? estimateTokens(text) };
    }
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const { data } of sseEvents(response)) {
      if (data === '[DONE]') break;
      let chunk: { choices?: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } | null };
      try { chunk = JSON.parse(data); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { text += delta; request.onDelta?.(delta); }
      if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? 0; outputTokens = chunk.usage.completion_tokens ?? 0; }
    }
    return { text, inputTokens, outputTokens: outputTokens || estimateTokens(text) };
  }
}

/**
 * Deterministic stand-in used only by automated tests and when the app is
 * started with ALLPAPER_AI=mock. It never pretends to be a model: every output
 * is prefixed so it cannot be mistaken for a real translation or answer.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock';
  async complete(request: CompleteRequest): Promise<Completion> {
    const last = request.messages.at(-1)?.content ?? '';
    const text = `[mock] ${last.replace(/^（所在章节：[^）]*）\n/, '').slice(0, 400)}`;
    for (const chunk of text.match(/.{1,24}/gs) ?? []) request.onDelta?.(chunk);
    return { text, inputTokens: estimateTokens(last), outputTokens: estimateTokens(text) };
  }
}

export function createProvider(config: ProviderConfig): AiProvider | undefined {
  if (config.provider === 'mock') return new MockProvider();
  if (config.provider === 'anthropic') return config.apiKey ? new AnthropicProvider(config.apiKey, config.baseUrl) : undefined;
  if (config.provider === 'openai-compatible') {
    // Local OpenAI-compatible servers often need no key, but they do need an address.
    return config.apiKey || config.baseUrl?.trim() ? new OpenAiCompatibleProvider(config.apiKey ?? '', config.baseUrl) : undefined;
  }
  return undefined;
}
