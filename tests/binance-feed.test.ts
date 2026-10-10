import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBinanceFeed } from '../src/binance-feed.ts';
import type { BinanceSocket } from '../src/binance-feed.ts';
import type { FeedEvent } from '../src/types.ts';

class Socket extends EventTarget implements BinanceSocket {
  readyState = 0;
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  send(stream: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ stream, data }) }));
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const metadata = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
        { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
      ],
    },
  ],
};
const row = (timeMs = 60_000, volume = 10, close = 100) => [
  timeMs,
  '100',
  '110',
  '90',
  String(close),
  String(volume),
  timeMs + 59_999,
];
const kline = (timeMs = 60_000, volume = 10, close = 100, eventTime = timeMs + 20_000) => ({
  e: 'kline',
  E: eventTime,
  s: 'BTCUSDT',
  k: {
    t: timeMs,
    T: timeMs + 59_999,
    s: 'BTCUSDT',
    i: '1m',
    o: '100',
    h: '110',
    l: '90',
    c: String(close),
    v: String(volume),
  },
});
const book = (sequence = 100) => ({
  lastUpdateId: sequence,
  bids: [
    ['99', '2'],
    ['98', '3'],
  ],
  asks: [
    ['101', '4'],
    ['102', '5'],
  ],
});

function harness() {
  const requests: { url: string; signal: AbortSignal | null | undefined; resolve(value: Response): void }[] =
    [];
  const sockets: Socket[] = [];
  const urls: string[] = [];
  const events: FeedEvent[] = [];
  const fetcher: typeof fetch = (input, init) =>
    new Promise<Response>(resolve => requests.push({ url: String(input), signal: init?.signal, resolve }));
  const feed = createBinanceFeed(
    {},
    {
      fetch: fetcher,
      createSocket(url) {
        urls.push(url);
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
    },
  );
  const connection = feed.connect(event => events.push(event));
  function respond(index: number, value: unknown, status = 200, headers?: HeadersInit): void {
    requests[index].resolve(new Response(JSON.stringify(value), { status, headers }));
  }
  async function ready() {
    respond(0, metadata);
    await flush();
    sockets[0].open();
    respond(1, [row()]);
    await flush();
  }
  return { feed, connection, events, requests, sockets, urls, respond, ready };
}

test('Binance validates metadata before data and opens the selected stream before requesting history', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  assert.equal(h.sockets.length, 0);
  assert.match(h.requests[0].url, /exchangeInfo\?symbol=BTCUSDT$/);
  h.respond(0, metadata);
  await flush();
  assert.equal(h.requests.length, 1);
  const event = h.events.find(event => event.type === 'instrument');
  assert.equal(event?.instrument.tickSize, 0.01);
  assert.equal(event?.instrument.pricePrecision, 2);
  assert.equal(event?.instrument.quantityPrecision, 5);
  assert.equal(
    h.urls[0],
    'wss://data-stream.binance.vision:443/stream?streams=btcusdt@kline_1m/btcusdt@depth20',
  );
  h.sockets[0].open();
  assert.match(h.requests[1].url, /klines\?symbol=BTCUSDT&interval=1m&limit=360$/);
  h.respond(1, [row()]);
  await flush();
  assert.equal(h.events.filter(event => event.type === 'candles.history').length, 1);
});

test('depth snapshots publish independently while candle history loads, without synthetic delta sequences', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, metadata);
  await flush();
  h.sockets[0].open();
  h.sockets[0].send('btcusdt@depth20', book(900));
  h.sockets[0].send('btcusdt@depth20', book(970));
  h.sockets[0].send('btcusdt@depth20', book(910));
  assert.deepEqual(
    h.events.filter(event => event.type === 'depth.snapshot').map(event => event.book.sequence),
    [900, 970],
  );
  assert.equal(
    h.events.some(event => event.type === 'candles.history'),
    false,
  );
  assert.equal(
    h.events.some(event => event.type === 'depth.delta'),
    false,
  );
  h.respond(1, [row()]);
  await flush();
});

test('bootstrap merging and reordered kline messages cannot roll prices or cumulative volume backward', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, metadata);
  await flush();
  h.sockets[0].open();
  h.sockets[0].send('btcusdt@kline_1m', kline(60_000, 7, 101));
  h.sockets[0].send('btcusdt@kline_1m', kline(120_000, 3, 103));
  h.respond(1, [row(60_000, 10, 104)]);
  await flush();
  const initial = h.events.find(event => event.type === 'candles.history')!;
  assert.deepEqual(
    initial.candles.map(bar => [bar.timeMs, bar.close, bar.volume]),
    [
      [60_000, 104, 10],
      [120_000, 103, 3],
    ],
  );
  h.sockets[0].send('btcusdt@kline_1m', kline(60_000, 9, 102, 110_000));
  h.sockets[0].send('btcusdt@kline_1m', kline(120_000, 5, 106, 150_000));
  h.sockets[0].send('btcusdt@kline_1m', kline(120_000, 5, 105, 145_000));
  assert.deepEqual(
    h.events.filter(event => event.type === 'candle').map(event => event.candle.close),
    [106],
  );
});

test('malformed depth reports only its own stream and the next valid full snapshot can recover', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  const count = h.events.length;
  h.sockets[0].send('btcusdt@depth20', { ...book(), bids: [['105', '2']] });
  assert.deepEqual(
    h.events
      .slice(count)
      .map(event => (event.type === 'stream.status' ? [event.stream, event.status] : event.type)),
    [['depth', 'error']],
  );
  h.sockets[0].send('btcusdt@depth20', book(101));
  assert.equal(h.events.at(-1)?.type, 'depth.snapshot');
  assert.equal(h.sockets[0].readyState, 1);
});

test('a skipped candle reconnects and refreshes history before subsequent live bars publish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  h.sockets[0].send('btcusdt@kline_1m', kline(180_000));
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(
    h.events.some(event => event.type === 'candle'),
    false,
  );
  assert.ok(
    h.events.some(
      event =>
        event.type === 'stream.status' &&
        event.stream === 'candles' &&
        event.message === 'Candle gap; reconnecting to refresh history',
    ),
  );
  t.mock.timers.tick(1000);
  await flush();
  h.sockets[1].open();
  h.respond(2, [row(60_000), row(120_000), row(180_000)]);
  await flush();
  h.sockets[1].send('btcusdt@kline_1m', kline(240_000));
  assert.equal(h.events.filter(event => event.type === 'candles.history').length, 2);
  assert.deepEqual(
    h.events.filter(event => event.type === 'candle').map(event => event.candle.timeMs),
    [240_000],
  );
});

test('late candles older than retained history do not publish unknown corrections', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  for (let index = 2; index <= 2001; index++) h.sockets[0].send('btcusdt@kline_1m', kline(index * 60_000));
  const count = h.events.length;
  h.sockets[0].send('btcusdt@kline_1m', kline(60_000, 100));
  assert.equal(h.events.length, count);
  assert.equal(h.sockets[0].readyState, 1);
});

test('pause aborts bootstrap and suppresses late REST and socket events; resume refetches history', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, metadata);
  await flush();
  h.sockets[0].open();
  h.connection.setPaused(true);
  assert.equal(h.requests[1].signal?.aborted, true);
  assert.equal(h.sockets[0].readyState, 3);
  const count = h.events.length;
  h.respond(1, [row(60_000, 10, 101)]);
  h.sockets[0].send('btcusdt@depth20', book());
  await flush();
  assert.equal(h.events.length, count);
  h.connection.setPaused(false);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  h.respond(2, [row(60_000, 20, 108)]);
  await flush();
  assert.deepEqual(
    h.events.filter(event => event.type === 'candles.history').map(event => event.candles[0].close),
    [108],
  );
});

test('disposing during metadata fetch cannot open a socket or publish delayed results', async () => {
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

test('Retry-After prevents early HTTP retries even through pause and resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  h.respond(0, { msg: 'Rate limit' }, 429, { 'Retry-After': '120' });
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

test('watchdog exposes a silent depth stream and reconnects without hiding active candles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 600_000 });
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  h.sockets[0].send('btcusdt@depth20', book());
  t.mock.timers.tick(10_000);
  assert.ok(
    h.events.some(
      event => event.type === 'stream.status' && event.stream === 'depth' && event.status === 'stale',
    ),
  );
  h.sockets[0].send('btcusdt@kline_1m', kline(60_000, 20));
  t.mock.timers.tick(20_000);
  assert.equal(h.sockets[0].readyState, 3);
  assert.ok(
    h.events.some(
      event =>
        event.type === 'stream.status' &&
        event.stream === 'depth' &&
        event.message === 'No depth updates; reconnecting',
    ),
  );
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].open();
  assert.equal(h.requests.length, 3);
  h.respond(2, [row(60_000, 30)]);
  await flush();
});

test('unexpected stream envelopes reconnect instead of attributing another market to the current one', async t => {
  const h = harness();
  t.after(() => h.connection.dispose());
  await h.ready();
  const count = h.events.length;
  h.sockets[0].send('ethusdt@depth20', book());
  assert.equal(h.sockets[0].readyState, 3);
  assert.equal(
    h.events.slice(count).some(event => event.type === 'depth.snapshot'),
    false,
  );
  assert.ok(h.events.slice(count).every(event => event.type === 'stream.status' && event.status === 'error'));
});
