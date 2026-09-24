# Changelog

All notable changes to this project will be documented in this file.

## [2.2.19] - 2026-09-24

Stabilization stage D, second cut (user go-ahead "补阶段 D 第二刀"; scope confirmed as b+c+d this cut, RandomOutcome stays a separate cut): **setup randomness fully migrated into the seeded `rngState` cursor, runtime ids made deterministic, and `withSeededRandom` retired outright with the battleRunner lockstep habit cleaned up** (§12-16 items b/c/d closed).

- **b) Setup randomness via cursor.** `createCardDeck` and the four `setup/runtimeSetup.ts` functions (`createLobbyPlayers` / `rollAndSortPlayers` / `assignFactions` / `buildDraftCandidates`) take an injected `random` param (Math.random default remains only for dev tooling and the cosmetic UI dice). The five store setup steps (`createRoom` / `rollDice` / `assignFactions` / `distributeDraftGenerals` / `confirmDraft` candidate refill) now consume a clone of `EngineState.rngState` and commit it back through the new `setupCursor`/`commitSetup` pair -- projection-identical to the engine-aware setter, the only observable difference being the advanced cursor. Live human-vs-AI play is covered automatically since `aiTurnDriver` goes through these store actions.
- **c) Deterministic ids.** `createAction` ids become a plain process counter (`action_N`; consumers only associate, never look up), and `createRuntimeInstanceId` drops `Date.now` + `Math.random` for a pure counter (ids are used by equality only; old replays embed their ids in `initialState` and are unaffected). `matchSetup`'s seeded stamping (`ai{seed}_c{n}`) now covers **both** cards and injected skills, closing the leak that test normalization used to paper over.
- **d) withSeededRandom retired.** `src/ai/rng.ts` is **deleted**. Three explicitly-seeded streams remain: in-play engine draws (`rngState = createRngState(seed)`), AI match assembly (`matchSetup` internal stream seeded `seed ^ 0x9e3779b9`), and AI policy (`battleRunner` stream seeded `seed ^ 0x85ebca6b`, injected via the new optional third `random` parameter of `AiPolicy`; the live random-tier fallback to Math.random without injection is intended). **Lockstep cleanup:** replay mode no longer consults the policy at all -- recorded actions are re-minted through `createAction` and dispatched directly.
- Tests 287 -> **291 / 36 files** (+4): new `store/setupDeterminism.test.ts` (same seed -> field-for-field identical setup, different seeds diverge, cursor demonstrably advances after `createRoom`), a patchless full-match `battleRunner` test that swaps Math.random for a throwing probe, and an upgraded action-sequence equality assertion; `matchSetup.test` now deep-equals whole built states without any global patch, and the `DrawResolver` probe tightens to cover action construction.
- Coverage ratchet: functions floor 33 -> **34** (measured 42.61-42.81 / 35.19-35.54 / 34.26-34.45 / 47.59-47.84; branch floor kept at 34 for run-to-run jitter, same call as 2.2.17).
- **Disclosed behavior change**: the AI-battle seed -> winner distribution shifted because the assembly stream was split out -- 300-game seed-1 baseline {1:112, 2:188} (2.2.18) becomes {1:109, 2:191}; rules semantics unchanged, but balance-observer history needs re-anchoring. Two consecutive `ai-battle` runs are content-identical.
- **Browser real-click E2E backfilled (§12-16 debt closed)**: dev server on 5199, human-vs-AI 2-player room clicked through the full chain (room -> dice 9/8 -> factions -> draft 10 generals -> turn-1 draw panel 2 generals + 3 card backs -> confirm -> playing), console 0 errors. The embedded browser's hidden viewport blocks CDP pointer input, so clicks were dispatched as real DOM `.click()` via script evaluation (React handlers run for real) with the established test-only dice throttle patch -- an environment shape, not a product change.
- Verified: check 0 errors / 291 tests / coverage gates 42/34/34/47 / lint 0 errors 30 legacy warnings (zero new) / build 1,918.71 kB single file (gzip 563.39 kB) / `npm run ai-battle -- --games 300 --seed 1` twice, content-identical (won=300, VIOLATIONS=0). CI remote verification: to be backfilled.

## [2.2.18] - 2026-09-24

Stabilization stage D, first cut (user go-ahead "开始阶段D"; scope questions answered "[No preference]" -> decided as the medium cut): **engine randomness moves into `EngineState.rngState` (decision D-2 core)** -- all in-match draw card selection now flows through one seedable, serializable cursor; legacy compatibility via lazy re-seeding, **no version numbers bumped anywhere** (NETWORK_SNAPSHOT_VERSION / ReplayDocument.version / EngineState.version all stay 1).

- New `src/core/rng.ts` (49 lines): mulberry32 cursor `{ s: uint32 }` as plain data (structuredClone/JSON-safe) with `createRngState` / `cloneRngState` / `rngNext` / `rngShuffle` (returns a new array; replaces the old biased `sort(() => Math.random() - 0.5)` reshuffles).
- `EngineState.rngState?` is an **optional** field so legacy snapshots and old replays still load; `createInitialEngineState` carries a constant seed and the real match re-seeds once at room creation (`gameStateAdapter.seedRngState`: Date.now^random once, never resets a cursor mid-match).
- **DrawResolver converged** (D-2 "no resolver may hold a private random source"): it now only validates (NO_PENDING_DRAW / DRAW_PLAYER_NOT_FOUND / DRAW_TOTAL_MISMATCH) and emits a **count-only** DRAW event (`requestedGeneral/requestedCards/count/reason`) -- zero card selection, zero Math.random. The rewritten test suite swaps Math.random for a throwing probe to prove the ban and asserts resolve purity (same state + action -> identical events).
- **`applyDrawEvent` is now the engine's single draw selection point**: seeded general-pool shuffle, deck-top slice, seeded discard-pile reshuffle; the advanced cursor is written back into the returned state, and `EventProcessor.process`'s single clone-and-thread loop keeps the cursor consistent across multi-event queues. A missing cursor (legacy state) falls back to a deterministic seed derived from turn/round/deck length -- the first draw of an old save is reproducible too. Skill-draw bare-count payloads (SkillTriggerBridge DRAW_CARD) stay compatible untouched.
- AI battles: `buildMatchState` stamps `rngState = createRngState(seed)`, so engine draws come from the state cursor while `withSeededRandom` keeps covering only deck build / pool sampling / policy timing (narrowed, not retired -- retirement is PENDING). Recorded replays now embed the cursor in `initialState`, making rebuild-style playback reproducible (reproducible re-roll; "record outcomes, not re-rolls" itself stays open).
- **Disclosed behavior change**: draw outcomes differ from pre-2.2.18 distributions (seeded shuffle replaces biased sort and the RNG stream split moved) -- expected under D-2. Deck-top order, compensation draws and the revealed-card UI (hand-diff based) are unchanged.
- Tests 268 -> **287 / 35 files** (+19 net): `core/rng.test.ts` 8 (stream determinism, JSON round-trip, shuffle properties), `eventProcessors/drawEvents.test.ts` 8 (state-alone reproducibility, cursor consumed only on random choices, pool/deck/reshuffle settlement, bare-count, legacy lazy seed, multi-event threading, no-ops), `store/executeDraw.rng.test.ts` 3 (production-store room seed, identical state -> identical draw, re-seed changes the draw), DrawResolver.test rewritten to the count-only contract, and two gameFlow smoke assertions switched from "Math.random mock identity shuffle" exact-id checks to faction-purity regex.
- Verified: check 0 errors / 287 tests pass / coverage 42.55/35.14/34.01/47.55 holding gates 42/34/33/47 (all four slightly above the 2.2.17 measurements; floors kept) / lint 0 errors 30 legacy warnings (zero new) / build 1,918.75 kB single file (gzip 563.32 kB) / `npm run ai-battle -- --games 300 --seed 1` twice with **byte-identical summary** (won=300, VIOLATIONS=0, winner split {1:112, 2:188}). **Honest boundary: this cut has NO browser real-click E2E** -- the automation permission classifier refused every page-navigation channel this session, so verification was downgraded to the vitest production-store pipeline (executeDraw.rng + aiTurnDriver full-match) and the on-page draw regression is registered PENDING (§12-16). Remaining D-2 debt (§12-16): RandomOutcome event stream, setup-path randomness migration (createCardDeck/runtimeSetup/matchSetup sampling), action.id/instanceId determinism, withSeededRandom retirement + battleRunner lockstep cleanup. CI backfill (with one real failure disclosed): the docs commit's first run #46 (35974231930, master@265d225) **failed** -- test(22)/test(24) caught TS6133, an unused `createLobbyPlayers` import left in `executeDraw.rng.test.ts` (the local check-green predated that file's final edit; lesson recorded: run the full gate suite only after every file is final). Fix commit 620a0a0 removes the import (zero behavior change, full local suite re-green); with user authorization the v2.2.18 tag was force-repointed from 265d225 to 620a0a0 (that single tag ref only). Push: direct timed out, one-shot 127.0.0.1:10808 proxy succeeded, no persistent config. CI #47 (run 35975699142, master@620a0a0) is **green**: test(22) 1m59s / test(24) 1m3s / lint 1m15s / build 59s, all four jobs completed successfully.

## [2.2.17] - 2026-09-24

Stabilization stage C, first cut (user go-ahead "好吧，做阶段C"): skill coverage completion -- old §12-9 items **b (HEAL/GAIN_ARMOR settlement)** and **d (skill-kill -> DEATH -> onKill/onDeath chain)** closed; **c (ReactionWindow business entry) and the no-engine-event trigger kinds stay PENDING** (scope confirmed up front).

- HEAL / GAIN_ARMOR now settle for real: `core/Event.ts` event union += `HEAL | GAIN_ARMOR`; `eventProcessors/generalEvents.ts` gains two pure handlers -- `applyHealEvent` (heals up to maxHp; an off-field general is an honest no-op) and `applyGainArmorEvent` (currentArmor point-pool accrual, matching the editor preview "获得 N 点护甲"; not physical armor cards); `SkillTriggerBridge` compiles both effects into real events with target resolution; `skillCompiler.SUPPORTED_EFFECT_TYPES` and `skillExcelFormat.SETTLEABLE_RUNTIME_TYPES` now cover all four settleable types (DRAW_CARD/DAMAGE/HEAL/GAIN_ARMOR) -- the editor's "暂未接入结算" label disappears on its own.
- Skill-kill death chain: skill lethality is only knowable at apply time (the trigger chain runs on the pre-dispatch frozen state), so the DAMAGE case of `chainedConsequences` now derives a `DEATH` event (carrying `skillKill: true`, attacker attribution) whenever a `damageType:'skill'` hit removes the target general from the field; the `damageType` gate doubles as the dedupe against AttackResolver's own resolver-side DEATH for normal-attack kills. `EventProcessor.process` gained an optional append-only `collected[]` parameter capturing mid-queue derived events (single-mutation-entry discipline D-2 intact; each DEATH is state-processed exactly once), and `GameEngine.dispatch` re-expands derived DEATHs through the trigger chain in **bounded re-entry rounds** (`MAX_TRIGGER_REENTRY_ROUNDS = 8`, excess flagged as CUSTOM `TRIGGER_REENTRY_LIMIT`).
- Ordering fact pinned by tests: trigger priority onDeath(100) > onKill(60), so on a skill kill the victim's onDeath draw settles before the killer's onKill draw (deck-order consequence, documented in `skillPipeline.test.ts`).
- Tests: `skillCompiler.test.ts` skip-assertion replaced by compile-assertions for both new effect types; 4 new pipeline tests (HEAL cap, GAIN_ARMOR accrual, full skill-kill integration incl. graveyard/both draws/compensation drawState, attack-kill dedupe with exactly 1 DEATH). 264 -> **268 tests / 32 files**. Built-in generals are still descriptive-only (compiler skips them), so existing content sees zero behavior change.
- Coverage ratchet raised to statements>=42 / branches>=34 / functions>=33 / lines>=47 (measured 42.46/35.11/33.85/47.49; branch floor kept one notch under margin due to 35.11-35.28 run jitter).
- Verified: check 0 errors / 268 tests pass / lint 0 errors 30 legacy warnings (zero new) / build 1,918.69 kB single file (gzip 563.24 kB) / `npm run ai-battle -- --games 300 --seed 1` VIOLATIONS=0 (won=300, avg 19ms). Browser E2E (dev 5203, store direct-drive via `__TK__` -- real clicks were refused by the automation environment this round, so the blessed store-drive technique was used and is disclosed as such): formal flow (room -> dice -> draft with baked skillEdits 烈攻/枭斩/疗愈/遗志 -> initial draws) then `restoreEngineState` seeding + **real store actions**: (a) endTurn -> p1 TURN_START settled 疗愈 hp 2->4 (capped) and 固甲 armor 0->2; (b) real `attackTarget` with runtime instanceIds -> melee 2 + 烈攻 skill 3 killed full-HP 许褚 -> graveyard entry, 遗志 onDeath draw (+1 p2), 枭斩 onKill draw (+1 p1), "玩家2 击破补偿抽卡" compensation window rendered and settled, turn ownership resumed in playing; UI snapshot consistent (黄盖 🛡️2 ❤️4/4, 墓地(1)), console 0 errors. Honest boundary: no screenshot (page backgrounded, viewport invisible -- snapshot + console used instead); §12-9c remains open. CI green: run 35965467286 (CI #44, master@926a530, 3m 14s; test(22)/test(24)/lint/build all completed successfully, 268 tests passing on both Node matrices); feat 37fecc1 + docs 926a530 + tag v2.2.17 pushed direct, no proxy needed.
- Decision recorded: per the user (2026-09-24), un-binding closures in the three big UI files is **dropped for good unless a clear benefit appears**.

## [2.2.16] - 2026-09-24

Stabilization stage F, final cut (decision D-6 now closed): `TestArena.tsx` shrunk 485 -> 483 lines via **pure verbatim moves, zero behavior change**.

- `src/components/testArena/compactPrimitives.tsx` (new, 10 lines): the three state-free top-level primitives at TestArena's tail -- SC (stat card) / Bar (bottom floating action bar) / Btn (confirm-cancel button incl. disabled state) -- moved verbatim; TestArena gains one import line.
- Deliberately **not merged** with the board's `gameBoard/uiPrimitives`: same component names but compact CSS variants (p-2 vs p-2.5, text-lg vs text-xl, bottom-[90px] vs bottom-[110px], gap-3 vs gap-4, px-3 py-1 text-xs vs px-4 py-1.5 text-sm). Merging would change styling, i.e. behavior, which breaks the pure-move discipline; the new file header pins this down and any future unification needs its own project item plus visual regression. TestArena has no StatPill/Modal equivalents (its inspect dialog is inline JSX, not a component).
- Scope: `Slot`/`BSlot`/`Territory*`, the three dev-panel tabs and every action handler stay in the component (closures over local and store state); further slimming requires closure disentanglement and a separate project item.
- Verified: check 0 errors / 264 tests pass (32 files, zero add/remove) / coverage flat at 41.90/34.49/33.33/46.93 holding gates 41/34/32/46 / lint 0 errors 30 legacy warnings / build 1,916.59 kB single file (gzip 562.85 kB). Browser real-click E2E in a 4-player test arena, all through the moved primitives: pool search for 廖化 -> add to hand -> hand-tile inspect SC grid (4/2/1/0) -> deploy Bar "登场：廖化 (消耗0/4)" with Btn disabled -> select 4 cost cards -> confirm -> deployTarget Bar -> click green camp slot (hand 6 -> 1) -> field inspect live SC + per-turn counters + melee/ranged/supply disabled states -> advance single-target straight to front:0 -> dev-panel 场上 damage to 3/4 (hit animation fired) -> supply Bar "已选0张" confirm disabled -> pick 1 军粮 -> confirm heals to 4/4 -> counters show move 1 / supply 1 -> player switch -> end turn -> 退出 back to menu; console 0 errors 0 warnings. CI green: run 35952936795 (CI #42, master@3b3bf36; test(22)/test(24)/lint/build all completed successfully); feat 35880e0 + docs 3b3bf36 + tag v2.2.16 pushed direct, no proxy needed.

## [2.2.15] - 2026-09-24

Stabilization stage F, second cut (decision D-6, second of the last-three list): `GameBoard.tsx` shrunk 704 -> 689 lines via **pure verbatim moves, zero behavior change**.

- `src/components/gameBoard/uiPrimitives.tsx` (new, 21 lines): the five stateless presentational primitives at the tail of GameBoard -- SC (stat mini-card), StatPill (count pill with toneMap), Bar (floating action bar), Btn (confirm/cancel button), Modal (overlay skeleton) -- moved verbatim. Disclosed micro-write: one aggregate `export { SC, StatPill, Bar, Btn, Modal }` line added (bodies untouched); `React.ReactNode` resolves via the UMD global type without an import (check 0 errors proves it). Grep (2026-09-24) confirms no other file referenced these primitives.
- Scope note: `Slot` / `BSlot` / `TerritoryBottom/Top/Side`, `arrange()`, all action handlers, memos and effects **stayed** in the component (they close over component state -- further slimming requires closure disentanglement, which is a separate, non-pure work item).
- Verified: check 0 errors / 264 tests pass (32 files, zero add/remove) / coverage ratchet gates 41/34/32/46 hold (measured 41.90/34.49/33.33/46.93, marginal dip from new-file header comments only) / lint 0 errors 30 legacy warnings / build 1,916.59 kB single file. Browser real-click E2E (dev 5203) through the split components on a full formal game (create room -> dice -> factions -> 2x10 draft -> initial draw with 2 generals in hand): general-pool and deck modals with correct StatPill counts, discard/graveyard empty states, hand and field general inspect views with all five SC cards, deploy Bar ("消耗0/4") with Btn disabled->enabled->confirm->target-selection banner->real camp-slot click landing the general, single-target advance move, pause menu save-snapshot/return/reset; console 0 errors.

## [2.2.14] - 2026-09-24

Stabilization stage F, first cut (decision D-6, head of the last-three list): `SkillEditor.tsx` shrunk 1253 -> 868 lines via **pure verbatim moves, zero behavior change**.

- `src/components/skillEditor/skillExcelParsers.ts` (new, 228 lines): all Excel/text import parsers (parseSkillCell / clean / isDetailedFormat / isRowPerSkillFormat / resolveGeneralByNameFaction / parseRowPerSkillSheet / parseLegacyDetailedRow). Disclosed type-only micro-writes: exported `SkillEditEntry` interface replaces five in-component `typeof editingSkills` references (field-for-field identical to the old inline state type; the component useState now uses it too), `export` keywords added (`clean` stays module-private), de-indentation from component scope.
- `src/components/skillEditor/TriggerEditor.tsx` (new, 106 lines): trigger-timing sub-editor incl. `selectCls` (used only there).
- `src/components/skillEditor/RuntimeEditor.tsx` (new, 78 lines): structured runtime editor incl. `runtimeSelectCls` / `runtimePreviewText`.
- `handleImportFile` / `handleExport` / `isIncompleteForExport` intentionally stayed in the component this round (closure over state -- not pure moves); SkillEditor's import surface narrowed accordingly.
- Verified: check 0 errors / 264 tests pass (32 files, zero add/remove) / coverage ratchet gates 41/34/32/46 hold (measured 42.09/34.67/33.45/47.16, flat vs 2.2.13) / lint 0 errors 30 legacy warnings / build 1,916.59 kB single file. Browser real-click E2E through the split components: editor mount, 95-general list, TriggerEditor type -> damage-subtype -> preview -> save -> store holds damageSubType -> batch-delete restore; multi-effect mode -> RuntimeEditor type/value/target -> preview; a real row-per-skill .xlsx injected via the file input and parsed by the moved parsers ("imported 1 general") then stored correctly; Excel export succeeded; console 0 errors.

## [2.2.13] - 2026-09-24

Stabilization stage B, second split (decision D-6): `core/EventProcessor.ts` shrunk 852 -> 93 lines via **pure verbatim moves, zero behavior change**. Single canonical entry (`process` queue loop + `apply` thin dispatcher) preserved; no second entry point.

- `src/core/eventProcessors/damageEvents.ts` (new, 168): BASE_DAMAGE + DAMAGE handlers (incl. skill-damage armor settlement and legacy armor fallback, now at damageEvents.ts:151).
- `src/core/eventProcessors/drawEvents.ts` (new, 178): DRAW_REQUIRED / DRAW (deck selection & reshuffle) / DRAW_CONFIRMED.
- `src/core/eventProcessors/generalEvents.ts` (new, 214): GENERAL_DEPLOYED / GENERAL_MOVED / SUPPLY_RESOLVED / ARMOR_EQUIPPED + RESOURCE_TYPES.
- `src/core/eventProcessors/playerEvents.ts` (new, 77): PLAYER_DEFEATED / GAME_OVER.
- `src/core/eventProcessors/turnEvents.ts` (new, 95): TURN_END / TURN_ACTIONS_RESET / TURN_START / PHASE_CHANGED.
- `src/core/eventProcessors/chainedConsequences.ts` (new, 112): deterministic derived-event enqueue (DAMAGE/DEATH/BASE_DAMAGE/PLAYER_DEFEATED chains) formerly inline in process().
- Verified: check 0 errors / 264 tests pass (32 files, zero add/remove) / coverage ratchet gates 41/34/32/46 hold (measured 42.09/34.67/33.45/47.16, funcs up from 32.84) / lint 0 errors 30 legacy warnings / build 1,916.89 kB single file. Browser smoke via dev-only `__TK__` (real store+engine assembly): createRoom->lobby, startTestArena + 4x endTurn driving TURN_END/TURN_START/DRAW_REQUIRED/DRAW_CONFIRMED/PHASE_CHANGED through split handlers (turn 2->5, round rolls to 2), snapshot create(4,565 chars)+restore true + empty-roomId guard + mismatched-room rejection, wrong developer password rejected; app console 0 unexpected errors (only deliberate negative-probe rejections).

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