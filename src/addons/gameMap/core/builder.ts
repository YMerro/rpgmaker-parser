import { normalizeEngine, type GameDataSource } from '../source';
import type { GameMapData, GameMapGraph, MapInfo, NamedUsage, Usage } from '../types';
import { commonEventSources, mapToSources, toCommonEvents, toMap, toMapInfos, toSystem, toTroops, troopSources } from './normalize';
import { scanSources } from './scanner';

export interface BuildOptions {
  /** Maps loaded in parallel (each one is a host call, e.g. an IPC round trip). Default 8. */
  concurrency?: number;
  /** Called after each map, for progress bars. */
  onProgress?: (done: number, total: number) => void;
}

const sortedRecord = (m: Map<number, Set<number>>) =>
  Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).map(([k, s]) => [String(k), [...s].sort((a, b) => a - b)]));

function named(names: string[], usage: Map<number, Usage[]>): NamedUsage[] {
  const max = Math.max(names.length - 1, ...usage.keys(), 0);
  const out: NamedUsage[] = [];
  for (let id = 1; id <= max; id++) out.push({ id, name: names[id] ?? '', usedIn: usage.get(id) ?? [] });
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Builds the game map graph from a host-provided data source.
 * Only System is required; any other failure becomes an entry in `warnings`.
 * The result is plain JSON (safe for IPC, structuredClone and JSON.stringify).
 */
export async function buildGameMapFrom(source: GameDataSource, options: BuildOptions = {}): Promise<GameMapGraph> {
  const engine = normalizeEngine(source.engine);
  const warnings: string[] = [];
  const optional = async <T>(label: string, fn: (() => unknown) | undefined, parse: (raw: unknown) => T, empty: T): Promise<T> => {
    if (!fn) return empty;
    try { return parse(await fn.call(source)); } catch (e) { warnings.push(`${label} unreadable: ${message(e)}`); return empty; }
  };

  const rawSystem = await source.system();
  if (rawSystem == null) throw new Error('System data is missing');
  const system = toSystem(rawSystem);
  const [infosFromDb, commonEvents, troops, fallbackTitle] = await Promise.all([
    optional('MapInfos', source.mapInfos, toMapInfos, [] as MapInfo[]),
    optional('CommonEvents', source.commonEvents, toCommonEvents, []),
    optional('Troops', source.troops, toTroops, []),
    optional('Title', source.title, (t) => (typeof t === 'string' ? t : ''), ''),
  ]);

  let infos = infosFromDb;
  if (!infos.length) {
    const ids = await optional('Map list', source.listMapIds, (r) => (Array.isArray(r) ? r.filter(Number.isInteger) : []), [] as number[]);
    warnings.push(`MapInfos missing or empty; scanning ${ids.length} map(s) from listMapIds()`);
    infos = ids.map((id) => ({ id, name: '', parentId: 0, order: id }));
  }

  const maps = new Map<number, GameMapData | null>();
  const mapErrors = new Map<number, string>();
  let next = 0, done = 0;
  const worker = async () => {
    while (next < infos.length) {
      const info = infos[next++];
      try {
        const m = toMap(await source.map(info.id), info.id);
        maps.set(info.id, m);
        if (!m) mapErrors.set(info.id, `Map ${info.id} (${info.name}) has no data`);
      } catch (e) {
        maps.set(info.id, null);
        mapErrors.set(info.id, `Map ${info.id} skipped: ${message(e)}`);
      }
      options.onProgress?.(++done, infos.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 8, infos.length)) }, worker));
  for (const info of infos) { const err = mapErrors.get(info.id); if (err) warnings.push(err); } // stable order

  const scan = scanSources([
    ...commonEventSources(commonEvents),
    ...troopSources(troops),
    ...infos.flatMap((i) => mapToSources(maps.get(i.id) ?? null)),
  ], engine);
  const mapLinks = sortedRecord(scan.mapLinks);

  return {
    formatVersion: 1,
    game: system.title || fallbackTitle || 'Untitled',
    engine,
    packed: source.packed ?? false,
    switches: named(system.switches, scan.switches),
    variables: named(system.variables, scan.variables),
    commonEvents: commonEvents.map((c) => ({
      id: c.id, name: c.name, trigger: c.trigger, switchId: c.switchId, calledFrom: scan.commonEventCalls.get(c.id) ?? [],
    })),
    maps: infos.map((i) => ({
      ...i,
      displayName: maps.get(i.id)?.displayName ?? '',
      eventCount: maps.get(i.id)?.events.length ?? 0,
      linksTo: mapLinks[String(i.id)] ?? [],
      dynamicTransfers: scan.dynamicTransfers.get(i.id) ?? 0,
    })),
    relations: {
      mapLinks,
      mapParents: Object.fromEntries(infos.filter((i) => i.parentId > 0).map((i) => [String(i.id), i.parentId])),
      commonEventMapLinks: sortedRecord(scan.commonEventMapLinks),
    },
    warnings,
  };
}
