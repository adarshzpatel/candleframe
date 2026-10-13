import { ChartError } from './errors.ts';
import { intervalToMs, isInterval, parseInterval, type IntervalSpec } from './intervals.ts';
import type { FeedAdapter, Interval } from './types.ts';

/** A widget catalog entry. The adapter owns asynchronous loading and connection. */
export interface WidgetMarketSource {
  id: string;
  label: string;
  symbols: readonly string[];
  intervals: readonly Interval[];
  /**
   * Interval kinds this source builds at any length, besides the listed `intervals`.
   * With `['time', 'tick']` a user can type `3m` or `700t` into the interval picker.
   */
  customIntervals?: readonly IntervalSpec['kind'][];
  createFeed(selection: { symbol: string; interval: Interval }): FeedAdapter;
}

const KINDS: readonly IntervalSpec['kind'][] = ['time', 'tick', 'range', 'momentum'];

/** Listed by the source, or a custom length of a kind it declares. */
export function supportsInterval(source: WidgetMarketSource, interval: string): interval is Interval {
  if (source.intervals.includes(interval as Interval)) return true;
  if (!source.customIntervals?.length || !isInterval(interval)) return false;
  return source.customIntervals.includes(parseInterval(interval).kind);
}

const UNIT_WORDS: Readonly<Record<string, string>> = {
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  d: 'd',
  day: 'd',
  days: 'd',
  w: 'w',
  week: 'w',
  weeks: 'w',
  t: 't',
  tick: 't',
  ticks: 't',
  r: 'r',
  range: 'r',
  rng: 'r',
  mr: 'mr',
  mom: 'mr',
  momentum: 'mr',
};

/**
 * Reads what a user typed as an interval: `3m`, `3 min`, `700 ticks`, `15 range`,
 * `12 momentum`. Null when it is not one.
 */
export function parseIntervalInput(text: string): Interval | null {
  const match = /^\s*(\d+)\s*([a-z]+)\s*$/i.exec(text);
  if (!match) return null;
  // `M` alone is ambiguous with `m`; units are read lowercase.
  const unit = UNIT_WORDS[match[2]!.toLowerCase()];
  const interval = unit && `${Number(match[1])}${unit}`;
  return interval && isInterval(interval) ? interval : null;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

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
      new Set(source.intervals).size !== source.intervals.length ||
      (source.customIntervals !== undefined &&
        (!Array.isArray(source.customIntervals) ||
          !(source.customIntervals as unknown[]).every(k => KINDS.includes(k as IntervalSpec['kind']))))
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
    !supportsInterval(source, selection.interval)
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
    descriptor.intervalMs !== intervalToMs(interval)
  )
    throw new ChartError('MARKET_FEED_MISMATCH');
  return feed;
}
