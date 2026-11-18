import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildGameMap, detectEngine, findMapLinks, findSwitchUsage, findVariableUsage, loadDatabase, loadEvents, loadMap, parseMarshal,
} from '../src/addons/gameMap/index.ts';
import type { EventSource } from '../src/addons/gameMap/index.ts';

const FX = join(import.meta.dirname, 'fixtures');
const GAMES = { mv: 'mv', mz: 'mz', vxace: 'vxace', xp: 'xp', vx: 'vx', 'mz-exe': 'mz', 'mv-nw': 'mv', 'vxace-packed': 'vxace', 'vx-packed': 'vx', 'xp-packed': 'xp' } as const;

for (const [dir, engine] of Object.entries(GAMES)) {
  test(`${dir}: detects engine and builds the expected graph`, () => {
    const path = join(FX, dir);
    assert.equal(detectEngine(path), engine);
    const g = buildGameMap(path);
    assert.equal(g.packed, /-(packed|exe|nw)$/.test(dir));
    assert.match(g.game, /^Fixture /);
    assert.deepEqual(g.switches.map((s) => s.name), ['Intro Done', 'Has Key', 'Boss Dead']);
    const how = (u: { condition?: string; command?: string; access: string }) => u.condition ?? `${u.command}:${u.access}`;
    assert.deepEqual(g.switches.map((s) => s.usedIn.map(how)), [
      ['controlSwitch:write', 'pageSwitch'],
      ['controlSwitch:write', 'troopSwitch', 'conditionalBranch:read'],
      ['commonEventTrigger', 'controlSwitch:write'],
    ]);
    assert.deepEqual(g.variables.map((v) => v.usedIn.map(how)), [
      ['controlVariable:write', 'controlVariable:read', 'transferPlayer:read'],
      ['transferPlayer:read', 'inputNumber:write'],
      ['controlVariable:write', 'pageVariable', 'transferPlayer:read'],
    ]);
    assert.deepEqual(g.switches[0].usedIn[1], { type: 'event', mapId: 1, eventId: 1, page: 1, condition: 'pageSwitch', access: 'read' });
    assert.deepEqual(g.relations, { mapLinks: { 1: [2], 2: [1] }, mapParents: { 2: 1, 3: 2 }, commonEventMapLinks: { 1: [3] } });
    assert.deepEqual(g.maps.map((m) => [m.id, m.eventCount, m.dynamicTransfers]), [[1, 1, 0], [2, 1, 1], [3, 0, 0], [4, 0, 0]]);
    assert.deepEqual(g.commonEvents[0].calledFrom, [{ type: 'event', mapId: 1, eventId: 1, page: 0 }]);
    assert.deepEqual(g.warnings, ['Map 4 (Missing) has no data file']);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g, 'output is plain JSON');
  });
}

test('lower-level API: loadDatabase / loadEvents / find*', () => {
  const path = join(FX, 'vxace-packed');
  const db = loadDatabase(path, 'vxace');
  assert.equal(db.mapInfos.length, 4);
  const events = loadEvents(path, 'vxace', 1);
  assert.equal(events.length, 2);
  assert.deepEqual([...findSwitchUsage(events).keys()], [1, 2]);
  assert.deepEqual([...findVariableUsage(events).keys()], [3, 1]);
  const maps = [1, 2, 3].map((id) => loadMap(path, 'vxace', id)!);
  assert.deepEqual(findMapLinks(maps), { 1: [2], 2: [1] });
  assert.throws(() => loadDatabase(path, 'mv'), /Engine mismatch/);
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

test('marshal: ints, bignums, floats, links, symbols', () => {
  const ruby = (expr: string) => parseMarshal(execFileSync('ruby', ['-e', `$stdout.binmode; print Marshal.dump((${expr}))`]));
  assert.deepEqual(ruby('[0, 1, -1, 122, 123, -124, 255, 256, -256, 65536, 2**31, -(2**40), 2**60]'),
    [0, 1, -1, 122, 123, -124, 255, 256, -256, 65536, 2 ** 31, -(2 ** 40), 2 ** 60]);
  assert.deepEqual(ruby('[1.5, -0.25, Float::INFINITY]'), [1.5, -0.25, Infinity]);
  assert.deepEqual(ruby('s = "\\u00e9"; [s, s, :a, :a, nil, true, false]'), ['é', 'é', 'a', 'a', null, true, false]);
  assert.deepEqual(ruby('{1 => "x", "k" => [2]}'), { 1: 'x', k: [2] });
  assert.throws(() => parseMarshal(Buffer.from([4, 8, 0x5b, 10])), /unexpected end/);
});

test('detection from Game.ini alone (no Data folder, no archive)', () => {
  for (const [lib, engine] of [['RGSS301.dll', 'vxace'], ['RGSS202E.dll', 'vx'], ['RGSS104E.dll', 'xp']]) {
    const tmp = mkdtempSync(join(tmpdir(), 'gm-'));
    writeFileSync(join(tmp, 'Game.ini'), `[Game]\r\nLibrary=${lib}\r\n`);
    assert.equal(detectEngine(tmp), engine);
  }
});

test('graceful fallback: corrupt map is skipped with a warning', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gm-'));
  cpSync(join(FX, 'xp'), tmp, { recursive: true });
  writeFileSync(join(tmp, 'Data', 'Map002.rxdata'), Buffer.from([4, 8, 0x6f, 0x3a]));
  const g = buildGameMap(tmp);
  assert.ok(g.warnings.some((w) => /^Map 2 skipped: Failed to parse Data\/Map002\.rxdata/.test(w)));
  assert.deepEqual(g.relations.mapLinks, { 1: [2] });
});

test('unknown games fail clearly', () => {
  assert.throws(() => detectEngine(mkdtempSync(join(tmpdir(), 'gm-'))), /Could not detect/);
  assert.throws(() => detectEngine(join(FX, 'enigma')), /Enigma Virtual Box, which is not supported.*evbunpack/);
  assert.throws(() => detectEngine(join(FX, 'nope')), /not found/);
});
