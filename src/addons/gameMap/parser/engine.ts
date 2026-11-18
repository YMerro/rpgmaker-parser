import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DirFiles, isDir, isEnigmaPacked, LayeredFiles, PrefixFiles, RgssArchive, ZipFiles, type GameFiles } from './files.ts';
import { parseMarshal } from './marshal.ts';
import type {
  Command, CommonEventInfo, Engine, EventSource, GameDatabase, GameMapData, MapEvent, MapInfo, PageCondition, TroopInfo,
} from '../types.ts';

export interface GameHandle {
  engine: Engine;
  root: string;
  packed: boolean;
  files: GameFiles;
}

const ARCHIVES: Record<string, Engine> = { 'game.rgss3a': 'vxace', 'game.rgss2a': 'vx', 'game.rgssad': 'xp' };
const handles = new Map<string, GameHandle>();

/** Locate the game root, its engine and how to read its files. Cached per path. */
export function openGame(gamePath: string): GameHandle {
  const abs = resolve(gamePath);
  const cached = handles.get(abs);
  if (cached) return cached;
  if (!isDir(abs)) throw new Error(`Game folder not found: ${abs}`);

  const root = abs;
  const dir = new DirFiles(root);
  // 1. loose MV/MZ (standard deployment: Game.exe is just the NW.js runtime)
  let handle = detectNw(root, dir, false);
  if (!handle) {
    let engine: Engine | undefined =
      dir.has('Data/System.rvdata2') ? 'vxace' : dir.has('Data/System.rxdata') ? 'xp' : dir.has('Data/System.rvdata') ? 'vx' : undefined;
    let archive: RgssArchive | undefined;
    for (const [name, eng] of Object.entries(ARCHIVES)) {
      const p = dir.resolve(name);
      if (p && (!engine || engine === eng)) { archive = new RgssArchive(p); engine ??= eng; break; }
    }
    if (!engine) {
      const lib = /^\s*Library\s*=\s*(\S+)/im.exec(dir.read('Game.ini')?.toString('latin1') ?? '')?.[1] ?? '';
      engine = /RGSS3/i.test(lib) ? 'vxace' : /RGSS2/i.test(lib) ? 'vx' : /RGSS1\d/i.test(lib) ? 'xp' : undefined;
    }
    if (engine) handle = { engine, root, packed: !!archive, files: archive ? new LayeredFiles([dir, archive]) : dir };
  }
  // 3. MV/MZ packed into package.nw or appended to an .exe
  if (!handle) {
    for (const pkg of nwPackages(root, dir)) if ((handle = detectNw(root, pkg, true))) break;
  }
  if (!handle) {
    const enigma = exes(root).find(isEnigmaPacked);
    if (enigma) {
      throw new Error(`${basename(enigma)} is packed with Enigma Virtual Box, which is not supported. ` +
        'Extract it first (e.g. with evbunpack), then point the parser at the extracted folder.');
    }
    throw new Error(`Could not detect an RPG Maker MV/MZ/VX Ace/VX/XP game in ${abs}`);
  }
  handles.set(abs, handle);
  return handle;
}

/** MV/MZ detection over any file layer; handles the `www/` sub-folder MV uses. */
function detectNw(root: string, files: GameFiles, packed: boolean): GameHandle | undefined {
  if (!files.has('data/System.json') && files.has('www/data/System.json')) files = new PrefixFiles(files, 'www/');
  if (!files.has('data/System.json')) return undefined;
  if (files.has('js/rmmz_core.js')) return { engine: 'mz', root, packed, files };
  if (files.has('js/rpg_core.js')) return { engine: 'mv', root, packed, files };
  // No engine scripts shipped: MZ's System.json has an `advanced` block.
  const sys = readJson(files.read('data/System.json')!) as Record<string, unknown>;
  return { engine: 'advanced' in sys ? 'mz' : 'mv', root, packed, files };
}

const exes = (root: string) => readdirSync(root).filter((n) => /\.exe$/i.test(n)).sort().map((n) => join(root, n));

/** Candidate NW.js packages: package.nw (zip or folder), then zips appended to .exe files. */
function* nwPackages(root: string, dir: DirFiles): Generator<GameFiles> {
  const nw = dir.resolve('package.nw');
  if (nw) {
    if (isDir(nw)) yield new DirFiles(nw);
    else { const z = ZipFiles.tryOpen(nw); if (z) yield z; }
  }
  for (const exe of exes(root)) { const z = ZipFiles.tryOpen(exe); if (z) yield z; }
}

export function detectEngine(gamePath: string): Engine {
  return openGame(gamePath).engine;
}

// ---------------------------------------------------------------- raw reads

const EXT: Record<Engine, string> = { mv: 'json', mz: 'json', vxace: 'rvdata2', vx: 'rvdata', xp: 'rxdata' };

/** Relative path of a data file, e.g. dataPath('vx', 'Map001') -> 'Data/Map001.rvdata'. */
export function dataPath(engine: Engine, base: string): string {
  return `${EXT[engine] === 'json' ? 'data' : 'Data'}/${base}.${EXT[engine]}`;
}

function readJson(buf: Buffer): unknown {
  return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
}

/** Read `data/<base>` in the engine's native format, or null if absent. */
export function readData(h: GameHandle, base: string): unknown {
  const rel = dataPath(h.engine, base);
  const buf = h.files.read(rel);
  if (!buf) return null;
  try {
    return rel.endsWith('.json') ? readJson(buf) : parseMarshal(buf);
  } catch (e) {
    throw new Error(`Failed to parse ${rel}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- normalizers

type Obj = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/** JSON arrays (null-padded) and Ruby hashes ({id => obj}) both become [obj with id]. */
function entries(raw: unknown): Obj[] {
  if (Array.isArray(raw)) return raw.filter(isObj).map((o, i) => ({ id: i, ...o }));
  if (isObj(raw)) return Object.entries(raw).filter(([, v]) => isObj(v)).map(([k, v]) => ({ id: Number(k), ...(v as Obj) }));
  return [];
}

function names(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(str) : [];
}

export function toCommands(raw: unknown): Command[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((c) => ({
    code: num(c.code), indent: num(c.indent), parameters: Array.isArray(c.parameters) ? c.parameters : [],
  }));
}

/** Map/troop page conditions. Ruby `@condition` and MV `conditions` share camelCased keys. */
export function toCondition(raw: unknown): PageCondition {
  const c = isObj(raw) ? raw : {};
  const out: PageCondition = { switchIds: [] };
  if (c.switch1Valid) out.switchIds.push(num(c.switch1Id));
  if (c.switch2Valid) out.switchIds.push(num(c.switch2Id));
  if (c.switchValid) out.switchIds.push(num(c.switchId)); // troop pages
  if (c.variableValid) out.variable = { id: num(c.variableId), value: num(c.variableValue) };
  out.switchIds = out.switchIds.filter((id) => id > 0);
  return out;
}

const pages = (raw: unknown) =>
  (Array.isArray(raw) ? raw.filter(isObj) : []).map((p) => ({ condition: toCondition(p.conditions ?? p.condition), list: toCommands(p.list) }));

function gameTitle(h: GameHandle, system: Obj): string {
  const ini = /^\s*Title\s*=\s*(.+?)\s*$/im.exec(h.files.read('Game.ini')?.toString('utf8') ?? '')?.[1];
  return str(system.gameTitle) || ini || basename(h.root);
}

// ---------------------------------------------------------------- public loaders

export function loadDatabase(gamePath: string, engine?: Engine): GameDatabase {
  const h = openGame(gamePath);
  if (engine && engine !== h.engine) throw new Error(`Engine mismatch: requested ${engine}, detected ${h.engine}`);
  const system = readData(h, 'System');
  if (!isObj(system)) throw new Error('System data file missing or unreadable');

  const mapInfos: MapInfo[] = entries(readData(h, 'MapInfos'))
    .filter((m) => num(m.id) > 0)
    .map((m) => ({ id: num(m.id), name: str(m.name), parentId: num(m.parentId), order: num(m.order) }))
    .sort((a, b) => a.id - b.id);

  const commonEvents: CommonEventInfo[] = entries(readData(h, 'CommonEvents'))
    .filter((c) => num(c.id) > 0)
    .map((c) => ({ id: num(c.id), name: str(c.name), trigger: num(c.trigger), switchId: num(c.switchId), list: toCommands(c.list) }));

  const troops: TroopInfo[] = entries(readData(h, 'Troops'))
    .filter((t) => num(t.id) > 0)
    .map((t) => ({ id: num(t.id), name: str(t.name), pages: pages(t.pages) }));

  return {
    engine: h.engine,
    title: gameTitle(h, system),
    switches: names(system.switches),
    variables: names(system.variables),
    mapInfos, commonEvents, troops,
  };
}

export function loadMap(gamePath: string, engine: Engine | undefined, mapId: number): GameMapData | null {
  const h = openGame(gamePath);
  const raw = readData(h, `Map${String(mapId).padStart(3, '0')}`);
  if (!isObj(raw)) return null;
  const events: MapEvent[] = entries(raw.events)
    .filter((e) => num(e.id) > 0)
    .map((e) => ({ id: num(e.id), name: str(e.name), x: num(e.x), y: num(e.y), pages: pages(e.pages) }))
    .sort((a, b) => a.id - b.id);
  return { id: mapId, displayName: str(raw.displayName), events };
}

/** All event pages of a map, as scanner input. */
export function loadEvents(gamePath: string, engine: Engine | undefined, mapId: number): EventSource[] {
  return mapToSources(loadMap(gamePath, engine, mapId));
}

export function mapToSources(map: GameMapData | null): EventSource[] {
  if (!map) return [];
  return map.events.flatMap((ev) => ev.pages.map((p, page) => ({
    ref: { type: 'event' as const, mapId: map.id, eventId: ev.id, page }, condition: p.condition, list: p.list,
  })));
}

export function databaseToSources(db: GameDatabase): EventSource[] {
  const ce: EventSource[] = db.commonEvents.map((c) => ({
    ref: { type: 'commonEvent', commonEventId: c.id },
    condition: { switchIds: c.trigger > 0 && c.switchId > 0 ? [c.switchId] : [] },
    list: c.list,
  }));
  const tr: EventSource[] = db.troops.flatMap((t) => t.pages.map((p, page) => ({
    ref: { type: 'troop' as const, troopId: t.id, page }, condition: p.condition, list: p.list,
  })));
  return [...ce, ...tr];
}
