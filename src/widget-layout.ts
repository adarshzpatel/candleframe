import { isInterval } from './intervals.ts';
import type { ChartSync } from './chart-group.ts';
import type { Interval } from './types.ts';

/** Grid arrangements. Each chart owns a WebGL context; browsers allow about 16 per page. */
export const LAYOUT_PRESETS = {
  '1': { label: 'One chart', cells: 1, columns: 1, rows: 1 },
  '2h': { label: 'Two side by side', cells: 2, columns: 2, rows: 1 },
  '2v': { label: 'Two stacked', cells: 2, columns: 1, rows: 2 },
  '1+2': { label: 'One large, two stacked', cells: 3, columns: 2, rows: 2 },
  '2x2': { label: 'Four in a grid', cells: 4, columns: 2, rows: 2 },
  '3x2': { label: 'Six in a grid', cells: 6, columns: 3, rows: 2 },
  '4x2': { label: 'Eight in a grid', cells: 8, columns: 4, rows: 2 },
} as const satisfies Record<string, { label: string; cells: number; columns: number; rows: number }>;
export type LayoutPreset = keyof typeof LAYOUT_PRESETS;
export const isLayoutPreset = (value: unknown): value is LayoutPreset =>
  typeof value === 'string' && Object.hasOwn(LAYOUT_PRESETS, value);

/** Linked behavior between the charts of one widget. */
export interface WidgetSync extends ChartSync {
  /** A symbol change in one chart applies to every chart. */
  symbol: boolean;
  /** An interval change in one chart applies to every chart. */
  interval: boolean;
}
export const DEFAULT_WIDGET_SYNC: Readonly<WidgetSync> = {
  symbol: false,
  interval: false,
  crosshair: true,
  time: true,
  dateRange: false,
};
export const SYNC_LABELS: Readonly<Record<keyof WidgetSync, string>> = {
  symbol: 'Symbol',
  interval: 'Interval',
  crosshair: 'Crosshair',
  time: 'Time',
  dateRange: 'Date range',
};
export interface WidgetLayout {
  preset: LayoutPreset;
  sync: WidgetSync;
}
export interface WorkspaceCell {
  source: string;
  symbol: string;
  interval: Interval;
}
/**
 * A saved grid: arrangement, sync settings and each chart's market. Drawings and
 * indicators stay in the per-market chart documents, so layouts showing the same
 * market share them.
 */
export interface WidgetWorkspace {
  version: 1;
  name: string;
  preset: LayoutPreset;
  sync: WidgetSync;
  /** Index of the chart the toolbar controls. */
  active: number;
  cells: WorkspaceCell[];
}
/** The saved layout list and the one in use. */
export interface WidgetWorkspaceIndex {
  version: 1;
  current: string;
  items: { id: string; name: string }[];
}

const MAX_NAME = 60;
export const cleanLayoutName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);

function parseSync(value: unknown): WidgetSync {
  const sync = { ...DEFAULT_WIDGET_SYNC };
  if (value && typeof value === 'object')
    for (const key of Object.keys(sync) as (keyof WidgetSync)[]) {
      const flag = (value as Record<string, unknown>)[key];
      if (typeof flag === 'boolean') sync[key] = flag;
    }
  return sync;
}

/** Reads a stored workspace, or null when it is missing or unusable. Unknown fields are dropped. */
export function parseWorkspace(value: unknown): WidgetWorkspace | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !isLayoutPreset(v.preset) || !Array.isArray(v.cells)) return null;
  const cells: WorkspaceCell[] = [];
  for (const cell of v.cells.slice(0, LAYOUT_PRESETS[v.preset].cells)) {
    const c = cell as Record<string, unknown> | null;
    if (
      !c ||
      typeof c.source !== 'string' ||
      typeof c.symbol !== 'string' ||
      typeof c.interval !== 'string' ||
      !isInterval(c.interval)
    )
      return null;
    cells.push({ source: c.source, symbol: c.symbol, interval: c.interval });
  }
  const active = Number.isInteger(v.active) ? Math.max(0, Math.min(cells.length - 1, v.active as number)) : 0;
  return {
    version: 1,
    name: typeof v.name === 'string' && cleanLayoutName(v.name) ? cleanLayoutName(v.name) : 'Layout',
    preset: v.preset,
    sync: parseSync(v.sync),
    active,
    cells,
  };
}

export function parseWorkspaceIndex(value: unknown): WidgetWorkspaceIndex | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.items)) return null;
  const items: WidgetWorkspaceIndex['items'] = [];
  for (const item of v.items as unknown[]) {
    const i = item as Record<string, unknown> | null;
    if (!i || typeof i.id !== 'string' || !i.id || typeof i.name !== 'string') continue;
    if (items.some(existing => existing.id === i.id)) continue;
    items.push({ id: i.id, name: cleanLayoutName(i.name) || 'Layout' });
  }
  if (!items.length) return null;
  const current = items.some(item => item.id === v.current) ? (v.current as string) : items[0].id;
  return { version: 1, current, items };
}

/** Normalizes a host's `layout` option. */
export function resolveLayout(input?: { preset?: LayoutPreset; sync?: Partial<WidgetSync> }): WidgetLayout {
  return {
    preset: isLayoutPreset(input?.preset) ? input.preset : '1',
    sync: parseSync({ ...DEFAULT_WIDGET_SYNC, ...input?.sync }),
  };
}
