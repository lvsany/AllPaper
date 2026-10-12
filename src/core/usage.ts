export interface TaskUsage { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number }

/** 950 → "950", 12 340 → "12.3k", 1 250 000 → "1.25M". */
export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 2 : count < 100_000 ? 1 : 0).replace(/\.?0+$/, '')}k`;
  return `${(count / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

export function totalUsage(byTask: Record<string, TaskUsage>): { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number } {
  const total = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  for (const item of Object.values(byTask)) {
    total.calls += item.calls;
    total.inputTokens += item.inputTokens;
    total.outputTokens += item.outputTokens;
    total.estimatedCost += item.estimatedCost;
  }
  return total;
}

/** `CA$0.42`; very small amounts show as `<CA$0.01` rather than a misleading zero. */
export function formatMoney(amount: number, currency: string): string {
  if (amount > 0 && amount < 0.01) return `<${currency}0.01`;
  return `${currency}${amount.toFixed(2)}`;
}

export type ModelTier = 'translate' | 'write' | 'reason';
export interface TierPrice { input: number; output: number }
export type Prices = Record<ModelTier, TierPrice>;

export const EMPTY_PRICES: Prices = {
  translate: { input: 0, output: 0 }, write: { input: 0, output: 0 }, reason: { input: 0, output: 0 }
};

/** Which model setting each recorded task is billed against. */
const TASK_TIER: Record<string, ModelTier> = {
  '阅读翻译': 'translate', '划词翻译': 'translate',
  '论文问答': 'write', '划词解释': 'write', '检索改写': 'write', '双栏写作翻译': 'write',
  '点子扩展': 'reason', '预实验设计': 'reason'
};
export const tierOfTask = (task: string): ModelTier => TASK_TIER[task] ?? 'write';

export const isPriced = (prices: Prices): boolean => Object.values(prices).some((p) => p.input > 0 || p.output > 0);

/** Spend for the month, computed from token counts and the prices set now. */
export function costOf(byTask: Record<string, TaskUsage>, prices: Prices): number {
  let cost = 0;
  for (const [task, item] of Object.entries(byTask)) {
    const price = prices[tierOfTask(task)] ?? EMPTY_PRICES.write;
    cost += (item.inputTokens * price.input + item.outputTokens * price.output) / 1_000_000;
  }
  return cost;
}

export const taskCost = (task: string, item: TaskUsage, prices: Prices): number =>
  costOf({ [task]: item }, prices);
