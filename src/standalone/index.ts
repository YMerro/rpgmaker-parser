import { writeFileSync } from 'node:fs';
import { buildGameMapFrom, type BuildOptions, type GameMapGraph } from '../addons/gameMap';
import { createFsSource } from './fsSource';

export { createFsSource, detectEngine, openGame, readData, dataPath } from './fsSource';
export { parseMarshal } from './marshal';
export { RgssArchive, ZipFiles } from './files';

/** Convenience for Node: read a game folder and build its graph. */
export function buildGameMap(gamePath: string, options?: BuildOptions): Promise<GameMapGraph> {
  return buildGameMapFrom(createFsSource(gamePath), options);
}

export async function writeGameMap(gamePath: string, outFile: string, options?: BuildOptions): Promise<GameMapGraph> {
  const graph = await buildGameMap(gamePath, options);
  writeFileSync(outFile, JSON.stringify(graph, null, 2) + '\n');
  return graph;
}
