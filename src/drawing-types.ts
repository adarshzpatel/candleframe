import type { ResolvedChartTheme } from './themes.ts';
import type { Anchor } from './types.ts';
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
}
export interface DrawingInput {
  id: string;
  type: string;
  points: Anchor[];
  style?: Partial<DrawingStyle>;
  locked?: boolean;
  visible?: boolean;
  text?: string;
  levels?: number[];
}
export type DrawingPatch = Partial<Pick<Drawing, 'points' | 'locked' | 'visible' | 'text' | 'levels'>> & {
  style?: Partial<DrawingStyle>;
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
      align?: 'left' | 'center' | 'right';
    };
export interface DrawingContext {
  theme?: ResolvedChartTheme;
  geometry: ChartGeometry;
  intervalMs: number;
  tickSize?: number;
  formatPrice(price: number): string;
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
}
export interface DrawingInteractionState {
  tool: string;
  selected: Drawing | null;
  creating: boolean;
  options: DrawingOptions;
}
