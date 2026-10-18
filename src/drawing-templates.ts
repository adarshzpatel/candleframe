import { ChartError } from './errors.ts';
import { DEFAULT_DRAWING_STYLE, normalizedToolDefaults } from './drawing-tools.ts';
import type { Drawing, DrawingPatch, DrawingToolDefaults, DrawingToolDefinition } from './drawing-types.ts';

export const MAX_TEMPLATES_PER_TOOL = 20;
export const MAX_TEMPLATE_NAME_LENGTH = 64;

/** A named look for one tool: style, settings and Fibonacci levels. */
export interface DrawingTemplate extends DrawingToolDefaults {
  name: string;
}
/** What the widget stores: named templates and saved defaults, keyed by tool type. */
export interface DrawingTemplateData {
  version: 1;
  templates: Record<string, DrawingTemplate[]>;
  defaults: Record<string, DrawingToolDefaults>;
}
/** Application storage for templates, such as an account service. */
export interface DrawingTemplateStore {
  load(): unknown | Promise<unknown>;
  save(value: DrawingTemplateData): void | Promise<void>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Trims a template name, or throws if it is empty, too long or has control characters. */
export function templateName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_TEMPLATE_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name))
    throw new ChartError('INVALID_TEMPLATE_NAME', undefined, {
      details: { maxLength: MAX_TEMPLATE_NAME_LENGTH },
    });
  return name;
}

/**
 * The style, settings and levels a template takes from a drawing. Points and text stay behind.
 * Given the tool, option keys it does not declare as settings (per-drawing state such as a
 * bars pattern's source range) stay behind too.
 */
export function drawingTemplateValue(
  drawing: Drawing,
  definition?: Pick<DrawingToolDefinition, 'settings'>,
): DrawingToolDefaults {
  const keys = definition && new Set(definition.settings?.map(setting => setting.key));
  const options = Object.entries(drawing.options ?? {}).filter(([key]) => !keys || keys.has(key));
  return {
    style: { ...drawing.style },
    ...(options.length ? { options: Object.fromEntries(options) } : {}),
    ...(drawing.levels.length ? { levels: [...drawing.levels] } : {}),
  };
}

/**
 * A `drawing.update` patch that gives a drawing `value`'s look, or the built-in look for
 * `null`. Every setting is listed, so values the template leaves out return to their default.
 */
export function drawingTemplatePatch(
  definition: Pick<DrawingToolDefinition, 'settings'> | undefined,
  value: DrawingToolDefaults | null,
): DrawingPatch {
  return {
    style: { ...DEFAULT_DRAWING_STYLE, ...value?.style },
    options: Object.fromEntries(
      (definition?.settings ?? []).map(setting => [
        setting.key,
        value?.options?.[setting.key] ?? setting.default,
      ]),
    ),
    levels: [...(value?.levels ?? [])],
  };
}

/**
 * Reads stored template data, dropping invalid entries. Templates for tools that are not
 * registered keep their generic checks, so they survive until their plugin returns.
 */
export function parseDrawingTemplates(
  value: unknown,
  tools: readonly DrawingToolDefinition[],
): DrawingTemplateData {
  const result: DrawingTemplateData = { version: 1, templates: {}, defaults: {} };
  if (!object(value)) return result;
  const definition = (type: string) => tools.find(tool => tool.type === type);
  const valid = (type: string, given: unknown) => {
    try {
      return normalizedToolDefaults(given, definition(type));
    } catch {
      return null;
    }
  };
  for (const [type, list] of Object.entries(object(value.templates) ? value.templates : {})) {
    if (!Array.isArray(list)) continue;
    const kept: DrawingTemplate[] = [];
    for (const entry of list) {
      if (!object(entry) || kept.length >= MAX_TEMPLATES_PER_TOOL) continue;
      const { name, ...rest } = entry;
      let checkedName: string;
      try {
        checkedName = templateName(name);
      } catch {
        continue;
      }
      const look = valid(type, rest);
      if (look && !kept.some(t => sameName(t.name, checkedName))) kept.push({ name: checkedName, ...look });
    }
    if (kept.length) result.templates[type] = kept;
  }
  for (const [type, given] of Object.entries(object(value.defaults) ? value.defaults : {})) {
    const look = valid(type, given);
    if (look && Object.keys(look).length) result.defaults[type] = look;
  }
  return result;
}

/** Named templates and saved defaults per tool, in memory with optional storage. */
export class DrawingTemplates {
  private data: DrawingTemplateData = { version: 1, templates: {}, defaults: {} };
  private readonly tools: readonly DrawingToolDefinition[];
  private readonly store: DrawingTemplateStore | undefined;
  private readonly onError: (error: unknown) => void;
  private changed = false;

  constructor(
    tools: readonly DrawingToolDefinition[],
    store?: DrawingTemplateStore,
    onError: (error: unknown) => void = () => {},
  ) {
    this.tools = tools;
    this.store = store;
    this.onError = onError;
  }
  /** Reads the store. Edits made before it answers win over the stored copy. */
  async load(): Promise<void> {
    if (!this.store) return;
    let saved: DrawingTemplateData;
    try {
      saved = parseDrawingTemplates(await this.store.load(), this.tools);
    } catch (error) {
      this.onError(error);
      return;
    }
    this.data = this.changed
      ? {
          version: 1,
          templates: { ...saved.templates, ...this.data.templates },
          defaults: { ...saved.defaults, ...this.data.defaults },
        }
      : saved;
  }
  list(type: string): readonly DrawingTemplate[] {
    return structuredClone(this.data.templates[type] ?? []);
  }
  find(type: string, name: string): DrawingTemplate | undefined {
    const found = this.data.templates[type]?.find(t => sameName(t.name, name));
    return found && structuredClone(found);
  }
  defaults(): Record<string, DrawingToolDefaults> {
    return structuredClone(this.data.defaults);
  }
  /**
   * Validates and stores a template. A name already in use throws `TEMPLATE_EXISTS`
   * unless `replace` is set; the replacement keeps the list position.
   */
  save(type: string, name: string, value: DrawingToolDefaults, replace = false): DrawingTemplate {
    const template = { name: templateName(name), ...this.validate(type, value) };
    const list = [...(this.data.templates[type] ?? [])],
      index = list.findIndex(t => sameName(t.name, template.name));
    if (index >= 0 && !replace) throw new ChartError('TEMPLATE_EXISTS', template.name);
    if (index < 0 && list.length >= MAX_TEMPLATES_PER_TOOL)
      throw new ChartError('TEMPLATE_LIMIT', undefined, { details: { max: MAX_TEMPLATES_PER_TOOL } });
    if (index >= 0) list[index] = template;
    else list.push(template);
    this.data.templates[type] = list;
    this.persist();
    return structuredClone(template);
  }
  remove(type: string, name: string): void {
    const list = this.data.templates[type] ?? [];
    if (!list.some(t => sameName(t.name, name))) throw new ChartError('TEMPLATE_NOT_FOUND', name);
    const rest = list.filter(t => !sameName(t.name, name));
    if (rest.length) this.data.templates[type] = rest;
    else delete this.data.templates[type];
    this.persist();
  }
  /** Saves a tool's defaults for the next session, or clears them with `null`. */
  setDefault(type: string, value: DrawingToolDefaults | null): void {
    if (value === null) delete this.data.defaults[type];
    else {
      const look = this.validate(type, value);
      if (Object.keys(look).length) this.data.defaults[type] = look;
      else delete this.data.defaults[type];
    }
    this.persist();
  }
  snapshot(): DrawingTemplateData {
    return structuredClone(this.data);
  }
  private validate(type: string, value: DrawingToolDefaults): DrawingToolDefaults {
    const definition = this.tools.find(tool => tool.type === type);
    if (!definition) throw new ChartError('UNKNOWN_DRAWING_TOOL', type);
    return normalizedToolDefaults(value, definition);
  }
  private persist() {
    this.changed = true;
    if (!this.store) return;
    try {
      Promise.resolve(this.store.save(this.snapshot())).catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
  }
}
