# Changelog

All notable changes to this project will be documented in this file.

## [2.2.12] - 2026-09-24

Stabilization stage B, first split (decision D-6): `gameStore.ts` shrunk 956 -> 622 lines via **pure verbatim moves, zero behavior change**.

- `src/store/gameStoreTypes.ts` (new): all store-level types (GamePhase/DrawContext/Player/GameState...); gameStore re-exports them so consumer imports are unchanged.
- `src/store/gameStoreEditorActions.ts` (new): developer-mode + skill/general edit slice as `buildEditorActions(get, set)` factory (same pattern as `buildTestArenaActions`).
- `src/store/gameStoreRecovery.ts` (new): snapshot serialization/restore slice as `buildRecoveryActions(get, set)`.
- `settleDrawInTestArena` / `buildTestArenaState` moved into `testArenaActions.ts` (test-arena cohesion; 297 -> 441 lines).
- Verified: check 0 errors / 264 tests pass (32 files, zero add/remove) / coverage ratchet gates 41/34/32/46 hold (measured 41.96/34.85/32.84/47) / lint 0 errors 30 legacy warnings / build 1,916.39 kB single file. Browser smoke via dev-only `__TK__`: createRoom->lobby, editor persist/merge/delete round-trip, snapshot create+restore true, testArena enter + endTurn stays mounted, resetGame keeps preferences; console 0 errors.

## [2.2.11] - 2026-09-24

Documentation / contract-freeze release. **No gameplay behavior, engine, or rule changes.**

- Fixed long-standing doc drift: README test count (131 -> 264), AGENTS module map (removed stale `card/` and `status/` entries, corrected gameStore/EventProcessor line counts, updated coverage ratchet 46/32/34/41 and lint warning count), CHANGELOG version history below.
- Corrected 2.0.0 cleanup claim: `start.bat` was never actually removed (it remains tracked as a local convenience launcher).
- Added `PROJECT_ARCH_MAP.md` -- Architecture & Authority Map for the v2.2.10 baseline (module layer, responsibility, canonical status, authority boundary, lifecycle, determinism, verification level, known gaps).
- `src/rules/legalActions.ts` contract wording renamed from "complete legal action list" to **candidate action enumeration** (doc-level only; behavior unchanged; legality authority remains `ActionValidator`/engine).
- Registered decisions (from the 2026-09-24 external architecture review, see PROJECT_HANDOFF §12): persistent-GameEngine migration must share a single TransitionCore with reconstruction-mode validation (no two long-term execution paths); RNG will move into `EngineState` with recorded random outcomes in replays (replays never re-roll); old replays are read-only historical assets -- never rewrite events, use schema-versioned adapters instead; card-cost enumeration gated by per-action `CardSelectionPolicy` (EQUIVALENT / INSTANCE_REQUIRED) when identity-sensitive costs are introduced.
- Registration discipline extended: README / AGENTS / CHANGELOG now checked against code at every version registration (PROJECT_RELEASE_PIPELINE.md).

## [2.2.10] - 2026-09-23

- Auto-save root fix: unattended saves never trigger browser downloads / OS "Save As" dialogs. Silent write to authorized directory only, else in-memory pending queue (cap 12) with automatic flush after authorization or a manual save. Manual save keeps the download fallback. 264 tests (6 new locking the no-download invariant).

## [2.2.9] - 2026-09-23

- Phase 4 human-vs-AI: per-seat AI toggle + strategy tier in room setup, production-store AI seat driver (draft/draw/play/end-turn), full-AI spectate mode, two browser E2E matches.

## [2.2.8] - 2026-09-22

- Faction balance stats (win/death/kill rates per faction, 2000-game baseline) and custom line-up selection for AI battles (repeatable, batch-locked via `seats` URL hash; per-seat faction-pure draft default).

## [2.2.7] - 2026-09-22

- Three-tier strategies (conservative / balanced / aggressive) + arena win-rate harness (`npm run ai-arena`, 3400 games, zero invariant violations; strength order aggressive > balanced > conservative > random).

## [2.2.6] - 2026-09-21

- Replay & operation-log saving at game over: rename row + save button, settings page "replay directory" (File System Access) + "auto-save each match" toggle, naming = room + faction + timestamp.

## [2.2.5] - 2026-09-21

- In-browser AI drill window (developer mode): runner control panel, log/replay export.

## [2.2.4] - 2026-09-20

- Seeded AI-vs-AI battle runner (`npm run ai-battle`) + invariant checker + report export; 1000-game local soak.

## [2.2.3] - 2026-09-20

- `getLegalActions` candidate enumerator in `src/rules/legalActions.ts` + engine-referee consistency tests (AI line phase 1).

## [2.2.2] - 2026-09-20

- Core game-flow automation tests driving real `GameAction`s (no engine bypass); coverage ratchet raised.

## [2.2.1] - 2026-09-20

- Draft merged-editing in `confirmDraft` (assembly invariant locked); editor->runtime gap found and fixed via browser E2E (saved skills now enter real matches).

## [2.2.0] - 2026-09-19

- Skill editor structured effect rows (type + value + target) and Excel import/export columns (skill convergence series 2.1.0-2.2.1 completed).

## [2.1.0] - 2026-09-19

- Skill system unique-runtime convergence: single runtime chain (compiler -> SkillTriggerBridge -> TriggerEngine), legacy skill runtime paths removed.

## [2.0.3] - 2026-09-19

- Dependency security zeroing: uuid via npm `overrides` (^11.1.1) + exceljs unified; audit-high clean baseline in CI.

## [2.0.1] / [2.0.2] - 2026-09-19

- xlsx (SheetJS) high-severity vulnerability fixed by vendoring the official CDN tarball (0.20.3; npm has no patched release), plus `xlsxSecureReader` regression tests.

## [2.0.0] - 2026-09-19

### Summary

Version 2.0 is a clean release based on the stable 1.29 codebase, with legacy cleanup and dependency restoration. This release consolidates all improvements from the 1.x series (1.0 -> 1.29) into a production-ready state.

### Changes from 1.0

#### Architecture (ARCH)
- **engineAwareSetter** (added in 1.1): Extracted store setter logic into a dedicated module, decoupling engine state synchronization from gameStore
- **gameStateAdapter** (enhanced through 1.2-1.15): Added engineStateToStoreProjection, applyEngineStateToStore, isRestorableEngineState for robust engine <-> store state mapping
- **localGameSnapshot** (added in 1.23): New module for local game state serialization/deserialization with autoSave integration
- **StateSerializer** (enhanced in 1.27): Network layer serialization support for multiplayer synchronization
- **gameStore refactoring** (1.0->1.29): Extracted helper functions (settleDrawInTestArena, buildTestArenaState, deriveResultState), added 'rules' phase, integrated autoSave

#### Code (CODE)
- **Rules page** (added in 1.20): New Rules.tsx component displaying game rules, accessible from main menu
- **UI refactoring** (1.23-1.26): Comprehensive updates to GameBoard, Settings, GameOverScreen, MainMenu components
- **getRuntimeCardId consistency** (1.19->1.20): Unified card runtime identity extraction across AttackResolver, MoveGeneralResolver, and EventProcessor

#### Dependencies (DEPENDENCY)
- **exceljs**: Restored to ^4.4.0 (was downgraded to ^3.4.0 in 1.29, now back to original)
- **uuid**: Added ^11.1.1 for unique identifier generation
- **vite**: Updated from 7.3.2 to 7.3.6 (patch)

### Cleanup in 2.0
- Removed dist/ directory (build artifacts should not be version-controlled)
- Removed .git/ directory (re-initialized for clean 2.0 history)
- Removed *.backup files
- ~~Removed start.bat (legacy startup script)~~ CORRECTED in 2.2.11: start.bat was not actually removed; it remains tracked as a local convenience launcher

### Verification
- npm install: 202 packages installed
- npm run check: TypeScript type check passed (zero errors)
- npm run build: Production build successful (dist/index.html, 1.8MB / 528KB gzipped)

### Statistics
- Total source files: ~150 TS/TSX files
- Total modules: 23
- Files unchanged from 1.0: 138 (87% stability)
- Files changed from 1.0: 16
- Files added from 1.0: 4