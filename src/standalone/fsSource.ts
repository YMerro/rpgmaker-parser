/**
 * Standalone (Node) data source: reads a game folder directly.
 * Used by the CLI and tests only. Inside the toolkit, a GameDataSource built on
 * src/core replaces this file, so none of it ships in src/addons/gameMap.
 */
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Engine, GameDataSource } from '../addons/gameMap';
import { DirFiles, isDir, isEnigmaPacked, LayeredFiles, PrefixFiles, RgssArchive, ZipFiles, type GameFiles } from './files';
import { parseMarshal } from './marshal';

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

// ---------------------------------------------------------------- GameDataSource

/** Exposes a game folder (loose, RGSS archive or NW.js package) as a GameDataSource. */
export function createFsSource(gamePath: string): GameDataSource {
  const h = openGame(gamePath);
  return {
    engine: h.engine,
    packed: h.packed,
    system: () => readData(h, 'System'),
    mapInfos: () => readData(h, 'MapInfos'),
    map: (id) => readData(h, `Map${String(id).padStart(3, '0')}`),
    commonEvents: () => readData(h, 'CommonEvents'),
    troops: () => readData(h, 'Troops'),
    title: () => /^\s*Title\s*=\s*(.+?)\s*$/im.exec(h.files.read('Game.ini')?.toString('utf8') ?? '')?.[1] ?? basename(h.root),
    listMapIds: () => Array.from({ length: 999 }, (_, i) => i + 1)
      .filter((id) => h.files.has(dataPath(h.engine, `Map${String(id).padStart(3, '0')}`))),
  };
}
