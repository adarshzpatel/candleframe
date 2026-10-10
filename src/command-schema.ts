import type { ChartCommand } from './types.ts';

/**
 * JSON Schema (draft 2020-12) for `ChartCommand`, for agents, tool definitions and
 * request validation outside TypeScript. The runtime still validates every command;
 * the schema describes shapes, and runtime errors cover ranges that depend on state.
 */
type Schema = Record<string, unknown>;

const finite: Schema = { type: 'number' };
const id: Schema = { type: 'string', minLength: 1, maxLength: 128 };
const anchor: Schema = {
  type: 'object',
  description: 'A point on the chart: UTC milliseconds and a price.',
  required: ['timeMs', 'price'],
  properties: { timeMs: finite, price: { type: 'number', exclusiveMinimum: 0 } },
  additionalProperties: false,
};
const style: Schema = {
  type: 'object',
  properties: {
    color: { type: 'string', pattern: '^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' },
    width: { type: 'number', minimum: 1, maximum: 8 },
    lineStyle: { enum: ['solid', 'dashed', 'dotted'] },
    fillOpacity: { type: 'number', minimum: 0, maximum: 1 },
    fontSize: { type: 'number', minimum: 10, maximum: 32 },
  },
  additionalProperties: false,
};
const priceScale: Schema = {
  oneOf: [
    {
      type: 'object',
      required: ['mode'],
      properties: { mode: { const: 'auto' }, log: { type: 'boolean' } },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['mode', 'minPrice', 'maxPrice'],
      properties: {
        mode: { const: 'manual' },
        minPrice: { type: 'number', exclusiveMinimum: 0 },
        maxPrice: { type: 'number', exclusiveMinimum: 0 },
        log: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  ],
};
const inputs: Schema = {
  type: 'object',
  description: 'Numeric inputs; see inspect().indicatorKinds for names, defaults and limits.',
  additionalProperties: finite,
};

function command(
  type: ChartCommand['type'],
  description: string,
  properties: Schema = {},
  required: string[] = [],
) {
  return {
    type: 'object',
    description,
    required: ['type', ...required],
    properties: { type: { const: type }, ...properties },
    additionalProperties: false,
  };
}

/** One entry per command type. The `satisfies` check fails to compile if a type is missing. */
const commands = {
  'layer.set': command(
    'layer.set',
    'Show or hide a layer.',
    { layer: { enum: ['heatmap', 'candles', 'volume', 'indicator'] }, visible: { type: 'boolean' } },
    ['layer', 'visible'],
  ),
  'heatmap.intensity': command(
    'heatmap.intensity',
    'Experimental heatmap brightness.',
    { value: { type: 'number', minimum: 0.2, maximum: 2 } },
    ['value'],
  ),
  'viewport.set': command(
    'viewport.set',
    'Show a time range, 20 to 2,200 bars wide. Stops following live data.',
    { fromMs: finite, toMs: finite, priceScale },
    ['fromMs', 'toMs'],
  ),
  'viewport.reset': command('viewport.reset', 'Return to the live view of the latest 180 bars.'),
  'priceScale.set': command(
    'priceScale.set',
    'Fix the price range. Keeps the log setting.',
    { minPrice: { type: 'number', exclusiveMinimum: 0 }, maxPrice: { type: 'number', exclusiveMinimum: 0 } },
    ['minPrice', 'maxPrice'],
  ),
  'priceScale.reset': command('priceScale.reset', 'Fit the price range to the visible candles.'),
  'priceScale.log': command(
    'priceScale.log',
    'Switch between log and linear price axes. Refits the range.',
    { enabled: { type: 'boolean' } },
    ['enabled'],
  ),
  'indicator.add': command(
    'indicator.add',
    'Add an indicator by kind. The id is generated when omitted and returned in `created`.',
    {
      indicator: {
        type: 'object',
        required: ['kind'],
        properties: {
          id: { type: 'string', pattern: '^[\\w.:-]{1,64}$' },
          kind: { type: 'string', minLength: 1 },
          inputs,
        },
        additionalProperties: false,
      },
    },
    ['indicator'],
  ),
  'indicator.update': command(
    'indicator.update',
    'Change some inputs (merged with the current ones) or visibility.',
    { id, inputs, visible: { type: 'boolean' } },
    ['id'],
  ),
  'indicator.remove': command('indicator.remove', 'Remove an indicator.', { id }, ['id']),
  'drawing.add': command(
    'drawing.add',
    'Add a drawing. See inspect().capabilities.drawingTools for types and point counts.',
    {
      drawing: {
        type: 'object',
        required: ['id', 'type', 'points'],
        properties: {
          id,
          type: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9._:-]{0,79}$' },
          points: { type: 'array', items: anchor, minItems: 1, maxItems: 1024 },
          style,
          locked: { type: 'boolean' },
          visible: { type: 'boolean' },
          text: { type: 'string', maxLength: 2000 },
          levels: { type: 'array', items: { type: 'number', minimum: -1000, maximum: 1000 }, maxItems: 24 },
        },
        additionalProperties: false,
      },
    },
    ['drawing'],
  ),
  'drawing.update': command(
    'drawing.update',
    'Patch a drawing. Locked drawings reject point changes.',
    {
      id,
      patch: {
        type: 'object',
        properties: {
          points: { type: 'array', items: anchor, minItems: 1, maxItems: 1024 },
          style,
          locked: { type: 'boolean' },
          visible: { type: 'boolean' },
          text: { type: 'string', maxLength: 2000 },
          levels: { type: 'array', items: { type: 'number', minimum: -1000, maximum: 1000 }, maxItems: 24 },
        },
        additionalProperties: false,
      },
    },
    ['id', 'patch'],
  ),
  'drawing.remove': command('drawing.remove', 'Delete a drawing.', { id }, ['id']),
  'drawing.duplicate': command(
    'drawing.duplicate',
    'Copy a drawing under a new id, shifted by `offset` (default three bars right).',
    {
      id,
      newId: id,
      offset: {
        type: 'object',
        required: ['timeMs', 'price'],
        properties: { timeMs: finite, price: finite },
        additionalProperties: false,
      },
    },
    ['id', 'newId'],
  ),
  'drawing.order': command(
    'drawing.order',
    'Move a drawing to the front or back.',
    { id, where: { enum: ['front', 'back'] } },
    ['id', 'where'],
  ),
  'drawing.lockAll': command(
    'drawing.lockAll',
    'Lock or unlock every drawing.',
    { locked: { type: 'boolean' } },
    ['locked'],
  ),
  'drawing.clear': command('drawing.clear', 'Delete every drawing.'),
  'history.undo': command('history.undo', 'Undo the last content edit. Not allowed in a batch.'),
  'history.redo': command('history.redo', 'Redo. Not allowed in a batch.'),
  'feed.pause': command(
    'feed.pause',
    'Pause or resume the data feed. Not allowed in a batch.',
    { paused: { type: 'boolean' } },
    ['paused'],
  ),
} satisfies Record<ChartCommand['type'], Schema>;

export const chartCommandTypes = Object.keys(commands) as ChartCommand['type'][];

/** Schema for one command. */
export const chartCommandSchema: Readonly<Schema> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openchart.dev/schemas/chart-command.json',
  title: 'ChartCommand',
  oneOf: Object.values(commands),
};

/** Schema for `execute` and `preview` batches. */
export const chartCommandBatchSchema: Readonly<Schema> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openchart.dev/schemas/chart-command-batch.json',
  title: 'ChartCommand batch',
  type: 'array',
  maxItems: 500,
  items: { oneOf: Object.values(commands) },
};
