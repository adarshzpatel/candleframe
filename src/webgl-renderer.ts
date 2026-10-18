import { footprintShown } from './footprint.ts';
import { drawsClosesOnly } from './chart-types.ts';
import { ChartError } from './errors.ts';
import { chartThemes, colorRGBA, indicatorColor, themeColor } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import type { ChartGeometry } from './geometry.ts';
import type { ChartType, RuntimeState } from './types.ts';
import { visibleRange } from './time-scale.ts';

export interface RenderFrame {
  state: RuntimeState;
  geometry: ChartGeometry;
  theme?: ResolvedChartTheme;
  /** Grid line positions in CSS pixels, usually the axis ticks. Without it, the theme's even grid is used. */
  grid?: { x: readonly number[]; y: readonly number[] };
}
export interface RendererStats {
  cpuMs: number;
  drawCalls: number;
  instances: number;
  status: 'ready' | 'lost' | 'unavailable';
}
export interface ChartRenderer {
  readonly name: string;
  mount(canvas: HTMLCanvasElement, invalidate: () => void, onStatus: (message: string | null) => void): void;
  render(frame: RenderFrame): RendererStats;
  dispose(): void;
}

const lineVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
layout(location=1) in vec2 start;
layout(location=2) in vec2 finish;
layout(location=3) in float thickness;
layout(location=4) in vec4 color;
layout(location=5) in vec2 clipY;
layout(location=6) in float endThickness;
uniform vec2 resolution;
out vec4 vColor;
out highp float vY;
flat out highp vec2 vClipY;
void main() {
  vec2 d = finish - start;
  vec2 normal = vec2(-d.y, d.x) / max(length(d), 0.0001);
  // A non-negative end thickness makes a trapezoid: vertical sides, height easing from thickness to it.
  vec2 point = endThickness >= 0.
    ? mix(start, finish, corner.x) + vec2(0., (corner.y - 0.5) * mix(thickness, endThickness, corner.x))
    : mix(start, finish, corner.x) + normal * (corner.y - 0.5) * thickness;
  gl_Position = vec4(point / resolution * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  vColor = color;
  vY = point.y;
  vClipY = clipY;
}`;
const lineFragment = `#version 300 es
precision mediump float;
in vec4 vColor;
in highp float vY;
flat in highp vec2 vClipY;
out vec4 outputColor;
void main() {
  if (vY < vClipY.x || vY > vClipY.y) discard;
  outputColor = vColor;
}`;
type Color = readonly [number, number, number, number];
const UNCLIPPED: readonly [number, number] = [-1e9, 1e9];
const INSTANCE_FLOATS = 12;
/** Pixel width of a level-of-detail column. */
const LOD_COLUMN = 2;
const colorsFor = (theme: ResolvedChartTheme) => {
  const chart = theme.chart;
  const token = (value: string, opacity = 1) => colorRGBA(themeColor(theme, value), opacity);
  return {
    background: colorRGBA(theme.palette.background),
    up: token(chart.candleUp),
    down: token(chart.candleDown),
    wickUp: token(chart.wickUp),
    wickDown: token(chart.wickDown),
    volumeUp: token(chart.volumeUp, chart.volumeOpacity),
    volumeDown: token(chart.volumeDown, chart.volumeOpacity),
    line: token(chart.lineColor),
    area: token(chart.areaColor, chart.areaOpacity),
    baselineUp: token(chart.baselineUp),
    baselineDown: token(chart.baselineDown),
    baselineUpFill: token(chart.baselineUp, chart.baselineOpacity),
    baselineDownFill: token(chart.baselineDown, chart.baselineOpacity),
    baseline: token(chart.axisColor, 0.5),
    histogramUp: token(chart.candleUp, 0.55),
    histogramDown: token(chart.candleDown, 0.55),
    grid: colorRGBA(theme.palette.grid, chart.gridOpacity),
    indicator: colorRGBA(theme.palette.indicator),
  };
};

/**
 * Per-bar candle colors from `[start, end)`, read from the first shown price indicator with
 * a `candles` output. Undefined keeps the theme color.
 */
function candleTones(state: RuntimeState, start: number, end: number): (Color | undefined)[] {
  const tones: (Color | undefined)[] = new Array(Math.max(0, end - start));
  if (!state.document.layers.indicator) return tones;
  for (const { plugin, series, visible } of state.indicators) {
    if (!visible || (plugin.pane ?? 'price') !== 'price') continue;
    const k = plugin.outputs?.findIndex(output => output.style === 'candles') ?? -1;
    const palette = plugin.outputs?.[k]?.palette;
    if (k < 0 || !palette?.length) continue;
    const values = series[k] ?? [];
    for (let i = start; i < end; i++) tones[i - start] = palette[values[i]];
    return tones;
  }
  return tones;
}

/** Instanced line and rectangle geometry. */
export class WebGL2Renderer implements ChartRenderer {
  readonly name = 'WebGL2';
  private theme = chartThemes.evergreen;
  private colors = colorsFor(this.theme);
  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private lineProgram!: WebGLProgram;
  private lineVao!: WebGLVertexArrayObject;
  private corners!: WebGLBuffer;
  private instances!: WebGLBuffer;
  private instanceCapacity = 0;
  private vertices = new Float32Array(8192 * INSTANCE_FLOATS);
  private used = 0;
  private status: RendererStats['status'] = 'unavailable';
  private invalidate = () => {};
  private onStatus: (message: string | null) => void = () => {};
  private disposed = false;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation>>();

  private onLost = (event: Event) => {
    event.preventDefault();
    this.status = 'lost';
    this.onStatus('GPU context lost. Waiting for recovery…');
    this.invalidate();
  };
  private onRestored = () => {
    if (this.disposed) return;
    try {
      this.initialize();
      this.onStatus(null);
      this.invalidate();
    } catch (error) {
      this.status = 'unavailable';
      this.onStatus(String(error));
    }
  };

  mount(canvas: HTMLCanvasElement, invalidate: () => void, onStatus: (message: string | null) => void): void {
    this.canvas = canvas;
    this.invalidate = invalidate;
    this.onStatus = onStatus;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl)
      throw new ChartError('WEBGL2_UNAVAILABLE', 'This device or browser could not create a WebGL2 context.');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.initialize();
  }

  private program(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    const makeShader = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vs = makeShader(gl.VERTEX_SHADER, vertex),
      fs = makeShader(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
    const log = ok
      ? ''
      : `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`;
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!ok) {
      gl.deleteProgram(program);
      throw new ChartError('SHADER_ERROR', `${log}`);
    }
    return program;
  }

  private initialize(): void {
    const gl = this.gl;
    this.uniforms.clear();
    this.lineProgram = this.program(lineVertex, lineFragment);
    this.corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instances = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (const [location, count, offset] of [
      [1, 2, 0],
      [2, 2, 2],
      [3, 1, 4],
      [4, 4, 5],
      [5, 2, 9],
      [6, 1, 11],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, count, gl.FLOAT, false, INSTANCE_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    this.instanceCapacity = 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.status = 'ready';
  }

  private uniform(program: WebGLProgram, name: string): WebGLUniformLocation {
    let cache = this.uniforms.get(program);
    if (!cache) {
      cache = new Map();
      this.uniforms.set(program, cache);
    }
    let location = cache.get(name);
    if (!location) {
      location = this.gl.getUniformLocation(program, name)!;
      cache.set(name, location);
    }
    return location;
  }

  private line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: Color,
    clipY = UNCLIPPED,
  ): void {
    if (this.used + INSTANCE_FLOATS > this.vertices.length) {
      const larger = new Float32Array(this.vertices.length * 2);
      larger.set(this.vertices);
      this.vertices = larger;
    }
    // Written field by field: this runs for every instance of every frame.
    const v = this.vertices,
      i = this.used;
    v[i] = x1;
    v[i + 1] = y1;
    v[i + 2] = x2;
    v[i + 3] = y2;
    v[i + 4] = width;
    v[i + 5] = color[0];
    v[i + 6] = color[1];
    v[i + 7] = color[2];
    v[i + 8] = color[3];
    v[i + 9] = clipY[0];
    v[i + 10] = clipY[1];
    v[i + 11] = -1;
    this.used += INSTANCE_FLOATS;
  }

  /** A band from `x1` to `x2` whose top and bottom edges run straight between the given ends. */
  private trapezoid(
    x1: number,
    top1: number,
    bottom1: number,
    x2: number,
    top2: number,
    bottom2: number,
    color: Color,
    clipY = UNCLIPPED,
  ): void {
    const h1 = bottom1 - top1,
      h2 = bottom2 - top2;
    if (h1 * h2 < 0) {
      // The edges cross: two triangles meeting where they do.
      const t = h1 / (h1 - h2),
        x = x1 + (x2 - x1) * t,
        y = top1 + (top2 - top1) * t;
      this.trapezoid(x1, top1, bottom1, x, y, y, color, clipY);
      this.trapezoid(x, y, y, x2, top2, bottom2, color, clipY);
      return;
    }
    this.line(x1, (top1 + bottom1) / 2, x2, (top2 + bottom2) / 2, Math.abs(h1), color, clipY);
    this.vertices[this.used - 1] = Math.abs(h2);
  }

  /** A segment with square ends, so joined segments leave no notch at their corners. */
  private segment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: Color,
    clipY: readonly [number, number],
  ): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) return;
    const ex = ((x2 - x1) / length) * (width / 2),
      ey = ((y2 - y1) / length) * (width / 2);
    this.line(x1 - ex, y1 - ey, x2 + ex, y2 + ey, width, color, clipY);
  }

  /** Line, step line, area and baseline: the closes joined, with any fill beneath them. */
  private closeLine(
    type: ChartType,
    bars: readonly { x: number; close: number }[],
    g: ChartGeometry,
    clip: readonly [number, number],
  ): void {
    const colors = this.colors,
      width = this.theme.chart.lineWidth,
      bottom = g.top + g.plotHeight;
    if (type === 'step-line') {
      for (let i = 0; i < bars.length; i++) {
        const y = g.y(bars[i].close),
          left = i ? (bars[i - 1].x + bars[i].x) / 2 : bars[i].x - g.barSpacing / 2,
          right = i < bars.length - 1 ? (bars[i].x + bars[i + 1].x) / 2 : bars[i].x + g.barSpacing / 2;
        this.segment(left, y, right, y, width, colors.line, clip);
        if (i) this.segment(left, g.y(bars[i - 1].close), left, y, width, colors.line, clip);
      }
      return;
    }
    // Segments with the fill under each and the colour of its line. Baseline splits a
    // segment where it crosses the base, the first close in view.
    const first = bars.find(bar => bar.x >= g.left) ?? bars[0],
      base = type === 'baseline' && first ? g.y(first.close) : bottom;
    const segments: [number, number, number, number, Color | null, Color][] = [];
    for (let i = 1; i < bars.length; i++) {
      let x1 = bars[i - 1].x,
        y1 = g.y(bars[i - 1].close);
      const x2 = bars[i].x,
        y2 = g.y(bars[i].close);
      if (type !== 'baseline') {
        segments.push([x1, y1, x2, y2, type === 'area' ? colors.area : null, colors.line]);
        continue;
      }
      if ((y1 - base) * (y2 - base) < 0) {
        const xm = x1 + ((x2 - x1) * (base - y1)) / (y2 - y1),
          above = y1 < base;
        segments.push([
          x1,
          y1,
          xm,
          base,
          above ? colors.baselineUpFill : colors.baselineDownFill,
          above ? colors.baselineUp : colors.baselineDown,
        ]);
        x1 = xm;
        y1 = base;
      }
      const above = Math.min(y1, y2) < base;
      segments.push([
        x1,
        y1,
        x2,
        y2,
        above ? colors.baselineUpFill : colors.baselineDownFill,
        above ? colors.baselineUp : colors.baselineDown,
      ]);
    }
    for (const [x1, y1, x2, y2, fill] of segments)
      if (fill) this.trapezoid(x1, y1, base, x2, y2, base, fill, clip);
    if (type === 'baseline') this.line(g.left, base, g.left + g.plotWidth, base, 1, colors.baseline, clip);
    for (const [x1, y1, x2, y2, , stroke] of segments) this.segment(x1, y1, x2, y2, width, stroke, clip);
  }

  render({ state, geometry: g, theme = chartThemes.evergreen, grid }: RenderFrame): RendererStats {
    const start = performance.now();
    if (this.status !== 'ready') return { cpuMs: 0, drawCalls: 0, instances: 0, status: this.status };
    if (this.theme !== theme) {
      this.theme = theme;
      this.colors = colorsFor(theme);
    }
    const colors = this.colors,
      appearance = theme.chart;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelWidth = Math.max(1, Math.round(g.width * dpr)),
      pixelHeight = Math.max(1, Math.round(g.height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...colors.background);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (grid && appearance.gridWidth) {
      for (const y of grid.y)
        this.line(g.left, y, g.left + g.plotWidth, y, appearance.gridWidth, colors.grid);
      for (const x of grid.x) this.line(x, g.top, x, g.bottom, appearance.gridWidth, colors.grid);
    }
    for (let i = 0; !grid && i <= appearance.gridRows; i++) {
      const y = g.top + (g.plotHeight / appearance.gridRows) * i;
      if (appearance.gridWidth)
        this.line(g.left, y, g.left + g.plotWidth, y, appearance.gridWidth, colors.grid);
    }
    for (let i = 0; !grid && i <= appearance.gridColumns; i++) {
      const x = g.left + (g.plotWidth / appearance.gridColumns) * i;
      if (appearance.gridWidth) this.line(x, g.top, x, g.bottom, appearance.gridWidth, colors.grid);
    }
    const bars = state.candles;
    const priceClip: readonly [number, number] = [g.top, g.top + g.plotHeight];
    const interval = state.feed.intervalMs;
    const range = visibleRange(bars, g.fromMs, g.toMs, interval, 1);
    // Below two pixels per bar, merge the bars that share a two-pixel column into one
    // OHLC bar. Zoomed-out views of long histories then draw a few hundred candles.
    const merge = g.barSpacing < LOD_COLUMN;
    const drawn: {
      x: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      footprint?: boolean;
      tone?: Color;
    }[] = [];
    const tones = candleTones(state, range.start, range.end);
    // Footprint bars leave their candle to the overlay, which draws it beside the cells.
    const footprints = !merge && footprintShown(state.document, g.barSpacing);
    let column = NaN,
      members = 0;
    for (let i = range.start; i < range.end; i++) {
      const bar = bars[i],
        x = g.x(bar.timeMs + interval / 2),
        key = Math.floor(x / LOD_COLUMN);
      const last = drawn[drawn.length - 1];
      if (merge && last && key === column) {
        last.high = Math.max(last.high, bar.high);
        last.low = Math.min(last.low, bar.low);
        last.close = bar.close;
        last.volume += bar.volume;
        last.tone = tones[i - range.start];
        last.x = (last.x * members + x) / (members + 1);
        members++;
      } else {
        drawn.push({
          x,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          footprint: footprints && !!bar.footprint?.length,
          tone: tones[i - range.start],
        });
        column = key;
        members = 1;
      }
    }
    let maxVolume = 1;
    for (const bar of drawn) maxVolume = Math.max(maxVolume, bar.volume);
    const candleWidth = Math.max(
      1,
      Math.min(
        appearance.candleMaxWidth,
        Math.max(g.barSpacing, merge ? LOD_COLUMN : 0) * appearance.candleBodyRatio,
      ),
    );
    // Price-pane fills sit under the candles, one trapezoid per bar-to-bar step so MSAA smooths the sloped edges.
    if (state.document.layers.indicator)
      for (const { plugin, series, visible: shown } of state.indicators) {
        if (!shown || !plugin.fills?.length || (plugin.pane ?? 'price') !== 'price') continue;
        for (const fill of plugin.fills) {
          const upper = series[fill.upper] ?? [],
            lower = series[fill.lower] ?? [];
          const [r, gr, b] = indicatorColor(theme, plugin, fill.upper);
          const tone: Color = [r, gr, b, fill.opacity];
          for (let i = Math.max(1, range.start); i < range.end; i++) {
            if (![upper[i - 1], lower[i - 1], upper[i], lower[i]].every(Number.isFinite)) continue;
            const from = g.x(bars[i - 1].timeMs + interval / 2),
              to = g.x(bars[i].timeMs + interval / 2);
            this.trapezoid(
              from,
              g.y(upper[i - 1]),
              g.y(lower[i - 1]),
              to,
              g.y(upper[i]),
              g.y(lower[i]),
              tone,
              priceClip,
            );
          }
        }
      }
    const type = state.document.chartType ?? 'candles';
    const candlesShown = state.document.layers.candles;
    if (candlesShown && drawsClosesOnly(type) && type !== 'columns')
      this.closeLine(type, drawn, g, priceClip);
    // Hollow candles and columns colour each bar by the close before it.
    let previousClose = bars[range.start - 1]?.close ?? drawn[0]?.open ?? 0;
    for (const bar of drawn) {
      const up = bar.close >= bar.open;
      const x = bar.x,
        rising = bar.close >= previousClose,
        color = bar.tone ?? (up ? colors.up : colors.down);
      previousClose = bar.close;
      if (candlesShown && !bar.footprint && (type === 'columns' || !drawsClosesOnly(type))) {
        const body = (top: number, bottom: number, tone: Color) =>
          this.line(
            x - candleWidth / 2,
            (top + bottom) / 2,
            x + candleWidth / 2,
            (top + bottom) / 2,
            Math.max(appearance.candleMinHeight, bottom - top),
            tone,
            priceClip,
          );
        const high = g.y(bar.high),
          low = g.y(bar.low),
          top = g.y(Math.max(bar.open, bar.close)),
          bottom = g.y(Math.min(bar.open, bar.close));
        if (type === 'ohlc-bars' || type === 'hlc-bars' || type === 'high-low') {
          const stroke = Math.max(appearance.wickWidth, Math.min(3, candleWidth / 5)),
            reach = Math.max(appearance.candleMinHeight, low - high) / 2;
          this.line(x, (high + low) / 2 - reach, x, (high + low) / 2 + reach, stroke, color, priceClip);
          // Ticks start at the bar's edge so their ends stay square against it.
          if (type === 'ohlc-bars')
            this.line(
              x - candleWidth / 2,
              g.y(bar.open),
              x + stroke / 2,
              g.y(bar.open),
              stroke,
              color,
              priceClip,
            );
          if (type !== 'high-low')
            this.line(
              x - stroke / 2,
              g.y(bar.close),
              x + candleWidth / 2,
              g.y(bar.close),
              stroke,
              color,
              priceClip,
            );
        } else if (type === 'columns') {
          body(g.y(bar.close), g.top + g.plotHeight, bar.tone ?? (rising ? colors.up : colors.down));
        } else if (type === 'hollow-candles') {
          const tone = bar.tone ?? (rising ? colors.up : colors.down),
            stroke = appearance.wickWidth;
          if (up && bottom - top > stroke * 2 && candleWidth > stroke * 3) {
            // An outlined body, with the wicks stopping at it.
            this.line(x, high, x, top, stroke, tone, priceClip);
            this.line(x, bottom, x, low, stroke, tone, priceClip);
            const left = x - candleWidth / 2 + stroke / 2,
              right = x + candleWidth / 2 - stroke / 2;
            this.line(left, top, left, bottom, stroke, tone, priceClip);
            this.line(right, top, right, bottom, stroke, tone, priceClip);
            this.line(
              left - stroke / 2,
              top + stroke / 2,
              right + stroke / 2,
              top + stroke / 2,
              stroke,
              tone,
              priceClip,
            );
            this.line(
              left - stroke / 2,
              bottom - stroke / 2,
              right + stroke / 2,
              bottom - stroke / 2,
              stroke,
              tone,
              priceClip,
            );
          } else {
            this.line(x, high, x, low, stroke, tone, priceClip);
            body(top, bottom, tone);
          }
        } else {
          this.line(
            x,
            high,
            x,
            low,
            appearance.wickWidth,
            bar.tone ?? (up ? colors.wickUp : colors.wickDown),
            priceClip,
          );
          body(top, bottom, color);
        }
      }
      if (state.document.layers.volume && g.volumeHeight > 0) {
        const h = (bar.volume / maxVolume) * g.volumeHeight;
        this.line(
          x - candleWidth / 2,
          g.volumeTop + g.volumeHeight - h / 2,
          x + candleWidth / 2,
          g.volumeTop + g.volumeHeight - h / 2,
          h,
          up ? colors.volumeUp : colors.volumeDown,
        );
      }
    }
    if (state.document.layers.indicator) {
      for (const { plugin, series, visible: shown } of state.indicators) {
        if (!shown || plugin.pane === 'profile') continue;
        const pane = plugin.pane === 'separate' ? g.panes.find(p => p.id === plugin.id) : undefined;
        if (plugin.pane === 'separate' && !pane) continue;
        const y = pane ? pane.y : g.y;
        const clip: readonly [number, number] = pane ? [pane.top, pane.top + pane.height] : priceClip;
        if (plugin.display === 'candles') {
          const [open, high, low, close] = series;
          for (let i = range.start; i < range.end; i++) {
            if (![open[i], high[i], low[i], close[i]].every(Number.isFinite)) continue;
            const up = close[i] >= open[i];
            const x = g.x(bars[i].timeMs + interval / 2);
            this.line(
              x,
              y(high[i]),
              x,
              y(low[i]),
              appearance.wickWidth,
              up ? colors.wickUp : colors.wickDown,
              clip,
            );
            const top = y(Math.max(open[i], close[i])),
              bottom = y(Math.min(open[i], close[i]));
            this.line(
              x - candleWidth / 2,
              (top + bottom) / 2,
              x + candleWidth / 2,
              (top + bottom) / 2,
              Math.max(appearance.candleMinHeight, bottom - top),
              up ? colors.up : colors.down,
              clip,
            );
          }
          continue;
        }
        const outputs = plugin.outputs?.length
          ? plugin.outputs
          : [{ color: plugin.color, style: 'line' as const }];
        outputs.forEach((output, k) => {
          // Dots are drawn on the overlay; candle colors were applied to the bars above.
          if (output.style === 'dot' || output.style === 'candles' || output.style === 'none') return;
          const values = series[k] ?? [];
          const color = indicatorColor(theme, plugin, k);
          if (output.style === 'histogram' || output.style === 'column') {
            const zero = Math.max(clip[0], Math.min(clip[1], y(0)));
            for (let i = range.start; i < range.end; i++) {
              if (!Number.isFinite(values[i])) continue;
              const x = g.x(bars[i].timeMs + interval / 2),
                top = y(values[i]);
              const tone =
                output.style === 'column'
                  ? color
                  : values[i] >= 0
                    ? colors.histogramUp
                    : colors.histogramDown;
              this.line(
                x - candleWidth / 2,
                (top + zero) / 2,
                x + candleWidth / 2,
                (top + zero) / 2,
                Math.abs(zero - top),
                tone,
                clip,
              );
            }
            return;
          }
          for (let i = Math.max(1, range.start); i < range.end; i++) {
            if (
              bars[i].timeMs < g.fromMs ||
              bars[i - 1].timeMs > g.toMs ||
              !Number.isFinite(values[i - 1]) ||
              !Number.isFinite(values[i])
            )
              continue;
            this.line(
              g.x(bars[i - 1].timeMs + interval / 2),
              y(values[i - 1]),
              g.x(bars[i].timeMs + interval / 2),
              y(values[i]),
              appearance.indicatorWidth,
              color,
              clip,
            );
          }
        });
      }
    }
    for (const pane of g.panes)
      if (appearance.gridWidth)
        this.line(
          g.left,
          pane.top - appearance.volumeGap / 2,
          g.left + g.plotWidth,
          pane.top - appearance.volumeGap / 2,
          appearance.gridWidth,
          colors.grid,
        );
    gl.useProgram(this.lineProgram);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    if (this.used * 4 > this.instanceCapacity) {
      this.instanceCapacity = this.vertices.byteLength;
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.used));
    gl.uniform2f(this.uniform(this.lineProgram, 'resolution'), g.width, g.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.round(g.left * dpr),
      Math.round((g.height - g.bottom) * dpr),
      Math.round(g.plotWidth * dpr),
      Math.round((g.bottom - g.top) * dpr),
    );
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.used / INSTANCE_FLOATS);
    gl.disable(gl.SCISSOR_TEST);
    return {
      cpuMs: performance.now() - start,
      drawCalls: 1,
      instances: this.used / INSTANCE_FLOATS,
      status: this.status,
    };
  }

  /** Development diagnostic. Retains CPU state while rebuilding GPU resources. */
  testContextRecovery(): boolean {
    if (this.disposed || this.status !== 'ready') return false;
    const extension = this.gl.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    this.recoveryTimer = setTimeout(() => {
      if (!this.disposed) extension.restoreContext();
    }, 2000);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.recoveryTimer);
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    }
    if (!this.gl) return;
    const gl = this.gl;
    gl.deleteProgram(this.lineProgram);
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.instances);
    gl.deleteVertexArray(this.lineVao);
    this.uniforms.clear();
  }
}
