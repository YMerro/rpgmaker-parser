#!/usr/bin/env node
import { writeGameMap } from './builder.ts';

const [gamePath, out = 'game-map.json'] = process.argv.slice(2);
if (!gamePath) {
  console.error('usage: gamemap <gameFolder> [out.json]');
  process.exit(2);
}
try {
  const g = writeGameMap(gamePath, out);
  console.log(`${g.game} [${g.engine}${g.packed ? ', packed' : ''}]: ${g.maps.length} maps, ` +
    `${g.switches.length} switches, ${g.variables.length} variables -> ${out}`);
  for (const w of g.warnings) console.warn(`warning: ${w}`);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
