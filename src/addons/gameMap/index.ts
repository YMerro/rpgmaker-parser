/**
 * Game Map addon: pure, host-agnostic API (no Node, no file I/O).
 * The host supplies raw game data through a `GameDataSource`.
 */
export { buildGameMapFrom, type BuildOptions } from './core/builder';
export { scanSources, findSwitchUsage, findVariableUsage, findMapLinks, type ScanResult } from './core/scanner';
export {
  field, entries, toCommands, toCondition, toSystem, toMapInfos, toCommonEvents, toTroops, toMap,
  mapToSources, commonEventSources, troopSources,
} from './core/normalize';
export { normalizeEngine, type GameDataSource, type Awaitable } from './source';
export type * from './types';
