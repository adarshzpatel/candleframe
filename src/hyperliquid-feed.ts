import { ChartError } from './errors.ts';
import { intervalToMs, isAligned } from './intervals.ts';
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

type HyperliquidSymbol = 'BTC/USDC' | 'ETH/USDC' | 'SOL/USDC' | 'HYPE/USDC';
export interface HyperliquidFeedOptions {
  symbol?: HyperliquidSymbol;
  interval?: Interval;
}
export interface HyperliquidSocket extends EventTarget {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
/** Optional transport injection for hosts and deterministic tests; no exchange wire types escape. */
export interface HyperliquidTransport {
  fetch: typeof globalThis.fetch;
  createSocket(url: string): HyperliquidSocket;
}

const INFO = 'https://api.hyperliquid.xyz/info';
const WS = 'wss://api.hyperliquid.xyz/ws';
const SYMBOLS: readonly HyperliquidSymbol[] = ['BTC/USDC', 'ETH/USDC', 'SOL/USDC', 'HYPE/USDC'];
const MAX_BUFFERED_EVENTS = 512;
const CANDLE_GAP = 'Candle gap; reconnecting to refresh history';
/** The server closes sockets that send nothing for 60 seconds. */
const PING_MS = 30_000;
/**
 * Candle messages arrive only on trades, and l2Book about every 5 seconds, so both wait
 * longer than Binance before calling a stream stale.
 */
const QUIET_MS: Record<Stream, { stale: number; reconnect: number }> = {
  candles: { stale: 30_000, reconnect: 90_000 },
  depth: { stale: 15_000, reconnect: 45_000 },
};
const restCooldown = new WeakMap<typeof globalThis.fetch, number>();

class HttpFailure extends Error {
  readonly retryAt: number;
  constructor(status: number, retryAt = 0) {
    super(`Hyperliquid market data HTTP ${status}${retryAt ? '; waiting before retry' : ''}`);
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
/** A candle with its trade count, which only grows while the bar forms. */
interface Bar {
  candle: Candle;
  trades: number;
}
/** `{ t, T, s, i, o, c, h, l, v, n }`, the same shape over REST and WebSocket. */
function candle(value: unknown, coin: string, interval: Interval, intervalMs: number): Bar {
  const data = object(value);
  if (data.s !== coin || data.i !== interval) throw new Error('Unexpected candle market or interval');
  const timeMs = integer(data.t);
  const [open, high, low, close, volume] = [data.o, data.h, data.l, data.c, data.v].map(numeric);
  if (
    integer(data.T) !== timeMs + intervalMs - 1 ||
    !isAligned(timeMs, intervalMs) ||
    low <= 0 ||
    volume < 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close)
  )
    throw new Error('Invalid candle');
  return { candle: { timeMs, open, high, low, close, volume }, trades: integer(data.n) };
}
function history(
  value: unknown,
  coin: string,
  interval: Interval,
  intervalMs: number,
  beforeMs = Infinity,
): Bar[] {
  // Requests span at most PAGE bars; a little slack covers client clock skew.
  if (!Array.isArray(value) || value.length > PAGE + 10) throw new Error('Invalid candle history');
  const bars = value.map(row => candle(row, coin, interval, intervalMs));
  if (
    bars.some(
      (bar, i) => (i > 0 && bar.candle.timeMs <= bars[i - 1].candle.timeMs) || bar.candle.timeMs >= beforeMs,
    )
  )
    throw new Error('Unordered candle history');
  return bars;
}
function levels(value: unknown, side: 'bids' | 'asks'): Level[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('Invalid l2Book levels');
  const rows: Level[] = value.map(row => {
    const level = object(row);
    const price = numeric(level.px);
    const quantity = numeric(level.sz);
    if (price <= 0 || quantity <= 0 || integer(level.n) < 1) throw new Error('Invalid depth level');
    return [price, quantity];
  });
  if (rows.some((row, i) => i > 0 && (side === 'bids' ? row[0] >= rows[i - 1][0] : row[0] <= rows[i - 1][0])))
    throw new Error('Unordered depth levels');
  return rows;
}
/** `{ coin, time, levels: [bids, asks] }`: a complete top-20 book in every message. */
function depth(value: unknown, coin: string): DepthSnapshot {
  const data = object(value);
  if (data.coin !== coin) throw new Error('Unexpected l2Book market');
  if (!Array.isArray(data.levels) || data.levels.length !== 2) throw new Error('Invalid l2Book levels');
  const book = {
    // Block time in milliseconds. It never decreases, so it orders snapshots.
    sequence: integer(data.time),
    bids: levels(data.levels[0], 'bids'),
    asks: levels(data.levels[1], 'asks'),
  };
  if (book.bids[0][0] >= book.asks[0][0]) throw new Error('Crossed depth snapshot');
  return book;
}
/**
 * Perp prices allow 5 significant figures and at most `6 - szDecimals` decimals, and
 * integers are always valid: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size
 * The tick therefore depends on the price's magnitude and is read from the current mark.
 */
function instrument(value: unknown, symbol: HyperliquidSymbol, coin: string): Instrument {
  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[1]))
    throw new Error('Missing instrument metadata');
  const meta = object(value[0]);
  if (!Array.isArray(meta.universe)) throw new Error('Missing instrument metadata');
  const index = meta.universe.findIndex(item => object(item).name === coin);
  const entry = index < 0 ? undefined : object(meta.universe[index]);
  if (!entry || entry.isDelisted === true) throw new Error('Market is unavailable');
  const sizeDecimals = integer(entry.szDecimals);
  const context = object(value[1][index]);
  const mark = numeric(context.markPx);
  if (sizeDecimals > 6 || mark <= 0) throw new Error('Unexpected instrument metadata');
  const decimals = Math.min(6 - sizeDecimals, Math.max(0, 4 - Math.floor(Math.log10(mark))));
  const [base, quote] = symbol.split('/');
  return {
    symbol,
    name: `${base} / ${quote} perpetual`,
    base,
    quote,
    tickSize: Number((10 ** -decimals).toFixed(decimals)),
    pricePrecision: decimals,
    quantityPrecision: sizeDecimals,
  };
}
function retryTime(response: Response): number {
  const header = response.headers.get('Retry-After');
  const seconds = header === null ? NaN : Number(header);
  const requested = Number.isFinite(seconds)
    ? Date.now() + Math.max(0, seconds) * 1000
    : Date.parse(header ?? '');
  return Math.max(Date.now() + 1000, Number.isFinite(requested) ? requested : Date.now() + 60_000);
}

/**
 * Bars per history request. The docs cap time-range responses at 500 elements, and each
 * candleSnapshot costs 20 weight plus 1 per 60 bars against 1,200 per minute per IP.
 */
const PAGE = 500;

/**
 * Candle intervals with a fixed length that align with CandleFrame's bar boundaries.
 * Hyperliquid also offers 1M (a calendar month) and 1w, whose weeks start on Thursday
 * rather than Monday.
 */
export const HYPERLIQUID_INTERVALS: readonly Interval[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '8h',
  '12h',
  '1d',
  '3d',
];

/**
 * Public, read-only Hyperliquid perpetuals market data. Each l2Book message is a fresh
 * top-20 snapshot, never a reconstructed full book.
 * Wire formats: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
 */
export function createHyperliquidFeed(
  options: HyperliquidFeedOptions = {},
  transport: Partial<HyperliquidTransport> = {},
): FeedAdapter {
  const symbol = options.symbol ?? 'BTC/USDC';
  const interval = options.interval ?? '1m';
  if (!SYMBOLS.includes(symbol) || !HYPERLIQUID_INTERVALS.includes(interval))
    throw new ChartError('UNSUPPORTED_MARKET', undefined, {
      details: { symbol, interval, intervals: HYPERLIQUID_INTERVALS },
    });
  const intervalMs = intervalToMs(interval);
  const [coin, quote] = symbol.split('/');
  const subscriptions = [
    { type: 'candle', coin, interval },
    { type: 'l2Book', coin },
  ];
  const fetcher = transport.fetch ?? globalThis.fetch;
  const createSocket = transport.createSocket ?? ((url: string) => new WebSocket(url));

  return {
    descriptor: {
      id: 'hyperliquid',
      label: 'Hyperliquid Perps',
      interval,
      intervalMs,
      simulated: false,
      instrument: {
        symbol,
        name: `${coin} / ${quote} perpetual`,
        base: coin,
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
      let socket: HyperliquidSocket | undefined;
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setInterval> | undefined;
      let knownInstrument: Instrument | undefined;
      let snapshotRequested = false;
      let lastDepthSequence = -1;

      function publish(event: FeedEvent): void {
        if (!disposed && !paused) emit(event);
      }
      function status(stream: Stream, state: 'loading' | 'stale' | 'error', message: string): void {
        publish({ type: 'stream.status', stream, status: state, message });
      }
      function stop(): void {
        generation++;
        snapshotRequested = false;
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
      async function request(body: object, signal: AbortSignal): Promise<unknown> {
        const cooldown = restCooldown.get(fetcher) ?? 0;
        if (cooldown > Date.now()) throw new HttpFailure(429, cooldown);
        const response = await fetcher(INFO, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
          credentials: 'omit',
        });
        if (!response.ok) {
          const retryAt = response.status === 429 ? retryTime(response) : 0;
          if (retryAt) restCooldown.set(fetcher, Math.max(retryAt, restCooldown.get(fetcher) ?? 0));
          throw new HttpFailure(response.status, retryAt);
        }
        return response.json();
      }
      const candles = (startTime: number, endTime: number, signal: AbortSignal) =>
        request({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }, signal);
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
        let lastAcceptedTime = -1;
        let bufferedCount = 0;
        let pingedAt = startedAt;
        const buffered = new Map<number, Bar>();
        const accepted = new Map<number, Bar>();
        for (const stream of ['candles', 'depth'] as const)
          status(stream, 'loading', 'Connecting to Hyperliquid market data');

        // Volume and trade count only grow within a bar, so neither may go backward.
        const newer = (bar: Bar, previous: Bar | undefined) =>
          !previous || (bar.trades >= previous.trades && bar.candle.volume >= previous.candle.volume);
        function acceptedCandle(bar: Bar): boolean {
          const time = bar.candle.timeMs;
          const previous = accepted.get(time);
          // An evicted bar or absent historical timestamp cannot be published as a correction.
          if (!previous && time <= lastAcceptedTime) return false;
          if (lastAcceptedTime >= 0 && time > lastAcceptedTime + intervalMs) throw new Error(CANDLE_GAP);
          // A REST reply can be newer than socket messages received while it was in flight.
          if (!newer(bar, previous)) return false;
          accepted.set(time, bar);
          lastAcceptedTime = Math.max(lastAcceptedTime, time);
          if (accepted.size > 2000) accepted.delete(accepted.keys().next().value!);
          return true;
        }
        function healthy(stream: Stream): void {
          received[stream] = Date.now();
          markedStale[stream] = false;
          if (historyReady && depthReady) failures = 0;
        }
        function book(value: unknown): void {
          const snapshot = depth(value, coin);
          // Out-of-order or repeated books are older data, not a newer state.
          if (snapshot.sequence < lastDepthSequence) return;
          lastDepthSequence = snapshot.sequence;
          depthReady = true;
          snapshotRequested = false;
          healthy('depth');
          publish({ type: 'depth.snapshot', book: snapshot });
        }
        async function loadHistory(): Promise<void> {
          try {
            const now = Date.now();
            const bars = history(
              await candles(Math.max(0, now - (PAGE - 1) * intervalMs), now + intervalMs, abort.signal),
              coin,
              interval,
              intervalMs,
            );
            if (!active()) return;
            if (!bars.length) throw new Error('Empty candle history');
            for (const bar of bars) accepted.set(bar.candle.timeMs, bar);
            lastAcceptedTime = bars.at(-1)!.candle.timeMs;
            for (const item of [...buffered.values()].sort((a, b) => a.candle.timeMs - b.candle.timeMs))
              acceptedCandle(item);
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
            if (envelope.channel === 'subscriptionResponse' || envelope.channel === 'pong') return;
            if (envelope.channel === 'error')
              throw new Error(`Hyperliquid error: ${String(envelope.data).slice(0, 200)}`);
            if (envelope.channel !== 'candle' && envelope.channel !== 'l2Book')
              throw new Error('Unexpected Hyperliquid channel');
            stream = envelope.channel === 'candle' ? 'candles' : 'depth';
            if (stream === 'depth') return book(envelope.data);
            // The docs type the payload as Candle[]; the server sends one object.
            const rows = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
            if (!rows.length || rows.length > 10) throw new Error('Invalid candle message');
            const bars = rows.map(row => candle(row, coin, interval, intervalMs));
            healthy('candles');
            for (const bar of bars) {
              if (!historyReady) {
                if (++bufferedCount > MAX_BUFFERED_EVENTS)
                  throw new Error('Candle bootstrap buffer exceeded');
                const previous = buffered.get(bar.candle.timeMs);
                if (newer(bar, previous)) buffered.set(bar.candle.timeMs, bar);
              } else if (acceptedCandle(bar)) publish({ type: 'candle', candle: bar.candle });
            }
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
          if (socket?.readyState === 1 && now - pingedAt >= PING_MS) {
            pingedAt = now;
            socket.send(JSON.stringify({ method: 'ping' }));
          }
          for (const stream of ['candles', 'depth'] as const) {
            if (now - received[stream] >= QUIET_MS[stream].reconnect) {
              recover(`No ${stream} updates; reconnecting`, stream, 0, 'stale');
              return;
            }
            if (!markedStale[stream] && now - received[stream] >= QUIET_MS[stream].stale) {
              markedStale[stream] = true;
              status(stream, 'stale', `Waiting for ${stream} updates`);
            }
          }
        }, 1000);

        void (async () => {
          try {
            if (!knownInstrument) {
              const metadata = await request({ type: 'metaAndAssetCtxs' }, abort.signal);
              if (!active()) return;
              knownInstrument = instrument(metadata, symbol, coin);
            }
            if (!active()) return;
            publish({ type: 'instrument', instrument: knownInstrument });
            const connection = createSocket(WS);
            socket = connection;
            // Subscribe before REST history, then merge buffered updates by candle identity.
            connection.addEventListener(
              'open',
              () => {
                if (!active()) return;
                pingedAt = Date.now();
                for (const subscription of subscriptions)
                  connection.send(JSON.stringify({ method: 'subscribe', subscription }));
                void loadHistory();
              },
              { once: true },
            );
            connection.addEventListener('message', message);
            connection.addEventListener('error', () => {
              if (active()) recover('Hyperliquid market-data connection failed');
            });
            connection.addEventListener('close', () => {
              if (active())
                recover('Hyperliquid market-data connection closed; reconnecting', undefined, 0, 'stale');
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
          if (disposed || paused || snapshotRequested || !controller) return;
          snapshotRequested = true;
          status('depth', 'stale', 'Requesting a fresh top-20 snapshot');
          // Socket books arrive about every 5 seconds; the REST book (weight 2) comes sooner.
          // Either one is complete, and the newer block time wins.
          const current = generation;
          void request({ type: 'l2Book', coin }, controller.signal).then(
            value => {
              if (current !== generation || disposed || paused) return;
              snapshotRequested = false;
              try {
                const snapshot = depth(value, coin);
                // A socket book from a later block already replaced this one.
                if (snapshot.sequence < lastDepthSequence) return;
                lastDepthSequence = snapshot.sequence;
                publish({ type: 'depth.snapshot', book: snapshot });
              } catch (error) {
                status('depth', 'error', error instanceof Error ? error.message : String(error));
              }
            },
            () => {
              // The next socket book recovers depth; the watchdog covers a silent stream.
              if (current === generation) snapshotRequested = false;
            },
          );
        },
        loadOlder(beforeMs) {
          if (disposed || paused || !controller) return;
          const current = generation,
            signal = controller.signal;
          // Both ends are inclusive.
          void candles(Math.max(0, beforeMs - PAGE * intervalMs), beforeMs - 1, signal)
            .then(value => history(value, coin, interval, intervalMs, beforeMs).map(bar => bar.candle))
            .then(
              bars => {
                // Only the most recent 5,000 or so bars exist per interval; past them the reply is empty.
                if (current === generation)
                  publish({ type: 'candles.prepend', candles: bars, exhausted: !bars.length });
              },
              error => {
                if (current === generation)
                  publish({
                    type: 'candles.prepend',
                    candles: [],
                    error: error instanceof Error ? error.message : String(error),
                  });
              },
            );
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
