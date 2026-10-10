import { ChartError } from './errors.ts';
import type { BookView, DepthDelta, DepthSnapshot, Level } from './types.ts';

function validateLevels(levels: readonly Level[]): void {
  const prices = new Set<number>();
  for (const [price, quantity] of levels) {
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      prices.has(price)
    ) {
      throw new ChartError('INVALID_DEPTH', 'prices must be unique and positive, quantities non-negative.');
    }
    prices.add(price);
  }
}

function updateSide(map: Map<number, number>, changes: readonly Level[]): void {
  for (const [price, quantity] of changes) {
    if (quantity === 0) map.delete(price);
    else map.set(price, quantity);
  }
}

/** Applies absolute quantities atomically. A sequence gap blocks deltas until a snapshot. */
export class OrderBook {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private sequence = -1;
  private status: BookView['status'] = 'waiting';

  markStale(): void {
    if (this.sequence >= 0) this.status = 'stale';
  }

  private commit(bids: Map<number, number>, asks: Map<number, number>, sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new ChartError('INVALID_SEQUENCE');
    if (bids.size > 2048 || asks.size > 2048)
      throw new ChartError('DEPTH_LIMIT', 'maximum 2048 levels per side.');
    if (bids.size && asks.size && Math.max(...bids.keys()) >= Math.min(...asks.keys()))
      throw new ChartError('CROSSED_BOOK');
    this.bids = bids;
    this.asks = asks;
    this.sequence = sequence;
    this.status = 'live';
  }

  snapshot(snapshot: DepthSnapshot): boolean {
    validateLevels(snapshot.bids);
    validateLevels(snapshot.asks);
    if (snapshot.sequence < this.sequence) return false;
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    updateSide(bids, snapshot.bids);
    updateSide(asks, snapshot.asks);
    this.commit(bids, asks, snapshot.sequence);
    return true;
  }

  delta(delta: DepthDelta): 'applied' | 'duplicate' | 'gap' {
    if (!Number.isSafeInteger(delta.sequence) || !Number.isSafeInteger(delta.previousSequence)) {
      this.status = 'stale';
      throw new ChartError('INVALID_SEQUENCE');
    }
    if (delta.sequence <= this.sequence) return 'duplicate';
    if (
      this.status !== 'live' ||
      delta.previousSequence !== this.sequence ||
      delta.sequence !== this.sequence + 1
    ) {
      this.status = 'stale';
      return 'gap';
    }
    try {
      validateLevels(delta.bids);
      validateLevels(delta.asks);
      const bids = new Map(this.bids);
      const asks = new Map(this.asks);
      updateSide(bids, delta.bids);
      updateSide(asks, delta.asks);
      this.commit(bids, asks, delta.sequence);
    } catch (error) {
      this.status = 'stale';
      throw error;
    }
    return 'applied';
  }

  inspect(limit = 64): BookView {
    return {
      status: this.status,
      sequence: this.sequence,
      bids: [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, limit),
      asks: [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, limit),
    };
  }
}
