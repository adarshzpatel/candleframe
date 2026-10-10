// A Model Context Protocol server that lets an agent drive a headless chart.
//
//   node --experimental-strip-types examples/mcp-server.ts                 # simulated BTC/USD
//   node --experimental-strip-types examples/mcp-server.ts --csv prices.csv --symbol AAPL --interval 1d --gaps
//
// Register it with Claude Code:
//   claude mcp add openchart -- node --experimental-strip-types /path/to/examples/mcp-server.ts
//
// It speaks JSON-RPC 2.0 over stdio with no dependencies. Tools return JSON text;
// failures return the ChartError as `{ code, message, path, details }` with isError.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  ChartRuntime,
  chartCommandBatchSchema,
  createSimulatedFeed,
  createStaticFeed,
  intervalToMs,
  sma,
  toChartError,
} from '../src/index.ts';
import type { Candle, ChartCommand, FeedAdapter, Interval } from '../src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : (args[index + 1] ?? 'true');
};

function csvFeed(path: string): FeedAdapter {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const columns = header.toLowerCase().split(',');
  const at = (name: string) => {
    const index = columns.findIndex(column => column.trim() === name);
    if (index < 0) throw new Error(`CSV needs a "${name}" column`);
    return index;
  };
  const [t, o, h, l, c] = ['time', 'open', 'high', 'low', 'close'].map(at);
  const v = columns.findIndex(column => column.trim() === 'volume');
  const candles: Candle[] = rows.map(row => {
    const cells = row.split(',');
    const time = cells[t].trim();
    return {
      timeMs: /^\d+$/.test(time) ? Number(time) : Date.parse(time),
      open: Number(cells[o]),
      high: Number(cells[h]),
      low: Number(cells[l]),
      close: Number(cells[c]),
      volume: v < 0 ? 0 : Number(cells[v]),
    };
  });
  const interval = (flag('interval') ?? '1d') as Interval;
  intervalToMs(interval);
  return createStaticFeed({
    candles: candles.sort((a, b) => a.timeMs - b.timeMs),
    interval,
    instrument: flag('symbol') ?? 'CSV',
    gaps: flag('gaps') === 'true',
  });
}

const csv = flag('csv');
const runtime = new ChartRuntime(csv ? csvFeed(csv) : createSimulatedFeed({ seed: 42 }), [sma(20)]);
runtime.start();

const tools = [
  {
    name: 'chart_inspect',
    description:
      'Current chart state: market, stream health, documentRevision, viewport, price scale, indicators with latest values, drawings, and the indicator kinds and drawing tools you can add. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => runtime.inspect(),
  },
  {
    name: 'chart_query',
    description:
      'Candles and indicator values for a time range (UTC ms), the visible range, or the latest bars. Values are aligned with candles; null means warmup.',
    inputSchema: {
      type: 'object',
      properties: {
        fromMs: { type: 'number' },
        toMs: { type: 'number' },
        visible: { type: 'boolean', description: 'Use the current viewport.' },
        limit: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        indicators: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    run: (input: Record<string, unknown>) => runtime.query(input),
  },
  {
    name: 'chart_preview',
    description:
      'Dry-run a batch of commands. Returns the resulting document, or the first error with its command index in error.path. Changes nothing.',
    inputSchema: {
      type: 'object',
      required: ['commands'],
      properties: { commands: chartCommandBatchSchema, expectedRevision: { type: 'integer' } },
      additionalProperties: false,
    },
    run: (input: { commands: ChartCommand[]; expectedRevision?: number }) =>
      runtime.preview(input.commands, input.expectedRevision),
  },
  {
    name: 'chart_execute',
    description:
      'Apply a batch of commands atomically as one undo step. Pass expectedRevision from chart_inspect to avoid overwriting newer edits (REVISION_CONFLICT means inspect again). Pass idempotencyKey to make retries safe. Returns the new documentRevision and created ids.',
    inputSchema: {
      type: 'object',
      required: ['commands'],
      properties: {
        commands: chartCommandBatchSchema,
        expectedRevision: { type: 'integer' },
        idempotencyKey: { type: 'string', maxLength: 128 },
      },
      additionalProperties: false,
    },
    run: (input: { commands: ChartCommand[]; expectedRevision?: number; idempotencyKey?: string }) =>
      runtime.execute(input.commands, input.expectedRevision, { idempotencyKey: input.idempotencyKey }),
  },
  {
    name: 'chart_undo',
    description: 'Undo the last content edit (a whole batch counts as one).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => runtime.execute({ type: 'history.undo' }),
  },
  {
    name: 'chart_export_layout',
    description: 'The saved-layout document: viewport, price scale, indicators and drawings. No market data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => runtime.exportDocument(),
  },
  {
    name: 'chart_restore_layout',
    description: 'Restore a layout from chart_export_layout. It must be for the same market and interval.',
    inputSchema: {
      type: 'object',
      required: ['document'],
      properties: { document: { type: 'object' }, expectedRevision: { type: 'integer' } },
      additionalProperties: false,
    },
    run: (input: { document: unknown; expectedRevision?: number }) => {
      runtime.restoreDocument(input.document, input.expectedRevision);
      return { documentRevision: runtime.inspect().documentRevision };
    },
  },
] as const;

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Record<string, unknown> };
const send = (message: object): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
};

function handle(message: Message): void {
  const { id, method, params = {} } = message;
  if (id === undefined) return; // Notifications, such as notifications/initialized.
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: (params.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'openchart', version: '0.3.0' },
          instructions:
            'Inspect first. Read candles with chart_query. Preview, then execute with expectedRevision. Errors carry a stable code and a path to the bad input.',
        },
      });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({
        id,
        result: {
          tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        },
      });
    case 'tools/call': {
      const tool = tools.find(t => t.name === params.name);
      if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${String(params.name)}` } });
      try {
        const output = (tool.run as (input: unknown) => unknown)(params.arguments ?? {});
        return send({
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output },
        });
      } catch (error) {
        const failure = toChartError(error).toJSON();
        return send({
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(failure) }],
            structuredContent: failure,
            isError: true,
          },
        });
      }
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line) as Message);
  } catch {
    send({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
});
lines.on('close', () => {
  runtime.dispose();
  process.exit(0);
});
