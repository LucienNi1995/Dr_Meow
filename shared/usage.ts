export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
  reasoning: number;
}

export interface ModelPrice {
  model: string;
  input: number;
  output: number;
  cached: number;
  cacheWrite: number;
}

export interface UsageRecord {
  source: 'meow' | 'claude' | 'codex';
  id: string;
  model: string;
  at: number;
  status: 'running' | 'complete' | 'cancelled' | 'error';
  tokens?: TokenUsage;
}

export interface UsageData {
  records: UsageRecord[];
  prices: ModelPrice[];
  scan: UsageScan;
}

export interface UsageScan {
  enabled: boolean;
  at?: number;
  files: number;
  imported: number;
  skipped: number;
  malformed: number;
  unavailable: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// Missing usage is unknown, never a zero-token request. Reasoning is already
// included in output and cache tokens are already included in input.
export function readTokenUsage(value: unknown): TokenUsage | undefined {
  const usage = record(value);
  if (!count(usage.input_tokens) || !count(usage.output_tokens)) return;
  const input = record(usage.input_tokens_details);
  const output = record(usage.output_tokens_details);
  const cached = input.cached_tokens ?? 0;
  const cacheWrite = input.cache_write_tokens ?? 0;
  const reasoning = output.reasoning_tokens ?? 0;
  if (!count(cached) || !count(cacheWrite) || !count(reasoning) ||
      cached + cacheWrite > usage.input_tokens || reasoning > usage.output_tokens) return;
  return { input: usage.input_tokens, output: usage.output_tokens, cached, cacheWrite, reasoning };
}

export function validPrice(value: unknown): value is ModelPrice {
  const price = record(value);
  return typeof price.model === 'string' && price.model.trim() === price.model &&
    price.model.length > 0 && price.model.length <= 180 &&
    ['input', 'output', 'cached', 'cacheWrite'].every(key =>
      typeof price[key] === 'number' && Number.isFinite(price[key]) && price[key] >= 0 && price[key] <= 1_000_000);
}

export function estimatedCost(tokens: TokenUsage | undefined, price: ModelPrice | undefined): number | undefined {
  if (!tokens || !price) return;
  return ((tokens.input - tokens.cached - tokens.cacheWrite) * price.input +
    tokens.cached * price.cached + tokens.cacheWrite * price.cacheWrite + tokens.output * price.output) / 1_000_000;
}

export function summarizeUsage(records: UsageRecord[], prices: ModelPrice[]) {
  const rates = new Map(prices.map(price => [price.model, price]));
  let input = 0, output = 0, cached = 0, cacheWrite = 0, reasoning = 0, cost = 0, unpriced = 0, unknown = 0;
  for (const row of records) {
    if (!row.tokens) { unknown++; continue; }
    input += row.tokens.input;
    output += row.tokens.output;
    cached += row.tokens.cached;
    cacheWrite += row.tokens.cacheWrite;
    reasoning += row.tokens.reasoning;
    const amount = estimatedCost(row.tokens, rates.get(row.model));
    if (amount === undefined) unpriced++;
    else cost += amount;
  }
  return { requests: records.length, input, output, cached, cacheWrite, reasoning, cost, unpriced, unknown };
}
