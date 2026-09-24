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
+-- core/            Game engine: GameEngine, EventProcessor (thin entry), eventProcessors/ (event-family handlers, split in 2.2.13), GameState, EventBus, EngineDispatchFlow
+-- action/          Action system: ActionTypes, ActionDispatcher, ResolverRegistry
|   +-- resolvers/   Attack, Deploy, Move, Supply, Surrender, Turn, Armor, Draw...
+-- store/           Zustand store: gameStore (+ gameStoreTypes/gameStoreEditorActions/gameStoreRecovery split in 2.2.12), gameStateAdapter, engineAwareSetter, engineExecutionBridge, testArenaActions, editorPersistence, localGameSnapshot
+-- data/            Card/general/skill data definitions + registries
+-- domain/          Game rules: combat, cost, regions, constants
+-- rules/           Rule engine: ActionValidator, RuleEngine, legalActions (candidate enumerator)
+-- skills/          Skill system: skillCompiler, SkillTriggerBridge, SkillDataRegistry, Excel format
+-- components/      React UI: GameBoard, Settings, Rules, MainMenu, UnifiedDraw, SkillEditor...
+-- controllers/     Game controllers: Hotseat, Human, AI, Local
+-- setup/           Match setup: draft, pool builder, runtime setup
+-- importer/        Excel data import: GeneralImporter, PackageImporter, SkillImporter
+-- network/         Multiplayer (dormant): WebSocket, StateSerializer, SyncManager
+-- replay/          Game replay: GameHistory, ReplayManager, SnapshotManager, liveReplayRecorder, replayStorage, gameplayLog
+-- timeline/        Turn timeline: PrioritySystem
+-- triggers/        Reaction system: TriggerEngine, ReactionWindow
+-- ai/              Bot AI: legal-action-driven policies, aiTurnDriver, battleRunner, arena, strategies
+-- room/            Room management (dormant): RoomManager, Match
+-- server/          Server (dormant): GameServer, ConnectionManager, ServerAuthority
+-- session/         Session (dormant): SessionManager, ReconnectToken
+-- utils/           Helpers: runtimeIdentity, generalCardVisual, cn
```

Per-module authority / lifecycle / determinism / verification status: see **`PROJECT_ARCH_MAP.md`** (single source of truth for module inventory; this file intentionally avoids volatile numbers except as-of stamps).

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
| `src/store/gameStore.ts` | Central Zustand store (622 lines as of 2.2.12; types/editor/recovery/test-arena slices split out per D-6 stage B) -- app/session state + engine projection |
| `src/core/EventProcessor.ts` | Event application logic -- single canonical entry (process/apply dispatcher + optional append-only `collected[]` derived-event capture added in 2.2.17, 106 lines as of 2.2.17; handlers verbatim-split into `core/eventProcessors/*` by event family per D-6 stage B) |
| `src/core/GameEngine.ts` | Game engine orchestrator (rebuilt per dispatch from EngineState -- see PROJECT_ARCH_MAP lifecycle) |
| `src/store/gameStateAdapter.ts` | Engine <-> Store state synchronization |
| `src/action/resolvers/*.ts` | Action resolution logic (attack, deploy, move, etc.) |
| `src/rules/legalActions.ts` | Candidate action enumerator for AI (NOT the legality authority -- ActionValidator is) |
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

- **Tests cover core flow, resolvers, skills, AI, replay.** 294 tests across 37 files (as of 2.2.20; latest count is authoritative in PROJECT_HANDOFF §3). ci.yml also gates `npm audit --audit-level=high`. Add more alongside existing ones in `src/**/*.test.ts`. Run `npm run test:coverage` for per-file coverage; thresholds in vitest.config.ts act as a ratchet (lines>=47, functions>=34, branches>=34, statements>=42 as of 2.2.20) and fail CI on regression.
- **Engine randomness (decision D-2).** Three explicitly-seeded streams, no global patching: (i) in-play randomness — the seeded cursor `EngineState.rngState` (`src/core/rng.ts`, mulberry32 plain data), consumed only inside EventProcessor handlers (draw selection in `eventProcessors/drawEvents.ts`) and, since 2.2.19, also by store setup steps (room creation, deck build, draft sampling) via the `setupCursor`/`commitSetup` pattern in `gameStore.ts`; (ii) AI match assembly — `ai/matchSetup.ts` seeds its own stream from `seed ^ 0x9e3779b9`; (iii) AI policy — `ai/battleRunner.ts` seeds `seed ^ 0x85ebca6b` and injects it as the optional third `random` param of `AiPolicy` (live human-vs-AI random tier legitimately falls back to Math.random). Resolvers must stay pure validators — never call Math.random on the engine path (throwing-probe tests enforce this, and a patchless full-match battleRunner test proves no global patch remains). `ai/rng.ts withSeededRandom` was retired in 2.2.19; remaining D-2 debt is the RandomOutcome event stream (§12-16a) only.
- **Engine lifecycle (decision D-1, first cut 2.2.20).** The state transition is exactly one pure function: `core/TransitionCore.ts` `transition(state, action, ctx) -> {state, events, accepted}` (validate → resolve → trigger chain → settle → bounded DEATH reentry; no STATE_CHANGED, no event stamping). `GameEngine.dispatch` is a thin container around it (emit/stamp, STATE_CHANGED snapshot, replay recording, snapshots). Live UI play still rebuilds per step via `engineExecutionBridge`; `core/transitionEquivalence.test.ts` permanently reconciles resident vs rebuilt vs ReplayPlayer playback on raw event sequences and final state. Do NOT add a second transition path; the store long-lived-engine migration is the planned next cut.
- **State sync is critical.** Always update both engine state and Zustand store via the established adapter pattern.
- **Card identity.** Use `getRuntimeCardId()` from `utils/runtimeIdentity` for all card ID lookups.
- **Excel import.** The `importer/` module requires `exceljs` -- verify .xlsx parsing after dependency changes. Note: package.json forces transitive `uuid` to ^11.1.1 via npm `overrides` (security fix, audit-clean baseline); revisit the override whenever exceljs is bumped.
- **Build output.** Single-file HTML via `vite-plugin-singlefile` -- everything inlines to `dist/index.html`.
- **Lint is advisory for legacy code.** ESLint flat config (eslint.config.js) is a real gate: 0 errors required to pass. 30 remaining warnings (as of 2.2.10) are all react-hooks in legacy UI (GameBoard, TestArena, SkillEditor, Codex, DiceRoll, UnifiedDraw): rules-of-hooks, static-components, exhaustive-deps, set-state-in-effect. These need careful UI refactors -- treat as tracked tech debt, do not blanket-suppress.