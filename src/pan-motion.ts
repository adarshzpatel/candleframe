type Point = { x: number; y: number };
type MotionOptions = { smooth: boolean; constrain: (point: Point) => Point };

/** Pixel-space pan motion. The caller supplies the clock and viewport limits. */
export class PanMotion {
  private position: Point = { x: 0, y: 0 };
  private target: Point = { x: 0, y: 0 };
  private velocity: Point = { x: 0, y: 0 };
  private lastFrame: number;
  private lastMove: number;
  private glide?: { from: Point; start: number; duration: number };
  private stopped = false;
  private options: MotionOptions;

  constructor(now: number, options: MotionOptions) {
    this.lastFrame = this.lastMove = now;
    this.options = options;
  }

  get active(): boolean {
    return Math.hypot(this.target.x - this.position.x, this.target.y - this.position.y) > 0;
  }

  move(dx: number, dy: number, now: number): void {
    if (this.stopped || this.glide) return;
    this.sample(now);
    const next = this.options.constrain({ x: this.target.x + dx, y: this.target.y + dy });
    const elapsed = now - this.lastMove;
    for (const axis of ['x', 'y'] as const) {
      const speed =
        elapsed > 0 && elapsed <= 80 ? (next[axis] - this.target[axis]) / Math.max(8, elapsed) : 0;
      // A reversal must not inherit momentum in the previous direction.
      const previous = this.velocity[axis];
      this.velocity[axis] =
        speed === 0 || Math.sign(speed) !== Math.sign(previous)
          ? speed
          : previous + (speed - previous) * (1 - Math.exp(-elapsed / 40));
    }
    this.target = next;
    this.lastMove = now;
    if (!this.options.smooth) this.position = { ...next };
  }

  release(now: number): void {
    if (this.stopped || this.glide) return;
    this.sample(now);
    if (!this.options.smooth) return;
    const age = Math.max(0, now - this.lastMove);
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    // A held pause ends the fling. Travel is capped even after a very fast swipe.
    const distance = age < 80 && speed > 0.05 ? Math.min(60, speed * 50) * Math.exp(-age / 32) : 0;
    this.target = this.options.constrain({
      x: this.target.x + (speed ? (this.velocity.x / speed) * distance : 0),
      y: this.target.y + (speed ? (this.velocity.y / speed) * distance : 0),
    });
    this.glide = { from: { ...this.position }, start: now, duration: distance > 0 ? 180 : 60 };
  }

  sample(now: number): Point {
    const elapsed = Math.max(0, now - this.lastFrame);
    this.lastFrame = Math.max(this.lastFrame, now);
    if (this.glide) {
      const progress = Math.max(0, Math.min(1, (now - this.glide.start) / this.glide.duration));
      const ease = 1 - (1 - progress) ** 3;
      this.position = {
        x: this.glide.from.x + (this.target.x - this.glide.from.x) * ease,
        y: this.glide.from.y + (this.target.y - this.glide.from.y) * ease,
      };
      if (progress === 1) this.glide = undefined;
    } else if (!this.stopped) {
      const amount = 1 - Math.exp(-elapsed / 12);
      this.position.x += (this.target.x - this.position.x) * amount;
      this.position.y += (this.target.y - this.position.y) * amount;
    }
    if (Math.hypot(this.target.x - this.position.x, this.target.y - this.position.y) < 0.05) {
      this.position = { ...this.target };
    }
    return { ...this.position };
  }

  /** Freeze at the last sampled position, without finishing a queued target. */
  cancel(): void {
    this.stopped = true;
    this.target = { ...this.position };
    this.velocity = { x: 0, y: 0 };
    this.glide = undefined;
  }
}
