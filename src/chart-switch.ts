import type { ChartApi } from './chart.ts';

export interface ChartSwitch {
  /** Acts on the current chart; appearance and drawing defaults apply to every chart. */
  readonly api: ChartApi;
  current(): ChartApi;
  /** Moves subscriptions to `chart`. Each listener receives its state at once. */
  set(chart: ChartApi): void;
}

/**
 * One `ChartApi` for controls that serve several charts, such as a toolbar over a grid.
 * `dispose` is a no-op: the owner disposes the charts.
 */
export function createChartSwitch(initial: ChartApi, all: () => readonly ChartApi[]): ChartSwitch {
  let active = initial;
  type Link = { attach(chart: ChartApi): () => void; detach: () => void };
  const links = new Set<Link>();
  function link(attach: Link['attach']): () => void {
    const entry: Link = { attach, detach: attach(active) };
    links.add(entry);
    return () => {
      if (!links.delete(entry)) return;
      entry.detach();
    };
  }
  const api: ChartApi = {
    setTheme: theme => all().forEach(chart => chart.setTheme(theme)),
    setTimeZone: zone => all().forEach(chart => chart.setTimeZone(zone)),
    getTheme: () => active.getTheme(),
    replaceFeed: (feed, revision) => active.replaceFeed(feed, revision),
    execute: (command, revision, options) => active.execute(command, revision, options),
    preview: (commands, revision) => active.preview(commands, revision),
    query: request => active.query(request),
    inspect: () => active.inspect(),
    exportDocument: () => active.exportDocument(),
    restoreDocument: (document, revision, options) => active.restoreDocument(document, revision, options),
    subscribe: listener => link(chart => chart.subscribe(listener)),
    setCrosshair: timeMs => active.setCrosshair(timeMs),
    subscribeCrosshair: listener => link(chart => chart.subscribeCrosshair(listener)),
    setTool: tool => active.setTool(tool),
    selectDrawing: id => active.selectDrawing(id),
    drawingState: () => active.drawingState(),
    drawingTools: () => active.drawingTools(),
    setDrawingOptions: options => all().forEach(chart => chart.setDrawingOptions(options)),
    capture: () => active.capture(),
    loadOlderHistory: () => active.loadOlderHistory(),
    // Lines and markers belong to one market; hosts with a grid set them per chart via `charts()`.
    setPriceLines: lines => active.setPriceLines(lines),
    setMarkers: markers => active.setMarkers(markers),
    subscribePriceLineDrag: listener => link(chart => chart.subscribePriceLineDrag(listener)),
    subscribePriceLineAction: listener => link(chart => chart.subscribePriceLineAction(listener)),
    priceAt: (x, y) => active.priceAt(x, y),
    dispose: () => {},
  };
  return {
    api,
    current: () => active,
    set(chart) {
      if (chart === active) return;
      active = chart;
      for (const entry of links) {
        entry.detach();
        entry.detach = entry.attach(chart);
      }
    },
  };
}

/** The focusable chart element of the active grid cell, or the only chart. */
export function activeChart(panel: ParentNode): HTMLElement | null {
  return (
    panel.querySelector<HTMLElement>('.chart-cell.active .cf-chart') ??
    panel.querySelector<HTMLElement>('.cf-chart')
  );
}
