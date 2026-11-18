/** Tests for the pure addon (what ships into the toolkit): no fixtures on disk. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildGameMapFrom, findSwitchUsage, findVariableUsage, normalizeEngine } from '../src/addons/gameMap';
import type { EventSource, GameDataSource } from '../src/addons/gameMap';

const ADDON = join(import.meta.dirname, '..', 'src', 'addons', 'gameMap');

test('addon is host-agnostic: no Node APIs, no file I/O, no standalone imports', () => {
  const files = readdirSync(ADDON, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = readFileSync(join(ADDON, f), 'utf8');
    for (const bad of [/from ['"]node:/, /from ['"](fs|path|zlib|os|child_process)['"]/, /\brequire\(/, /\bprocess\./, /\bBuffer\b/, /standalone/, /from ['"][^'"]+\.ts['"]/]) {
      assert.doesNotMatch(src, bad, `${f} must not match ${bad}`);
    }
  }
});

/** Shapes a toolkit adapter might hand over: '@' ivars, snake_case, Ruby hashes as Map, async calls. */
function weirdVxAceSource(): GameDataSource & { calls: number[] } {
  const cmd = (code: number, ...parameters: unknown[]) => ({ '@code': code, '@indent': 0, '@parameters': parameters });
  const calls: number[] = [];
  return {
    calls,
    engine: 'RPG Maker VX Ace',
    system: async () => ({ '@game_title': 'Weird', '@switches': [null, 'Door Open'], '@variables': [null, 'Coins'] }),
    mapInfos: async () => new Map([[1, { '@name': 'Hall', '@parent_id': 0, '@order': 1 }], [2, { '@name': 'Broken', '@parent_id': 1, '@order': 2 }]]),
    map: async (id) => {
      calls.push(id);
      if (id === 2) throw new Error('IPC timeout');
      return {
        '@display_name': 'Great Hall',
        '@events': new Map([[7, {
          '@id': 7, '@name': 'Door', '@x': 1, '@y': 2,
          '@pages': [{ '@condition': { '@switch1_valid': true, '@switch1_id': 1, '@variable_valid': true, '@variable_id': 1, '@variable_value': 3 },
            '@list': [cmd(121, 1, 1, 1), cmd(201, 0, 2, 0, 0, 2, 0), cmd(0)] }],
        }]]),
      };
    },
    commonEvents: () => { throw new Error('not exported by adapter'); },
  };
}

test('buildGameMapFrom: tolerant normalization, async source, per-map failures become warnings', async () => {
  const src = weirdVxAceSource();
  const progress: string[] = [];
  const g = await buildGameMapFrom(src, { concurrency: 2, onProgress: (d, t) => progress.push(`${d}/${t}`) });
  assert.equal(g.engine, 'vxace');
  assert.equal(g.game, 'Weird');
  assert.deepEqual(g.switches, [{ id: 1, name: 'Door Open', usedIn: [
    { type: 'event', mapId: 1, eventId: 7, page: 0, condition: 'pageSwitch', access: 'read' },
    { type: 'event', mapId: 1, eventId: 7, page: 0, command: 'controlSwitch', access: 'write', line: 0 },
  ] }]);
  assert.deepEqual(g.variables[0].usedIn.map((u) => u.condition), ['pageVariable']);
  assert.deepEqual(g.maps.map((m) => [m.id, m.displayName, m.eventCount]), [[1, 'Great Hall', 1], [2, '', 0]]);
  assert.deepEqual(g.relations, { mapLinks: { 1: [2] }, mapParents: { 2: 1 }, commonEventMapLinks: {} });
  assert.deepEqual(g.warnings, ['CommonEvents unreadable: not exported by adapter', 'Map 2 skipped: IPC timeout']);
  assert.deepEqual(progress, ['1/2', '2/2']);
  assert.deepEqual(structuredClone(g), g, 'structured-clone safe (IPC)');
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g, 'plain JSON');
});

test('buildGameMapFrom: listMapIds fallback, title fallback, missing System', async () => {
  const g = await buildGameMapFrom({
    engine: 'xp', system: () => ({ switches: [], variables: [] }), mapInfos: () => null,
    map: (id) => ({ events: [] }), title: () => 'From Game.ini', listMapIds: () => [3, 5],
  });
  assert.equal(g.game, 'From Game.ini');
  assert.deepEqual(g.maps.map((m) => m.id), [3, 5]);
  assert.match(g.warnings[0], /MapInfos missing or empty; scanning 2 map/);
  await assert.rejects(buildGameMapFrom({ engine: 'mv', system: () => null, mapInfos: () => [], map: () => null }), /System data is missing/);
  await assert.rejects(buildGameMapFrom({ engine: '2003', system: () => ({}), mapInfos: () => [], map: () => null }), /Unsupported engine/);
});

test('normalizeEngine accepts loose spellings', () => {
  const cases: Record<string, string> = { MV: 'mv', 'RPG Maker MZ': 'mz', 'VX Ace': 'vxace', vx_ace: 'vxace', RMVX: 'vx', RMXP: 'xp', xp: 'xp' };
  for (const [k, v] of Object.entries(cases)) assert.equal(normalizeEngine(k), v, k);
});

test('scanner: engine-specific command codes', () => {
  const src: EventSource[] = [{
    ref: { type: 'commonEvent', commonEventId: 1 },
    list: [
      { code: 104, indent: 0, parameters: [7] },              // Select Item (VX Ace+)
      { code: 285, indent: 0, parameters: [8, 0, 1, 9, 10] }, // Get Location Info (VX Ace+)
      { code: 203, indent: 0, parameters: [0, 1, 12, 13, 14] }, // Set Vehicle Location (VX+; Scroll Map in XP)
      { code: 126, indent: 0, parameters: [1, 0, 1, 11] },    // Change Items by variable
      { code: 121, indent: 0, parameters: [5, 1, 0] },        // inverted range ignored
    ],
  }];
  assert.deepEqual([...findVariableUsage(src, 'mz').keys()], [7, 8, 9, 10, 12, 13, 14, 11]);
  assert.deepEqual([...findVariableUsage(src, 'vxace').keys()], [7, 8, 9, 10, 12, 13, 14, 11]);
  assert.deepEqual([...findVariableUsage(src, 'vx').keys()], [12, 13, 14, 11]);
  assert.deepEqual([...findVariableUsage(src, 'xp').keys()], [11]);
  assert.equal(findSwitchUsage(src).size, 0);
});

