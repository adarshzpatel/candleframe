import { ChartError } from './errors.ts';
import { intervalToMs } from './intervals.ts';
import type { Candle, FeedAdapter, FeedEvent, Instrument, Interval } from './types.ts';

export interface StaticFeedOptions {
  /** Ascending candles. Times are UTC milliseconds at the start of each bar. */
  candles: readonly Candle[];
  interval: Interval;
  /** A symbol string, or full instrument metadata. Missing precision is inferred from the data. */
  instrument: string | (Partial<Instrument> & { symbol: string });
  /** Source identity saved in layouts. Default `static`. */
  id?: string;
  label?: string;
  /** Set for markets with sessions or weekends. See `FeedDescriptor.gaps`. */
  gaps?: boolean;
  /** Bars sent first; the rest load as the user pans back. Default 1,000. */
  initialBars?: number;
  /** Bars per older-history page. Default 1,000. */
  pageSize?: number;
}

export interface StaticFeed extends FeedAdapter {
  /** Adds a bar or replaces the bar with the same time. Use for host-driven live updates. */
  update(candle: Candle): void;
  /** Replaces all candles. Connected charts reload history and keep their drawings. */
  setCandles(candles: readonly Candle[]): void;
}

function decimals(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = value.toString();
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Math.min(12, Number(exponent[1]));
  return Math.min(12, text.split('.')[1]?.length ?? 0);
}

function inferInstrument(input: StaticFeedOptions['instrument'], candles: readonly Candle[]): Instrument {
  const given = typeof input === 'string' ? { symbol: input } : input;
  if (!given || typeof given.symbol !== 'string' || !given.symbol)
    throw new ChartError('INVALID_INSTRUMENT', 'instrument needs a symbol', { path: 'instrument' });
  const sample = candles.slice(-500);
  const pricePrecision =
    given.pricePrecision ??
    (given.tickSize !== undefined
      ? decimals(given.tickSize)
      : Math.min(8, Math.max(0, ...sample.flatMap(c => [c.open, c.high, c.low, c.close].map(decimals)))));
  const [base, quote] = given.symbol.includes('/') ? given.symbol.split('/') : [given.symbol, ''];
  return {
    symbol: given.symbol,
    name: given.name ?? given.symbol,
    base: given.base ?? base,
    quote: given.quote ?? (quote || 'USD'),
    tickSize: given.tickSize ?? 10 ** -pricePrecision,
    pricePrecision,
    quantityPrecision:
      given.quantityPrecision ?? Math.min(8, Math.max(0, ...sample.map(c => decimals(c.volume)))),
  };
}

function copySorted(candles: readonly Candle[]): Candle[] {
  if (!Array.isArray(candles))
    throw new ChartError('INVALID_HISTORY', 'candles must be an array', { path: 'candles' });
  const copy = candles.map(c => ({ ...c }));
  for (let i = 1; i < copy.length; i++)
    if (copy[i].timeMs <= copy[i - 1].timeMs)
      throw new ChartError('INVALID_HISTORY', 'candle times must strictly ascend', {
        path: `candles.${i}.timeMs`,
        details: { index: i, timeMs: copy[i].timeMs, previousMs: copy[i - 1].timeMs },
      });
  return copy;
}

/**
 * Charts an array of candles. Pages older bars on demand and accepts host updates,
 * so an application with its own data source needs no custom adapter.
 */
export function createStaticFeed(options: StaticFeedOptions): StaticFeed {
  const intervalMs = intervalToMs(options.interval);
  let candles = copySorted(options.candles);
  const initialBars = options.initialBars ?? 1000;
  const pageSize = options.pageSize ?? 1000;
  for (const [key, value] of [
    ['initialBars', initialBars],
    ['pageSize', pageSize],
  ] as const)
    if (!Number.isInteger(value) || value < 1)
      throw new ChartError('INVALID_OPTION', `${key} must be a positive integer`, { path: key });
  const listeners = new Set<(event: FeedEvent) => void>();
  const send = (event: FeedEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  return {
    descriptor: {
      id: options.id ?? 'static',
      label: options.label ?? 'Static data',
      instrument: inferInstrument(options.instrument, candles),
      interval: options.interval,
      intervalMs,
      simulated: false,
      gaps: options.gaps ?? false,
    },
    update(candle) {
      const last = candles.at(-1);
      if (last && candle.timeMs < last.timeMs) {
        const index = candles.findIndex(c => c.timeMs === candle.timeMs);
        if (index < 0)
          throw new ChartError('UNKNOWN_CORRECTION', 'only the loaded bars can be replaced', {
            details: { timeMs: candle.timeMs },
          });
        candles[index] = { ...candle };
      } else if (last && candle.timeMs === last.timeMs) candles[candles.length - 1] = { ...candle };
      else candles.push({ ...candle });
      send({ type: 'candle', candle: { ...candle } });
    },
    setCandles(next) {
      candles = copySorted(next);
      send({ type: 'candles.history', candles: candles.slice(-initialBars) });
    },
    connect(emit) {
      let paused = false;
      let disposed = false;
      const listener = (event: FeedEvent) => {
        if (!paused && !disposed) emit(event);
      };
      listeners.add(listener);
      if (candles.length) emit({ type: 'candles.history', candles: candles.slice(-initialBars) });
      else emit({ type: 'stream.status', status: 'error', message: 'No candles to display' });
      return {
        setPaused(value) {
          if (disposed || paused === value) return;
          paused = value;
          // Resume with current data; updates made while paused are not replayed one by one.
          if (!paused && candles.length)
            emit({ type: 'candles.history', candles: candles.slice(-initialBars) });
        },
        loadOlder(beforeMs) {
          // Reply asynchronously, like a network feed; the runtime is mid-publication.
          queueMicrotask(() => {
            if (disposed || paused) return;
            let end = 0;
            while (end < candles.length && candles[end].timeMs < beforeMs) end++;
            const start = Math.max(0, end - pageSize);
            emit({ type: 'candles.prepend', candles: candles.slice(start, end), exhausted: start === 0 });
          });
        },
        dispose() {
          disposed = true;
          listeners.delete(listener);
        },
      };
    },
  };
}
