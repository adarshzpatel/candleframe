import { footprintShown } from './footprint.ts';
import { ChartError } from './errors.ts';
import { chartThemes, colorRGBA, indicatorColor, themeColor } from './themes.ts';
import type { ResolvedChartTheme } from './themes.ts';
import type { ChartGeometry } from './geometry.ts';
import type { HeatmapStore } from './heatmap.ts';
import type { RuntimeState } from './types.ts';
import { visibleRange } from './time-scale.ts';

export interface RenderFrame {
  state: RuntimeState;
  geometry: ChartGeometry;
  heatmap?: HeatmapStore;
  theme?: ResolvedChartTheme;
  /** Grid line positions in CSS pixels, usually the axis ticks. Without it, the theme's even grid is used. */
  grid?: { x: readonly number[]; y: readonly number[] };
}
export interface RendererStats {
  cpuMs: number;
  drawCalls: number;
  instances: number;
  textureBytes: number;
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
uniform vec2 resolution;
out vec4 vColor;
out highp float vY;
flat out highp vec2 vClipY;
void main() {
  vec2 d = finish - start;
  vec2 normal = vec2(-d.y, d.x) / max(length(d), 0.0001);
  vec2 point = mix(start, finish, corner.x) + normal * (corner.y - 0.5) * thickness;
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
const heatVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
uniform vec2 resolution;
uniform vec4 rect;
out vec2 uv;
void main() {
  vec2 point = rect.xy + corner * rect.zw;
  gl_Position = vec4(point / resolution * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  uv = corner;
}`;
const heatFragment = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D heat;
uniform vec4 view;
uniform vec4 grid;
uniform vec2 ring;
uniform float intensity;
uniform vec4 lowColor;
uniform vec4 midColor;
uniform vec4 highColor;
uniform vec4 peakColor;
uniform vec4 unknownColor;
uniform float heatOpacity;
out vec4 outputColor;
void main() {
  float col = floor(mix(view.x, view.y, uv.x));
  float price = mix(view.w, view.z, uv.y);
  float row = floor((price - grid.x) / grid.y);
  if (col < 0. || col >= grid.w || row < 0. || row >= grid.z) discard;
  float slot = mod(ring.x + col, ring.y);
  vec2 value = texelFetch(heat, ivec2(int(slot), int(row)), 0).rg;
  if (value.g < .75) {
    float stripe = step(.65, fract((gl_FragCoord.x + gl_FragCoord.y) / 12.));
    outputColor = vec4(unknownColor.rgb, stripe * unknownColor.a);
    return;
  }
  float strength = clamp(value.r * intensity, 0., 1.);
  vec3 cool = mix(lowColor.rgb, midColor.rgb, smoothstep(.08,.48,strength));
  vec3 warm = mix(highColor.rgb, peakColor.rgb, smoothstep(.55,.95,strength));
  vec3 color = mix(cool, warm, smoothstep(.4,.65,strength));
  outputColor = vec4(color, smoothstep(.03,.65,strength) * heatOpacity);
}`;

type Color = readonly [number, number, number, number];
const UNCLIPPED: readonly [number, number] = [-1e9, 1e9];
const INSTANCE_FLOATS = 11;
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
    histogramUp: token(chart.candleUp, 0.55),
    histogramDown: token(chart.candleDown, 0.55),
    grid: colorRGBA(theme.palette.grid, chart.gridOpacity),
    indicator: colorRGBA(theme.palette.indicator),
    heatLow: token(chart.heatmapLow),
    heatMid: token(chart.heatmapMid),
    heatHigh: token(chart.heatmapHigh),
    heatPeak: token(chart.heatmapPeak),
    heatUnknown: token(chart.heatmapUnknown, chart.heatmapUnknownOpacity),
  };
};

/** Instanced line/rectangle geometry and a bounded, incrementally updated depth texture. */
export class WebGL2Renderer implements ChartRenderer {
  readonly name = 'WebGL2';
  private theme = chartThemes.evergreen;
  private colors = colorsFor(this.theme);
  private canvas!: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private lineProgram!: WebGLProgram;
  private heatProgram!: WebGLProgram;
  private lineVao!: WebGLVertexArrayObject;
  private heatVao!: WebGLVertexArrayObject;
  private corners!: WebGLBuffer;
  private instances!: WebGLBuffer;
  private texture!: WebGLTexture;
  private uploadedRevision = -1;
  private uploadedStore?: HeatmapStore;
  private uploadedStamps: number[] = [];
  private columnBytes = new Uint8Array(0);
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
    this.heatProgram = this.program(heatVertex, heatFragment);
    this.corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const vao = () => {
      const result = gl.createVertexArray()!;
      gl.bindVertexArray(result);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      return result;
    };
    this.heatVao = vao();
    this.lineVao = vao();
    this.instances = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (const [location, count, offset] of [
      [1, 2, 0],
      [2, 2, 2],
      [3, 1, 4],
      [4, 4, 5],
      [5, 2, 9],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, count, gl.FLOAT, false, INSTANCE_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadedRevision = -1;
    this.uploadedStore = undefined;
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

  private upload(store: HeatmapStore): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.uploadedStore !== store) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG8,
        store.capacity,
        store.grid.rows,
        0,
        gl.RG,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.uploadedStamps = Array(store.capacity).fill(-1);
      this.columnBytes = new Uint8Array(store.grid.rows * 2);
      this.uploadedStore = store;
      this.uploadedRevision = -1;
    }
    if (this.uploadedRevision === store.revision) return;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let slot = 0; slot < store.capacity; slot++) {
      const column = store.columns[slot];
      if (!column || this.uploadedStamps[slot] === store.stamps[slot]) continue;
      for (let row = 0; row < store.grid.rows; row++) {
        this.columnBytes[row * 2] = Math.round(
          Math.min(1, Math.log1p(column.values[row]) / Math.log(45)) * 255,
        );
        this.columnBytes[row * 2 + 1] = column.valid ? 255 : 0;
      }
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        slot,
        0,
        1,
        store.grid.rows,
        gl.RG,
        gl.UNSIGNED_BYTE,
        this.columnBytes,
      );
      this.uploadedStamps[slot] = store.stamps[slot];
    }
    this.uploadedRevision = store.revision;
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
    this.used += INSTANCE_FLOATS;
  }

  render({ state, geometry: g, heatmap, theme = chartThemes.evergreen, grid }: RenderFrame): RendererStats {
    const start = performance.now();
    if (this.status !== 'ready')
      return { cpuMs: 0, drawCalls: 0, instances: 0, textureBytes: 0, status: this.status };
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
    let drawCalls = 0;
    if (state.document.layers.heatmap && heatmap?.count) {
      this.upload(heatmap);
      gl.useProgram(this.heatProgram);
      gl.bindVertexArray(this.heatVao);
      gl.uniform2f(this.uniform(this.heatProgram, 'resolution'), g.width, g.height);
      gl.uniform4f(this.uniform(this.heatProgram, 'rect'), g.left, g.top, g.plotWidth, g.plotHeight);
      gl.uniform4f(
        this.uniform(this.heatProgram, 'view'),
        (g.fromMs - heatmap.firstTimeMs) / heatmap.grid.intervalMs,
        (g.toMs - heatmap.firstTimeMs) / heatmap.grid.intervalMs,
        g.minPrice,
        g.maxPrice,
      );
      gl.uniform4f(
        this.uniform(this.heatProgram, 'grid'),
        heatmap.grid.minPrice,
        heatmap.grid.binSize,
        heatmap.grid.rows,
        heatmap.count,
      );
      gl.uniform2f(this.uniform(this.heatProgram, 'ring'), heatmap.startSlot, heatmap.capacity);
      gl.uniform1f(this.uniform(this.heatProgram, 'intensity'), state.document.intensity);
      gl.uniform4f(this.uniform(this.heatProgram, 'lowColor'), ...colors.heatLow);
      gl.uniform4f(this.uniform(this.heatProgram, 'midColor'), ...colors.heatMid);
      gl.uniform4f(this.uniform(this.heatProgram, 'highColor'), ...colors.heatHigh);
      gl.uniform4f(this.uniform(this.heatProgram, 'peakColor'), ...colors.heatPeak);
      gl.uniform4f(this.uniform(this.heatProgram, 'unknownColor'), ...colors.heatUnknown);
      gl.uniform1f(this.uniform(this.heatProgram, 'heatOpacity'), appearance.heatmapOpacity);
      gl.uniform1i(this.uniform(this.heatProgram, 'heat'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls++;
    }
    this.used = 0;
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
    }[] = [];
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
    // Price-pane fills sit under the candles. Each bar-to-bar step is two flat halves.
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
              to = g.x(bars[i].timeMs + interval / 2),
              middle = (from + to) / 2;
            for (const [x1, x2, k] of [
              [from, middle, i - 1],
              [middle, to, i],
            ]) {
              const top = g.y(upper[k]),
                bottom = g.y(lower[k]);
              this.line(
                x1,
                (top + bottom) / 2,
                x2,
                (top + bottom) / 2,
                Math.abs(bottom - top),
                tone,
                priceClip,
              );
            }
          }
        }
      }
    for (const bar of drawn) {
      const up = bar.close >= bar.open;
      const x = bar.x,
        color = up ? colors.up : colors.down;
      if (state.document.layers.candles && !bar.footprint) {
        this.line(
          x,
          g.y(bar.high),
          x,
          g.y(bar.low),
          appearance.wickWidth,
          up ? colors.wickUp : colors.wickDown,
          priceClip,
        );
        const top = g.y(Math.max(bar.open, bar.close)),
          bottom = g.y(Math.min(bar.open, bar.close));
        this.line(
          x - candleWidth / 2,
          (top + bottom) / 2,
          x + candleWidth / 2,
          (top + bottom) / 2,
          Math.max(appearance.candleMinHeight, bottom - top),
          color,
          priceClip,
        );
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
    drawCalls++;
    return {
      cpuMs: performance.now() - start,
      drawCalls,
      instances: this.used / INSTANCE_FLOATS,
      textureBytes: this.uploadedStore ? this.uploadedStore.capacity * this.uploadedStore.grid.rows * 2 : 0,
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
    gl.deleteProgram(this.heatProgram);
    gl.deleteBuffer(this.corners);
    gl.deleteBuffer(this.instances);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteVertexArray(this.heatVao);
    gl.deleteTexture(this.texture);
    this.uniforms.clear();
  }
}
