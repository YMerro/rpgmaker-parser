# rpgmaker-parser

Extracts the logic structure of an RPG Maker game into a portable `game-map.json`:
- switches and variables, with every place they are read or written;
- maps and the transfers between them;
- common events and the events that call them.

Supports **MV, MZ, VX Ace, VX and XP**.

The repository has two parts:
- **`src/addons/gameMap/`** is the addon. It is pure TypeScript with no I/O, made to be dropped into the toolkit,
  which feeds it game data through a `GameDataSource`. See its [README](src/addons/gameMap/README.md)
  and [INTEGRATION.md](src/addons/gameMap/INTEGRATION.md).
- **`src/standalone/`** is a Node data source plus a CLI, to run the parser on a game folder without the toolkit.
  It reads loose data, encrypted RGSS archives (`rgss3a`/`rgss2a`/`rgssad`) and NW.js packages
  (`package.nw`, or a zip appended to `Game.exe`).

## Usage

Requires Node.js 20.11 or later.

```bash
npm install
npm run gamemap -- <gameFolder> [out.json]
```

```ts
// Node, straight from a game folder
import { buildGameMap } from './src/standalone';
const graph = await buildGameMap('/path/to/game');

// Any host (toolkit): provide the data yourself
import { buildGameMapFrom } from './src/addons/gameMap';
const graph = await buildGameMapFrom(mySource);
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

Not supported: Enigma Virtual Box executables (extract them first, e.g. with `evbunpack`), ZIP64 packages, and RPG Maker 2000/2003.

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
