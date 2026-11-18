# Toolkit integration (next session)

The addon needs a single thing from the toolkit: a `GameDataSource` built on `src/core`.
Everything below the "Assumed" marker is a sketch. The signatures of `adapterOf` and `readMap`
were not available when this was written, so check them against `src/core` first.

## 1. Data source: `src/addons/gameMap/toolkitSource.ts`

```ts
import type { GameDataSource } from './source';
// Assumed: adjust the imports and calls to the real src/core API.
import { adapterOf, readMap } from '../../core';

export function toolkitSource(game: Game): GameDataSource {
  const adapter = adapterOf(game);
  return {
    engine: adapter.engine,                         // 'MV' | 'VX Ace' ... are all accepted
    packed: adapter.packed,                         // optional
    system: () => adapter.readData('System'),       // raw System object
    mapInfos: () => adapter.readData('MapInfos'),
    commonEvents: () => adapter.readData('CommonEvents'),
    troops: () => adapter.readData('Troops'),
    map: (mapId) => readMap(game, mapId),           // raw map, with its events and pages
  };
}
```

Pass the **raw** engine objects. Key spelling and hash shape do not matter (see `core/normalize.ts`).
Only `system`, `mapInfos` and `map` are required. A method that throws becomes a warning.

## 2. Main process: `src/main/api.ts`

```ts
import { buildGameMapFrom } from '../addons/gameMap';
import { toolkitSource } from '../addons/gameMap/toolkitSource';

gameMap: (game) => buildGameMapFrom(toolkitSource(game)),  // returns plain JSON, safe over IPC
```

## 3. Renderer tab: `src/renderer/tabs/GameMapTab.tsx`, added to `src/pages/Game.tsx`

```tsx
const { data, loading, error } = useAsync(() => api.gameMap(game), [game]);
// .toolbar: search box and filters (unused / write-only / read-only)
// .grid of .card: one card per switch or variable with its usedIn list,
// plus map cards showing linksTo / dynamicTransfers
```

## Points to check in src/core

1. Does `readMap` return the raw map (events → pages → conditions + list), or an already
   normalized one? If it is normalized, map it back to raw keys or add a small adapter
   in `toolkitSource`.
2. Does the adapter expose System, MapInfos, CommonEvents and Troops?
   Only System, MapInfos and maps are required.
3. `listScenes` / `sceneCommands` could replace `map()` only if they also expose **page conditions**.
   The scanner needs them for `pageSwitch` / `pageVariable`.
4. The addon uses extensionless ESM imports and `export type *` (TypeScript 5.0+).
   That is the convention for Vite/Electron projects.
