import type { Command, Engine, EventSource, GameMapData, SourceRef, Usage } from '../types.ts';
import { mapToSources } from './engine.ts';

/**
 * Scans page conditions + control commands. No script analysis, and called
 * common events (code 117) are recorded as references, not followed.
 */
export interface ScanResult {
  switches: Map<number, Usage[]>;
  variables: Map<number, Usage[]>;
  /** transfer destinations per source (map events keyed by mapId) */
  mapLinks: Map<number, Set<number>>;
  commonEventMapLinks: Map<number, Set<number>>;
  /** variable-designated transfers per map (destination unknown statically) */
  dynamicTransfers: Map<number, number>;
  commonEventCalls: Map<number, SourceRef[]>;
}

const MAX_RANGE = 5000; // guard against corrupt `start..end` ranges
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);

export function scanSources(sources: EventSource[], engine: Engine = 'mv'): ScanResult {
  const r: ScanResult = {
    switches: new Map(), variables: new Map(), mapLinks: new Map(),
    commonEventMapLinks: new Map(), dynamicTransfers: new Map(), commonEventCalls: new Map(),
  };
  // Command availability differs by engine: XP's 203 is Scroll Map;
  // Select Item (104) and Get Location Info (285) arrived with VX Ace.
  const hasVehicles = engine !== 'xp';
  const hasAceCommands = engine !== 'xp' && engine !== 'vx';
  const add = <K>(m: Map<K, any[]>, k: K, v: unknown) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  const addSet = (m: Map<number, Set<number>>, k: number, v: number) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);

  for (const src of sources) {
    const ref = src.ref;
    const condName = ref.type === 'event' ? 'pageSwitch' : ref.type === 'troop' ? 'troopSwitch' : 'commonEventTrigger';
    for (const id of src.condition?.switchIds ?? []) add(r.switches, id, { ...ref, condition: condName, access: 'read' });
    const v = src.condition?.variable;
    if (v && v.id > 0) add(r.variables, v.id, { ...ref, condition: ref.type === 'event' ? 'pageVariable' : 'troopVariable', access: 'read' });

    src.list.forEach((cmd: Command, line) => {
      const p = cmd.parameters;
      const sw = (id: unknown, command: string, access: Usage['access']) =>
        int(id) > 0 && add(r.switches, int(id), { ...ref, command, access, line });
      const vr = (id: unknown, command: string, access: Usage['access']) =>
        int(id) > 0 && add(r.variables, int(id), { ...ref, command, access, line });
      const range = (fn: typeof sw, command: string) => {
        const a = int(p[0]), b = int(p[1]);
        if (a > 0 && b >= a && b - a < MAX_RANGE) for (let id = a; id <= b; id++) fn(id, command, 'write');
      };

      switch (cmd.code) {
        case 121: range(sw, 'controlSwitch'); break;
        case 122:
          range(vr, 'controlVariable');
          if (int(p[3]) === 1) vr(p[4], 'controlVariable', 'read');
          break;
        case 111:
          if (int(p[0]) === 0) sw(p[1], 'conditionalBranch', 'read');
          else if (int(p[0]) === 1) {
            vr(p[1], 'conditionalBranch', 'read');
            if (int(p[2]) !== 0) vr(p[3], 'conditionalBranch', 'read');
          }
          break;
        case 103: vr(p[0], 'inputNumber', 'write'); break;
        case 104: if (hasAceCommands) vr(p[0], 'selectItem', 'write'); break;
        case 125: if (int(p[1]) === 1) vr(p[2], 'changeGold', 'read'); break;
        case 126: case 127: case 128:
          if (int(p[2]) === 1) vr(p[3], ({ 126: 'changeItems', 127: 'changeWeapons', 128: 'changeArmors' } as const)[cmd.code], 'read');
          break;
        case 201:
          if (int(p[0]) === 0) {
            if (int(p[1]) > 0) {
              if (ref.type === 'event') addSet(r.mapLinks, ref.mapId, int(p[1]));
              else if (ref.type === 'commonEvent') addSet(r.commonEventMapLinks, ref.commonEventId, int(p[1]));
            }
          } else {
            [p[1], p[2], p[3]].forEach((id) => vr(id, 'transferPlayer', 'read'));
            if (ref.type === 'event') r.dynamicTransfers.set(ref.mapId, (r.dynamicTransfers.get(ref.mapId) ?? 0) + 1);
          }
          break;
        case 202: if (int(p[1]) === 1) [p[2], p[3]].forEach((id) => vr(id, 'setEventLocation', 'read')); break;
        case 203: if (hasVehicles && int(p[1]) === 1) [p[2], p[3], p[4]].forEach((id) => vr(id, 'setVehicleLocation', 'read')); break;
        case 285:
          if (hasAceCommands) {
            vr(p[0], 'getLocationInfo', 'write');
            if (int(p[2]) === 1) [p[3], p[4]].forEach((id) => vr(id, 'getLocationInfo', 'read'));
          }
          break;
        case 117: if (int(p[0]) > 0) add(r.commonEventCalls, int(p[0]), { ...ref }); break;
      }
    });
  }
  return r;
}

export const findSwitchUsage = (sources: EventSource[], engine?: Engine) => scanSources(sources, engine).switches;
export const findVariableUsage = (sources: EventSource[], engine?: Engine) => scanSources(sources, engine).variables;

/** mapId -> sorted destination mapIds, from direct Transfer Player commands. */
export function findMapLinks(maps: GameMapData[], engine?: Engine): Record<string, number[]> {
  const links = scanSources(maps.flatMap(mapToSources), engine).mapLinks;
  return Object.fromEntries([...links].sort((a, b) => a[0] - b[0]).map(([k, s]) => [String(k), [...s].sort((a, b) => a - b)]));
}
