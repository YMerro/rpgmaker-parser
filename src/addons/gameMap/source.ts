import type { Engine } from './types';

export type Awaitable<T> = T | Promise<T>;

/**
 * Everything the parser needs from the host. The toolkit implements this on
 * top of its `src/core` adapters; the parser itself never touches files.
 *
 * Each method returns the engine's *raw* data object as the host already has it.
 * Accepted shapes:
 * - keys in camelCase (MV/MZ JSON), snake_case, or `@`-prefixed Ruby ivars;
 * - Ruby hashes (map events, MapInfos) as a plain object, an array or a `Map`.
 * Return `null`/`undefined` for data that does not exist.
 */
export interface GameDataSource {
  /** 'mv' | 'mz' | 'vxace' | 'vx' | 'xp', loose spellings like 'VX Ace' or 'RMXP' accepted. */
  engine: Engine | string;
  /** True when the data came from an archive/package (informational only). */
  packed?: boolean;
  /** System.json / System.rvdata2 / ... : switch and variable names, title. */
  system(): Awaitable<unknown>;
  /** MapInfos: the map tree. */
  mapInfos(): Awaitable<unknown>;
  /** MapXXX: one map with its events. */
  map(mapId: number): Awaitable<unknown>;
  commonEvents?(): Awaitable<unknown>;
  troops?(): Awaitable<unknown>;
  /** Title fallback when System has none (XP keeps it in Game.ini). */
  title?(): Awaitable<string | null | undefined>;
  /** Map ids to scan when MapInfos is missing or empty. */
  listMapIds?(): Awaitable<number[]>;
}

const ENGINE_ALIASES: Record<string, Engine> = {
  mv: 'mv', rpgmv: 'mv', rmmv: 'mv',
  mz: 'mz', rpgmz: 'mz', rmmz: 'mz',
  vxace: 'vxace', ace: 'vxace', rmvxace: 'vxace', rgss3: 'vxace',
  vx: 'vx', rmvx: 'vx', rgss2: 'vx',
  xp: 'xp', rmxp: 'xp', rgss1: 'xp', rgss: 'xp',
};

/** 'VX Ace', 'rpg-maker-mz', 'RMXP' ... -> canonical Engine. */
export function normalizeEngine(name: string): Engine {
  const key = String(name).toLowerCase().replace(/rpg[\s_-]*maker/g, 'rpg').replace(/[^a-z0-9]/g, '');
  const hit = ENGINE_ALIASES[key] ?? ENGINE_ALIASES[key.replace(/^rpg/, '')];
  if (!hit) throw new Error(`Unsupported engine "${name}" (expected MV, MZ, VX Ace, VX or XP)`);
  return hit;
}
