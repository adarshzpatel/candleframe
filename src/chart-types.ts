import type { Candle, ChartType } from './types.ts';

/** Every chart type with its menu label, in menu order. `group` splits the menu. */
export const CHART_TYPES: readonly {
  id: ChartType;
  label: string;
  group: 'Bars' | 'Lines' | 'Order flow';
}[] = Object.freeze([
  { id: 'candles', label: 'Candles', group: 'Bars' },
  { id: 'hollow-candles', label: 'Hollow candles', group: 'Bars' },
  { id: 'heikin-ashi', label: 'Heikin Ashi', group: 'Bars' },
  { id: 'ohlc-bars', label: 'Bars', group: 'Bars' },
  { id: 'hlc-bars', label: 'HLC bars', group: 'Bars' },
  { id: 'high-low', label: 'High-low', group: 'Bars' },
  { id: 'columns', label: 'Columns', group: 'Bars' },
  { id: 'line', label: 'Line', group: 'Lines' },
  { id: 'line-markers', label: 'Line with markers', group: 'Lines' },
  { id: 'step-line', label: 'Step line', group: 'Lines' },
  { id: 'area', label: 'Area', group: 'Lines' },
  { id: 'baseline', label: 'Baseline', group: 'Lines' },
  { id: 'footprint', label: 'Footprint', group: 'Order flow' },
]);
const ids = new Set<unknown>(CHART_TYPES.map(type => type.id));
export const isChartType = (value: unknown): value is ChartType => ids.has(value);
export const chartTypeLabel = (type: ChartType): string =>
  CHART_TYPES.find(item => item.id === type)?.label ?? 'Candles';

const CLOSE_ONLY = new Set<ChartType>(['line', 'line-markers', 'step-line', 'area', 'baseline', 'columns']);
/** Types drawn from closes alone, so autoscale fits closes rather than highs and lows. */
export const drawsClosesOnly = (type: ChartType | undefined): boolean => !!type && CLOSE_ONLY.has(type);

/**
 * Heikin Ashi bars from raw ones. Bars before `changed` are reused from `previous`, so a
 * live tick recomputes only the bars from the change on. Each HA bar depends on the one
 * before it, so the first loaded bar seeds the series with (open + close) / 2.
 */
export function heikinAshi(
  candles: readonly Candle[],
  previous: readonly Candle[],
  changed: number,
): Candle[] {
  const from = Math.max(0, Math.min(changed, previous.length, candles.length));
  const result = previous.slice(0, from);
  for (let i = from; i < candles.length; i++) {
    const bar = candles[i],
      before = result[i - 1];
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = before ? (before.open + before.close) / 2 : (bar.open + bar.close) / 2;
    result.push({
      ...bar,
      open,
      high: Math.max(bar.high, open, close),
      low: Math.min(bar.low, open, close),
      close,
    });
  }
  return result;
}
