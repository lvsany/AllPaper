export interface ApiReply { ok: boolean; status: number; text: string }

export interface ArxivApiOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** arXiv asks for no more than one API request every three seconds. */
  minGapMs?: number;
  maxRetries?: number;
}

/**
 * Every call to export.arxiv.org goes through one queue: requests are spaced out, and a
 * 429/503 is retried after the server's Retry-After (or an increasing delay) instead of failing.
 */
export function createArxivApi(options: ArxivApiOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const minGap = options.minGapMs ?? 3100;
  const maxRetries = options.maxRetries ?? 3;
  let lastRequestAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function attemptLoop(url: string, onWait?: (message: string) => void): Promise<ApiReply> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = lastRequestAt + minGap - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      let response: Response;
      try {
        response = await doFetch(url, { headers: { 'user-agent': 'AllPaper/0.1 (personal research tool)' }, signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        if (attempt >= maxRetries) throw error;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (response.status !== 429 && response.status !== 503) return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : '' };
      if (attempt >= maxRetries) return { ok: false, status: response.status, text: '' };
      const retryAfter = Number(response.headers.get('retry-after')) || 0;
      const delay = Math.min(60_000, Math.max(retryAfter * 1000, 5000 * 2 ** attempt));
      onWait?.(`arXiv 正在限流，${Math.ceil(delay / 1000)} 秒后自动重试（第 ${attempt + 1}/${maxRetries} 次）…`);
      await sleep(delay);
      lastRequestAt = now();
    }
  }

  return {
    get(url: string, onWait?: (message: string) => void): Promise<ApiReply> {
      const run = () => attemptLoop(url, onWait);
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    }
  };
}

export const arxivApi = createArxivApi();
