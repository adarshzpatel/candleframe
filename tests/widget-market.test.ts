import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMarketFeed, validateMarketSources } from '../src/widget-market.ts';
import type { WidgetMarketSource } from '../src/widget-market.ts';
import { INTERVAL_MS } from '../src/types.ts';
import type { FeedAdapter, Interval } from '../src/types.ts';

function fixture() {
  const counts = { factories: 0, connections: 0 };
  const source: WidgetMarketSource = {
    id: 'example',
    label: 'Example exchange',
    symbols: ['BTC/USD', 'ETH/USD'],
    intervals: ['1m', '5m'],
    createFeed({ symbol, interval }) {
      counts.factories++;
      return {
        descriptor: {
          id: 'example',
          label: 'Example exchange',
          simulated: true,
          interval,
          intervalMs: INTERVAL_MS[interval],
          instrument: {
            symbol,
            name: symbol,
            base: symbol.split('/')[0],
            quote: 'USD',
            tickSize: 0.01,
            pricePrecision: 2,
            quantityPrecision: 3,
          },
          depth: { kind: 'snapshots', levels: 20 },
        },
        connect() {
          counts.connections++;
          return { dispose() {}, setPaused() {}, requestSnapshot() {} };
        },
      };
    },
  };
  return { source, counts };
}

test('market catalogs validate without invoking factories or requiring selectable markets', () => {
  const { source, counts } = fixture();
  validateMarketSources([]);
  validateMarketSources([source, { ...source, id: 'second', label: 'Second exchange' }]);
  assert.deepEqual(counts, { factories: 0, connections: 0 });
});

test('market catalogs reject duplicate identities, duplicate entries and malformed sources', () => {
  const { source, counts } = fixture();
  assert.throws(() => validateMarketSources([source, { ...source }]), /DUPLICATE_MARKET_SOURCE/);
  const malformed: unknown[] = [
    null,
    { ...source, id: '' },
    { ...source, id: '  ' },
    { ...source, label: '' },
    { ...source, createFeed: null },
    { ...source, symbols: [] },
    { ...source, symbols: [''] },
    { ...source, symbols: ['BTC/USD', 'BTC/USD'] },
    { ...source, symbols: 'BTC/USD' },
    { ...source, intervals: [] },
    { ...source, intervals: ['1m', '1m'] },
    { ...source, intervals: ['10x'] },
    { ...source, intervals: ['toString'] },
  ];
  for (const candidate of malformed)
    assert.throws(() => validateMarketSources([candidate] as WidgetMarketSource[]), /INVALID_MARKET_SOURCE/);
  assert.throws(
    () => validateMarketSources(null as unknown as WidgetMarketSource[]),
    /INVALID_MARKET_SOURCES/,
  );
  assert.deepEqual(counts, { factories: 0, connections: 0 });
});

test('unsupported market selections fail before creating or connecting an adapter', () => {
  const { source, counts } = fixture();
  assert.throws(
    () => resolveMarketFeed(source, { symbol: 'SOL/USD', interval: '1m' }),
    /UNSUPPORTED_MARKET_SELECTION/,
  );
  assert.throws(
    () => resolveMarketFeed(source, { symbol: 'BTC/USD', interval: '1h' }),
    /UNSUPPORTED_MARKET_SELECTION/,
  );
  assert.throws(
    () => resolveMarketFeed(source, { symbol: 'BTC/USD', interval: 'bad' as Interval }),
    /UNSUPPORTED_MARKET_SELECTION/,
  );
  assert.deepEqual(counts, { factories: 0, connections: 0 });
});

test('feed resolution verifies source, symbol, interval and duration without connecting', () => {
  const { source, counts } = fixture(),
    selection = { symbol: 'ETH/USD', interval: '5m' as const };
  for (const mismatch of [
    { id: 'other' },
    { interval: '1m' as const },
    { intervalMs: 123 },
    {
      instrument: {
        symbol: 'BTC/USD',
        name: 'Bitcoin',
        base: 'BTC',
        quote: 'USD',
        tickSize: 0.01,
        pricePrecision: 2,
        quantityPrecision: 3,
      },
    },
  ]) {
    const bad = {
      ...source,
      createFeed(value: typeof selection) {
        const feed = source.createFeed(value);
        return { ...feed, descriptor: { ...feed.descriptor, ...mismatch } };
      },
    };
    assert.throws(() => resolveMarketFeed(bad, selection), /MARKET_FEED_MISMATCH/);
  }
  for (const result of [null, {}, { descriptor: {} }, Promise.resolve({})]) {
    assert.throws(
      () => resolveMarketFeed({ ...source, createFeed: () => result as unknown as FeedAdapter }, selection),
      /INVALID_MARKET_FEED/,
    );
  }
  assert.equal(counts.connections, 0);
});

test('successful resolution returns the factory adapter and protects caller selection from mutations', () => {
  const { source, counts } = fixture(),
    selection = { symbol: 'ETH/USD', interval: '5m' as Interval };
  const adapter = source.createFeed(selection);
  const resolved = resolveMarketFeed(
    {
      ...source,
      createFeed(request) {
        request.symbol = 'BTC/USD';
        return adapter;
      },
    },
    selection,
  );
  assert.equal(resolved, adapter);
  assert.deepEqual(selection, { symbol: 'ETH/USD', interval: '5m' });
  assert.deepEqual(counts, { factories: 1, connections: 0 });
});

test('factory failures propagate before a caller replaces its active feed', () => {
  const { source, counts } = fixture(),
    selection = { symbol: 'BTC/USD', interval: '1m' as const };
  const previous = source.createFeed(selection),
    error = new Error('Provider unavailable');
  let active = previous;
  assert.throws(
    () => {
      active = resolveMarketFeed(
        {
          ...source,
          createFeed() {
            throw error;
          },
        },
        selection,
      );
    },
    value => value === error,
  );
  assert.equal(active, previous);
  assert.equal(counts.connections, 0);
});

test('typed intervals read in short or long form', async () => {
  const { parseIntervalInput } = await import('../src/widget-market.ts');
  assert.equal(parseIntervalInput('3m'), '3m');
  assert.equal(parseIntervalInput(' 3 min '), '3m');
  assert.equal(parseIntervalInput('700 ticks'), '700t');
  assert.equal(parseIntervalInput('15 range'), '15r');
  assert.equal(parseIntervalInput('12 momentum'), '12mr');
  assert.equal(parseIntervalInput('12mr'), '12mr');
  assert.equal(parseIntervalInput('2 hours'), '2h');
  for (const bad of ['', 'abc', '0t', '5 parsecs', 't']) assert.equal(parseIntervalInput(bad), null, bad);
});

test('a source accepts any length of the kinds it declares, and still its listed intervals', async () => {
  const { supportsInterval, validateMarketSources } = await import('../src/widget-market.ts');
  const base = {
    id: 's',
    label: 'S',
    symbols: ['X'],
    intervals: ['1m' as const],
    createFeed: () => ({}) as never,
  };
  const custom = { ...base, customIntervals: ['time', 'tick'] as const };
  assert.ok(supportsInterval(base, '1m') && !supportsInterval(base, '3m'));
  assert.ok(supportsInterval(custom, '3m') && supportsInterval(custom, '700t'));
  assert.ok(!supportsInterval(custom, '15r'));
  assert.throws(() => validateMarketSources([{ ...base, customIntervals: ['weird' as never] }]), {
    code: 'INVALID_MARKET_SOURCE',
  });
});
