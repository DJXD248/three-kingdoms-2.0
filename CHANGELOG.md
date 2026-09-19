# Changelog

All notable changes to this project will be documented in this file.

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
- Removed start.bat (legacy startup script)

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