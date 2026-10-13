import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeOrder,
  exitResizes,
  entryTypeAt,
  exitAt,
  formatPnl,
  pnlAt,
  positionEffect,
  positionOf,
} from '../src/trading-logic.ts';
import type { BrokerPosition, BrokerState } from '../src/trading-types.ts';

const long: BrokerPosition = { account: 'A', symbol: 'MNQ', quantity: 2, averagePrice: 100 };
const short: BrokerPosition = { ...long, quantity: -1 };

test('P&L and its text', () => {
  assert.equal(pnlAt(long, 105, 2), 20);
  assert.equal(pnlAt(short, 105, 2), -10);
  assert.equal(formatPnl(20, '$', 2), '+$20.00');
  assert.equal(formatPnl(-10, '€', 2), '−€10.00');
  // Without a point value the amount is in points.
  assert.equal(formatPnl(5), '+5.00 pts');
});

test('P&L reads in points when the broker gives no point value', () => {
  assert.equal(describeOrder({ side: 'sell', type: 'limit' }, long, 103).label, 'TP +6.00 pts');
});

test('a limit that closes the position is a TP, a stop an SL, others are entries', () => {
  assert.deepEqual(describeOrder({ side: 'sell', type: 'limit' }, long, 110, 2), {
    kind: 'TP',
    label: 'TP +$40.00',
    tone: 'positive',
  });
  assert.deepEqual(describeOrder({ side: 'sell', type: 'stop' }, long, 95, 2), {
    kind: 'SL',
    label: 'SL −$20.00',
    tone: 'negative',
  });
  assert.equal(describeOrder({ side: 'buy', type: 'limit' }, long, 95, 2).label, 'BUY LIMIT');
  assert.equal(describeOrder({ side: 'buy', type: 'stop' }, null, 95, 2).label, 'BUY STOP');
  assert.equal(describeOrder({ side: 'buy', type: 'limit' }, short, 95, 2).kind, 'TP');
});

test('dragging out of the position: TP beyond the market in its favor, SL against it', () => {
  assert.deepEqual(exitAt(long, 100, 104), { kind: 'TP', side: 'sell', type: 'limit', quantity: 2 });
  assert.deepEqual(exitAt(long, 100, 97), { kind: 'SL', side: 'sell', type: 'stop', quantity: 2 });
  assert.deepEqual(exitAt(short, 100, 97), { kind: 'TP', side: 'buy', type: 'limit', quantity: 1 });
  assert.deepEqual(exitAt(short, 100, 104), { kind: 'SL', side: 'buy', type: 'stop', quantity: 1 });
});

test('an entry rests as a limit on the passive side and a stop beyond the market', () => {
  assert.equal(entryTypeAt('buy', 99, 100), 'limit');
  assert.equal(entryTypeAt('buy', 101, 100), 'stop');
  assert.equal(entryTypeAt('sell', 101, 100), 'limit');
  assert.equal(entryTypeAt('sell', 99, 100), 'stop');
  assert.equal(entryTypeAt('sell', 99, null), 'limit');
});

test('describes what an order does to the position', () => {
  assert.equal(positionEffect(0, 'buy', 1), 'Opens long 1');
  assert.equal(positionEffect(1, 'buy', 1), 'Adds to your long: 2 after');
  assert.equal(positionEffect(2, 'sell', 1), 'Reduces your long to 1');
  assert.equal(positionEffect(1, 'sell', 1), 'Closes your position');
  assert.equal(positionEffect(1, 'sell', 3), 'Reverses to short 2');
});

test('finds an open position for an account and symbol', () => {
  const state: BrokerState = {
    connected: true,
    tradingEnabled: true,
    accounts: ['A'],
    orders: [],
    positions: [long, { ...long, symbol: 'ES', quantity: 0 }],
    fills: [],
  };
  assert.equal(positionOf(state, 'A', 'MNQ'), long);
  assert.equal(positionOf(state, 'A', 'ES'), null);
});

test('a single TP and SL are resized to the whole position; several are left alone', () => {
  const order = (id: string, type: 'limit' | 'stop', quantity: number, side: 'buy' | 'sell' = 'sell') => ({
    id,
    account: 'A',
    symbol: 'MNQ',
    side,
    type,
    quantity,
    price: type === 'limit' ? 110 : 90,
  });
  const state = (orders: ReturnType<typeof order>[]): BrokerState => ({
    connected: true,
    tradingEnabled: true,
    accounts: ['A'],
    orders,
    positions: [{ account: 'A', symbol: 'MNQ', quantity: 3, averagePrice: 100 }],
    fills: [],
  });
  // Added to a long of 1: both brackets grow to 3.
  assert.deepEqual(exitResizes(state([order('tp', 'limit', 1), order('sl', 'stop', 1)]), 'A'), [
    { orderId: 'tp', quantity: 3 },
    { orderId: 'sl', quantity: 3 },
  ]);
  // Two targets scale out: only the single SL is resized.
  assert.deepEqual(
    exitResizes(state([order('t1', 'limit', 1), order('t2', 'limit', 2), order('sl', 'stop', 1)]), 'A'),
    [{ orderId: 'sl', quantity: 3 }],
  );
  // A buy limit under a long adds to it: not an exit.
  assert.deepEqual(exitResizes(state([order('add', 'limit', 1, 'buy')]), 'A'), []);
  // Already the right size: nothing to do.
  assert.deepEqual(exitResizes(state([order('tp', 'limit', 3)]), 'A'), []);
});
