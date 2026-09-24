/**
 * Match-assembly tests for the 2.2.8 seat setups (faction picks, explicit
 * general lists with duplicates, seeded determinism) plus the faction-label
 * propagation the balance stats rely on.
 *
 * Since the 2.2.19 D-2 second cut buildMatchState is patchless-deterministic:
 * its own setup cursor stream + seed-stamped ids for cards AND skills, so the
 * tests call it bare and can deep-equal two assemblies of the same config.
 */
import { describe, expect, it } from 'vitest';
import { buildMatchState, defaultMatchConfig, type SeatConfig } from './matchSetup';
import { allFactions, allGenerals, getGeneralsByFaction, type General } from '../data/generals';

const build = (seed: number, overrides: Parameters<typeof defaultMatchConfig>[1]) =>
  buildMatchState(defaultMatchConfig(seed, overrides));

describe('matchSetup seat configs', () => {
  it('every seat carries a valid faction label and a faction-pure pool', () => {
    const state = build(11, { playerCount: 3, poolPerPlayer: 6 });
    expect(state.players).toHaveLength(3);
    for (const p of state.players) {
      expect(allFactions).toContain(p.faction as (typeof allFactions)[number]);
      const pool = p.generalPool as General[];
      expect(pool).toHaveLength(6);
      for (const g of pool) expect(g.faction).toBe(p.faction);
    }
  });

  it('same seed → identical assembly, patchless (full EngineState deep-equal)', () => {
    const a = build(77, { playerCount: 2, poolPerPlayer: 4 });
    const b = build(77, { playerCount: 2, poolPerPlayer: 4 });
    // Cards AND injected skills are seed-stamped, so no process-local counter
    // leaks into state — the whole assembled match must compare equal.
    expect(a).toEqual(b);
    const ids = (p: typeof a) =>
      p.players.flatMap(q => (q.generalPool as General[]).map(g => (g as { instanceId?: string }).instanceId));
    expect(ids(a)[0]).toBe(`ai77_c0`);
  });

  it('explicit faction is honoured and duplicate factions across seats are legal', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏' },
      { faction: '魏' },
      { faction: '蜀' },
    ];
    const state = build(21, { playerCount: 3, poolPerPlayer: 5, seatConfigs });
    expect(state.players.map(p => p.faction)).toEqual(['魏', '魏', '蜀']);
    for (const p of state.players) {
      const pool = p.generalPool as General[];
      expect(pool).toHaveLength(5);
      expect(pool.every(g => g.faction === p.faction)).toBe(true);
    }
  });

  it("blank ('' / null) and bogus faction labels are treated as not-picked", () => {
    const seatConfigs: SeatConfig[] = [{ faction: '' }, { faction: '汉' as never }, { faction: null }];
    const state = build(23, { playerCount: 3, poolPerPlayer: 4, seatConfigs });
    for (const p of state.players) {
      expect(allFactions).toContain(p.faction as (typeof allFactions)[number]);
      expect((p.generalPool as General[]).every(g => g.faction === p.faction)).toBe(true);
    }
  });

  it('explicit general list (with repeats) becomes the seat pool verbatim', () => {
    const seatConfigs: SeatConfig[] = [
      { faction: '魏', generals: ['wei_001', 'wei_001', 'wei_002'] },
    ];
    const state = build(31, { playerCount: 2, poolPerPlayer: 8, seatConfigs });
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(3); // list length wins over poolPerPlayer
    expect(pool.map(g => g.id)).toEqual(['wei_001_p1', 'wei_001_p1', 'wei_002_p1']);
    expect(pool.map(g => g.name)).toEqual([
      allGenerals.find(g => g.id === 'wei_001')!.name,
      allGenerals.find(g => g.id === 'wei_001')!.name,
      allGenerals.find(g => g.id === 'wei_002')!.name,
    ]);
    // stamped deterministic instance ids keep replay comparable
    expect(new Set(pool.map(g => (g as { instanceId?: string }).instanceId)).size).toBe(3);
  });

  it('generals without an explicit faction derive the label from the first pick; unknown ids are dropped', () => {
    const wu = getGeneralsByFaction('吴')[0];
    const seatConfigs: SeatConfig[] = [
      { generals: [`not_a_general_${Date.now()}`, wu.id] as string[] },
    ];
    // unknown id filtered first → faction label from the surviving first general
    const state = build(41, { playerCount: 2, seatConfigs });
    expect(state.players[0].faction).toBe(wu.faction);
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe(`${wu.id}_p1`);
  });

  it('faction pools smaller than poolPerPlayer wrap around into duplicates', () => {
    const smallest = [...allFactions].sort(
      (a, b) => getGeneralsByFaction(a).length - getGeneralsByFaction(b).length,
    )[0];
    const supply = getGeneralsByFaction(smallest).length;
    const state = build(51, {
      playerCount: 2,
      poolPerPlayer: supply + 3,
      seatConfigs: [{ faction: smallest }, { faction: smallest }],
    });
    const pool = state.players[0].generalPool as General[];
    expect(pool).toHaveLength(supply + 3);
    const unique = new Set(pool.map(g => g.id));
    expect(unique.size).toBe(supply); // every definition used, extras are repeats
  });
});
