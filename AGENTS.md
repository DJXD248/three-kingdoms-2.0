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
npm run build                                      # preflight dependency check + vite build -> dist/index.html (never installs silently; run the install command above first)
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

- **Tests cover core flow, resolvers, skills, AI, replay.** 431 tests across 49 files (as of 2.5.0; latest count is authoritative in PROJECT_HANDOFF §3). Since 2.3.3 the vitest include also covers `scripts/**/*.test.mjs` (build preflight guard, decision D-7). ci.yml also gates `npm audit --audit-level=high`. Add more alongside existing ones in `src/**/*.test.ts`. Run `npm run test:coverage` for per-file coverage; thresholds in vitest.config.ts act as a ratchet (lines>=47, functions>=34, branches>=34, statements>=42 as of 2.2.25) and fail CI on regression.
- **Engine randomness (decision D-2).** Three explicitly-seeded streams, no global patching: (i) in-play randomness — the seeded cursor `EngineState.rngState` (`src/core/rng.ts`, mulberry32 plain data), consumed only inside EventProcessor handlers (draw selection in `eventProcessors/drawEvents.ts`) and, since 2.2.19, also by store setup steps (room creation, deck build, draft sampling) via the `setupCursor`/`commitSetup` pattern in `gameStore.ts`; (ii) AI match assembly — `ai/matchSetup.ts` seeds its own stream from `seed ^ 0x9e3779b9`; (iii) AI policy — `ai/battleRunner.ts` seeds `seed ^ 0x85ebca6b` and injects it as the optional third `random` param of `AiPolicy` (live human-vs-AI random tier legitimately falls back to Math.random). Resolvers must stay pure validators — never call Math.random on the engine path (throwing-probe tests enforce this, and a patchless full-match battleRunner test proves no global patch remains). `ai/rng.ts withSeededRandom` was retired in 2.2.19. Since 2.2.22 in-play draw randomness is also **recorded as outcomes, not re-rolls**: TransitionCore emits a `RANDOM_OUTCOME` event (`core/Event.ts`, purpose `DRAW_SELECTION`, stableId `ro:<turn>:<round>:<playerId>:<index>`, value carries selected keys + deckTake + reshuffleKeys + cursorAfter) for every DRAW consumed on the live path, and ReplayPlayer injects the recorded outcomes back via `engine.outcomeOverrides` — replay playback uses the recorded selection verbatim (strict validation; any mismatch falls back to seeded re-roll, which is also the dual-read path for pre-2.2.22 replays, so no schema bump). Event stream is byte-identical live vs replay (`core/randomOutcome.test.ts`). Since 2.2.23 the fallback is never silent (GPT Q4 contract — auto-fallback allowed, silent fallback not): strict-validation failures that downgrade to the seeded re-roll carry exact reasons (`COUNT_MISMATCH` / `UNRESOLVABLE_KEY` / `MISMATCHED_SLOTS`) through an out-of-band channel — `DrawOutcomeFlow.diagnostics` → `TransitionResult.overrideFailures` → `GameEngine.lastOverrideFailures` → `ReplayPlaybackResult.overrideFailures` — and ReplayPlayer emits one aggregated `console.warn` per failing playback; live-path diagnostics are structurally empty so the event stream is untouched. **D-2 is now fully closed (2.2.25)**: the last §12-16e observation landed — reaction-window ids are deterministic (`rw:<turn>:<round>:<sourceEventKey>:<seq>`, a container counter that does NOT consume rngState), and the remaining non-engine Math.random sites are registered exemptions (DiceRoll/testArena decorative dice, `generateRoomName` default param outside the store path, dormant network scaffolding and the legitimate live random-tier AI-policy fallback).
- **Engine lifecycle (decision D-1, closed at 2.2.21).** The state transition is exactly one pure function: `core/TransitionCore.ts` `transition(state, action, ctx) -> {state, events, accepted}` (validate → resolve → trigger chain → settle → bounded DEATH reentry; no STATE_CHANGED, no event stamping). `GameEngine.dispatch` is a thin container around it (emit/stamp, STATE_CHANGED snapshot, replay recording, snapshots). Since 2.2.21 live UI play runs through ONE module-level resident engine in `store/engineExecutionBridge`: each dispatch adopts the incoming engineState (a clone — the same input the old per-step rebuild consumed) and fully resyncs the skill registry (unregister previous owners, then syncPlayerSkills), so the container can never drift from the store-authoritative state; restore/reset/testArena writes are honored automatically by the adopt step, no invalidation hook needed. The old per-step rebuild survives only as `dispatchStoreActionReconcile`, a reconciliation tool pinned against the resident path by `core/transitionEquivalence.test.ts` (resident === reconcile === bridge === ReplayPlayer). Do NOT add a second transition path, and do NOT treat the resident container as a state owner — the store's engineState is still the only source of truth.
- **Replay document format (decision D-4, landed at 2.2.24).** `ReplayDocument` carries an optional `header?: {schemaVersion, gameVersion}` (`REPLAY_SCHEMA_VERSION = 2` in `replay/types.ts`); `version` stays 1 and legacy archives are NEVER rewritten — a missing header reads as schemaVersion 1 (dual-read), and `ReplayRecorder.deserialize` explicitly rejects out-of-range schemas. Armor-destruction placeholder cards (`eventProcessors/damageEvents.ts`) use a positional deterministic id `legacy_armor_destroyed_<discardPile-index+i>` — keep the `legacy_armor_destroyed` prefix (`ai/invariants.ts` excludes it from the card ledger) and never reintroduce `Date.now()` there.
- **Reaction windows are container-layer timing (§12-9c entry, landed at 2.2.25).** `GameEngine.openReactionWindow(event, participants?)` + `passReaction` drive `triggers/ReactionWindow` through the resident bridge (`openReactionWindowStore`/`passReactionStore`/`resetReactionWindowStore`) and the store's `reactionWindow` field / GameBoard HUD strip. Hard invariants: window state NEVER enters EngineState (a test pins the snapshot byte-unchanged across open/pass/close), REACTION_WINDOW_OPENED/CLOSED are EventBus emissions outside dispatch return streams so windows never reach replay documents, and window ids stay the deterministic `rw:<turn>:<round>:<sourceEventKey>:<seq>` form (counter, not rngState). Do NOT auto-open windows from skills or trigger types — deciding which skills react is content work gated on decision D-3.
- **Skill triggers are demand-driven (2.3 content era, first cut v2.3.0).** 7 trigger types are supported (onDeploy/onTurnStart/onDamageTaken/onDamageDealt/onKill/onDeath/onBecomingTarget) across three synchronized tables (compiler SUPPORTED_TRIGGER_MAP / dataTypes / bridge TRIGGER_EVENT_MAP) — extend all three together or not at all. `onBecomingTarget` reuses the EXISTING `BEFORE_DAMAGE` event (zero new canonical events): it fires only from AttackResolver's general-targeted branch, condition `owner==targetPlayerId && (no declared general || general==targetId??target)`, priority 50, and its derived counter-damage settles at the BFS tail of the same dispatch — AFTER source DAMAGE + ATTACK_RESOLVED + AFTER_DAMAGE, and it still lands even if the target died from the source damage. The full twelve-slot contract table (Event/Timing/Source/Target/Trigger/Condition/Effect/RNG/Replay/Transition/Reentrancy/Death chain) for every supported trigger lives in PROJECT_ARCH_MAP.md §F; any new trigger must fill all twelve slots there BEFORE implementation. The remaining 12 trigger types are an on-demand pool (not debt): implement one only when a real skill needs it. **onTurnEnd is the second closed case (v2.3.1) and the precedent for decision-type triggers: TURN_END is deliberately NOT in the event map (no auto-fire) — activation is a canonical `ACTIVATE_SKILL` action through `TurnEndSkillResolver` (five honest rejection gates, legality re-derived from EngineState), emitting SKILL_ACTIVATED into the `consumedSkills` ledger via EventProcessor plus effects through the shared static `createSkillEvents`; the turn-end ask window (store-layer pre-dispatch deferral, field `turnEndAsk`) is the reaction window's first real business caller — the window is class B (never recorded; structurally cannot reach snapshots), in-window decisions are class A canonical actions (D-3c).** Compile honesty (D-9 class C): skipped skill effects are reported out-of-band via WeakMap `getCompileDiagnostics(engine)` with `console.warn` deduped per **distinct entry** (`skillName#effectId:reason`) — never silently, and never aggregated per engine (batch runners mint engines per step; per-entry dedup measured 92 vs 707 warn lines over 300 games). Content-cut baseline口径 (v2.3.0+): behavior-changing cuts validate via same-seed two-run byte self-consistency + VIOLATIONS=0 + honest distribution disclosure; current baseline B2 ({1:114,2:186}) is registered in PROJECT_HANDOFF §12-19. Store fixture invariant (2.3.1 lesson): any store `set()` without an own `engineState` rebuilds the engine mirror from display fields — fixtures must alias `players === engineState.players` and `cardDeck === engineState.deck` like production does, or handcrafted fields get wiped.
- **State sync is critical.** Always update both engine state and Zustand store via the established adapter pattern.
- **Card identity.** Use `getRuntimeCardId()` from `utils/runtimeIdentity` for all card ID lookups.
- **Excel import.** The `importer/` module requires `exceljs` -- verify .xlsx parsing after dependency changes. Note: package.json forces transitive `uuid` to ^11.1.1 via npm `overrides` (security fix, audit-clean baseline); revisit the override whenever exceljs is bumped.
- **Build output.** Single-file HTML via `vite-plugin-singlefile` -- everything inlines to `dist/index.html`.
- **Lint is advisory for legacy code.** ESLint flat config (eslint.config.js) is a real gate: 0 errors required to pass. 30 remaining warnings (as of 2.2.10) are all react-hooks in legacy UI (GameBoard, TestArena, SkillEditor, Codex, DiceRoll, UnifiedDraw): rules-of-hooks, static-components, exhaustive-deps, set-state-in-effect. These need careful UI refactors -- treat as tracked tech debt, do not blanket-suppress.