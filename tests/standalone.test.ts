import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findMapLinks, findSwitchUsage, findVariableUsage, mapToSources, toMap, toMapInfos } from '../src/addons/gameMap';
import { buildGameMap, createFsSource, detectEngine, parseMarshal } from '../src/standalone';

const FX = join(import.meta.dirname, 'fixtures');
const GAMES = { mv: 'mv', mz: 'mz', vxace: 'vxace', xp: 'xp', vx: 'vx', 'mz-exe': 'mz', 'mv-nw': 'mv', 'vxace-packed': 'vxace', 'vx-packed': 'vx', 'xp-packed': 'xp' } as const;

for (const [dir, engine] of Object.entries(GAMES)) {
  test(`${dir}: detects engine and builds the expected graph`, async () => {
    const path = join(FX, dir);
    assert.equal(detectEngine(path), engine);
    const g = await buildGameMap(path);
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
    assert.deepEqual(g.warnings, ['Map 4 (Missing) has no data']);
    assert.deepEqual(JSON.parse(JSON.stringify(g)), g, 'output is plain JSON');
  });
}

test('lower-level API: fs source + normalizers + find*', () => {
  const src = createFsSource(join(FX, 'vxace-packed'));
  assert.equal(toMapInfos(src.mapInfos()).length, 4);
  const events = mapToSources(toMap(src.map(1), 1));
  assert.equal(events.length, 2);
  assert.deepEqual([...findSwitchUsage(events).keys()], [1, 2]);
  assert.deepEqual([...findVariableUsage(events).keys()], [3, 1]);
  const maps = [1, 2, 3].map((id) => toMap(src.map(id), id)!);
  assert.deepEqual(findMapLinks(maps), { 1: [2], 2: [1] });
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

test('graceful fallback: corrupt map is skipped with a warning', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gm-'));
  cpSync(join(FX, 'xp'), tmp, { recursive: true });
  writeFileSync(join(tmp, 'Data', 'Map002.rxdata'), Buffer.from([4, 8, 0x6f, 0x3a]));
  const g = await buildGameMap(tmp);
  assert.ok(g.warnings.some((w) => /^Map 2 skipped: Failed to parse Data\/Map002\.rxdata/.test(w)));
  assert.deepEqual(g.relations.mapLinks, { 1: [2] });
});

test('unknown games fail clearly', () => {
  assert.throws(() => detectEngine(mkdtempSync(join(tmpdir(), 'gm-'))), /Could not detect/);
  assert.throws(() => detectEngine(join(FX, 'enigma')), /Enigma Virtual Box, which is not supported.*evbunpack/);
  assert.throws(() => detectEngine(join(FX, 'nope')), /not found/);
});
