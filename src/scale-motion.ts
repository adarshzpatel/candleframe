export interface ViewRanges { fromMs: number; toMs: number; minPrice: number; maxPrice: number }
const edges = ['fromMs', 'toMs', 'minPrice', 'maxPrice'] as const;

/** Presentation-only easing. Documents and commands retain their exact target ranges. */
export class ScaleMotion {
  private position: ViewRanges;
  private origin: ViewRanges;
  private target: ViewRanges;
  private start = 0;
  private duration = 0;

  constructor(ranges: ViewRanges) {
    this.position = { ...ranges }; this.origin = { ...ranges }; this.target = { ...ranges };
  }

  get active(): boolean { return edges.some(edge => this.position[edge] !== this.target[edge]); }

  retarget(ranges: ViewRanges, now: number, duration = 90): void {
    if (edges.every(edge => ranges[edge] === this.target[edge])) return;
    this.origin = this.sample(now);
    this.target = { ...ranges };
    this.start = now;
    this.duration = duration;
  }

  sample(now: number): ViewRanges {
    const progress = this.duration ? Math.max(0, Math.min(1, (now - this.start) / this.duration)) : 1;
    const ease = 1 - (1 - progress) ** 3;
    for (const edge of edges) this.position[edge] = progress === 1
      ? this.target[edge] : this.origin[edge] + (this.target[edge] - this.origin[edge]) * ease;
    return { ...this.position };
  }
}
