/** All types here are plain data: the parser's output is portable JSON. */
export type Engine = 'mv' | 'mz' | 'vxace' | 'vx' | 'xp';

export interface Command {
  code: number;
  indent: number;
  parameters: unknown[];
}

/** Engine-neutral page condition (only the parts we track). */
export interface PageCondition {
  switchIds: number[];
  variable?: { id: number; value: number };
}

export type SourceRef =
  | { type: 'event'; mapId: number; eventId: number; page: number }
  | { type: 'commonEvent'; commonEventId: number }
  | { type: 'troop'; troopId: number; page: number };

/** One scannable command list plus the condition that gates it. */
export interface EventSource {
  ref: SourceRef;
  condition?: PageCondition;
  list: Command[];
}

export type Usage = SourceRef & {
  condition?: string;
  command?: string;
  access: 'read' | 'write';
  line?: number;
};

export interface MapInfo { id: number; name: string; parentId: number; order: number }
export interface CommonEventInfo { id: number; name: string; trigger: number; switchId: number; list: Command[] }
export interface TroopInfo { id: number; name: string; pages: { condition: PageCondition; list: Command[] }[] }

export interface MapEvent { id: number; name: string; x: number; y: number; pages: { condition: PageCondition; list: Command[] }[] }
export interface GameMapData { id: number; displayName: string; events: MapEvent[] }

export interface NamedUsage { id: number; name: string; usedIn: Usage[] }

export interface GameMapGraph {
  formatVersion: 1;
  game: string;
  engine: Engine;
  packed: boolean;
  switches: NamedUsage[];
  variables: NamedUsage[];
  commonEvents: { id: number; name: string; trigger: number; switchId: number; calledFrom: SourceRef[] }[];
  maps: { id: number; name: string; displayName: string; parentId: number; order: number; eventCount: number; linksTo: number[]; dynamicTransfers: number }[];
  relations: {
    mapLinks: Record<string, number[]>;
    mapParents: Record<string, number>;
    commonEventMapLinks: Record<string, number[]>;
  };
  warnings: string[];
}
