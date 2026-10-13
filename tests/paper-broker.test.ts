import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPaperBroker } from '../src/paper-broker.ts';
import type { BrokerState } from '../src/trading-types.ts';

function setup() {
  const broker = createPaperBroker({ pointValue: () => 2, maxQuantity: 5 });
  let state!: BrokerState;
  broker.subscribe(s => (state = s));
  return { broker, state: () => state };
}

test('a market order fills at the last price and opens a position', async () => {
  const { broker, state } = setup();
  assert.match(
    (await broker.placeOrder({ account: 'Paper', symbol: 'MNQ', side: 'buy', quantity: 1, type: 'market' }))
      .error!,
    /No price/,
  );
  broker.onMarketPrice('MNQ', 100, 1);
  const result = await broker.placeOrder({
    account: 'Paper',
    symbol: 'MNQ',
    side: 'buy',
    quantity: 2,
    type: 'market',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(state().positions, [{ account: 'Paper', symbol: 'MNQ', quantity: 2, averagePrice: 100 }]);
  assert.equal(state().fills.length, 1);
});

test('limits fill when price reaches them, stops when it trades through', async () => {
  const { broker, state } = setup();
  broker.onMarketPrice('MNQ', 100, 1);
  await broker.placeOrder({
    account: 'Paper',
    symbol: 'MNQ',
    side: 'buy',
    quantity: 1,
    type: 'limit',
    price: 98,
  });
  await broker.placeOrder({
    account: 'Paper',
    symbol: 'MNQ',
    side: 'buy',
    quantity: 1,
    type: 'stop',
    price: 103,
  });
  assert.equal(state().orders.length, 2);
  broker.onMarketPrice('MNQ', 97.5, 2);
  assert.deepEqual(
    state().positions.map(p => [p.quantity, p.averagePrice]),
    [[1, 98]],
  );
  broker.onMarketPrice('MNQ', 104, 3);
  assert.deepEqual(
    state().positions.map(p => [p.quantity, p.averagePrice]),
    [[2, 101]],
  );
  assert.equal(state().orders.length, 0);
});

test('reduce-only orders must close part of the position', async () => {
  const { broker, state } = setup();
  broker.onMarketPrice('MNQ', 100, 1);
  const tp = {
    account: 'Paper',
    symbol: 'MNQ',
    side: 'sell',
    quantity: 1,
    type: 'limit',
    price: 110,
    reduceOnly: true,
  } as const;
  assert.match((await broker.placeOrder(tp)).error!, /reduce-only/);
  await broker.placeOrder({ account: 'Paper', symbol: 'MNQ', side: 'buy', quantity: 1, type: 'market' });
  assert.equal((await broker.placeOrder(tp)).ok, true);
  broker.onMarketPrice('MNQ', 110, 2);
  assert.deepEqual(state().positions, []); // Flat after the TP.
});

test('orders can be moved and cancelled, and quantities are capped', async () => {
  const { broker, state } = setup();
  const { orderId } = await broker.placeOrder({
    account: 'Paper',
    symbol: 'MNQ',
    side: 'sell',
    quantity: 1,
    type: 'limit',
    price: 120,
  });
  await broker.modifyOrder('Paper', orderId!, { price: 115, quantity: 2 });
  assert.deepEqual([state().orders[0]!.price, state().orders[0]!.quantity], [115, 2]);
  await broker.cancelOrder('Paper', orderId!);
  assert.deepEqual(state().orders, []);
  assert.match((await broker.cancelOrder('Paper', orderId!)).error!, /not working/);
  assert.match(
    (await broker.placeOrder({ account: 'Paper', symbol: 'MNQ', side: 'buy', quantity: 9, type: 'market' }))
      .error!,
    /at most 5/,
  );
});
