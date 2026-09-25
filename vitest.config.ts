import { defineConfig } from 'vitest/config';
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node 24 + vitest 5.0.1: the default forks/threads worker bootstrap loses the
// collector context ("Cannot read properties of undefined (reading 'config')"
// in every describe). vmThreads runs modules in an in-process VM context where
// the state is reachable, and the full suite passes there. Keep CI (Node 20/22)
// on the default pool untouched by switching only on Node >= 24.
const nodeMajor = Number(process.versions.node.split('.')[0] || 0);

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    pool: nodeMajor >= 24 ? 'vmThreads' : undefined,
    // scripts/preflight-build.test.mjs: v2.3.3 (D-7) build 防呆脚本的守卫测试随脚本同目录登记。
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/App.tsx',
      ],
      // Ratchet baseline: floors sit just below current coverage so CI fails
      // on regression and can only be raised as new tests land.
      // Raised during the Phase 5 skill uniqueness convergence (skill chain tests).
      // 2.2.0 (skillExcelFormat + editor runtime smoke): overall lines 31.0 / funcs 19.4 / branches 22.3 / stmts 26.4.
      // 2.2.2 (core gameplay flow tests, src/core/gameFlow.test.ts): stmts 29.87 / branch 25.13 / funcs 21.93 / lines 35.04.
      // Phase-1 AI (legalActions enumerator + consistency tests): stmts 33.2 / branch 27.63 / funcs 24.15 / lines 38.39.
      // 2.2.4 (AI-vs-AI battle runner: seeded matches, invariants, replay): stmts 35.63 / branch 29.52 / funcs 25.89 / lines 40.93.
      // 2.2.7 (three-tier strategy policies + arena): stmts 37.11 / branch 31.36 / funcs 28.09 / lines 41.83.
      // 2.2.8 (faction balance stats + seat picks + dock table test): stmts 38.1 / branch 31.93 / funcs 29.01 / lines 42.88.
      // 2.2.9 (human-vs-AI driver: full store-level AI match tests): stmts 41.43 / branch 34.55 / funcs 32.33 / lines 46.47.
      // 2.2.17 (Stage C skill coverage: HEAL/GAIN_ARMOR settlement + skill-kill DEATH chain tests): stmts 42.46-42.66 / branch 35.11-35.28 / funcs 33.85-33.97 / lines 47.49-47.72. Branch floor kept at 34 (run-to-run jitter).
      // 2.2.19 (D-2 second cut: setup-cursor + patchless-runner determinism tests): stmts 42.61-42.81 / branch 35.19-35.54 / funcs 34.26-34.45 / lines 47.59-47.84. Funcs floor raised; branch kept at 34 for jitter headroom (same call as 2.2.17).
      // 2.2.20 (D-1 TransitionCore extraction + resident-vs-rebuilt reconciliation tests): stmts 42.83 / branch 35.26 / funcs 34.36 / lines 47.87. Floors held (all within jitter headroom of 2.2.19 measurements).
      // 2.2.21 (D-1 second cut: store resident container + adopt-clone/resync guards, 4-path reconciliation): stmts 43.30 / branch 35.52 / funcs 34.95 / lines 48.40. Floors held; branch -0.02 vs 2.2.20 is denominator drift, still 1.5pt above floor.
      thresholds: {
        lines: 47,
        functions: 34,
        branches: 34,
        statements: 42,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
