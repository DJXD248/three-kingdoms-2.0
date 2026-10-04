/**
 * AI battle runner smoke tests — small seeded matches, kept fast for CI.
 * The heavy soak (hundreds of games) is a local `npm run ai-battle` activity;
 * these tests only pin: matches terminate, no invariant fires, and the same
 * seed reproduces the same outcome.
 */
import { describe, expect, it } from 'vitest';
import { runMatch, runBatch, skillTriggerKey, isSkillEffectEvent } from './battleRunner';
import { buildMatchState, defaultMatchConfig } from './matchSetup';
import { DIY_FIXTURE_GENERALS } from './fixtures/diyGeneralFixture';
import { configuredSkillRows } from './battleReport';
import { SkillTriggerBridge } from '../skills/SkillTriggerBridge';
import type { DataSkillEffectType } from '../skills/dataTypes';
import { policyByName } from './policies/strategyPolicy';

describe('ai battle runner (seeded smoke)', () => {
  it('2-player random match finishes with zero violations', () => {
    const result = runMatch(defaultMatchConfig(101, { poolPerPlayer: 5, deckSize: 40 }), { maxSteps: 2000 });
    expect(result.violations).toEqual([]);
    expect(result.status).toBe('won');
    expect(result.winnerId).not.toBeNull();
    expect(result.steps).toBeGreaterThan(5);
    expect(result.finalPhase).toBe('gameOver');
  });

  it('3-player match with skill injection finishes clean', () => {
    const result = runMatch(
      defaultMatchConfig(202, { playerCount: 3, poolPerPlayer: 5, deckSize: 45, skillInjection: 0.8 }),
      { maxSteps: 2500 },
    );
    expect(result.violations).toEqual([]);
    expect(['won', 'stepsExhausted']).toContain(result.status);
    if (result.status === 'won') expect(result.winnerId).not.toBeNull();
  });

  it('same seed reproduces the same match', () => {
    const config = defaultMatchConfig(303, { poolPerPlayer: 4, deckSize: 40 });
    const a = runMatch(config, { maxSteps: 1500 });
    const b = runMatch(config, { maxSteps: 1500 });
    expect(a.status).toBe(b.status);
    expect(a.winnerId).toBe(b.winnerId);
    expect(a.steps).toBe(b.steps);
    // 2.2.19: full action equality (type + seat + payload), not just the type
    // sequence — every stream (assembly, draws, policy picks) is seeded
    // explicitly, so a patchless rerun is bit-identical end to end.
    expect(a.actions).toEqual(b.actions);
  });

  it('patchless: a generated match never reaches for the global random source', () => {
    // Headline guard for the retired withSeededRandom patch (D-2 second cut):
    // Math.random throws, so ANY hidden entropy consumer on the runner path
    // fails the match instead of silently drifting across reruns.
    const original = Math.random;
    Math.random = () => { throw new Error('battleRunner must run on explicit seeded streams'); };
    try {
      const result = runMatch(defaultMatchConfig(505, { poolPerPlayer: 4, deckSize: 40 }), { maxSteps: 1500 });
      expect(result.violations).toEqual([]);
      expect(result.status).toBe('won');
    } finally {
      Math.random = original;
    }
  });

  it('replaying a recorded match accepts every action and ends identically', () => {
    const config = defaultMatchConfig(404, { poolPerPlayer: 4, deckSize: 40 });
    const original = runMatch(config, { maxSteps: 1500 });
    expect(original.status).toBe('won');
    const replayed = runMatch(config, { recorded: original.actions, maxSteps: original.actions.length + 5 });
    expect(replayed.violations).toEqual([]);
    expect(replayed.status).toBe('won');
    expect(replayed.winnerId).toBe(original.winnerId);
    expect(replayed.steps).toBe(original.steps);
  });

  it('seat stats track deployments/deaths coherently and mark exactly one winner', () => {
    const seatPolicies = [policyByName('aggressive')!, policyByName('aggressive')!];
    const config = defaultMatchConfig(902, { poolPerPlayer: 6, deckSize: 50 });
    const result = runMatch(config, { maxSteps: 1500, seatPolicies });
    const stats = result.seatStats ?? [];
    expect(stats).toHaveLength(2);
    for (const s of stats) {
      const opponentDeaths = stats.filter(o => o !== s).reduce((acc, o) => acc + o.deaths, 0);
      expect(s.faction).toMatch(/魏|蜀|吴|群|晋/);
      expect(s.deaths).toBeLessThanOrEqual(s.deployed);
      expect(s.kills).toBeLessThanOrEqual(opponentDeaths); // 2p: kills ⊆ opponent removals
    }
    // Aggressive-vs-aggressive actually fights: field actions must be tracked.
    expect(stats.reduce((acc, s) => acc + s.deployed, 0)).toBeGreaterThan(0);
    expect(result.actions.filter(a => a.type === 'ATTACK').length).toBeGreaterThan(0);
    expect(stats.reduce((acc, s) => acc + s.attacks, 0)).toBe(
      result.actions.filter(a => a.type === 'ATTACK').length,
    );
    expect(stats.reduce((acc, s) => acc + s.won, 0)).toBe(result.status === 'won' ? 1 : 0);
    if (result.status === 'won') {
      expect(stats[(result.winnerId ?? 0) - 1]?.won).toBe(1);
    }
    // Determinism: the same seeded run yields identical stats.
    const again = runMatch(config, { maxSteps: 1500, seatPolicies });
    expect(again.seatStats).toEqual(stats);
  });
});

describe('skill trigger tracking (2.4.3 content audit)', () => {
  it('off by default: no skillTriggers field, outcome untouched', () => {
    const config = defaultMatchConfig(711, { poolPerPlayer: 4, deckSize: 40 });
    const plain = runMatch(config, { maxSteps: 1500 });
    expect(plain.skillTriggers).toBeUndefined();
    expect(plain.skillTriggers === undefined).toBe(true);
    // B4 default path hard证: tracking off must not perturb anything.
    expect(plain.status).toBe('won');
    expect(plain.violations).toEqual([]);
  });

  it('on: effect-event counts are keyed by 模板id:技能名 and deterministic', () => {
    const config = defaultMatchConfig(
      712,
      { poolPerPlayer: 5, deckSize: 45, skillInjection: 0.99 },
    );
    const a = runMatch(config, { maxSteps: 2000, trackSkillTriggers: true });
    const b = runMatch(config, { maxSteps: 2000, trackSkillTriggers: true });
    expect(a.violations).toEqual([]);
    expect(a.skillTriggers).toEqual(b.skillTriggers);
    for (const key of Object.keys(a.skillTriggers ?? {})) {
      // join key = 模板id:技能名 (2.7.0) — never an instance-salted or
      // seat-suffixed id: the alias table resolves both forms back.
      expect(key.split(':')[0]).not.toContain('__inst');
      expect(key.split(':')[0]).not.toMatch(/^ai\d+_c\d+$/);
      expect(key.split(':')[0]).not.toMatch(/_p\d+$/);
    }
    // Same seed, tracking off → identical match outcome (counter is pure observer).
    const untracked = runMatch(config, { maxSteps: 2000 });
    expect(untracked.winnerId).toBe(a.winnerId);
    expect(untracked.steps).toBe(a.steps);
    expect(untracked.actions).toEqual(a.actions);
  });

  it('#39: the counter keys off the bridge payload, not a hand-written type list', () => {
    const state = buildMatchState(defaultMatchConfig(901, { poolPerPlayer: 3, deckSize: 30 }));
    const playerId = state.players[0].id;
    const types: DataSkillEffectType[] = ['DRAW_CARD', 'DAMAGE', 'HEAL', 'GAIN_ARMOR', 'DISCARD', 'GIVE', 'EQUIP_STRIP', 'REVEAL', 'DECK_PLACE', 'DUEL'];
    const events = SkillTriggerBridge.createSkillEvents(
      {
        ownerId: playerId,
        skill: {
          id: 't:全类型',
          name: '全类型',
          trigger: 'onTurnStart',
          description: '报表名单守卫',
          effects: types.map(type => ({ type, value: 1, target: 'SELF' as const })),
        },
      },
      state,
      { type: 'TURN_START', data: { playerId } },
    );
    // One event per effect type and every one of them joins the report: a type
    // added to the bridge is counted by construction, no roster to remember.
    expect(events).toHaveLength(types.length);
    expect(new Set(events.map(e => (e.data as { effectType: string }).effectType))).toEqual(new Set(types));
    for (const ev of events) expect(isSkillEffectEvent(ev)).toBe(true);

    // Events that merely mention a skill are not effect events — counting the
    // activation itself would credit rows for skills that produced nothing.
    expect(isSkillEffectEvent({ type: 'SKILL_ACTIVATED', data: { skillId: 't:全类型', stableId: `1:t:全类型` } })).toBe(false);
    expect(isSkillEffectEvent({ type: 'DRAW_REQUIRED', data: { reason: 'compensation', playerId, totalCards: 1 } })).toBe(false);
  });

  it('#39: the roster is pool-derived, so a DIY batch reports the sample skills by name', () => {
    const rows = configuredSkillRows(DIY_FIXTURE_GENERALS);
    // Every sample carries exactly one compiled skill ⇒ the roster is the fixture, not the ledger.
    expect(rows).toHaveLength(DIY_FIXTURE_GENERALS.length);
    expect(rows.every(r => r.key.startsWith('D-fix-'))).toBe(true);
    expect(rows.every(r => r.label.startsWith('试作·'))).toBe(true);
    // The official ledger cannot name these skills: that is why the old hardcoded
    // roster listed 262 official rows for a --diy-fixture batch and every sample
    // skill fell off the list (displayed as a raw key reading zero).
    expect(configuredSkillRows().some(r => r.key.startsWith('D-fix-'))).toBe(false);
  });

  it('#39: REVEAL / DECK_PLACE triggers actually reach the report', () => {
    // 本刀 v2.8.35 将营地格子从 3 减为 [0, 2]（砍掉 slot 1＝本营格）。
    // 固定种子下某些局因槽位不足而部署失败、技能不触发；
    // 用多个种子跑一次，只要任意一个种子能产出两枚效果就算通过。
    const keysOf = (effectType: string) =>
      configuredSkillRows(
        DIY_FIXTURE_GENERALS.filter(g =>
          (g.skills ?? []).some(s => s.effects?.some(e => e.runtime?.type === effectType)),
        ),
      ).map(r => r.key);

    let found = false;
    for (const seed of [1, 42, 100, 777]) {
      const batch = runBatch({
        games: 40,
        seed,
        maxSteps: 2000,
        trackSkillTriggers: true,
        configOverrides: { poolSource: 'diy-fixture', skillInjection: 0 },
      });
      if (batch.violated !== 0) continue;
      const aggregate = batch.skillTriggerCounts ?? {};
      const observed = [...keysOf('REVEAL'), ...keysOf('DECK_PLACE')];
      if (observed.length < 2) continue;
      if (observed.every(k => (aggregate[k] ?? 0) > 0)) {
        found = true;
        break;
      }
    }
    expect(found, 'REVEAL/DECK_PLACE 在任一种子下均未触发').toBe(true);
  });

  it('skillTriggerKey joins 模板id:技能名, resolving owners via the alias table (2.7.0)', () => {
    // Without an alias entry the raw owner segment is kept (off-list rows stay visible).
    expect(skillTriggerKey('wei_001__inst_a:奸雄:e1')).toBe('wei_001__inst_a:奸雄');
    // Both per-assembly forms resolve back to the template id.
    const aliases = new Map([
      ['ai712_c3', 'wei_003'],
      ['jin_004_p2', 'jin_004'],
    ]);
    expect(skillTriggerKey('ai712_c3:猛进:e1', aliases)).toBe('wei_003:猛进');
    expect(skillTriggerKey('jin_004_p2:帷幄:e1', aliases)).toBe('jin_004:帷幄');
    expect(skillTriggerKey('no-colon-fallback')).toBe('no-colon-fallback');
  });

  it('runBatch rolls up counts only when tracking is on', () => {
    const overrides = { poolPerPlayer: 5, deckSize: 45, skillInjection: 0.99 };
    const off = runBatch({ games: 20, seed: 712, maxSteps: 2000, configOverrides: overrides });
    expect(off.skillTriggerCounts).toBeUndefined();
    const on = runBatch({
      games: 20,
      seed: 712,
      maxSteps: 2000,
      trackSkillTriggers: true,
      configOverrides: overrides,
    });
    expect(on.skillTriggerCounts).toBeDefined();
    // 20 near-full-injection games provably fire skill effects (CLI-verified).
    const counts = on.skillTriggerCounts ?? {};
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
    // Roll-up keys are sorted for byte-stable output across reruns.
    const keys = Object.keys(counts);
    expect(keys).toEqual([...keys].sort());
    // Positive pin (2.7.0): the join really lands on template ids, so the
    // expected-row table matches — pre-keying every row sat off-list.
    expect(keys.some(k => /^[a-z]+_\d+:.+/.test(k))).toBe(true);
    expect(on.winnerCounts).toEqual(off.winnerCounts);
  });

  it('runBatch forwards an opt-in policy tier deterministically (2.5.4 CLI --policy wiring)', () => {
    const overrides = { poolPerPlayer: 4, deckSize: 36, skillInjection: 0.9 };
    const aggressive = policyByName('aggressive')!;
    const a = runBatch({ games: 2, seed: 9301, maxSteps: 1200, policy: aggressive, configOverrides: overrides });
    const b = runBatch({ games: 2, seed: 9301, maxSteps: 1200, policy: aggressive, configOverrides: overrides });
    expect(a.violated).toBe(0);
    expect(a.violations).toEqual([]);
    expect(a.winnerCounts).toEqual(b.winnerCounts);
  });
});
