import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { ChartRuntime } from '../src/runtime.ts';
import { createStaticFeed } from '../src/static-feed.ts';
import { sma } from '../src/indicators.ts';
import { chartCommandBatchSchema, chartCommandSchema, chartCommandTypes } from '../src/command-schema.ts';
import type { Candle, ChartCommand } from '../src/types.ts';

const MINUTE = 60_000;
const bars: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const close = Number((100 + 5 * Math.sin(i / 9)).toFixed(2));
  return { timeMs: i * MINUTE, open: close, high: close + 1, low: close - 1, close, volume: 2 };
});
function chart() {
  const runtime = new ChartRuntime(createStaticFeed({ candles: bars, interval: '1m', instrument: 'TEST' }), [
    sma(20),
  ]);
  runtime.start();
  return runtime;
}

test('a batch applies atomically as one revision and one undo step, and returns created ids', () => {
  const runtime = chart();
  const before = runtime.inspect().documentRevision;
  let publications = 0;
  runtime.subscribe(() => publications++);
  publications = 0;
  const result = runtime.execute(
    [
      { type: 'indicator.add', indicator: { kind: 'rsi' } },
      { type: 'indicator.add', indicator: { kind: 'macd', id: 'momentum' } },
      { type: 'priceScale.log', enabled: true },
      {
        type: 'drawing.add',
        drawing: { id: 'level', type: 'horizontal', points: [{ timeMs: 0, price: 101 }] },
      },
    ],
    before,
  );
  assert.deepEqual(result, { documentRevision: before + 1, created: ['rsi', 'momentum', 'level'] });
  assert.equal(publications, 1, 'subscribers see the batch once');
  const doc = runtime.exportDocument();
  assert.equal(doc.indicators.length, 3);
  assert.equal(doc.priceScale.log, true);
  runtime.execute({ type: 'history.undo' });
  const undone = runtime.exportDocument();
  assert.equal(undone.indicators.length, 1, 'one undo reverts the whole batch');
  assert.equal(undone.drawings.length, 0);
  runtime.dispose();
});

test('a failing batch changes nothing and reports the command index', () => {
  const runtime = chart();
  const before = runtime.exportDocument(),
    revision = runtime.inspect().documentRevision;
  assert.throws(
    () =>
      runtime.execute([
        { type: 'indicator.add', indicator: { kind: 'rsi' } },
        { type: 'indicator.update', id: 'rsi', inputs: { period: 9000 } },
      ]),
    (error: { code: string; path: string; details: { index: number } }) =>
      error.code === 'INVALID_INDICATOR_INPUT' &&
      error.path === '1.inputs.period' &&
      error.details.index === 1,
  );
  assert.deepEqual(runtime.exportDocument(), before);
  assert.equal(runtime.inspect().documentRevision, revision);
  assert.equal(runtime.inspect().history.canUndo, false);
  assert.throws(() => runtime.execute([{ type: 'feed.pause', paused: true }]), {
    code: 'INVALID_BATCH',
    path: '0.type',
  });
  runtime.dispose();
});

test('preview returns the would-be document without changing anything', () => {
  const runtime = chart();
  const before = runtime.exportDocument();
  const ok = runtime.preview([{ type: 'indicator.add', indicator: { kind: 'ema', inputs: { period: 50 } } }]);
  assert.ok(ok.ok);
  assert.deepEqual(ok.created, ['ema']);
  assert.equal(ok.document.indicators.at(-1)?.kind, 'ema');
  assert.deepEqual(runtime.exportDocument(), before);
  const bad = runtime.preview([{ type: 'viewport.set', fromMs: 0, toMs: MINUTE }]);
  assert.ok(!bad.ok);
  assert.equal(bad.error.code, 'INVALID_VIEWPORT');
  assert.equal(bad.error.path, '0.viewport');
  const stale = runtime.preview([], 999);
  assert.ok(!stale.ok && stale.error.code === 'REVISION_CONFLICT');
  runtime.dispose();
});

test('idempotency keys make retries safe even after the revision moved on', () => {
  const runtime = chart();
  const commands: ChartCommand[] = [{ type: 'indicator.add', indicator: { kind: 'rsi' } }];
  const first = runtime.execute(commands, 0, { idempotencyKey: 'add-rsi' });
  const retry = runtime.execute(commands, 0, { idempotencyKey: 'add-rsi' });
  assert.deepEqual(retry, first);
  assert.equal(runtime.exportDocument().indicators.length, 2, 'applied once');
  assert.throws(
    () =>
      runtime.execute([{ type: 'indicator.add', indicator: { kind: 'ema' } }], undefined, {
        idempotencyKey: 'add-rsi',
      }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  runtime.dispose();
});

test('query returns aligned candles and indicator values with nulls for warmup', () => {
  const runtime = chart();
  const latest = runtime.query({ limit: 3 });
  assert.equal(latest.candles.length, 3);
  assert.equal(latest.truncated, true);
  assert.equal(latest.candles.at(-1)?.timeMs, 399 * MINUTE);
  const start = runtime.query({ fromMs: 0, toMs: 30 * MINUTE });
  assert.equal(start.candles.length, 31);
  const values = start.indicators[0].outputs.value;
  assert.equal(values.length, 31);
  assert.equal(values[18], null);
  assert.equal(typeof values[19], 'number');
  const visible = runtime.query({ visible: true, indicators: false });
  const { fromMs, toMs } = runtime.inspect().document.viewport;
  assert.ok(visible.candles.every(bar => bar.timeMs >= fromMs && bar.timeMs <= toMs));
  assert.deepEqual(visible.indicators, []);
  assert.throws(() => runtime.query({ limit: 0 }), { code: 'INVALID_QUERY', path: 'limit' });
  runtime.dispose();
});

test('the command schema covers every command type', () => {
  const variants = (chartCommandSchema as { oneOf: { properties: { type: { const: string } } }[] }).oneOf;
  assert.deepEqual(
    variants.map(v => v.properties.type.const),
    chartCommandTypes,
  );
  assert.equal(chartCommandTypes.length, 20);
  assert.equal((chartCommandBatchSchema as { maxItems: number }).maxItems, 500);
  const runtime = chart();
  assert.deepEqual(runtime.inspect().capabilities.commands, chartCommandTypes);
  runtime.dispose();
});

test('the MCP example server answers initialize, tools/list and tools/call', async () => {
  const server = spawn(process.execPath, ['--experimental-strip-types', 'examples/mcp-server.ts'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = new Map<number, { result?: Record<string, unknown>; error?: unknown }>();
  let buffer = '';
  server.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const reply = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      replies.set(reply.id, reply);
    }
  });
  const call = (id: number, method: string, params: object = {}) =>
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  call(1, 'initialize', { protocolVersion: '2025-06-18' });
  call(2, 'tools/list');
  call(3, 'tools/call', {
    name: 'chart_execute',
    arguments: { commands: [{ type: 'indicator.add', indicator: { kind: 'rsi' } }], expectedRevision: 0 },
  });
  call(4, 'tools/call', { name: 'chart_execute', arguments: { commands: [], expectedRevision: 99 } });
  for (let i = 0; i < 100 && replies.size < 4; i++) await new Promise(resolve => setTimeout(resolve, 50));
  server.stdin.end();
  assert.equal((replies.get(1)?.result?.serverInfo as { name: string }).name, 'openchart');
  const names = (replies.get(2)?.result?.tools as { name: string }[]).map(t => t.name);
  assert.ok(names.includes('chart_execute') && names.includes('chart_query'));
  assert.deepEqual(replies.get(3)?.result?.structuredContent, { documentRevision: 1, created: ['rsi'] });
  assert.equal(replies.get(4)?.result?.isError, true);
  assert.equal((replies.get(4)?.result?.structuredContent as { code: string }).code, 'REVISION_CONFLICT');
});
