import { ChartError } from './errors.ts';
import type { Drawing, DrawingGroup } from './drawing-types.ts';
import type { ChartCommand } from './types.ts';

export const MAX_DRAWING_GROUPS = 100;
export const MAX_GROUP_NAME_LENGTH = 64;

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
export function validGroupName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_GROUP_NAME_LENGTH)
    throw new ChartError('INVALID_DRAWING_GROUP', `name must be 1 to ${MAX_GROUP_NAME_LENGTH} characters`, {
      path: 'name',
    });
  return name;
}

/**
 * Checks saved groups and drops members that no longer exist. A drawing stays in the
 * first group that lists it, and groups left without members are removed.
 */
export function parseDrawingGroups(value: unknown, drawings: readonly Drawing[]): DrawingGroup[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_DRAWING_GROUPS)
    throw new ChartError('INVALID_DRAWING_GROUPS', `send an array of at most ${MAX_DRAWING_GROUPS} groups`, {
      path: 'drawingGroups',
    });
  const known = new Set(drawings.map(d => d.id)),
    taken = new Set<string>(),
    ids = new Set<string>();
  const groups: DrawingGroup[] = [];
  value.forEach((group: Partial<DrawingGroup> | null, index) => {
    const path = `drawingGroups.${index}`;
    if (!group || typeof group !== 'object' || !validId(group.id) || !Array.isArray(group.drawings))
      throw new ChartError('INVALID_DRAWING_GROUPS', 'each group needs an id and a drawings array', { path });
    if (ids.has(group.id))
      throw new ChartError('INVALID_DRAWING_GROUPS', 'group ids must be unique', {
        path: `${path}.id`,
        details: { id: group.id },
      });
    ids.add(group.id);
    let name: string;
    try {
      name = validGroupName(group.name);
    } catch {
      throw new ChartError(
        'INVALID_DRAWING_GROUPS',
        `name must be 1 to ${MAX_GROUP_NAME_LENGTH} characters`,
        {
          path: `${path}.name`,
        },
      );
    }
    const members = group.drawings.filter(
      (id): id is string => typeof id === 'string' && known.has(id) && !taken.has(id),
    );
    members.forEach(id => taken.add(id));
    if (members.length) groups.push({ id: group.id, name, drawings: [...new Set(members)] });
  });
  return groups;
}

export function groupOf(groups: readonly DrawingGroup[] | undefined, id: string): DrawingGroup | undefined {
  return groups?.find(group => group.drawings.includes(id));
}

/** Validated, existing, unique drawing ids for a group command. */
export function memberIds(drawings: readonly Drawing[], value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > drawings.length)
    throw new ChartError('INVALID_DRAWING_GROUP', 'drawingIds must list one or more drawings', {
      path: 'drawingIds',
    });
  value.forEach((id, index) => {
    if (!drawings.some(d => d.id === id))
      throw new ChartError('DRAWING_NOT_FOUND', undefined, { path: `drawingIds.${index}`, details: { id } });
  });
  if (new Set(value).size !== value.length)
    throw new ChartError('INVALID_DRAWING_GROUP', 'drawingIds must be unique', { path: 'drawingIds' });
  return [...value];
}

/** Gathers `ids` next to the frontmost of them, keeping their relative order, like a stacked group. */
export function gather(drawings: readonly Drawing[], ids: readonly string[]): Drawing[] {
  const members = new Set(ids);
  const moved = drawings.filter(d => members.has(d.id));
  const front = drawings.indexOf(moved.at(-1)!);
  const result: Drawing[] = [];
  drawings.forEach((d, index) => {
    if (!members.has(d.id)) result.push(d);
    if (index === front) result.push(...moved);
  });
  return result;
}

/** One row of the Objects tree, front to back. Groups sit at their frontmost member. */
export type DrawingTreeItem =
  { kind: 'drawing'; id: string } | { kind: 'group'; id: string; members: string[] };

export function drawingTree(
  drawings: readonly Drawing[],
  groups: readonly DrawingGroup[] = [],
): DrawingTreeItem[] {
  const items: DrawingTreeItem[] = [],
    seen = new Set<string>();
  for (const d of [...drawings].reverse()) {
    const group = groupOf(groups, d.id);
    if (!group) items.push({ kind: 'drawing', id: d.id });
    else if (!seen.has(group.id)) {
      seen.add(group.id);
      const members = new Set(group.drawings);
      items.push({
        kind: 'group',
        id: group.id,
        members: [...drawings]
          .reverse()
          .filter(m => members.has(m.id))
          .map(m => m.id),
      });
    }
  }
  return items;
}

/** What a tree drop targets: a top-level row, or a member row inside a group. */
export interface DrawingTreeDrop {
  /** A drawing or group id. */
  target: string;
  where: 'before' | 'after';
}

/**
 * Commands that move a drawing or group to a drop position in the Objects tree, where
 * `before` means in front of the target. A drawing dropped beside a member joins that
 * group; one dropped beside a top-level row leaves its group. Groups stay top level.
 * Returns an empty list when nothing would change.
 */
export function treeMoveCommands(
  drawings: readonly Drawing[],
  groups: readonly DrawingGroup[] = [],
  source: string,
  drop: DrawingTreeDrop,
): ChartCommand[] {
  const tree = drawingTree(drawings, groups);
  const isGroup = groups.some(g => g.id === source);
  if (source === drop.target) return [];
  if (isGroup && groupOf(groups, drop.target)?.id === source) return [];
  const without: DrawingTreeItem[] = tree
    .filter(item => item.id !== source)
    .map(item =>
      item.kind === 'group' ? { ...item, members: item.members.filter(id => id !== source) } : item,
    );
  const moving: DrawingTreeItem = isGroup
    ? tree.find(item => item.id === source)!
    : { kind: 'drawing', id: source };
  const offset = drop.where === 'before' ? 0 : 1;
  const top = without.findIndex(item => item.id === drop.target);
  if (top >= 0) without.splice(top + offset, 0, moving);
  else {
    const parent = without.find(
      (item): item is Extract<DrawingTreeItem, { kind: 'group' }> =>
        item.kind === 'group' && item.members.includes(drop.target),
    );
    if (!parent) return [];
    if (isGroup) without.splice(without.indexOf(parent) + offset, 0, moving);
    else parent.members.splice(parent.members.indexOf(drop.target) + offset, 0, source);
  }
  // Back to front, as the document stores them.
  const order = without.flatMap(item => (item.kind === 'group' ? item.members : [item.id])).reverse();
  const commands: ChartCommand[] = [];
  for (const item of without) {
    if (item.kind !== 'group') continue;
    const before = groups.find(g => g.id === item.id)!;
    const same =
      before.drawings.length === item.members.length &&
      item.members.every(id => before.drawings.includes(id));
    if (!item.members.length) commands.push({ type: 'drawing.ungroup', id: item.id });
    else if (!same)
      commands.push({ type: 'drawing.updateGroup', id: item.id, drawingIds: [...item.members].reverse() });
  }
  if (order.some((id, index) => drawings[index]?.id !== id))
    commands.push({ type: 'drawing.reorder', ids: order });
  return commands;
}
