# gameMap: RPG Maker logic parser

Extracts switches, variables, maps and how they are used into a portable `game-map.json`.
Supports MV, MZ, VX Ace, VX and XP. Data can be read from:
- loose files: the standard export, where `Game.exe` is only the NW.js/RGSS runtime;
- an MV/MZ NW.js package: a `package.nw` (zip or folder), or a zip appended to any `.exe` at the game root;
- an encrypted RGSS archive (`Game.rgss3a`, `Game.rgss2a`, `Game.rgssad`).
No dependencies. Includes its own Ruby Marshal reader.

    node src/addons/gameMap/cli.ts <gameFolder> [out.json]

| Module | Role |
|---|---|
| `parser/engine.ts` | `detectEngine`, `loadDatabase`, `loadMap`, `loadEvents`: normalizes JSON and Marshal data into one shape |
| `parser/files.ts` | case-insensitive folder access, RGSSAD v1/v3 archives, NW.js zip packages |
| `parser/marshal.ts` | Ruby Marshal 4.8 → plain objects (ivars camelCased to match MV keys) |
| `parser/scanner.ts` | `findSwitchUsage`, `findVariableUsage`, `findMapLinks` |
| `builder.ts` | `buildGameMap` / `writeGameMap` |

**Detected usages**: page conditions (map events, troops, common-event triggers) and the commands
121 Control Switches, 122 Control Variables, 111 Conditional Branch, 103 Input Number, 104 Select Item,
125–128 operands, 201/202/203 variable-designated positions, 285 Get Location Info.
117 Common Event calls are recorded (`commonEvents[].calledFrom`) but not followed.
Script calls and plugin commands are not analyzed.

Commands that don't exist in an engine are skipped for it: 104/285 need VX Ace+, and 203 is Scroll Map in XP.

**Not supported**:
- Enigma Virtual Box executables: detected and rejected with a hint (extract them first, e.g. with `evbunpack`);
- ZIP64 packages larger than 4 GB;
- RPG Maker 2000/2003, which use a different binary format (LCF).
