/**
 * AiBattleDock smoke test (2.2.8): the completion notice must render the new
 * per-faction balance table (胜率 / 死亡率 / 击杀率) from a real-shaped
 * `qoder-ai-battle-done` window message, and stay hidden without developer
 * mode. This closes the pixel gap left by the embedded-browser E2E, where the
 * battle popup could not be kept as a separate opener tab.
 *
 * Note on timing: `window.postMessage` dispatches its `message` event on a
 * later task, and under the vmThreads pool a single 0ms timeout is not enough
 * for it to land (the update leaked into the following test). `deliver()`
 * therefore waits two short ticks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import AiBattleDock from './AiBattleDock';
import { useGameStore } from '../store/gameStore';

const SUMMARY = {
  games: 20,
  won: 20,
  exhausted: 0,
  violated: 0,
  violationTotal: 0,
  winnerCounts: { '1': 20 },
  totalMs: 640,
  avgMs: 32,
  slowestMs: 96,
  factionStats: [
    { faction: '魏', seats: 20, wins: 20, deployed: 23, deaths: 3, kills: 7, attacks: 22 },
    { faction: '蜀', seats: 20, wins: 0, deployed: 63, deaths: 63, kills: 3, attacks: 20 },
  ],
};

const doneMessage = (factionStats: unknown[] = SUMMARY.factionStats) => ({
  kind: 'qoder-ai-battle-done',
  params: { players: 2, seed: 1, seats: [], games: 20 },
  summary: { ...SUMMARY, factionStats },
  artifacts: { logText: 'x', replayJson: '{}', failures: [] },
  reportedAt: 0,
});

const bodyText = () => document.body.textContent ?? '';

async function deliver(message: unknown) {
  // `act` lets the message event fire *and* the resulting setState flush
  // inside React's testing queue, so no "not wrapped in act" noise leaks out.
  await act(async () => {
    window.postMessage(message, '*');
    await new Promise(r => setTimeout(r, 20)); // message event fires
    await new Promise(r => setTimeout(r, 20)); // React flushes the state update
  });
}

describe('AiBattleDock faction balance table', () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    useGameStore.setState({ developerMode: false });
  });

  it('renders one rate row per faction after a done message (developer mode on)', async () => {
    useGameStore.setState({ developerMode: true });
    render(<AiBattleDock />);
    await deliver(doneMessage());

    const text = bodyText();
    expect(text).toContain('结束简报');
    expect(text).toContain('势力平衡');
    expect(text).toContain('100.0%'); // 魏 胜率 20/20 · 蜀 死亡率 63/63
    expect(text).toContain('13.0%'); // 魏 死亡率 3/23
    expect(text).toContain('31.8%'); // 魏 击杀率 7/22
    expect(text).toContain('15.0%'); // 蜀 击杀率 3/20
    expect(text).toContain('0.0%'); // 蜀 胜率 0/20
  });

  it('renders nothing while developer mode is off', async () => {
    useGameStore.setState({ developerMode: false });
    const view = render(<AiBattleDock />);
    await deliver(doneMessage());
    expect(bodyText()).not.toContain('结束简报');
    view.unmount();
  });

  it('tolerates legacy payloads without factionStats (brief shows, table does not)', async () => {
    useGameStore.setState({ developerMode: true });
    render(<AiBattleDock />);
    await deliver(doneMessage([]));

    const text = bodyText();
    expect(text).toContain('结束简报');
    expect(text).not.toContain('势力平衡');
  });
});
