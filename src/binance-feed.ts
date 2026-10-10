import { ChartError } from './errors.ts';
import { INTERVAL_MS } from './types.ts';
import type {
  Candle,
  DepthSnapshot,
  FeedAdapter,
  FeedEvent,
  Instrument,
  Interval,
  Level,
  Stream,
} from './types.ts';

type BinanceSymbol = 'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT';
export interface BinanceFeedOptions {
  symbol?: BinanceSymbol;
  interval?: Interval;
}
export interface BinanceSocket extends EventTarget {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
}
/** Optional transport injection for hosts and deterministic tests; no exchange wire types escape. */
export interface BinanceTransport {
  fetch: typeof globalThis.fetch;
  createSocket(url: string): BinanceSocket;
}

const REST = 'https://data-api.binance.vision/api/v3';
const WS = 'wss://data-stream.binance.vision:443/stream?streams=';
const MAX_BUFFERED_EVENTS = 512;
const CANDLE_GAP = 'Candle gap; reconnecting to refresh history';
const restCooldown = new WeakMap<typeof globalThis.fetch, number>();

class HttpFailure extends Error {
  readonly retryAt: number;
  constructor(status: number, retryAt = 0) {
    super(`Binance market data HTTP ${status}${retryAt ? '; waiting before retry' : ''}`);
    this.retryAt = retryAt;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid market-data object');
  return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '')
    throw new Error('Invalid market-data number');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Invalid market-data number');
  return n;
}
function integer(value: unknown): number {
  const n = numeric(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid market-data sequence or time');
  return n;
}
function candle(values: readonly unknown[], intervalMs: number): Candle {
  if (values.length < 6) throw new Error('Incomplete candle');
  const [timeMs, open, high, low, close, volume] = values.map(numeric);
  if (
    !Number.isSafeInteger(timeMs) ||
    timeMs < 0 ||
    timeMs % intervalMs !== 0 ||
    low <= 0 ||
    volume < 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close)
  )
    throw new Error('Invalid candle');
  return { timeMs, open, high, low, close, volume };
}
function history(value: unknown, intervalMs: number): Candle[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000)
    throw new Error('Invalid candle history');
  const bars = value.map(row => {
    if (!Array.isArray(row)) throw new Error('Invalid candle history row');
    return candle(row.slice(0, 6), intervalMs);
  });
  if (bars.some((bar, i) => i > 0 && bar.timeMs <= bars[i - 1].timeMs))
    throw new Error('Unordered candle history');
  return bars;
}
function levels(value: unknown, side: 'bids' | 'asks'): Level[] {
  if (!Array.isArray(value) || !value.length || value.length > 20)
    throw new Error('Invalid partial-depth levels');
  const rows: Level[] = value.map(row => {
    if (!Array.isArray(row) || row.length !== 2) throw new Error('Invalid depth level');
    const price = numeric(row[0]);
    const quantity = numeric(row[1]);
    if (price <= 0 || quantity <= 0) throw new Error('Invalid depth level');
    return [price, quantity];
  });
  if (rows.some((row, i) => i > 0 && (side === 'bids' ? row[0] >= rows[i - 1][0] : row[0] <= rows[i - 1][0])))
    throw new Error('Unordered depth levels');
  return rows;
}
function depth(value: unknown): DepthSnapshot {
  const data = object(value);
  const book = {
    sequence: integer(data.lastUpdateId),
    bids: levels(data.bids, 'bids'),
    asks: levels(data.asks, 'asks'),
  };
  if (book.bids[0][0] >= book.asks[0][0]) throw new Error('Crossed depth snapshot');
  return book;
}
function precision(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || numeric(value) <= 0)
    throw new Error('Invalid instrument filter');
  return (value.split('.')[1] ?? '').replace(/0+$/, '').length;
}
function instrument(value: unknown, symbol: BinanceSymbol, wireSymbol: string): Instrument {
  const result = object(value);
  if (!Array.isArray(result.symbols)) throw new Error('Missing instrument metadata');
  const entry = result.symbols.map(object).find(item => item.symbol === wireSymbol);
  if (!entry || entry.status !== 'TRADING' || !Array.isArray(entry.filters))
    throw new Error('Market is unavailable');
  const [base, quote] = symbol.split('/');
  if (entry.baseAsset !== base || entry.quoteAsset !== quote)
    throw new Error('Unexpected instrument metadata');
  const filters = entry.filters.map(object);
  const tick = filters.find(item => item.filterType === 'PRICE_FILTER')?.tickSize;
  const step = filters.find(item => item.filterType === 'LOT_SIZE')?.stepSize;
  return {
    symbol,
    name: `${base} / ${quote}`,
    base,
    quote,
    tickSize: numeric(tick),
    pricePrecision: precision(tick),
    quantityPrecision: precision(step),
  };
}
function retryTime(response: Response): number {
  const header = response.headers.get('Retry-After');
  const seconds = header === null ? NaN : Number(header);
  const requested = Number.isFinite(seconds)
    ? Date.now() + Math.max(0, seconds) * 1000
    : Date.parse(header ?? '');
  return Math.max(
    Date.now() + 1000,
    Number.isFinite(requested) ? requested : Date.now() + (response.status === 418 ? 300_000 : 60_000),
  );
}

/**
 * Public, read-only Binance Spot market data. Partial depth is a fresh top-20 snapshot,
 * never a reconstructed full book. Wire formats: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
 */
export function createBinanceFeed(
  options: BinanceFeedOptions = {},
  transport: Partial<BinanceTransport> = {},
): FeedAdapter {
  const symbol = options.symbol ?? 'BTC/USDT';
  const interval = options.interval ?? '1m';
  if (!['BTC/USDT', 'ETH/USDT', 'SOL/USDT'].includes(symbol) || !Object.hasOwn(INTERVAL_MS, interval))
    throw new ChartError('UNSUPPORTED_MARKET');
  const wireSymbol = symbol.replace('/', '');
  const intervalMs = INTERVAL_MS[interval];
  const [base, quote] = symbol.split('/');
  const klineStream = `${wireSymbol.toLowerCase()}@kline_${interval}`;
  const depthStream = `${wireSymbol.toLowerCase()}@depth20`;
  const fetcher = transport.fetch ?? globalThis.fetch;
  const createSocket = transport.createSocket ?? ((url: string) => new WebSocket(url));

  return {
    descriptor: {
      id: 'binance',
      label: 'Binance Spot',
      interval,
      intervalMs,
      simulated: false,
      instrument: {
        symbol,
        name: `${base} / ${quote}`,
        base,
        quote,
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 3,
      },
      depth: { kind: 'snapshots', levels: 20 },
    },
    connect(emit) {
      let disposed = false;
      let paused = false;
      let generation = 0;
      let failures = 0;
      let controller: AbortController | undefined;
      let socket: BinanceSocket | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setInterval> | undefined;
      let knownInstrument: Instrument | undefined;
      let snapshotRequested = false;

      function publish(event: FeedEvent): void {
        if (!disposed && !paused) emit(event);
      }
      function status(stream: Stream, state: 'loading' | 'stale' | 'error', message: string): void {
        publish({ type: 'stream.status', stream, status: state, message });
      }
      function stop(): void {
        generation++;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        clearInterval(watchdog);
        watchdog = undefined;
        controller?.abort();
        controller = undefined;
        const closing = socket;
        socket = undefined;
        closing?.close();
      }
      function recover(
        message: string,
        failedStream?: Stream,
        retryAt = 0,
        severity: 'stale' | 'error' = 'error',
      ): void {
        if (disposed || paused) return;
        stop();
        for (const stream of ['candles', 'depth'] as const)
          status(stream, !failedStream || stream === failedStream ? severity : 'stale', message);
        const delay = Math.max(
          Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)),
          retryAt - Date.now(),
          (restCooldown.get(fetcher) ?? 0) - Date.now(),
        );
        reconnectTimer = setTimeout(start, delay);
      }
      async function request(path: string, signal: AbortSignal): Promise<unknown> {
        const cooldown = restCooldown.get(fetcher) ?? 0;
        if (cooldown > Date.now()) throw new HttpFailure(429, cooldown);
        const response = await fetcher(`${REST}/${path}`, { signal, credentials: 'omit' });
        if (!response.ok) {
          const retryAt = response.status === 429 || response.status === 418 ? retryTime(response) : 0;
          if (retryAt) restCooldown.set(fetcher, Math.max(retryAt, restCooldown.get(fetcher) ?? 0));
          throw new HttpFailure(response.status, retryAt);
        }
        return response.json();
      }
      function start(): void {
        if (disposed || paused) return;
        stop();
        const current = generation;
        const active = () => !disposed && !paused && current === generation;
        const abort = new AbortController();
        controller = abort;
        const startedAt = Date.now();
        const received: Record<Stream, number> = { candles: startedAt, depth: startedAt };
        const markedStale: Record<Stream, boolean> = { candles: false, depth: false };
        let historyReady = false;
        let depthReady = false;
        let lastDepthSequence = -1;
        let lastAcceptedTime = -1;
        let bufferedCount = 0;
        const buffered = new Map<number, { candle: Candle; eventTime: number }>();
        const accepted = new Map<number, { candle: Candle; eventTime: number }>();
        for (const stream of ['candles', 'depth'] as const)
          status(stream, 'loading', 'Connecting to Binance market data');

        function acceptedCandle(bar: Candle, eventTime: number): boolean {
          const previous = accepted.get(bar.timeMs);
          // An evicted bar or absent historical timestamp cannot be published as a correction.
          if (!previous && bar.timeMs <= lastAcceptedTime) return false;
          if (lastAcceptedTime >= 0 && bar.timeMs > lastAcceptedTime + intervalMs)
            throw new Error(CANDLE_GAP);
          // Binance kline volume is cumulative. A REST response can be newer than events
          // received while it was in flight; neither those nor reordered WS events may roll it back.
          if (previous && (eventTime < previous.eventTime || bar.volume < previous.candle.volume))
            return false;
          accepted.set(bar.timeMs, { candle: bar, eventTime });
          lastAcceptedTime = Math.max(lastAcceptedTime, bar.timeMs);
          if (accepted.size > 2000) accepted.delete(accepted.keys().next().value!);
          return true;
        }
        function healthy(stream: Stream): void {
          received[stream] = Date.now();
          markedStale[stream] = false;
          if (historyReady && depthReady) failures = 0;
        }
        async function loadHistory(): Promise<void> {
          try {
            const bars = history(
              await request(`klines?symbol=${wireSymbol}&interval=${interval}&limit=360`, abort.signal),
              intervalMs,
            );
            if (!active()) return;
            for (const bar of bars) accepted.set(bar.timeMs, { candle: bar, eventTime: 0 });
            lastAcceptedTime = bars.at(-1)!.timeMs;
            for (const item of [...buffered.values()].sort((a, b) => a.candle.timeMs - b.candle.timeMs))
              acceptedCandle(item.candle, item.eventTime);
            const merged = [...accepted.values()]
              .map(item => item.candle)
              .sort((a, b) => a.timeMs - b.timeMs)
              .slice(-2000);
            buffered.clear();
            historyReady = true;
            healthy('candles');
            publish({ type: 'candles.history', candles: merged });
          } catch (error) {
            if (active())
              recover(
                error instanceof Error ? error.message : String(error),
                'candles',
                error instanceof HttpFailure ? error.retryAt : 0,
              );
          }
        }
        function message(event: Event): void {
          if (!active()) return;
          let stream: Stream | undefined;
          try {
            const text = (event as MessageEvent<unknown>).data;
            if (typeof text !== 'string' || text.length > 1_000_000)
              throw new Error('Invalid WebSocket payload');
            const envelope = object(JSON.parse(text));
            if (envelope.stream !== klineStream && envelope.stream !== depthStream)
              throw new Error('Unexpected Binance stream');
            stream = envelope.stream === klineStream ? 'candles' : 'depth';
            if (stream === 'depth') {
              const book = depth(envelope.data);
              if (book.sequence < lastDepthSequence) return;
              lastDepthSequence = book.sequence;
              depthReady = true;
              snapshotRequested = false;
              healthy('depth');
              publish({ type: 'depth.snapshot', book });
              return;
            }
            const data = object(envelope.data);
            const k = object(data.k);
            if (data.e !== 'kline' || data.s !== wireSymbol || k.s !== wireSymbol || k.i !== interval)
              throw new Error('Unexpected kline market or interval');
            const bar = candle([k.t, k.o, k.h, k.l, k.c, k.v], intervalMs);
            const eventTime = integer(data.E);
            if (integer(k.T) !== bar.timeMs + intervalMs - 1 || eventTime < bar.timeMs)
              throw new Error('Invalid kline time');
            healthy('candles');
            if (!historyReady) {
              if (++bufferedCount > MAX_BUFFERED_EVENTS) throw new Error('Candle bootstrap buffer exceeded');
              const previous = buffered.get(bar.timeMs);
              if (!previous || (eventTime >= previous.eventTime && bar.volume >= previous.candle.volume))
                buffered.set(bar.timeMs, { candle: bar, eventTime });
            } else if (acceptedCandle(bar, eventTime)) publish({ type: 'candle', candle: bar });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!stream || reason === 'Candle bootstrap buffer exceeded' || reason === CANDLE_GAP)
              recover(reason, stream);
            else status(stream, 'error', reason);
          }
        }
        watchdog = setInterval(() => {
          if (!active()) return;
          const now = Date.now();
          if (!historyReady && now - startedAt >= 20_000) {
            recover('Candle bootstrap timed out', 'candles');
            return;
          }
          for (const stream of ['candles', 'depth'] as const) {
            if (now - received[stream] >= 30_000) {
              recover(`No ${stream} updates; reconnecting`, stream, 0, 'stale');
              return;
            }
            if (!markedStale[stream] && now - received[stream] >= 10_000) {
              markedStale[stream] = true;
              status(stream, 'stale', `Waiting for ${stream} updates`);
            }
          }
        }, 1000);

        void (async () => {
          try {
            if (!knownInstrument) {
              const metadata = await request(`exchangeInfo?symbol=${wireSymbol}`, abort.signal);
              if (!active()) return;
              knownInstrument = instrument(metadata, symbol, wireSymbol);
            }
            if (!active()) return;
            publish({ type: 'instrument', instrument: knownInstrument });
            const connection = createSocket(`${WS}${klineStream}/${depthStream}`);
            socket = connection;
            // Subscribe before REST history, then merge buffered updates by candle identity.
            connection.addEventListener(
              'open',
              () => {
                if (active()) void loadHistory();
              },
              { once: true },
            );
            connection.addEventListener('message', message);
            connection.addEventListener('error', () => {
              if (active()) recover('Binance market-data connection failed');
            });
            connection.addEventListener('close', () => {
              if (active())
                recover('Binance market-data connection closed; reconnecting', undefined, 0, 'stale');
            });
          } catch (error) {
            if (active())
              recover(
                error instanceof Error ? error.message : String(error),
                undefined,
                error instanceof HttpFailure ? error.retryAt : 0,
              );
          }
        })();
      }

      start();
      return {
        setPaused(value) {
          if (disposed || value === paused) return;
          paused = value;
          if (paused) stop();
          else start();
        },
        requestSnapshot() {
          if (disposed || paused || snapshotRequested) return;
          snapshotRequested = true;
          // Every depth20 message is complete; the next one is the recovery snapshot.
          status('depth', 'stale', 'Waiting for the next top-20 snapshot');
        },
        dispose() {
          if (!disposed) {
            disposed = true;
            stop();
          }
        },
      };
    },
  };
}
