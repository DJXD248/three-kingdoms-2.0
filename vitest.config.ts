import { defineConfig } from 'vitest/config';
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
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
      thresholds: {
        lines: 27,
        functions: 16,
        branches: 19,
        statements: 23,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
