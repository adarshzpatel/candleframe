import { ChartError } from './errors.ts';
import { binBook } from './heatmap.ts';
import { alignTime, intervalToMs } from './intervals.ts';
import type {
  Candle,
  DepthSnapshot,
  FeedAdapter,
  FootprintLevel,
  FeedConnection,
  HeatmapGrid,
  Instrument,
  Interval,
  Level,
} from './types.ts';

const MINUTE = 60_000;
const START_TIME = Date.UTC(2026, 9, 2, 12);
const HISTORY_MINUTES = 360 * 60;
const TRADE_STEP_MS = 50;
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
export function simulatedBook(
  price: number,
  sequence: number,
  phase: number,
  priceStep = 5,
  quantityScale = 1,
): DepthSnapshot {
  const midpoint = Math.round(price / priceStep) * priceStep;
  const side = (direction: -1 | 1): Level[] =>
    Array.from({ length: 80 }, (_, i) => {
      const p = Number((midpoint + direction * (i + 1) * priceStep).toFixed(8));
      const referencePrice = (p / priceStep) * 5;
      const wall = Math.exp(-Math.pow(((referencePrice % 200) - 100) / 15, 2)) * 15;
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

type Flow = Map<number, [buy: number, sell: number]>;
/** Running delta from the bar open, and its extremes. */
interface Swing {
  delta: number;
  low: number;
  high: number;
}
const swing = (): Swing => ({ delta: 0, low: 0, high: 0 });
/** Moves the running delta by one trade or sub-bar, extending the extremes. */
function step(state: Swing, delta: number, overshoot = 0): void {
  state.low = Math.min(state.low, state.delta + Math.min(0, delta) - overshoot);
  state.high = Math.max(state.high, state.delta + Math.max(0, delta) + overshoot);
  state.delta += delta;
}

/**
 * Synthetic aggressor flow for one bar: volume concentrates near the body, rising bars
 * lean to buyers and each price bucket varies. A shape for demos, not recorded trades.
 */
function distribute(bar: Candle, bucket: number, rng: () => number, into: Flow = new Map()): Flow {
  const range = bar.high - bar.low;
  const move = bar.close - bar.open;
  const lean = Math.tanh(move / (range * 0.35 + bucket * 0.1));
  const share = Math.max(0.06, Math.min(0.94, 0.5 + 0.32 * lean + (rng() - 0.5) * 0.22));
  const center = (bar.open + bar.close) / 2;
  const sigma = Math.max(range / 2.6, bucket * 0.6);
  const first = Math.floor(bar.low / bucket),
    last = Math.floor(bar.high / bucket);
  const weights: number[] = [];
  let sum = 0;
  for (let k = first; k <= last; k++) {
    const mid = Math.max(bar.low, Math.min(bar.high, (k + 0.5) * bucket));
    const w = Math.exp(-(((mid - center) / sigma) ** 2) / 2) * (0.55 + rng() * 0.9);
    weights.push(w);
    sum += w;
  }
  weights.forEach((w, i) => {
    const k = first + i;
    const volume = (bar.volume * w) / sum;
    const offset = ((k + 0.5) * bucket - center) / (range + bucket);
    const buy = Math.max(0.02, Math.min(0.98, share + (rng() - 0.5) * 0.3 + 0.12 * Math.sign(move) * offset));
    const cell = into.get(k) ?? [0, 0];
    cell[0] += volume * buy;
    cell[1] += volume * (1 - buy);
    into.set(k, cell);
  });
  return into;
}

/** Flow as a candle's `buyVolume`, ascending `footprint` and `deltaRange`. */
function withFlow(bar: Candle, flow: Flow, bucket: number, precision: number, range?: Swing): Candle {
  const footprint: FootprintLevel[] = [...flow.keys()]
    .sort((a, b) => a - b)
    .map(k => {
      const [buy, sell] = flow.get(k)!;
      return [Number((k * bucket).toFixed(precision)), buy, sell];
    });
  const buyVolume = Math.min(
    bar.volume,
    footprint.reduce((total, level) => total + level[1], 0),
  );
  const delta = 2 * buyVolume - bar.volume;
  const deltaRange: readonly [number, number] = range
    ? [Math.min(range.low, delta, 0), Math.max(range.high, delta, 0)]
    : [Math.min(0, delta), Math.max(0, delta)];
  return { ...bar, buyVolume, footprint, deltaRange };
}

function aggregate(candles: readonly Candle[], intervalMs: number): Candle[] {
  const result: Candle[] = [];
  for (const bar of candles) {
    const timeMs = alignTime(bar.timeMs, intervalMs);
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
  /**
   * Simulate individual trades at irregular times, with bursts, heavy-tailed sizes and
   * aggressor imbalance, instead of one price step every 250 ms.
   */
  trades?: boolean;
  /** Simulated seconds per real second in trade mode. Default 1 (real time). */
  speed?: number;
}

export function createSimulatedFeed(input: number | SimulatedFeedOptions = 42): SimulatedFeed {
  const options = typeof input === 'number' ? { seed: input } : input;
  const seed = options.seed ?? 42;
  const symbol = options.symbol ?? 'BTC/USD';
  const interval = options.interval ?? '1m';
  if (!Number.isFinite(seed)) throw new ChartError('INVALID_SEED');
  if (!Object.hasOwn(instruments, symbol)) throw new ChartError('UNSUPPORTED_SYMBOL');
  const intervalMs = intervalToMs(interval);
  if (options.speed !== undefined && !(options.speed >= 0.1 && options.speed <= 1000))
    throw new ChartError('INVALID_OPTION', 'speed must be 0.1 to 1000');
  const preset = instruments[symbol];
  // Up to one hour, every interval aggregates the same minute series, so switching
  // intervals keeps the price. Longer intervals use 1/60-interval steps instead.
  const stepMs = Math.max(MINUTE, Math.floor(intervalMs / 60 / MINUTE) * MINUTE);
  if (intervalMs < MINUTE) throw new ChartError('UNSUPPORTED_INTERVAL', 'the simulation starts at 1m');
  const priceScale = preset.price / 68_000;
  const quantityScale = 1 / priceScale;
  const rounded = (price: number) => Number(price.toFixed(preset.precision));
  // Footprint buckets widen with the interval: 1 book step at 1m, 4 at 15m, 38 at 1d.
  const bucket = preset.step * Math.ceil(Math.sqrt(intervalMs / MINUTE));
  const instrument: Instrument = {
    symbol,
    name: preset.name,
    base: preset.base,
    quote: 'USD',
    tickSize: 10 ** -preset.precision,
    pricePrecision: preset.precision,
    quantityPrecision: preset.quantityPrecision,
  };
  const connections = new Set<() => void>();
  return {
    descriptor: {
      id: 'simulated',
      label: 'Local simulation',
      instrument,
      interval,
      intervalMs,
      simulated: true,
      depth: { kind: 'sequenced', levels: 80 },
    },
    injectGap() {
      for (const drop of connections) drop();
    },
    connect(emit): FeedConnection {
      const rng = random(seed);
      // Every interval uses the same minute history and consumes the same random
      // sequence. Selecting another interval does not change the market price.
      const minutes: Candle[] = [];
      let close = preset.price as number;
      for (let i = 0; i < HISTORY_MINUTES; i++) {
        const open = close;
        const reference =
          68_000 +
          650 * Math.sin(i / 600) +
          400 * Math.sin(i / 130) +
          130 * Math.sin(i / 31) +
          60 * Math.sin(i / 9) +
          (rng() - 0.5) * 32;
        close = rounded(reference * priceScale);
        minutes.push({
          timeMs: START_TIME - (HISTORY_MINUTES - i) * stepMs,
          open,
          close,
          high: rounded(Math.max(open, close) + rng() * 27 * priceScale),
          low: rounded(Math.min(open, close) - rng() * 27 * priceScale),
          volume: (3 + rng() * 15) * quantityScale,
        });
      }
      minutes.push({ timeMs: START_TIME, open: close, high: close, low: close, close, volume: 0 });
      // Order flow uses its own random sequence, so prices match the plain series.
      const flowRng = random(seed ^ 0x2545f491);
      const flows = new Map<number, Flow>();
      const swings = new Map<number, Swing>();
      const aggregated = aggregate(minutes, intervalMs);
      const firstTime = aggregated[0].timeMs;
      for (const bar of minutes) {
        if (bar.timeMs < firstTime || bar.volume <= 0) continue;
        const timeMs = alignTime(bar.timeMs, intervalMs);
        const flow = new Map<number, [number, number]>();
        distribute(bar, bucket, flowRng, flow);
        let buy = 0,
          sell = 0;
        for (const [k, [b, s]] of flow) {
          buy += b;
          sell += s;
          const cell = flows.get(timeMs)?.get(k) ?? [0, 0];
          cell[0] += b;
          cell[1] += s;
          if (!flows.has(timeMs)) flows.set(timeMs, new Map());
          flows.get(timeMs)!.set(k, cell);
        }
        // Each sub-bar may swing past its net delta before settling.
        if (!swings.has(timeMs)) swings.set(timeMs, swing());
        step(swings.get(timeMs)!, buy - sell, (buy + sell) * flowRng() * 0.12);
      }
      const candles = aggregated.map(bar =>
        withFlow(bar, flows.get(bar.timeMs) ?? new Map(), bucket, preset.precision, swings.get(bar.timeMs)),
      );
      // Older pages walk backward from the first bar with their own random sequence,
      // so paging never changes the bars already shown.
      const olderRng = random(seed ^ 0x5f3759df);
      let earliest = candles[0];
      let current = { ...candles.at(-1)! };
      let currentFlow: Flow = flows.get(current.timeMs) ?? new Map();
      let currentSwing: Swing = swings.get(current.timeMs) ?? swing();
      let sequence = 1000;
      let steps = 0;
      let clockMs = START_TIME;
      let book = simulatedBook(close, sequence, HISTORY_MINUTES, preset.step, quantityScale);
      let paused = false;
      let disposed = false;
      let omitted = false;
      let recovering: ReturnType<typeof setTimeout> | undefined;
      const drop = () => {
        omitted = true;
      };
      connections.add(drop);
      emit({ type: 'candles.history', candles });
      emit({ type: 'depth.snapshot', book });
      if (options.heatmap) {
        const low = Math.min(...candles.map(bar => bar.low)) - 80 * preset.step;
        const high = Math.max(...candles.map(bar => bar.high)) + 80 * preset.step;
        const binSize = Math.ceil((high - low) / 256 / preset.step) * preset.step;
        const grid: HeatmapGrid = {
          minPrice: Math.floor(low / binSize) * binSize,
          binSize,
          rows: 256,
          intervalMs,
        };
        emit({
          type: 'heatmap.history',
          grid,
          columns: candles.map((bar, i) =>
            binBook(
              {
                ...simulatedBook(bar.close, i, i, preset.step, quantityScale),
                status: 'live',
              },
              grid,
              bar.timeMs,
            ),
          ),
        });
      }
      /** Applies one trade at `timeMs`, opening a new bar when the clock crosses into one. */
      const trade = (timeMs: number, price: number, size: number, buyShare: number) => {
        const barMs = alignTime(timeMs, intervalMs);
        if (barMs !== current.timeMs) {
          currentFlow = new Map();
          currentSwing = swing();
          current = {
            timeMs: barMs,
            open: current.close,
            high: current.close,
            low: current.close,
            close: current.close,
            volume: 0,
          };
        }
        const key = Math.floor(price / bucket);
        const cell = currentFlow.get(key) ?? [0, 0];
        cell[0] += size * buyShare;
        cell[1] += size * (1 - buyShare);
        currentFlow.set(key, cell);
        step(currentSwing, size * (2 * buyShare - 1));
        current = withFlow(
          {
            ...current,
            close: price,
            high: Math.max(current.high, price),
            low: Math.min(current.low, price),
            volume: current.volume + size,
          },
          currentFlow,
          bucket,
          preset.precision,
          currentSwing,
        );
      };
      const publishDepth = (price: number, phase: number) => {
        const old = book;
        book = simulatedBook(price, ++sequence, phase, preset.step, quantityScale);
        if (omitted) {
          omitted = false;
          return;
        }
        emit({
          type: 'depth.delta',
          book: {
            sequence,
            previousSequence: sequence - 1,
            bids: diff(old.bids, book.bids),
            asks: diff(old.asks, book.asks),
          },
        });
      };
      const timer = options.trades
        ? tradeEngine()
        : setInterval(() => {
            if (paused || disposed) return;
            steps++;
            clockMs += stepMs / 6;
            const next = rounded(
              Math.max(
                preset.price * 0.94,
                Math.min(preset.price * 1.06, current.close + (rng() - 0.48) * 11 * priceScale),
              ),
            );
            const traded = rng() * 2 * quantityScale;
            // Upticks are mostly lifted offers, downticks mostly hit bids.
            const lean = next > current.close ? 0.72 : next < current.close ? 0.28 : 0.5;
            trade(clockMs, next, traded, Math.max(0.05, Math.min(0.95, lean + (flowRng() - 0.5) * 0.3)));
            // Depth transport problems never prevent a candle publication.
            emit({ type: 'candle', candle: { ...current } });
            if (disposed || paused) return;
            publishDepth(next, HISTORY_MINUTES + steps / 6);
          }, 250);

      /**
       * Individual trades at irregular times. Activity clusters: a slowly drifting intensity
       * with occasional bursts sets the arrival rate. Sizes are heavy-tailed. Aggressors
       * lean with a persistent order-flow imbalance and toward the reference path, and
       * each trade moves price by a few ticks, more for larger prints.
       */
      function tradeEngine() {
        const tradeRng = random(seed ^ 0x7f4a7c15);
        const normal = () => Math.sqrt(-2 * Math.log(1 - tradeRng())) * Math.cos(2 * Math.PI * tradeRng());
        const speed = options.speed ?? 1;
        const priceTick = preset.step / 5;
        let intensity = 1,
          imbalance = 0,
          price = current.close,
          sinceDepth = 0;
        return setInterval(() => {
          if (paused || disposed) return;
          const elapsed = TRADE_STEP_MS * speed;
          // Log-normal drift pulled back toward 1, with rare bursts.
          intensity = Math.max(0.25, Math.min(8, intensity ** 0.98 * Math.exp(normal() * 0.12)));
          if (tradeRng() < 0.003) intensity = 3 + tradeRng() * 4;
          imbalance = imbalance * 0.97 + normal() * 0.08;
          // Poisson arrivals at about 8 trades a second, scaled by intensity.
          const expected = (8 * intensity * elapsed) / 1000;
          let count = 0;
          for (let product = tradeRng(), limit = Math.exp(-expected); product > limit && count < 400; count++)
            product *= tradeRng();
          const minute = HISTORY_MINUTES + (clockMs - START_TIME) / stepMs;
          const reference =
            (68_000 +
              650 * Math.sin(minute / 600) +
              400 * Math.sin(minute / 130) +
              130 * Math.sin(minute / 31) +
              60 * Math.sin(minute / 9)) *
            priceScale;
          for (let k = 0; k < count; k++) {
            const pull = Math.tanh((reference - price) / (40 * priceScale));
            const buy = tradeRng() < 0.5 + 0.3 * Math.tanh(imbalance) + 0.12 * pull;
            const block = tradeRng() < 0.01 ? 8 + tradeRng() * 12 : 1;
            const size = 0.018 * quantityScale * Math.exp(normal() * 0.9) * block;
            // Most prints trade at the touch; larger ones walk the book.
            const ticks =
              tradeRng() < 0.45 ? 0 : 1 + Math.floor(-Math.log(1 - tradeRng()) * Math.sqrt(block));
            price = rounded(
              Math.max(
                preset.price * 0.94,
                Math.min(preset.price * 1.06, price + (buy ? 1 : -1) * ticks * priceTick),
              ),
            );
            trade(clockMs + (elapsed * (k + 1)) / (count + 1), price, size, buy ? 1 : 0);
          }
          clockMs += elapsed;
          if (count) emit({ type: 'candle', candle: { ...current } });
          sinceDepth += TRADE_STEP_MS;
          if (disposed || paused || sinceDepth < 250) return;
          sinceDepth = 0;
          steps++;
          publishDepth(price, HISTORY_MINUTES + steps / 6);
        }, TRADE_STEP_MS);
      }
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
        loadOlder(beforeMs) {
          queueMicrotask(() => {
            if (disposed || paused || beforeMs !== earliest.timeMs) return;
            const page: Candle[] = [];
            const olderFlowRng = random(seed ^ earliest.timeMs);
            let close = earliest.open;
            for (let i = 1; i <= 360; i++) {
              const open = rounded(
                Math.max(preset.price * 0.5, close + (olderRng() - 0.5) * 60 * priceScale),
              );
              const bar: Candle = {
                timeMs: earliest.timeMs - i * intervalMs,
                open,
                close,
                high: rounded(Math.max(open, close) + olderRng() * 40 * priceScale),
                low: rounded(
                  Math.max(preset.price * 0.4, Math.min(open, close) - olderRng() * 40 * priceScale),
                ),
                volume: (20 + olderRng() * 90) * quantityScale,
              };
              const flow = distribute(bar, bucket, olderFlowRng);
              let net = 0;
              for (const [b, s] of flow.values()) net += b - s;
              const range = swing();
              step(range, net, bar.volume * olderFlowRng() * 0.1);
              page.unshift(withFlow(bar, flow, bucket, preset.precision, range));
              close = open;
            }
            earliest = page[0];
            emit({ type: 'candles.prepend', candles: page });
          });
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
