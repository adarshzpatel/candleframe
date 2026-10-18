import type { DrawingToolDefinition } from './drawing-types.ts';

/** Extra shapes, arrows and notes. Registered in drawing-tools.ts; icons merge into ui-icons.ts. */
/** Shapes after the polyline. */
export const shapeTools: readonly DrawingToolDefinition[] = [];
/** Arrows after the arrow. */
export const arrowTools: readonly DrawingToolDefinition[] = [];
/** Text and notes after the price label. */
export const noteTools: readonly DrawingToolDefinition[] = [];
/** 24-unit SVG paths keyed by tool type. */
export const shapesIcons: Readonly<Record<string, string>> = {};
