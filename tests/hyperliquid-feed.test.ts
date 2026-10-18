import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChartRuntime } from '../src/runtime.ts';
import { createHyperliquidFeed, HYPERLIQUID_INTERVALS } from '../src/hyperliquid-feed.ts';
import type { HyperliquidSocket, HyperliquidTransport } from '../src/hyperliquid-feed.ts';
import type { FeedEvent } from '../src/types.ts';

// Synthetic payloads in Hyperliquid's wire shapes, with small made-up numbers.
class Socket extends EventTarget implements HyperliquidSocket {
  readyState = 0;
  readonly sent: unknown[] = [];
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  push(channel: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ channel, data }) }));
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const metadata = [
  {
    universe: [
      { name: 'ETH', szDecimals: 4, maxLeverage: 5 },
      { name: 'BTC', szDecimals: 5, maxLeverage: 5 },
    ],
  },
  [{ markPx: '20.5' }, { markPx: '123.4' }],
];
const bar = (timeMs = 60_000, volume = 10, close = 100, trades = 5) => ({
  t: timeMs,
  T: timeMs + 59_999,
  s: 'BTC',
  i: '1m',
  o: '100',
  c: String(close),
  h: '110',
  l: '90',
  v: String(volume),
  n: trades,
});
interface Request {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal | null | undefined;
  resolve(value: Response): void;
}

function harness(options: Parameters<typeof createHyperliquidFeed>[0] = {}) {
  const requests: Request[] = [];
  const sockets: Socket[] = [];
  const urls: string[] = [];
  const events: FeedEvent[] = [];
  const transport: HyperliquidTransport = {
    fetch: (input, init) =>
      new Promise<Response>(resolve =>
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
          signal: init?.signal,
          resolve,
        }),
      ),
    createSocket(url) {
      urls.push(url);
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
  };
  const feed = createHyperliquidFeed(options, transport);
  const connection = feed.connect(event => events.push(event));
  function respond(index: number, value: unknown, status = 200, headers?: HeadersInit): void {
    requests[index].resolve(new Response(JSON.stringify(value), { status, headers }));
  }
  async function ready() {
    respond(0, metadata);
    await flush();
    sockets[0].open();
    respond(1, [bar()]);
    await flush();
  }
  return { feed, connection, events, requests, sockets, urls, transport, respond, ready };
}

test('metadata comes first, then the socket subscribes before history is requested', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  assert.equal(h.sockets.length, 0);
  assert.equal(h.requests[0].url, 'https://api.hyperliquid.xyz/info');
  assert.deepEqual(h.requests[0].body, { type: 'metaAndAssetCtxs' });
  h.respond(0, metadata);
  await flush();
  assert.equal(h.requests.length, 1);
  const event = h.events.find(event => event.type === 'instrument');
  // A 123.4 mark with five significant figures leaves two decimals; szDecimals 5 allows one.
  assert.equal(event?.instrument.tickSize, 0.1);
  assert.equal(event?.instrument.pricePrecision, 1);
  assert.equal(event?.instrument.quantityPrecision, 5);
  assert.equal(h.urls[0], 'wss://api.hyperliquid.xyz/ws');
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].sent, [
    { method: 'subscribe', subscription: { type: 'candle', coin: 'BTC', interval: '1m' } },
  ]);
  const history = h.requests[1].body as { type: string; req: Record<string, unknown> };
  assert.equal(history.type, 'candleSnapshot');
  assert.equal(history.req.coin, 'BTC');
  assert.equal(history.req.interval, '1m');
  h.respond(1, [bar(0), bar(60_000)]);
  await flush();
  const loaded = h.events.find(event => event.type === 'candles.history');
  assert.deepEqual(
    loaded?.candles.map(bar => bar.timeMs),
    [0, 60_000],
  );
});

test('history, a live update and a new bar drive a runtime to live candles', async t => {
  const h = harness();
  h.connection.dispose();
  // A second connection from the same transport, owned by the runtime.
  const runtime = new ChartRuntime(createHyperliquidFeed({}, h.transport));
  t.after(() => runtime.dispose());
  runtime.start();
  h.respond(1, metadata);
  await flush();
  h.sockets[0].open();
  h.respond(2, [bar(0), bar(60_000)]);
  await flush();
  h.sockets[0].push('candle', bar(60_000, 12, 104, 7));
  h.sockets[0].push('candle', bar(120_000, 1, 105, 1));
  const state = runtime.state();
  assert.deepEqual(
    state.candles.map(bar => [bar.timeMs, bar.close]),
    [
      [0, 100],
      [60_000, 104],
      [120_000, 105],
    ],
  );
  assert.equal(state.feed.instrument.tickSize, 0.1);
  assert.equal(state.stream.status, 'live');
});

test('bootstrap merging and reordered candles cannot roll volume or trade count backward', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, metadata);
  await flush();
  h.sockets[0].open();
  h.sockets[0].push('candle', bar(60_000, 7, 101, 3));
  h.sockets[0].push('candle', bar(120_000, 3, 103, 2));
  h.respond(1, [bar(60_000, 10, 104, 5)]);
  await flush();
  const initial = h.events.find(event => event.type === 'candles.history')!;
  assert.deepEqual(
    initial.candles.map(bar => [bar.timeMs, bar.close, bar.volume]),
    [
      [60_000, 104, 10],
      [120_000, 103, 3],
    ],
  );
  h.sockets[0].push('candle', bar(60_000, 9, 102, 4));
  h.sockets[0].push('candle', bar(120_000, 5, 106, 4));
  h.sockets[0].push('candle', bar(120_000, 5, 105, 3));
  // The documented Candle[] form is accepted too.
  h.sockets[0].push('candle', [bar(120_000, 6, 107, 5)]);
  assert.deepEqual(
    h.events.filter(event => event.type === 'candle').map(event => event.candle.close),
    [106, 107],
  );
});

test('malformed candles report an error without publishing a bar', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  for (const payload of [
    { ...bar(120_000), h: '95' },
    { ...bar(120_000), T: 120_000 },
    { ...bar(120_001), T: 180_000 },
    { ...bar(120_000), o: 'abc' },
    { ...bar(120_000), i: '5m' },
  ]) {
    const count = h.events.length;
    h.sockets[0].push('candle', payload);
    assert.deepEqual(
      h.events.slice(count).map(event => (event.type === 'stream.status' ? event.status : event.type)),
      ['error'],
    );
  }
  assert.equal(h.sockets[0].readyState, 1);
  const count = h.events.length;
  h.sockets[0].dispatchEvent(new MessageEvent('message', { data: 'not json' }));
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(
    h.events.slice(count).some(event => event.type === 'candle'),
    false,
  );
});

test('another coin, an unknown channel or a server error reconnects instead of misattributing data', async t => {
  for (const [channel, data] of [
    ['candle', { ...bar(120_000), s: 'ETH' }],
    ['l2Book', { coin: 'BTC' }],
    ['trades', []],
    ['error', 'Invalid subscription'],
  ] as const) {
    const h = harness();
    t.after(() => h.connection.dispose());
    await h.ready();
    const count = h.events.length;
    h.sockets[0].push(channel, data);
    assert.equal(h.sockets[0].readyState, channel === 'candle' ? 1 : 3);
    assert.equal(
      h.events.slice(count).some(event => event.type === 'candle'),
      false,
    );
  }
});

test('a skipped candle reconnects and refreshes history before later bars publish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  h.sockets[0].push('candle', bar(180_000));
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(
    h.events.some(event => event.type === 'candle'),
    false,
  );
  assert.ok(
    h.events.some(
      event =>
        event.type === 'stream.status' && event.message === 'Candle gap; reconnecting to refresh history',
    ),
  );
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(h.requests.length, 2, 'instrument metadata is reused');
  h.sockets[1].open();
  h.respond(2, [bar(60_000), bar(120_000), bar(180_000)]);
  await flush();
  h.sockets[1].push('candle', bar(240_000));
  assert.equal(h.events.filter(event => event.type === 'candles.history').length, 2);
  assert.deepEqual(
    h.events.filter(event => event.type === 'candle').map(event => event.candle.timeMs),
    [240_000],
  );
});

test('a closed socket reconnects with backoff and resubscribes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  h.sockets[0].close();
  assert.ok(h.events.some(event => event.type === 'stream.status' && event.status === 'stale'));
  t.mock.timers.tick(999);
  assert.equal(h.sockets.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].close();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(h.sockets.length, 2);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(h.sockets.length, 3);
  h.sockets[2].open();
  assert.equal(h.sockets[2].sent.length, 1);
});

test('the watchdog pings, marks silent candles stale and reconnects after a long quiet spell', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  t.mock.timers.tick(30_000);
  assert.ok(
    h.events.some(
      event =>
        event.type === 'stream.status' &&
        event.status === 'stale' &&
        event.message === 'Waiting for candle updates',
    ),
  );
  assert.deepEqual(h.sockets[0].sent.at(-1), { method: 'ping' });
  h.sockets[0].push('candle', bar(60_000, 20, 100, 9));
  t.mock.timers.tick(89_000);
  assert.equal(h.sockets[0].readyState, 1);
  t.mock.timers.tick(1000);
  assert.equal(h.sockets[0].readyState, 3);
  assert.ok(
    h.events.some(
      event => event.type === 'stream.status' && event.message === 'No candle updates; reconnecting',
    ),
  );
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  assert.equal(h.requests.length, 3);
  h.respond(2, [bar(60_000, 30, 100, 10)]);
  await flush();
});

test('loadOlder requests the page before the first bar and reports exhaustion and errors', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  h.connection.loadOlder!(600_000_000);
  const page = h.requests[2].body as { req: { startTime: number; endTime: number } };
  assert.equal(page.req.endTime, 599_999_999);
  assert.equal(page.req.startTime, 600_000_000 - 500 * 60_000);
  h.respond(2, [bar(599_880_000), bar(599_940_000)]);
  await flush();
  h.connection.loadOlder!(599_880_000);
  h.respond(3, []);
  await flush();
  h.connection.loadOlder!(599_880_000);
  h.respond(4, [bar(599_880_000)]); // overlaps the loaded bars
  await flush();
  h.connection.loadOlder!(599_880_000);
  h.respond(5, { error: 'busy' }, 500);
  await flush();
  const prepends = h.events.filter(event => event.type === 'candles.prepend');
  assert.deepEqual(
    prepends.map(event => [event.candles.length, event.exhausted ?? false, Boolean(event.error)]),
    [
      [2, false, false],
      [0, true, false],
      [0, false, true],
      [0, false, true],
    ],
  );
});

test('HTTP 429 sets a shared cooldown that holds through pause and resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, null, 429, { 'Retry-After': '120' });
  await flush();
  h.connection.setPaused(true);
  h.connection.setPaused(false);
  await flush();
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(119_999);
  await flush();
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(h.requests.length, 2);
});

test('pause aborts bootstrap and suppresses late events; resume reloads history', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, metadata);
  await flush();
  h.sockets[0].open();
  h.connection.setPaused(true);
  assert.equal(h.requests[1].signal?.aborted, true);
  assert.equal(h.sockets[0].readyState, 3);
  const count = h.events.length;
  h.respond(1, [bar(60_000, 10, 101)]);
  h.sockets[0].push('candle', bar(60_000, 11, 102, 6));
  await flush();
  assert.equal(h.events.length, count);
  h.connection.setPaused(false);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  h.respond(2, [bar(60_000, 20, 108)]);
  await flush();
  assert.deepEqual(
    h.events.filter(event => event.type === 'candles.history').map(event => event.candles[0].close),
    [108],
  );
});

test('dispose during metadata closes everything and publishes nothing afterwards', async () => {
  const h = harness();
  h.connection.dispose();
  h.connection.dispose();
  assert.equal(h.requests[0].signal?.aborted, true);
  const count = h.events.length;
  h.respond(0, metadata);
  await flush();
  assert.equal(h.events.length, count);
  assert.equal(h.sockets.length, 0);
});

test('dispose after connecting closes the socket and drops later messages', async () => {
  const h = harness();
  await h.ready();
  h.connection.dispose();
  assert.equal(h.sockets[0].readyState, 3);
  const count = h.events.length;
  h.sockets[0].push('candle', bar(60_000, 11, 102, 6));
  h.connection.loadOlder!(60_000);
  await flush();
  assert.equal(h.events.length, count);
  assert.equal(h.requests.length, 2);
});

test('unknown symbols and intervals are rejected before any request', () => {
  const calls: string[] = [];
  const transport: HyperliquidTransport = {
    fetch: () => {
      calls.push('fetch');
      return Promise.reject(new Error('unused'));
    },
    createSocket: () => {
      calls.push('socket');
      throw new Error('unused');
    },
  };
  for (const options of [
    { symbol: 'DOGE/USDC' },
    { symbol: 'BTC/USDT' },
    { interval: '1w' },
    { interval: '1s' },
    { interval: '7m' },
  ])
    assert.throws(
      () => createHyperliquidFeed(options as Parameters<typeof createHyperliquidFeed>[0], transport),
      { code: 'UNSUPPORTED_MARKET' },
    );
  assert.deepEqual(calls, []);
  assert.equal(HYPERLIQUID_INTERVALS.includes('1w'), false);
  const feed = createHyperliquidFeed({ symbol: 'HYPE/USDC', interval: '4h' }, transport);
  assert.equal(feed.descriptor.intervalMs, 4 * 3_600_000);
  assert.equal(feed.descriptor.instrument.base, 'HYPE');
});

test('a delisted or missing coin is reported instead of guessed', async t => {
  const h = harness({ symbol: 'ETH/USDC' });
  t.after(() => h.connection.dispose());
  h.respond(0, [{ universe: [{ name: 'ETH', szDecimals: 4, isDelisted: true }] }, [{ markPx: '20' }]]);
  await flush();
  assert.equal(h.sockets.length, 0);
  assert.ok(
    h.events.some(
      event =>
        event.type === 'stream.status' &&
        event.status === 'error' &&
        event.message === 'Market is unavailable',
    ),
  );
});
