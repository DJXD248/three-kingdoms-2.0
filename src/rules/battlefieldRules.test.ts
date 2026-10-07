/**
 * 界面那份"能打的名单"与引擎那道闸必须同判据（v2.9.0 射程刀）。
 *
 * 这一档钉的不是距离数学（那是 `core/attackReach.test.ts` 的活），而是**两个出口
 * 共用一个判据**之后再不许分叉：
 *  ① 名单里每一个目标，直接扔给引擎都收（不打回 `ACTION_REJECTED`）。
 *  ② 名单里没列的每一个敌方目标，直接扔给引擎都拒，而且拒的理由还是原来那两个
 *    （同席位＝`INVALID_ATTACK_TARGET`、够不着＝`TARGET_OUT_OF_RANGE`）——闸的顺序没动。
 *  ③ 自家席位一员都不列（补的旧缺口：旧名单只排除"出手的这一员自己"，队友照样进名单，
 *    点上去就是一笔被引擎当场拒掉的攻击）。引擎那一侧一直拒着同席目标，所以这次是
 *    **名单向引擎对齐**，不是新增一条规则（判据＝§12-111⑩ 的反方向实例）。
 *  ④ 账本上的射程同时改变名单与闸，两者步调一致（+1 多出来的那一格，两边同时多）。
 */
import { describe, it, expect } from 'vitest';
import { getValidTargets } from './battlefieldRules';
import type { FieldGeneral, Player } from '../store/gameStore';
import type { EnginePlayer, EngineState } from '../core/GameState';
import { GameEngine } from '../core/GameEngine';
import { createAction } from '../action/ActionTypes';
import { addModifier } from '../core/statModifiers';
import type { StatModifier } from '../core/statModifiers';

type Zone = 'camp' | 'front' | 'battle';
interface Spot { zone: Zone, areaOwnerId: number | null }

/** 七格＝三席的营地/前线（各两块）＋共用的战场。站位与席位刻意允许不一致
 *  （"我的将站在别人那片"正是旧表从没被测过的那一角）。 */
const SPOTS: Spot[] = [
  { zone: 'camp', areaOwnerId: 1 }, { zone: 'front', areaOwnerId: 1 },
  { zone: 'camp', areaOwnerId: 2 }, { zone: 'front', areaOwnerId: 2 },
  { zone: 'camp', areaOwnerId: 3 }, { zone: 'front', areaOwnerId: 3 },
  { zone: 'battle', areaOwnerId: null },
];

const ATTACK_COST = { id: 'cost_1', name: '粮草', type: '粮草' as const, description: '攻击花费' };

function fg(seat: number, spot: Spot, index: number): FieldGeneral {
  const general = {
    id: `s${seat}p${index}`, name: `将${seat}-${index}`, faction: '蜀', hp: 4, type: '武将',
    meleeAtk: 2, rangedAtk: 1, armor: 0, skills: [],
  } as any;
  return {
    general, currentHp: 4, maxHp: 4, meleeAtk: 2, rangedAtk: 1, armor: 0,
    currentArmor: 0, armorCards: [], isArming: false,
    hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
    ownerId: seat, position: { zone: spot.zone, slot: 0, areaOwnerId: spot.areaOwnerId },
  };
}

interface Scenario { attacker: FieldGeneral, players: Player[] }

function scenario(attackerSpot: Spot, seats: number[] = [1, 2, 3], spots: Spot[] = SPOTS): Scenario {
  const players: Player[] = seats.map(seat => ({
    id: seat, name: `P${seat}`, faction: '蜀', seatOrder: seat, diceRoll: 0,
    generalPool: [], hand: seat === 1 ? [ATTACK_COST] : [],
    fieldGenerals: spots.map((spot, index) => fg(seat, spot, index)),
    baseHp: 10, baseMaxHp: 10, isAlive: true, isSpectating: false,
    avatarGeneral: null, graveyard: [],
  }));
  const index = spots.findIndex(s => s.zone === attackerSpot.zone && s.areaOwnerId === attackerSpot.areaOwnerId);
  expect(index, `出手位不在给定的格子里：${attackerSpot.zone}/${attackerSpot.areaOwnerId}`).toBeGreaterThanOrEqual(0);
  const attacker = players[0].fieldGenerals[index];
  return { attacker, players };
}

/** 名单与引擎共用同一份场上事实：引擎那一侧就是把 store 的 FieldGeneral 原样搬过去。 */
function baseState(scn: Scenario, ledger?: StatModifier[]): EngineState {
  const players: EnginePlayer[] = scn.players.map(p => ({
    id: p.id, name: p.name, hp: 4, hand: [...p.hand] as any[], generalPool: [],
    fieldGenerals: p.fieldGenerals.map(f => ({ ...f, position: { ...f.position } })),
    graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
  })) as unknown as EnginePlayer[];
  return {
    version: 1, phase: 'playing', timelinePhase: 'ACTION', players,
    currentPlayerId: 1, turn: 1, round: 1,
    deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
    discardPile: [], drawState: null,
    ...(ledger ? { statModifiers: ledger } : {}),
  };
}

/** 引擎收不收这一笔；不收时把理由一起带回来（被拒的落点状态必然没动，故可以复用同一份底账）。 */
function verdict(state: EngineState, attackerId: string, targetId: string, ranged: boolean): 'accepted' | string {
  const engine = new GameEngine(structuredClone(state));
  const events = engine.dispatch(
    createAction('ATTACK', 1, { attackerId, targetId, ranged, consumeCard: ATTACK_COST }),
  );
  const rejected = events.find(e => e.type === 'ACTION_REJECTED') as any;
  return rejected ? String(rejected.data.reason) : 'accepted';
}

function rangeLedger(generalId: string, value: number, mode: 'delta' | 'set'): StatModifier[] {
  return addModifier([], {
    key: 'RANGE', mode, value,
    targetPlayerId: 1, targetId: generalId,
    ownerPlayerId: 1, ownerGeneralId: generalId, ownerSkillId: 'sk-range',
    locked: false, passive: true,
  });
}

const spotLabel = (s: Spot) => `${s.zone}/${s.areaOwnerId}`;

describe('名单 ↔ 引擎：两个出口同判据', () => {
  const kinds = [
    { name: '无射程账（默认档 2）', make: null as null | ((id: string) => StatModifier[]) },
    { name: '射程 +1（档 3）', make: (id: string) => rangeLedger(id, 1, 'delta') },
    { name: '射程固定为 1（远程结构性为空）', make: (id: string) => rangeLedger(id, 1, 'set') },
    { name: '射程固定为 4（拉到最远）', make: (id: string) => rangeLedger(id, 4, 'set') },
  ];

  for (const spot of SPOTS) {
    for (const ranged of [false, true]) {
      for (const kind of kinds) {
        it(`出手位 ${spotLabel(spot)}｜${ranged ? '远程' : '近战'}｜${kind.name}`, () => {
          const scn = scenario(spot);
          const attackerId = scn.attacker.general.id;
          const ledger = kind.make ? kind.make(attackerId) : undefined;
          const listed = getValidTargets(scn.attacker, scn.players, ranged, ledger);
          const listedIds = new Set(listed.map(t => t.id));
          const state = baseState(scn, ledger);

          const mismatches: string[] = [];
          for (const player of scn.players) {
            for (const target of player.fieldGenerals) {
              const id = target.general.id;
              const got = verdict(state, attackerId, id, ranged);
              const accepted = got === 'accepted';
              if (accepted !== listedIds.has(id)) {
                mismatches.push(`${id}（席位${player.id}）：名单${listedIds.has(id) ? '列了' : '没列'}，引擎给 ${got}`);
              }
            }
            const baseId = `base_${player.id}`;
            const got = verdict(state, attackerId, baseId, ranged);
            if ((got === 'accepted') !== listedIds.has(baseId)) {
              mismatches.push(`${baseId}：名单${listedIds.has(baseId) ? '列了' : '没列'}，引擎给 ${got}`);
            }
          }
          expect(mismatches, `${spotLabel(spot)}｜${ranged ? '远程' : '近战'}｜${kind.name}`).toEqual([]);
          // 出手的这一员自己绝不在名单里。
          expect(listedIds.has(attackerId)).toBe(false);
        });
      }
    }
  }
});

describe('拒绝的理由还是原来那两个（闸的顺序没被这一刀动过）', () => {
  const scn = scenario({ zone: 'camp', areaOwnerId: 1 });
  const state = baseState(scn);

  it('同席位的队友＝INVALID_ATTACK_TARGET，够不着的敌人＝TARGET_OUT_OF_RANGE', () => {
    // 自家前线那一格（档 1）：远程本来就够不着，理由是够不着。
    expect(verdict(state, 's1p0', 's1p1', true)).toBe('INVALID_ATTACK_TARGET');   // 同席位先拦
    expect(verdict(state, 's1p0', 's2p0', true)).toBe('TARGET_OUT_OF_RANGE');      // 敌营地，档 4
    expect(verdict(state, 's1p0', 'base_2', true)).toBe('INVALID_ATTACK_TARGET');  // 营地行沿用旧理由
    // 近战：同片区域收、隔两块拒。
    expect(verdict(state, 's1p0', 's2p1', false)).toBe('accepted');                // 自家前线（档 1）
    expect(verdict(state, 's1p0', 's2p2', false)).toBe('TARGET_OUT_OF_RANGE');     // 敌营地（档 4）
  });
});

describe('射程把名单拉长（名单与闸一起变，不是一边变）', () => {
  // 这一档用两席棋盘（自家营地/自家前线/敌营地/敌前线/战场），梯级才读得懂。
  const TWO_SEAT_SPOTS: Spot[] = [
    { zone: 'camp', areaOwnerId: 1 }, { zone: 'front', areaOwnerId: 1 },
    { zone: 'camp', areaOwnerId: 2 }, { zone: 'front', areaOwnerId: 2 },
    { zone: 'battle', areaOwnerId: null },
  ];
  const ownCamp: Spot = TWO_SEAT_SPOTS[0];
  const scn = scenario(ownCamp, [1, 2], TWO_SEAT_SPOTS);
  const state2 = baseState(scn);
  const plus1 = rangeLedger('s1p0', 1, 'delta');
  const ids = (ledger?: StatModifier[]) =>
    getValidTargets(scn.attacker, scn.players, true, ledger).map(t => t.id).sort();

  it('自家营地出手的远程：射程 2 只列战场，+1 才多列敌前线，+2 才够到敌营地与营地', () => {
    expect(ids()).toEqual(['s2p4']);                                        // 战场
    expect(ids(plus1)).toEqual(['s2p3', 's2p4']);                           // + 敌前线
    expect(ids(rangeLedger('s1p0', 2, 'delta'))).toEqual(['base_2', 's2p2', 's2p3', 's2p4']); // + 敌营地/营地
  });

  it('名单多出来的那一格，引擎也当场收（射程不是界面自嗨）', () => {
    expect(verdict(state2, 's1p0', 's2p3', true)).toBe('TARGET_OUT_OF_RANGE');
    expect(verdict(baseState(scn, plus1), 's1p0', 's2p3', true)).toBe('accepted');
  });

  it('射程摁成 1 ⇒ 远程名单空、远程一律拒；近战名单一字不变', () => {
    const clamped = rangeLedger('s1p0', 1, 'set');
    expect(getValidTargets(scn.attacker, scn.players, true, clamped)).toEqual([]);
    expect(verdict(baseState(scn, clamped), 's1p0', 's2p4', true)).toBe('TARGET_OUT_OF_RANGE');
    const melee = getValidTargets(scn.attacker, scn.players, false).map(t => t.id).sort();
    expect(melee).toEqual(['s2p0', 's2p1']);
    expect(getValidTargets(scn.attacker, scn.players, false, clamped).map(t => t.id).sort()).toEqual(melee);
    expect(getValidTargets(scn.attacker, scn.players, false, rangeLedger('s1p0', 9, 'delta')).map(t => t.id).sort()).toEqual(melee);
  });
});

describe('旧缺口：同席队友不再进名单', () => {
  const scn = scenario({ zone: 'battle', areaOwnerId: null });

  it('站在战场上：自家那一头的营地按档 2 算够得着，但名单一员都不列自家席位', () => {
    expect(scn.attacker.general.id).toBe('s1p6');
    for (const ranged of [false, true]) {
      const listed = getValidTargets(scn.attacker, scn.players, ranged);
      expect(listed.filter(t => t.playerId === 1)).toEqual([]);
    }
    // 敌方那一侧一格不少（证明席位过滤没有把名单砍空）：远程从战场只够得着两头的营地。
    const ranged = getValidTargets(scn.attacker, scn.players, true).map(t => t.id).sort();
    expect(ranged).toEqual(['base_2', 'base_3', 's2p0', 's2p2', 's2p4', 's3p0', 's3p2', 's3p4']);
    // 近战从战场够得着两片前线和战场本身，够不着任何营地。
    const melee = getValidTargets(scn.attacker, scn.players, false).map(t => t.id).sort();
    expect(melee).toEqual(['s2p1', 's2p3', 's2p5', 's2p6', 's3p1', 's3p3', 's3p5', 's3p6']);
  });

  it('名单砍掉的这些目标，引擎本来就一直拒（对齐的是名单，不是新增规则）', () => {
    // 自家营地那员队友从战场上量是档 2＝远程"够得着"，引擎按席位拒。
    expect(verdict(baseState(scn), 's1p6', 's1p0', true)).toBe('INVALID_ATTACK_TARGET');
    expect(verdict(baseState(scn), 's1p6', 's1p4', true)).toBe('INVALID_ATTACK_TARGET');
  });
});

/**
 * 上面那些账本是我照着账本形状写的；这一段**不写账本**——把一枚带「在场即射程＋2」
 * 的将交回引擎自己登场，看它落的那一笔能不能把远端那一格从"拒"翻成"收"。
 * 这条链的四个环节（登场→落笔→名单→闸）此前各有一段证人，但没有一条测试把它们
 * 串成一笔，所以"射程这把钥匙只在注册表上是一行字"这个风险没人挡（同 §12-112：
 * 能写出来还得真管事）。
 */
describe('射程那笔账可以由引擎自己落（真登场→账本→名单→闸）', () => {
  const DEPLOY_COST = { id: 'cost_2', name: '材料', type: '材料' as const, description: '登场花费' };

  function rangeGeneral(withRange: boolean) {
    return {
      id: 'rng', instanceId: 'rng__inst_1', name: '射程将', faction: '蜀', hp: 1, type: '武将',
      meleeAtk: 2, rangedAtk: 1, armor: 0,
      skills: withRange ? [{
        name: '样·远射',
        description: '你的远程攻击多够得着两块区域。',
        effects: [{
          id: 'e1',
          trigger: { type: 'passive' as const },
          runtime: { type: 'MODIFY_STAT', value: 2, target: 'SELF', stat: 'RANGE', modifyMode: 'delta' },
        }],
      }] : [],
    } as any;
  }

  function deploy(withRange: boolean) {
    const target = fg(2, { zone: 'camp', areaOwnerId: 2 }, 0);
    const state: EngineState = {
      version: 1, phase: 'playing', timelinePhase: 'ACTION',
      players: [
        {
          id: 1, name: 'P1', hp: 4, hand: [rangeGeneral(withRange), DEPLOY_COST, ATTACK_COST],
          generalPool: [], fieldGenerals: [], graveyard: [],
          baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
        },
        {
          id: 2, name: 'P2', hp: 4, hand: [], generalPool: [], fieldGenerals: [target],
          graveyard: [], baseHp: 10, baseMaxHp: 10, isAlive: true, statuses: [],
        },
      ] as unknown as EnginePlayer[],
      currentPlayerId: 1, turn: 1, round: 1,
      deck: [{ id: 'deck_1', name: '粮草', type: '粮草' }],
      discardPile: [], drawState: null,
    };
    const engine = new GameEngine(structuredClone(state));
    engine.dispatch(createAction('DEPLOY_GENERAL', 1, {
      general: rangeGeneral(withRange), consumeCards: [DEPLOY_COST], slot: 0,
    }));
    const deployed = engine.state;
    // 登场后 P1 场上就那一员；这里直接取它，测试里不再各自点下标。
    const attacker = (deployed.players[0] as { fieldGenerals: unknown[] }).fieldGenerals[0] as unknown as FieldGeneral;
    return { state: deployed, attacker, players: deployed.players as unknown as Player[] };
  }

  it('带射程的将登场即落一笔 RANGE；不带的那位一字不落', () => {
    const withRange = deploy(true);
    const ledger = withRange.state.statModifiers ?? [];
    expect(ledger.map(m => `${m.key}:${m.mode}:${m.value}`)).toEqual(['RANGE:delta:2']);
    expect(ledger[0]!.targetId).toBe('rng__inst_1');
    expect(ledger[0]!.passive).toBe(true);

    const without = deploy(false);
    expect(without.state.statModifiers ?? []).toEqual([]);
  });

  it('这一笔自己把敌营地那一格从"拒"翻成"收"，名单与闸同一时刻翻', () => {
    const without = deploy(false);
    // 基础射程 2：档 4 那一格既不在名单里，扔给引擎也是 TARGET_OUT_OF_RANGE。
    expect(getValidTargets(without.attacker, without.players, true, without.state.statModifiers)
      .map(t => t.id)).toEqual([]);
    expect(verdict(without.state, 'rng__inst_1', 's2p0', true)).toBe('TARGET_OUT_OF_RANGE');
    // 营地那一格的拒因沿用旧写法（够不着营地＝这个目标本身不成立，不是"距离不够"
    // 那一支）——闸的顺序与理由编码一字没动，见上面那段"理由还是原来那两个"。
    expect(verdict(without.state, 'rng__inst_1', 'base_2', true)).toBe('INVALID_ATTACK_TARGET');

    const withRange = deploy(true);
    const listed = getValidTargets(withRange.attacker, withRange.players, true, withRange.state.statModifiers)
      .map(t => t.id).sort();
    expect(listed).toEqual(['base_2', 's2p0']);
    expect(verdict(withRange.state, 'rng__inst_1', 's2p0', true)).toBe('accepted');
    expect(verdict(withRange.state, 'rng__inst_1', 'base_2', true)).toBe('accepted');
  });

  it('同一笔射程对近战无效（闸那一支根本不读上限）', () => {
    const withRange = deploy(true);
    // 敌营地那员在档 4：近战永远够不着，射程再长也够不着。
    expect(getValidTargets(withRange.attacker, withRange.players, false, withRange.state.statModifiers)
      .map(t => t.id)).toEqual([]);
    expect(verdict(withRange.state, 'rng__inst_1', 's2p0', false)).toBe('TARGET_OUT_OF_RANGE');
  });
});
