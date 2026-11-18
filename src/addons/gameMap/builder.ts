import { writeFileSync } from 'node:fs';
import { dataPath, databaseToSources, loadDatabase, loadMap, mapToSources, openGame } from './parser/engine.ts';
import { scanSources } from './parser/scanner.ts';
import type { EventSource, GameMapData, GameMapGraph, NamedUsage, Usage } from './types.ts';

const sortedRecord = (m: Map<number, Set<number>>) =>
  Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).map(([k, s]) => [String(k), [...s].sort((a, b) => a - b)]));

function named(names: string[], usage: Map<number, Usage[]>): NamedUsage[] {
  const max = Math.max(names.length - 1, ...usage.keys(), 0);
  const out: NamedUsage[] = [];
  for (let id = 1; id <= max; id++) out.push({ id, name: names[id] ?? '', usedIn: usage.get(id) ?? [] });
  return out;
}

/** detect engine → load DB → load maps → scan → graph. Never throws on a single bad map. */
export function buildGameMap(gamePath: string): GameMapGraph {
  const handle = openGame(gamePath);
  const db = loadDatabase(gamePath);
  const warnings: string[] = [];

  let infos = db.mapInfos;
  if (!infos.length) {
    warnings.push('MapInfos missing or empty; probing Map001..Map999');
    infos = [];
    for (let id = 1; id < 1000; id++) {
      if (handle.files.has(dataPath(handle.engine, `Map${String(id).padStart(3, '0')}`))) infos.push({ id, name: '', parentId: 0, order: id });
    }
  }

  const maps = new Map<number, GameMapData | null>();
  const sources: EventSource[] = databaseToSources(db);
  for (const info of infos) {
    try {
      const m = loadMap(gamePath, handle.engine, info.id);
      if (!m) warnings.push(`Map ${info.id} (${info.name}) has no data file`);
      maps.set(info.id, m);
      sources.push(...mapToSources(m));
    } catch (e) {
      warnings.push(`Map ${info.id} skipped: ${(e as Error).message}`);
      maps.set(info.id, null);
    }
  }

  const scan = scanSources(sources, handle.engine);
  const mapLinks = sortedRecord(scan.mapLinks);

  return {
    formatVersion: 1,
    game: db.title,
    engine: db.engine,
    packed: handle.packed,
    switches: named(db.switches, scan.switches),
    variables: named(db.variables, scan.variables),
    commonEvents: db.commonEvents.map((c) => ({
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

export function writeGameMap(gamePath: string, outFile: string): GameMapGraph {
  const graph = buildGameMap(gamePath);
  writeFileSync(outFile, JSON.stringify(graph, null, 2) + '\n');
  return graph;
}
