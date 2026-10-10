import { ChartError } from './errors.ts';
import type { BookView, DepthColumn, HeatmapGrid } from './types.ts';

export function binBook(book: BookView, grid: HeatmapGrid, timeMs: number): DepthColumn {
  const values = new Float32Array(grid.rows);
  if (book.status === 'live') {
    for (const [price, quantity] of [...book.bids, ...book.asks]) {
      const row = Math.floor((price - grid.minPrice) / grid.binSize);
      if (row >= 0 && row < grid.rows) values[row] += quantity;
    }
  }
  return { timeMs, values, valid: book.status === 'live' };
}

/** Fixed-capacity, time-ordered ring. Gap markers remain until that interval expires. */
export class HeatmapStore {
  readonly columns: (DepthColumn | undefined)[];
  readonly stamps: number[];
  startSlot = 0;
  count = 0;
  revision = 0;
  readonly grid: HeatmapGrid;
  readonly capacity: number;
  constructor(grid: HeatmapGrid, capacity = 512) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      capacity > 4096 ||
      !Number.isInteger(grid.rows) ||
      grid.rows < 1 ||
      grid.rows > 1024 ||
      !Number.isFinite(grid.minPrice) ||
      !Number.isFinite(grid.binSize) ||
      grid.binSize <= 0 ||
      !Number.isFinite(grid.intervalMs) ||
      grid.intervalMs <= 0
    )
      throw new ChartError('INVALID_HEATMAP_GRID');
    this.grid = { ...grid };
    this.capacity = capacity;
    this.columns = Array.from({ length: capacity });
    this.stamps = Array(capacity).fill(0);
  }

  append(column: DepthColumn): void {
    if (
      !Number.isFinite(column.timeMs) ||
      column.timeMs < 0 ||
      column.values.length !== this.grid.rows ||
      column.values.some(value => !Number.isFinite(value) || value < 0)
    )
      throw new ChartError('INVALID_HEATMAP_COLUMN');
    const timeMs = Math.floor(column.timeMs / this.grid.intervalMs) * this.grid.intervalMs;
    const lastSlot = (this.startSlot + this.count - 1 + this.capacity) % this.capacity;
    const last = this.columns[lastSlot];
    if (last && this.count && timeMs < last.timeMs) throw new ChartError('OUT_OF_ORDER_DEPTH');
    if (last && this.count && timeMs === last.timeMs) {
      this.columns[lastSlot] = { ...column, timeMs, valid: last.valid && column.valid };
      this.stamps[lastSlot] = ++this.revision;
      return;
    }
    if (last && this.count && timeMs - last.timeMs > this.grid.intervalMs) {
      const start = Math.max(
        last.timeMs + this.grid.intervalMs,
        timeMs - (this.capacity - 1) * this.grid.intervalMs,
      );
      for (let t = start; t < timeMs; t += this.grid.intervalMs)
        this.write({ timeMs: t, values: new Float32Array(this.grid.rows), valid: false });
    }
    this.write({ ...column, timeMs });
  }

  private write(column: DepthColumn): void {
    const slot = (this.startSlot + this.count) % this.capacity;
    this.columns[slot] = column;
    this.stamps[slot] = ++this.revision;
    if (this.count < this.capacity) this.count++;
    else this.startSlot = (this.startSlot + 1) % this.capacity;
  }

  get firstTimeMs(): number {
    return this.columns[this.startSlot]?.timeMs ?? 0;
  }
}
