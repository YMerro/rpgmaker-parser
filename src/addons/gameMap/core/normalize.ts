/**
 * Raw engine data -> engine-neutral structures. Pure: no I/O, no Node APIs.
 * Tolerates camelCase / snake_case / `@ivar` keys and object / array / Map hashes,
 * so it accepts MV/MZ JSON as well as Ruby data however the host decoded it.
 */
import type {
  Command, CommonEventInfo, EventSource, GameMapData, MapEvent, MapInfo, PageCondition, TroopInfo,
} from '../types';

type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Read `key` (camelCase) from an object using any of the supported spellings. */
export function field(o: unknown, key: string): unknown {
  if (o instanceof Map) o = Object.fromEntries(o);
  if (!isObj(o)) return undefined;
  for (const k of [key, snake(key), `@${snake(key)}`, `@${key}`]) if (k in o) return o[k];
  return undefined;
}

/** JSON arrays (null-padded), Ruby hashes ({id => obj}) and Maps -> [{ id, obj }]. */
export function entries(raw: unknown): { id: number; obj: Obj }[] {
  const pairs: [unknown, unknown][] =
    Array.isArray(raw) ? raw.map((v, i) => [i, v])
    : raw instanceof Map ? [...raw.entries()]
    : isObj(raw) ? Object.entries(raw)
    : [];
  const out: { id: number; obj: Obj }[] = [];
  for (const [k, v] of pairs) {
    const obj = v instanceof Map ? (Object.fromEntries(v) as Obj) : v;
    if (!isObj(obj)) continue;
    const id = num(field(obj, 'id'), Number(k));
    if (id > 0) out.push({ id, obj });
  }
  return out.sort((a, b) => a.id - b.id);
}

export const names = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(str) : []);

export function toCommands(raw: unknown): Command[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((c) => {
    const params = field(c, 'parameters');
    return { code: num(field(c, 'code')), indent: num(field(c, 'indent')), parameters: Array.isArray(params) ? params : [] };
  });
}

/** Event/troop page conditions (MV `conditions`, Ruby `@condition`). */
export function toCondition(raw: unknown): PageCondition {
  const f = (k: string) => field(raw, k);
  const out: PageCondition = { switchIds: [] };
  if (f('switch1Valid')) out.switchIds.push(num(f('switch1Id')));
  if (f('switch2Valid')) out.switchIds.push(num(f('switch2Id')));
  if (f('switchValid')) out.switchIds.push(num(f('switchId'))); // troop pages
  if (f('variableValid')) out.variable = { id: num(f('variableId')), value: num(f('variableValue')) };
  out.switchIds = out.switchIds.filter((id) => id > 0);
  return out;
}

const toPages = (raw: unknown) => (Array.isArray(raw) ? raw : []).filter(isObj)
  .map((p) => ({ condition: toCondition(field(p, 'conditions') ?? field(p, 'condition')), list: toCommands(field(p, 'list')) }));

export function toSystem(raw: unknown): { title: string; switches: string[]; variables: string[] } {
  return { title: str(field(raw, 'gameTitle')), switches: names(field(raw, 'switches')), variables: names(field(raw, 'variables')) };
}

export const toMapInfos = (raw: unknown): MapInfo[] => entries(raw).map(({ id, obj }) => ({
  id, name: str(field(obj, 'name')), parentId: num(field(obj, 'parentId')), order: num(field(obj, 'order')),
}));

export const toCommonEvents = (raw: unknown): CommonEventInfo[] => entries(raw).map(({ id, obj }) => ({
  id, name: str(field(obj, 'name')), trigger: num(field(obj, 'trigger')), switchId: num(field(obj, 'switchId')),
  list: toCommands(field(obj, 'list')),
}));

export const toTroops = (raw: unknown): TroopInfo[] => entries(raw).map(({ id, obj }) => ({
  id, name: str(field(obj, 'name')), pages: toPages(field(obj, 'pages')),
}));

export function toMap(raw: unknown, mapId: number): GameMapData | null {
  if (!isObj(raw) && !(raw instanceof Map)) return null;
  const events: MapEvent[] = entries(field(raw, 'events')).map(({ id, obj }) => ({
    id, name: str(field(obj, 'name')), x: num(field(obj, 'x')), y: num(field(obj, 'y')), pages: toPages(field(obj, 'pages')),
  }));
  return { id: mapId, displayName: str(field(raw, 'displayName')), events };
}

/** All event pages of a map, as scanner input. */
export function mapToSources(map: GameMapData | null): EventSource[] {
  if (!map) return [];
  return map.events.flatMap((ev) => ev.pages.map((p, page) => ({
    ref: { type: 'event' as const, mapId: map.id, eventId: ev.id, page }, condition: p.condition, list: p.list,
  })));
}

export function commonEventSources(commonEvents: CommonEventInfo[]): EventSource[] {
  return commonEvents.map((c) => ({
    ref: { type: 'commonEvent', commonEventId: c.id },
    condition: { switchIds: c.trigger > 0 && c.switchId > 0 ? [c.switchId] : [] },
    list: c.list,
  }));
}

export function troopSources(troops: TroopInfo[]): EventSource[] {
  return troops.flatMap((t) => t.pages.map((p, page) => ({
    ref: { type: 'troop' as const, troopId: t.id, page }, condition: p.condition, list: p.list,
  })));
}
