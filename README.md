# rpgmaker-parser

Extracts the logic structure of an RPG Maker game into a portable `game-map.json`:
- switches and variables, with every place they are read or written;
- maps and the transfers between them;
- common events and the events that call them.

Supports **MV, MZ, VX Ace, VX and XP**, whether the data is loose, in an encrypted RGSS archive,
or inside an NW.js package (`package.nw`, or a zip appended to `Game.exe`). No runtime dependencies.

## Usage

Requires Node.js 22.18 or later, which runs the TypeScript sources directly.

```bash
npm install
npm run gamemap -- <gameFolder> [out.json]
```

```ts
import { buildGameMap } from './src/addons/gameMap/index.ts';
const graph = buildGameMap('/path/to/game');
```

## Output (excerpt)

```json
{
  "formatVersion": 1,
  "game": "My Game",
  "engine": "mz",
  "packed": false,
  "switches": [
    { "id": 1, "name": "Intro Done", "usedIn": [
      { "type": "event", "mapId": 1, "eventId": 1, "page": 0, "command": "controlSwitch", "access": "write", "line": 0 },
      { "type": "event", "mapId": 1, "eventId": 1, "page": 1, "condition": "pageSwitch", "access": "read" }
    ]}
  ],
  "variables": [],
  "commonEvents": [{ "id": 1, "name": "Ending", "trigger": 2, "switchId": 3, "calledFrom": [] }],
  "maps": [{ "id": 1, "name": "Town", "displayName": "Sunny Town", "parentId": 0, "order": 1,
             "eventCount": 1, "linksTo": [2], "dynamicTransfers": 0 }],
  "relations": { "mapLinks": { "1": [2] }, "mapParents": {}, "commonEventMapLinks": {} },
  "warnings": []
}
```

See [`src/addons/gameMap/README.md`](src/addons/gameMap/README.md) for the modules, the detected commands and the current limits.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run fixtures
```

`npm run fixtures` regenerates the test games in `tests/fixtures` and requires Ruby.
