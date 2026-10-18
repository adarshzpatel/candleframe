// Writes the Commands reference page from the command JSON Schema, so the page cannot
// drift from `src/command-schema.ts`. Each example is built from the required properties
// and checked against a headless runtime; the script fails if one is rejected for any
// reason other than naming an id that does not exist yet.
// Run: node --experimental-strip-types scripts/generate-command-docs.ts   (npm run docs:commands)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChartRuntime, chartCommandSchema, createSimulatedFeed } from '../src/index.ts';
import type { ChartCommand } from '../src/index.ts';

type Schema = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  oneOf?: Schema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  maxProperties?: number;
  uniqueItems?: boolean;
  pattern?: string;
};

const out = fileURLToPath(new URL('../site/src/content/docs/reference/commands.md', import.meta.url));
const variants = (chartCommandSchema as { oneOf: Schema[] }).oneOf;
/** Rows nest this deep (`drawing.points[].timeMs`); deeper objects are summarized inline. */
const MAX_DEPTH = 3;

// Example values by `<command>:<path>`, then by property name. Everything else comes
// from the schema: the first enum value, true, or the smallest number allowed.
const HOUR = 3_600_000;
const T = Date.UTC(2026, 0, 5, 14);
const examples: Record<string, unknown> = {
  'indicator.update:id': 'rsi',
  'indicator.remove:id': 'rsi',
  'drawing.group:id': 'group-1',
  'drawing.updateGroup:id': 'group-1',
  'drawing.ungroup:id': 'group-1',
  'drawing.updateGroup:name': 'Levels',
  'drawing.update:patch.text': 'Weekly support',
  'drawing:id': 'support',
  'drawing:type': 'horizontal',
  'indicator:kind': 'rsi',
  layer: 'volume',
  chartType: 'heikin-ashi',
  value: 1,
  fromMs: T - 3 * HOUR,
  toMs: T,
  timeMs: T,
  price: 64000,
  minPrice: 60000,
  maxPrice: 70000,
  id: 'support',
  newId: 'support-copy',
  'drawingIds[]': 'support',
  'ids[]': 'support',
};
// Optional properties worth showing, because the required ones alone say little or fail.
const extras = new Set(['drawing.updateGroup:name', 'drawing.update:patch.text']);
// What an example needs on the chart, by the error a fresh chart returns.
const needs: Record<string, string> = {
  DRAWING_NOT_FOUND: 'a drawing with id `support`',
  INVALID_DRAWING_GROUP: 'a drawing with id `support`',
  INVALID_DRAWING_ORDER: 'a drawing with id `support` (and no others)',
  INDICATOR_NOT_FOUND: 'an indicator with id `rsi`',
  DRAWING_GROUP_NOT_FOUND: 'a drawing group with id `group-1`',
};

function exampleValue(schema: Schema, command: string, path: string): unknown {
  const name = path.split('.').at(-1)!;
  for (const key of [`${command}:${path}`, `${path.split('.')[0]}:${name}`, name])
    if (key in examples) return examples[key];
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return exampleValue(schema.oneOf[0], command, path);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') return true;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'string') return 'text';
  if (type === 'array')
    return Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () =>
      exampleValue(schema.items ?? {}, command, `${path}[]`),
    );
  if (type === 'object') {
    const value: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (schema.required?.includes(key) || extras.has(`${command}:${path}.${key}`))
        value[key] = exampleValue(child, command, `${path}.${key}`);
    return value;
  }
  return null;
}

function exampleFor(variant: Schema): ChartCommand {
  const command = variant.properties!.type.const as string;
  const value: Record<string, unknown> = { type: command };
  for (const [key, child] of Object.entries(variant.properties!))
    if (key !== 'type' && (variant.required?.includes(key) || extras.has(`${command}:${key}`)))
      value[key] = exampleValue(child, command, key);
  return value as ChartCommand;
}

const code = (value: unknown) => `\`${typeof value === 'string' ? JSON.stringify(value) : String(value)}\``;
const range = (min: number | undefined, max: number | undefined, unit = '') =>
  min !== undefined && max !== undefined
    ? `${min} to ${max}${unit}`
    : min !== undefined
      ? `at least ${min}${unit}`
      : max !== undefined
        ? `at most ${max}${unit}`
        : '';

/** One line describing a schema's type and constraints. */
function describe(schema: Schema, depth: number): string {
  if (schema.const !== undefined) return code(schema.const);
  if (schema.enum) return `one of ${schema.enum.map(code).join(', ')}`;
  if (schema.oneOf) {
    const nonNull = schema.oneOf.filter(s => s.type !== 'null');
    // Several object shapes read best written out; a lone `object | null` expands into rows.
    const parts = nonNull.map(s =>
      s.properties && (nonNull.length > 1 || depth >= MAX_DEPTH) ? inline(s) : describe(s, depth),
    );
    return `${parts.join(', or ')}${nonNull.length < schema.oneOf.length ? ', or null' : ''}`;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? 'any'];
  const nullable = types.includes('null') ? ' or null' : '';
  const kinds = types.filter(t => t !== 'null');
  if (kinds.length > 1) return `${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}${nullable}`;
  const type = kinds[0];
  const parts: string[] = [];
  if (type === 'number' || type === 'integer') {
    parts.push(type);
    if (schema.exclusiveMinimum !== undefined) parts.push(`above ${schema.exclusiveMinimum}`);
    const r = range(schema.minimum, schema.maximum);
    if (r) parts.push(r);
  } else if (type === 'string') {
    parts.push('string');
    const r =
      schema.minLength === 1 && schema.maxLength === undefined
        ? 'not empty'
        : range(schema.minLength, schema.maxLength, ' characters');
    if (r) parts.push(r);
    if (schema.pattern) parts.push(`matching \`${schema.pattern}\``);
  } else if (type === 'array') {
    const items = schema.items ?? {};
    const nulls = Array.isArray(items.type) && items.type.includes('null') ? ' or null' : '';
    const inner = items.properties && depth < MAX_DEPTH ? `objects${nulls}` : describe(items, depth + 1);
    parts.push(`array of ${inner.includes(',') ? `(${inner})` : inner}`);
    const r = range(schema.minItems, schema.maxItems, ' items');
    if (r) parts.push(r);
    if (schema.uniqueItems) parts.push('unique');
  } else if (type === 'object') {
    if (schema.properties && depth >= MAX_DEPTH) parts.push(inline(schema));
    else if (typeof schema.additionalProperties === 'object')
      parts.push(`object of ${describe(schema.additionalProperties, depth + 1)} values`);
    else parts.push('object');
    if (schema.maxProperties !== undefined) parts.push(`at most ${schema.maxProperties} keys`);
  } else parts.push(String(type));
  return parts.join(', ') + nullable;
}

/** An object written out on one line: `{ key: type, optional?: type }`. */
function inline(schema: Schema): string {
  const fields = Object.entries(schema.properties ?? {}).map(
    ([key, child]) => `${key}${schema.required?.includes(key) ? '' : '?'}: ${describe(child, MAX_DEPTH)}`,
  );
  return `{ ${fields.join('; ')} }`;
}

interface Row {
  path: string;
  type: string;
  required: boolean;
  notes: string;
}
function rows(schema: Schema, prefix: string, depth: number): Row[] {
  const result: Row[] = [];
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (depth === 1 && key === 'type') continue;
    const path = prefix + key;
    result.push({
      path,
      type: describe(child, depth),
      required: !!schema.required?.includes(key),
      notes: child.description ?? '',
    });
    if (depth >= MAX_DEPTH) continue;
    // Expand nested objects, objects inside arrays, and the object half of `object | null`.
    const nested = child.properties
      ? child
      : child.items?.properties
        ? child.items
        : child.oneOf?.find(s => s.properties && child.oneOf!.some(o => o.type === 'null'));
    if (nested) result.push(...rows(nested, `${path}${nested === child.items ? '[]' : ''}.`, depth + 1));
  }
  return result;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
function table(variant: Schema): string {
  const list = rows(variant, '', 1);
  if (!list.length) return 'No properties besides `type`.';
  return [
    '| Property | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...list.map(
      row => `| \`${row.path}\` | ${cell(row.type)} | ${row.required ? 'yes' : 'no'} | ${cell(row.notes)} |`,
    ),
  ].join('\n');
}

// Check every example against a headless chart.
function chart(seed: { group: boolean } | null): ChartRuntime {
  const runtime = new ChartRuntime(createSimulatedFeed({ seed: 42 }));
  runtime.start();
  runtime.execute({ type: 'feed.pause', paused: true });
  if (seed) {
    const latest = runtime.inspect().latestCandle!;
    runtime.execute([
      { type: 'indicator.add', indicator: { kind: 'rsi' } },
      {
        type: 'drawing.add',
        drawing: { id: 'support', type: 'horizontal', points: [{ timeMs: latest.timeMs, price: 64000 }] },
      },
      ...(seed.group ? [{ type: 'drawing.group' as const, id: 'group-1', drawingIds: ['support'] }] : []),
    ]);
  }
  return runtime;
}
const SOLO = new Set(['history.undo', 'history.redo', 'feed.pause']);
function attempt(runtime: ChartRuntime, command: ChartCommand): { code: string; message: string } | null {
  try {
    if (SOLO.has(command.type)) runtime.execute(command);
    else {
      const result = runtime.preview([command]);
      if (!result.ok) return result.error;
    }
    return null;
  } finally {
    runtime.dispose();
  }
}

const sections: string[] = [];
const needsState: string[] = [];
const failures: string[] = [];
for (const variant of variants) {
  const type = variant.properties!.type.const as string;
  const example = exampleFor(variant);
  const fresh = attempt(chart(null), example);
  let note = '';
  if (fresh) {
    const seeded = attempt(chart({ group: type !== 'drawing.group' }), example);
    if (seeded || !needs[fresh.code]) failures.push(`${type}: ${(seeded ?? fresh).message}`);
    else {
      needsState.push(`${type} (${fresh.code})`);
      note = `\n\nThis example needs ${needs[fresh.code]} on the chart. On a chart without one it fails with \`${fresh.code}\`.`;
    }
  }
  sections.push(
    `## \`${type}\`\n\n${variant.description}\n\n${table(variant)}\n\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`${note}`,
  );
}
if (failures.length) {
  console.error(`These examples are rejected by the runtime:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

const page = `---
# Generated by scripts/generate-command-docs.ts from src/command-schema.ts. Do not edit.
# Regenerate with: npm run docs:commands
title: Commands
description: Every chart command, with its properties and a minimal JSON example, generated from the command JSON Schema.
---

<!-- Generated by scripts/generate-command-docs.ts. Do not edit; run npm run docs:commands. -->

A command is a JSON object with a \`type\`. You send commands to \`execute\` or \`preview\` on a chart, a widget or a headless \`ChartRuntime\`. See [Drive the chart](../../agents/drive-the-chart/) for the loop, revisions and batches.

This page lists all ${variants.length} command types. It is generated from \`chartCommandSchema\`, the JSON Schema (draft 2020-12) exported by \`candleframe/core\`. The schema checks shapes. The runtime also checks rules that depend on the chart's state, such as whether an id exists or whether a time range is 3 to 2,200 bars wide.

Each example uses only the required properties, plus one optional property where the required ones alone would do nothing useful. The generator sends every example to a headless chart and fails if the runtime rejects it. Examples that name an existing drawing, indicator or group say so.

\`history.undo\`, \`history.redo\` and \`feed.pause\` cannot go in a batch. Send each one on its own.

${sections.join('\n\n')}
`;
writeFileSync(out, page);
console.log(`ok   wrote ${variants.length} commands to site/src/content/docs/reference/commands.md`);
if (needsState.length) console.log(`     need existing ids: ${needsState.join(', ')}`);
