import { describe, expect, it } from 'vitest';
import { costOf, EMPTY_PRICES, formatMoney, formatTokens, isPriced, totalUsage } from './usage';

describe('token usage', () => {
  it('formats counts compactly', () => {
    expect([0, 950, 1000, 1234, 12_340, 123_456, 1_250_000, 10_000_000].map(formatTokens)).toEqual(['0', '950', '1k', '1.23k', '12.3k', '123k', '1.25M', '10M']);
  });
  it('sums all tasks', () => {
    expect(totalUsage({ a: { calls: 2, inputTokens: 10, outputTokens: 5, estimatedCost: 0.5 }, b: { calls: 1, inputTokens: 1, outputTokens: 1, estimatedCost: 0.25 } }))
      .toEqual({ calls: 3, inputTokens: 11, outputTokens: 6, estimatedCost: 0.75 });
  });
  it('formats money in the chosen currency', () => {
    expect(formatMoney(0.4212, 'CA$')).toBe('CA$0.42');
    expect(formatMoney(0.003, 'CA$')).toBe('<CA$0.01');
    expect(formatMoney(0, '¥')).toBe('¥0.00');
  });
  it('prices each task against its own model tier', () => {
    const byTask = {
      '阅读翻译': { calls: 10, inputTokens: 1_000_000, outputTokens: 500_000, estimatedCost: 0 },
      '论文问答': { calls: 2, inputTokens: 200_000, outputTokens: 10_000, estimatedCost: 0 },
      '预实验设计': { calls: 1, inputTokens: 100_000, outputTokens: 20_000, estimatedCost: 0 }
    };
    const prices = { translate: { input: 1, output: 5 }, write: { input: 3, output: 15 }, reason: { input: 15, output: 75 } };
    // 1*1 + 0.5*5  +  0.2*3 + 0.01*15  +  0.1*15 + 0.02*75
    expect(costOf(byTask, prices)).toBeCloseTo(3.5 + 0.75 + 3, 6);
    expect(isPriced(EMPTY_PRICES)).toBe(false);
    expect(isPriced(prices)).toBe(true);
  });
});
