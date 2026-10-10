import { ChartError } from './errors.ts';
import { INTERVAL_MS } from './types.ts';
import type { FeedAdapter, Interval } from './types.ts';

/** A widget catalog entry. The adapter owns asynchronous loading and connection. */
export interface WidgetMarketSource {
  id: string;
  label: string;
  symbols: readonly string[];
  intervals: readonly Interval[];
  createFeed(selection: { symbol: string; interval: Interval }): FeedAdapter;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isInterval = (value: unknown): value is Interval =>
  typeof value === 'string' && Object.hasOwn(INTERVAL_MS, value);

/** Empty catalogs are valid for fixed-market widgets. Factories are never invoked here. */
export function validateMarketSources(sources: readonly WidgetMarketSource[]): void {
  if (!Array.isArray(sources)) throw new ChartError('INVALID_MARKET_SOURCES');
  const ids = new Set<string>();
  for (const source of sources) {
    if (
      !source ||
      typeof source !== 'object' ||
      !nonempty(source.id) ||
      !nonempty(source.label) ||
      typeof source.createFeed !== 'function' ||
      !Array.isArray(source.symbols) ||
      !source.symbols.length ||
      !source.symbols.every(nonempty) ||
      new Set(source.symbols).size !== source.symbols.length ||
      !Array.isArray(source.intervals) ||
      !source.intervals.length ||
      !source.intervals.every(isInterval) ||
      new Set(source.intervals).size !== source.intervals.length
    )
      throw new ChartError('INVALID_MARKET_SOURCE');
    if (ids.has(source.id)) throw new ChartError('DUPLICATE_MARKET_SOURCE');
    ids.add(source.id);
  }
}

/** Resolves a disconnected feed. Callers replace the active feed only after this succeeds. */
export function resolveMarketFeed(
  source: WidgetMarketSource,
  selection: { symbol: string; interval: Interval },
): FeedAdapter {
  validateMarketSources([source]);
  if (
    !selection ||
    !source.symbols.includes(selection.symbol) ||
    !source.intervals.includes(selection.interval)
  )
    throw new ChartError('UNSUPPORTED_MARKET_SELECTION');
  const { symbol, interval } = selection,
    sourceId = source.id;
  // Pass an owned selection so factory code cannot change the caller's request.
  const feed = source.createFeed({ symbol, interval });
  if (!feed || typeof feed !== 'object' || typeof feed.connect !== 'function' || !feed.descriptor)
    throw new ChartError('INVALID_MARKET_FEED');
  const descriptor = feed.descriptor;
  if (
    descriptor.id !== sourceId ||
    descriptor.instrument?.symbol !== symbol ||
    descriptor.interval !== interval ||
    descriptor.intervalMs !== INTERVAL_MS[interval]
  )
    throw new ChartError('MARKET_FEED_MISMATCH');
  return feed;
}
