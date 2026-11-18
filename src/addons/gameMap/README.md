# gameMap addon

Builds a portable JSON graph of an RPG Maker game's logic: switches, variables, maps,
common events and where each is used.
Supports MV, MZ, VX Ace, VX and XP.

This folder is a drop-in for the toolkit's `src/addons/gameMap/`:
- pure TypeScript, with no Node APIs and no file I/O, so it runs in the main process, the renderer or a worker;
- the host supplies raw game data through `GameDataSource` (`source.ts`);
- the output is plain JSON, safe for IPC and `structuredClone`.

```ts
import { buildGameMapFrom } from './addons/gameMap';
const graph = await buildGameMapFrom(source, { concurrency: 8, onProgress: (done, total) => {} });
```

| File | Role |
|---|---|
| `index.ts` | public API |
| `source.ts` | `GameDataSource` interface (what the host must provide), `normalizeEngine` |
| `types.ts` | output and intermediate types (plain data only) |
| `core/normalize.ts` | raw engine data → neutral structures (accepts camelCase, snake_case and `@ivar` keys; Ruby hashes as object, array or `Map`) |
| `core/scanner.ts` | `scanSources`, `findSwitchUsage`, `findVariableUsage`, `findMapLinks` |
| `core/builder.ts` | `buildGameMapFrom`: loads through the source, scans, assembles the graph |

## What is detected

**Page conditions**: switches and variables gating map event pages, troop pages,
and common-event triggers.

**Commands**:
- 121 Control Switches
- 122 Control Variables (target written; operand read when it is a variable)
- 111 Conditional Branch
- 103 Input Number
- 104 Select Item (VX Ace+)
- 125–128 gold/item changes whose amount comes from a variable
- 201/202/203 positions designated by variables
- 285 Get Location Info (VX Ace+)

Command 203 means Set Vehicle Location from VX onward, but Scroll Map in XP, so it is ignored for XP.
Calls to common events (117) are recorded in `commonEvents[].calledFrom` but not followed.
Script calls and plugin commands are not analyzed.

## Failure handling

- Only the System data is required. If it is missing, the build throws.
- If MapInfos, CommonEvents, Troops or a single map fails, it is skipped and recorded in `warnings`.

Reading game files from disk (RGSS archives, NW.js packages, Ruby Marshal) is not done here.
In this repository, `src/standalone/` does that for the CLI and tests.
In the toolkit, `src/core` does it. See `INTEGRATION.md`.
