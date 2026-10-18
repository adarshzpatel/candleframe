import type { ResolvedChartTheme } from './themes.ts';
import type { Anchor, Candle } from './types.ts';
import type { ChartGeometry } from './geometry.ts';

export interface DrawingStyle {
  color: string;
  width: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  fillOpacity: number;
  fontSize: number;
}
export interface Drawing {
  id: string;
  type: string;
  points: Anchor[];
  style: DrawingStyle;
  locked: boolean;
  visible: boolean;
  text: string;
  levels: number[];
  /** Colour and visibility for `levels[i]`, by index. Omitted when every level uses its default. */
  levelStyles?: DrawingLevelStyle[];
  /** Tool-specific settings keyed by `DrawingSetting.key`. Omitted when every value is the default. */
  options?: DrawingOptionValues;
}
/** One Fibonacci level's look. A missing colour uses the level's built-in hue. */
export interface DrawingLevelStyle {
  color?: string;
  /** False hides the level but keeps it in the levels table. */
  visible?: boolean;
}
export type DrawingOptionValue = boolean | number | string;
export type DrawingOptionValues = Record<string, DrawingOptionValue>;
/** One field of a tool's settings form. Values persist in `Drawing.options`. */
export type DrawingSetting = {
  key: string;
  label: string;
  /** Groups fields under a heading in the settings form. */
  section?: string;
} & (
  | { kind: 'boolean'; default: boolean }
  | { kind: 'select'; default: string; choices: readonly { value: string; label: string }[] }
  /** An empty default means "follow the drawing's colour" until the user picks one. */
  | { kind: 'color'; default: string }
  | { kind: 'number'; default: number; min: number; max: number; step?: number }
);
export interface DrawingInput {
  id: string;
  type: string;
  points: Anchor[];
  style?: Partial<DrawingStyle>;
  locked?: boolean;
  visible?: boolean;
  text?: string;
  levels?: number[];
  levelStyles?: DrawingLevelStyle[];
  options?: DrawingOptionValues;
}
export type DrawingPatch = Partial<
  Pick<Drawing, 'points' | 'locked' | 'visible' | 'text' | 'levels' | 'levelStyles'>
> & {
  style?: Partial<DrawingStyle>;
  /** Merged into the current options. */
  options?: DrawingOptionValues;
};
export interface DrawingPoint {
  x: number;
  y: number;
}
export interface DrawingHandle {
  id: number | string;
  at: DrawingPoint;
  cursor: 'move' | 'ns-resize' | 'ew-resize';
}
export type DrawingPrimitive =
  | {
      kind: 'path';
      points: DrawingPoint[];
      closed?: boolean;
      fill?: string;
      color?: string;
      width?: number;
      dash?: number[];
      opacity?: number;
    }
  | {
      kind: 'text';
      at: DrawingPoint;
      text: string;
      color?: string;
      size?: number;
      background?: string;
      /** Corner radius for the background box. */
      radius?: number;
      align?: 'left' | 'center' | 'right';
      /** Centres the text box vertically on `at.y`. */
      middle?: boolean;
      /** No background box, like a chart label. */
      plain?: boolean;
      bold?: boolean;
      italic?: boolean;
      /** Box outline colour. */
      border?: string;
      /** Background box opacity; defaults to the theme's annotation opacity. */
      backgroundOpacity?: number;
      /** Wraps lines longer than this many CSS pixels at spaces. */
      wrap?: number;
      /** Rotation in radians around `at`, clockwise on screen, such as text along a line. */
      angle?: number;
    }
  | {
      /** A tag in the price or time axis gutter, drawn outside the plot clip. */
      kind: 'axis';
      axis: 'price' | 'time';
      value: number;
      color?: string;
      /** Defaults to the formatted price or time. */
      text?: string;
    };
export interface DrawingContext {
  theme?: ResolvedChartTheme;
  geometry: ChartGeometry;
  intervalMs: number;
  tickSize?: number;
  /** Loaded candles in time order, for drawings that replay price (position outcomes). */
  candles?: readonly Candle[];
  formatPrice(price: number): string;
  /** True while this drawing is selected, for details shown only then. */
  selected?: boolean;
  /** Axis-style time label. Headless hosts may omit it. */
  formatTime?(timeMs: number): string;
  /** Shared measured text width for painting and hit testing; optional for headless hosts. */
  measureText?(text: string, font: string): number;
}
/** Trusted, framework-free extension. Geometry also supplies shared hit testing. */
export interface DrawingToolDefinition {
  readonly type: string;
  readonly label: string;
  readonly group: string;
  readonly points: number | 'path' | 'freehand';
  readonly hint: string;
  /** Heading inside the group's menu, such as Channels under Lines. */
  readonly section?: string;
  /** Tool-specific settings, rendered as a form and stored in `Drawing.options`. */
  readonly settings?: readonly DrawingSetting[];
  /** Opens a text editor after placement or when the annotation is activated. */
  readonly editableText?: boolean;
  /** Opens host-owned properties on double-click or Enter, without opening on placement. */
  readonly editableProperties?: boolean;
  /** Optional one-click placement. The persisted point count still follows `points`. */
  create?(anchor: Anchor, context: DrawingContext): Anchor[];
  /** Custom handles replace raw anchor handles for semantic editing. */
  handles?(drawing: Drawing, context: DrawingContext): DrawingHandle[];
  moveHandle?(drawing: Drawing, handle: string, anchor: Anchor, context: DrawingContext): Anchor[];
  project(drawing: Drawing, context: DrawingContext): DrawingPrimitive[];
  validate?(drawing: Drawing): void;
}
export interface DrawingOptions {
  magnet: 'off' | 'weak' | 'strong';
  stayInDrawingMode: boolean;
  hidden: boolean;
  style: DrawingStyle;
  text: string;
  /** Last-used style, settings and levels per tool, applied over `style` to new drawings of that tool. */
  toolDefaults: Record<string, DrawingToolDefaults>;
}
/** What a tool's next drawing starts with, and what a drawing template holds. */
export interface DrawingToolDefaults {
  style?: Partial<DrawingStyle>;
  options?: DrawingOptionValues;
  /** Fibonacci levels; empty or omitted uses the tool's built-in levels. */
  levels?: number[];
  /** Colour and visibility per level, by index into the levels. */
  levelStyles?: DrawingLevelStyle[];
}
/** `toolDefaults` entries replace that tool's defaults; `null` clears them. */
export type DrawingOptionsPatch = Partial<Omit<DrawingOptions, 'style' | 'toolDefaults'>> & {
  style?: Partial<DrawingStyle>;
  toolDefaults?: Record<string, DrawingToolDefaults | null>;
};
/** Pointer modifiers: Shift snaps angles to 45°, clone drags a copy of the drawing. */
export interface DrawingModifiers {
  shift?: boolean;
  clone?: boolean;
}
export interface DrawingInteractionState {
  tool: string;
  selected: Drawing | null;
  creating: boolean;
  options: DrawingOptions;
}
