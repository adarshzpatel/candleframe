import { binBook } from './heatmap.ts';
import { INTERVAL_MS } from './types.ts';
import type { Candle, DepthSnapshot, FeedAdapter, FeedConnection, HeatmapGrid, Instrument, Interval, Level } from './types.ts';

const MINUTE = 60_000;
const START_TIME = Date.UTC(2026, 9, 2, 12);
const HISTORY_MINUTES = 360 * 60;
const instruments = {
  'BTC/USD': { name: 'Bitcoin', base: 'BTC', price: 68_000, step: 5, precision: 2, quantityPrecision: 5 },
  'ETH/USD': { name: 'Ethereum', base: 'ETH', price: 3_200, step: 0.25, precision: 2, quantityPrecision: 4 },
  'SOL/USD': { name: 'Solana', base: 'SOL', price: 150, step: 0.01, precision: 3, quantityPrecision: 3 },
} as const;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Synthetic quantities only; this is not recorded exchange liquidity. */
export function simulatedBook(price: number, sequence: number, phase: number, priceStep = 5, quantityScale = 1): DepthSnapshot {
  const midpoint = Math.round(price / priceStep) * priceStep;
  const side = (direction: -1 | 1): Level[] => Array.from({ length: 80 }, (_, i) => {
    const p = Number((midpoint + direction * (i + 1) * priceStep).toFixed(8));
    const referencePrice = p / priceStep * 5;
    const wall = Math.exp(-Math.pow((referencePrice % 200 - 100) / 15, 2)) * 15;
    const broad = 1.3 + Math.pow(Math.sin(referencePrice * 0.018 + phase * 0.025), 8) * 7;
    const wave = 0.6 + 0.4 * Math.sin(referencePrice * 0.07 + phase * 0.04);
    return [p, Math.round((broad + wall) * wave * quantityScale * 1000) / 1000];
  });
  return { sequence, bids: side(-1), asks: side(1) };
}

function diff(previous: readonly Level[], next: readonly Level[]): Level[] {
  const old = new Map(previous);
  const fresh = new Map(next);
  const changes: Level[] = [];
  for (const [p, q] of fresh) if (old.get(p) !== q) changes.push([p, q]);
  for (const p of old.keys()) if (!fresh.has(p)) changes.push([p, 0]);
  return changes;
}

function aggregate(candles: readonly Candle[], intervalMs: number): Candle[] {
  const result: Candle[] = [];
  for (const bar of candles) {
    const timeMs = Math.floor(bar.timeMs / intervalMs) * intervalMs;
    const previous = result.at(-1);
    if (!previous || previous.timeMs !== timeMs) result.push({ ...bar, timeMs });
    else {
      previous.high = Math.max(previous.high, bar.high);
      previous.low = Math.min(previous.low, bar.low);
      previous.close = bar.close;
      previous.volume += bar.volume;
    }
  }
  return result.slice(-360);
}

export interface SimulatedFeed extends FeedAdapter {
  /** Omit one depth sequence while candles continue. For the recovery exercise. */
  injectGap(): void;
}

export interface SimulatedFeedOptions {
  seed?: number;
  symbol?: keyof typeof instruments;
  interval?: Interval;
  heatmap?: boolean;
}

export function createSimulatedFeed(input: number | SimulatedFeedOptions = 42): SimulatedFeed {
  const options = typeof input === 'number' ? { seed: input } : input;
  const seed = options.seed ?? 42;
  const symbol = options.symbol ?? 'BTC/USD';
  const interval = options.interval ?? '1m';
  if (!Number.isFinite(seed)) throw new Error('INVALID_SEED');
  if (!Object.hasOwn(instruments, symbol)) throw new Error('UNSUPPORTED_SYMBOL');
  if (!Object.hasOwn(INTERVAL_MS, interval)) throw new Error('UNSUPPORTED_INTERVAL');
  const preset = instruments[symbol];
  const intervalMs = INTERVAL_MS[interval];
  const priceScale = preset.price / 68_000;
  const quantityScale = 1 / priceScale;
  const rounded = (price: number) => Number(price.toFixed(preset.precision));
  const instrument: Instrument = {
    symbol, name: preset.name, base: preset.base, quote: 'USD',
    tickSize: 10 ** -preset.precision, pricePrecision: preset.precision, quantityPrecision: preset.quantityPrecision,
  };
  const connections = new Set<() => void>();
  return {
    descriptor: {
      id: 'simulated', label: 'Local simulation', instrument, interval, intervalMs,
      simulated: true, depth: { kind: 'sequenced', levels: 80 },
    },
    injectGap() { for (const drop of connections) drop(); },
    connect(emit): FeedConnection {
      const rng = random(seed);
      // Every interval uses the same minute history and consumes the same random
      // sequence. Selecting another interval does not change the market price.
      const minutes: Candle[] = [];
      let close = preset.price as number;
      for (let i = 0; i < HISTORY_MINUTES; i++) {
        const open = close;
        const reference = 68_000 + 650 * Math.sin(i / 600) + 400 * Math.sin(i / 130)
          + 130 * Math.sin(i / 31) + 60 * Math.sin(i / 9) + (rng() - 0.5) * 32;
        close = rounded(reference * priceScale);
        minutes.push({
          timeMs: START_TIME - (HISTORY_MINUTES - i) * MINUTE,
          open, close,
          high: rounded(Math.max(open, close) + rng() * 27 * priceScale),
          low: rounded(Math.min(open, close) - rng() * 27 * priceScale),
          volume: (3 + rng() * 15) * quantityScale,
        });
      }
      minutes.push({ timeMs: START_TIME, open: close, high: close, low: close, close, volume: 0 });
      const candles = aggregate(minutes, intervalMs);
      let current = { ...candles.at(-1)! };
      let sequence = 1000;
      let steps = 0;
      let clockMs = START_TIME;
      let book = simulatedBook(close, sequence, HISTORY_MINUTES, preset.step, quantityScale);
      let paused = false;
      let disposed = false;
      let omitted = false;
      let recovering: ReturnType<typeof setTimeout> | undefined;
      const drop = () => { omitted = true; };
      connections.add(drop);
      emit({ type: 'candles.history', candles });
      emit({ type: 'depth.snapshot', book });
      if (options.heatmap) {
        const low = Math.min(...candles.map(bar => bar.low)) - 80 * preset.step;
        const high = Math.max(...candles.map(bar => bar.high)) + 80 * preset.step;
        const binSize = Math.ceil((high - low) / 256 / preset.step) * preset.step;
        const grid: HeatmapGrid = { minPrice: Math.floor(low / binSize) * binSize, binSize, rows: 256, intervalMs };
        emit({
          type: 'heatmap.history', grid,
          columns: candles.map((bar, i) => binBook({
            ...simulatedBook(bar.close, i, i, preset.step, quantityScale), status: 'live',
          }, grid, bar.timeMs)),
        });
      }
      const timer = setInterval(() => {
        if (paused || disposed) return;
        steps++;
        clockMs += 10_000;
        const next = rounded(Math.max(preset.price * 0.94, Math.min(preset.price * 1.06,
          current.close + (rng() - 0.48) * 11 * priceScale)));
        const timeMs = Math.floor(clockMs / intervalMs) * intervalMs;
        if (timeMs !== current.timeMs) current = {
          timeMs, open: current.close, high: current.close, low: current.close, close: current.close, volume: 0,
        };
        current = {
          ...current, close: next, high: Math.max(current.high, next), low: Math.min(current.low, next),
          volume: current.volume + rng() * 2 * quantityScale,
        };
        // Depth transport problems never prevent a candle publication.
        emit({ type: 'candle', candle: { ...current } });
        if (disposed || paused) return;
        const old = book;
        book = simulatedBook(next, ++sequence, HISTORY_MINUTES + steps / 6, preset.step, quantityScale);
        if (omitted) { omitted = false; return; }
        emit({ type: 'depth.delta', book: {
          sequence, previousSequence: sequence - 1, bids: diff(old.bids, book.bids), asks: diff(old.asks, book.asks),
        } });
      }, 250);
      return {
        setPaused(value) {
          if (disposed || value === paused) return;
          paused = value;
          if (paused) {
            clearTimeout(recovering);
            recovering = undefined;
          } else {
            emit({ type: 'candle', candle: { ...current } });
            if (!disposed && !paused) emit({ type: 'depth.snapshot', book });
          }
        },
        requestSnapshot() {
          if (disposed || paused || recovering) return;
          recovering = setTimeout(() => {
            recovering = undefined;
            if (!disposed && !paused) emit({ type: 'depth.snapshot', book });
          }, 1100);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          clearInterval(timer);
          clearTimeout(recovering);
          connections.delete(drop);
        },
      };
    },
  };
}
