import { stateTimeScale } from './geometry.ts';
import { MAX_VIEWPORT_BARS, MIN_VIEWPORT_BARS } from './runtime.ts';
import type { ChartApi } from './chart.ts';
import type { ChartCommand, RuntimeState } from './types.ts';

/** What linked charts share. Symbol and interval belong to the host, which owns the feeds. */
export interface ChartSync {
  /** Hovering one plot shows a time line on the others. */
  crosshair: boolean;
  /** Scrolling aligns the right edge in time; each chart keeps its own zoom. */
  time: boolean;
  /** Every chart shows the same time range, within its 3 to 2,200 bar limit. Implies `time`. */
  dateRange: boolean;
}
export type GroupChart = Pick<ChartApi, 'subscribe' | 'execute' | 'setCrosshair' | 'subscribeCrosshair'>;
export interface ChartGroup {
  add(chart: GroupChart): void;
  remove(chart: GroupChart): void;
  setSync(sync: Partial<ChartSync>): void;
  getSync(): ChartSync;
  /** Moves the other charts to this chart's time position now, such as after enabling time sync. */
  align(chart: GroupChart): void;
  /** Unlinks every chart. The charts stay mounted. */
  dispose(): void;
}

const DEFAULT_SYNC: ChartSync = { crosshair: true, time: true, dateRange: false };

/**
 * The navigation command that moves `target` to match `source`, or null when it already
 * matches. A source following live makes the target follow live too.
 */
export function linkedViewport(
  source: Pick<RuntimeState, 'candles' | 'feed' | 'document'>,
  target: Pick<RuntimeState, 'candles' | 'feed' | 'document'>,
  mode: 'time' | 'dateRange',
): ChartCommand | null {
  if (!source.candles.length || !target.candles.length) return null;
  const from = source.document.viewport,
    current = target.document.viewport;
  if (from.following) return current.following ? null : { type: 'viewport.reset' };
  const scale = stateTimeScale(target);
  const end = scale.logical(from.toMs);
  const span = Math.min(
    MAX_VIEWPORT_BARS,
    Math.max(
      MIN_VIEWPORT_BARS,
      mode === 'dateRange' ? scale.bars(from.fromMs, from.toMs) : scale.bars(current.fromMs, current.toMs),
    ),
  );
  const fromMs = scale.time(end - span),
    toMs = scale.time(end);
  const close = (a: number, b: number) => Math.abs(a - b) <= target.feed.intervalMs * 1e-6;
  if (!current.following && close(fromMs, current.fromMs) && close(toMs, current.toMs)) return null;
  return { type: 'viewport.set', fromMs, toMs };
}

/**
 * Links charts so crosshair and time position follow the chart being used. Edits made
 * through the group are navigation only: they add no undo steps.
 */
export function createChartGroup(
  charts: readonly GroupChart[] = [],
  sync: Partial<ChartSync> = {},
): ChartGroup {
  let settings: ChartSync = { ...DEFAULT_SYNC, ...sync };
  const members = new Map<GroupChart, { state: RuntimeState | null; detach: () => void }>();
  // Set while the group writes to a chart, so the write is not linked back.
  let applying = false;

  function propagate(source: GroupChart): void {
    const mode = settings.dateRange ? 'dateRange' : settings.time ? 'time' : null;
    const state = members.get(source)?.state;
    if (!mode || !state) return;
    applying = true;
    try {
      for (const [chart, member] of members) {
        if (chart === source || !member.state) continue;
        const command = linkedViewport(state, member.state, mode);
        if (!command) continue;
        try {
          chart.execute(command);
        } catch {
          /* A chart that cannot take this range keeps its own. */
        }
      }
    } finally {
      applying = false;
    }
  }

  function add(chart: GroupChart): void {
    if (members.has(chart)) return;
    const member = { state: null as RuntimeState | null, detach: () => {} };
    members.set(chart, member);
    const unsubscribe = chart.subscribe(next => {
      const previous = member.state;
      member.state = next;
      if (applying || !previous || previous.generation !== next.generation) return;
      const a = previous.document.viewport,
        b = next.document.viewport;
      // Following live moves the viewport on every new bar; only a change of mode or
      // an explicit move is navigation.
      if (a.following && b.following) return;
      if (a.fromMs === b.fromMs && a.toMs === b.toMs && a.following === b.following) return;
      propagate(chart);
    });
    const unlinkCrosshair = chart.subscribeCrosshair(timeMs => {
      if (!settings.crosshair) return;
      for (const other of members.keys()) if (other !== chart) other.setCrosshair(timeMs);
    });
    member.detach = () => {
      unsubscribe();
      unlinkCrosshair();
      chart.setCrosshair(null);
    };
  }

  for (const chart of charts) add(chart);
  return {
    add,
    remove(chart) {
      const member = members.get(chart);
      if (!member) return;
      members.delete(chart);
      member.detach();
    },
    setSync(next) {
      settings = { ...settings, ...next };
      if (!settings.crosshair) for (const chart of members.keys()) chart.setCrosshair(null);
    },
    getSync: () => ({ ...settings }),
    align(chart) {
      if (members.has(chart)) propagate(chart);
    },
    dispose() {
      for (const member of members.values()) member.detach();
      members.clear();
    },
  };
}
