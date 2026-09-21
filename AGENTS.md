# AGENTS.md

Three Kingdoms card game -- React + TypeScript single-page application.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.2 |
| Language | TypeScript | 5.9 |
| Build | Vite | 7.3 |
| Styling | Tailwind CSS | 4.1 |
| State | Zustand | 5.0 |
| Data | exceljs | 4.4 |
| Package | npm | -- |

## Verification Commands

```bash
npm install --include=optional --ignore-scripts   # install dependencies
npm run check                                      # tsc --noEmit (type check)
npm run build                                      # vite build -> dist/index.html
npm run dev                                        # dev server
npm run test                                       # vitest run (unit tests)
npm run test:coverage                              # vitest run --coverage -> coverage/
npm run lint                                       # eslint . (flat config)
npm run lint:fix                                   # eslint . --fix
```

## Core Module Map

```
src/
+-- core/            Game engine: GameEngine, EventProcessor, GameState, EventBus
+-- action/          Action system: ActionTypes, ActionDispatcher, ResolverRegistry
|   +-- resolvers/   Attack, Deploy, Move, Supply, Surrender, Turn, Armor, Draw...
+-- store/           Zustand store: gameStore (910 lines), gameStateAdapter, engineAwareSetter
+-- data/            Card/general/skill data definitions + registries
+-- domain/          Game rules: combat, cost, regions, constants
+-- rules/           Rule engine: ActionValidator, RuleEngine, TurnRule, CardRule
+-- skills/          Skill system: SkillEngine, EffectResolver, TriggerBridge
+-- components/      React UI: GameBoard, Settings, Rules, MainMenu, UnifiedDraw...
+-- controllers/     Game controllers: Hotseat, Human, AI, Local
+-- setup/           Match setup: draft, pool builder, runtime setup
+-- importer/        Excel data import: GeneralImporter, PackageImporter, SkillImporter
+-- network/         Multiplayer: WebSocket, StateSerializer, SyncManager
+-- replay/          Game replay: GameHistory, ReplayManager, SnapshotManager
+-- timeline/        Turn timeline: PhaseManager, PrioritySystem, TurnManager
+-- triggers/        Reaction system: TriggerEngine, ReactionWindow
+-- ai/              Bot AI: Bot, Difficulty, RandomStrategy
+-- card/            Card engine: CardEngine, Deck, Hand
+-- room/            Room management: RoomManager, Match
+-- server/          Server: GameServer, ConnectionManager, ServerAuthority
+-- session/         Session: SessionManager, ReconnectToken
+-- status/          Status effects: StatusManager, Modifier, StatusEffect
+-- utils/           Helpers: runtimeIdentity, generalCardVisual, cn
```

## Architecture Overview

```
User Input
    |
    v
+---------------+     +--------------+     +---------------+
|  Components   |---->|  gameStore   |---->|  GameEngine   |
|  (React UI)   |     |  (Zustand)   |     |  (core/)      |
+---------------+     +--------------+     +---------------+
                           |                      |
                           v                      v
                    +--------------+     +---------------+
                    | engineAware  |     | EventProcessor|
                    | Setter       |     | (apply events |
                    | (sync state) |     |  to state)    |
                    +--------------+     +---------------+
```

**Action flow:**
1. Component dispatches action via `gameStore`
2. `engineExecutionBridge` forwards to `GameEngine`
3. `ActionDispatcher` routes to appropriate `Resolver`
4. Resolver returns `GameEvent[]`
5. `EventProcessor` applies events to `EngineState`
6. `gameStateAdapter` syncs engine state back to Zustand store

## Data Import Flow

Excel files (.xlsx) are imported via the `importer/` module:

```
.xlsx file
    |
    v
+-----------------+     +------------------+     +-----------------+
| GeneralImporter |---->| GeneralRegistry  |---->| gameStore       |
| PackageImporter |     | (data/registries)|     | (runtime data)  |
| SkillImporter   |     +------------------+     +-----------------+
+-----------------+
```

- **GeneralImporter**: Imports general data from Excel
- **PackageImporter**: Imports card package data
- **SkillImporter**: Imports skill data
- All importers use `exceljs` to parse .xlsx files
- Data flows into registries (`data/registries/`) which are consumed by the game engine

## Key Files

| File | Purpose |
|------|---------|
| `src/store/gameStore.ts` | Central state store (910 lines) -- all game state lives here |
| `src/core/EventProcessor.ts` | Event application logic (818 lines) -- how state changes |
| `src/core/GameEngine.ts` | Game engine orchestrator |
| `src/store/gameStateAdapter.ts` | Engine <-> Store state synchronization |
| `src/action/resolvers/*.ts` | Action resolution logic (attack, deploy, move, etc.) |
| `src/data/generals.ts` | General card definitions |
| `src/data/cards.ts` | Card deck definitions |
| `src/components/GameBoard.tsx` | Main game UI component |

## Game Phases

```
menu --> codex/settings/createRoom/rules
     --> diceRoll --> factionAssign --> generalDraft
     --> drawing <--> playing --> gameOver
     --> testArena (developer mode)
```

## Notes for AI Agents

- **Tests cover all action resolvers + core.** 128 tests across EventProcessor (17), AttackResolver (11), MoveGeneralResolver (10), DeployGeneralResolver (15), SupplyResolver (17), SurrenderResolver (6), ArmorResolver (14), TurnResolver (11), DrawResolver (8), BeginDrawResolver (6), ConfirmDrawResolver (8), ResolveBaseLossResolver (5). Add more alongside existing ones in `src/**/*.test.ts`. Run `npm run test:coverage` for per-file coverage; thresholds in vitest.config.ts act as a ratchet (lines>=13, statements>=11, branches>=10, functions>=7) and fail CI on regression.
- **State sync is critical.** Always update both engine state and Zustand store via the established adapter pattern.
- **Card identity.** Use `getRuntimeCardId()` from `utils/runtimeIdentity` for all card ID lookups.
- **Excel import.** The `importer/` module requires `exceljs` -- verify .xlsx parsing after dependency changes.
- **Build output.** Single-file HTML via `vite-plugin-singlefile` -- everything inlines to `dist/index.html`.
- **Lint is advisory for legacy code.** ESLint flat config (eslint.config.js) is a real gate: 0 errors required to pass. prefer-const and no-empty are fixed. 32 remaining warnings are all react-hooks in legacy UI (GameBoard, TestArena, SkillEditor, Codex, DiceRoll, UnifiedDraw): rules-of-hooks (15, mostly an early `if(!cp) return null` before hooks in GameBoard), static-components (8, nested component defs), exhaustive-deps (6), set-state-in-effect (2), purity (1). These need careful UI refactors -- treat as tracked tech debt, do not blanket-suppress.