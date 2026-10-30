/**
 * 联机切片⑤c（v2.9.25）逐席候选名单那笔账的判据证人。
 *
 * 这里钉的是"这一格该装什么、不该装什么"；「别席那一格有没有整块漏上线」不住这里，
 * 那条在 `netDraftListPrivacy.test.ts`（拿真 store 走一遍再扫线上）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDraftListFrame,
  cardAtKey,
  draftItemOf,
  draftListFactsOf,
  draftTally,
  judgeDraftConfirm,
  judgeDraftPick,
  sameDraftListFrames,
  type DraftCardLike,
} from './netDraftList';
import { DRAFT_PICK_TOTAL } from './netDraftProgress';
import {
  encodeEnvelope,
  parseEnvelope,
  MAX_DRAFT_INSTRUCTION_LENGTH,
  MAX_DRAFT_ITEMS,
  MAX_DRAFT_SKILLS,
  MAX_DRAFT_STAT_VALUE,
  MAX_MOVE_LABEL_LENGTH,
  type NetDraftItem,
  type NetDraftListFrame,
} from './netProtocol';

const card = (over: Partial<DraftCardLike> & { id: string; name: string }): DraftCardLike => ({
  faction: '魏',
  type: '武将',
  hp: 4,
  meleeAtk: 2,
  rangedAtk: 1,
  skills: [{ name: '刚勇' }],
  ...over,
});

/** 两席、正在征召、第一席在挑：`buildDraftListFrame` 那三条分支都要有材料。 */
const VIEW = {
  phase: 'generalDraft',
  draftPlayerIndex: 0,
  draftGenerals: [card({ id: 'g-wei-1', name: '夏侯惇' }), card({ id: 'g-wei-2', name: '张辽', faction: '魏' })],
  draftQunGenerals: [card({ id: 'g-qun-1', name: '华雄', faction: '群' })],
  selectedDraftGenerals: [] as DraftCardLike[],
  players: [{ id: 1 }, { id: 2 }],
};

const facts = (over: Partial<typeof VIEW> = {}) => draftListFactsOf({ ...VIEW, ...over });

describe('⑤c 摘取尺（draftListFactsOf）：位置编号是唯一的上线的号', () => {
  it('一张卡上线的就是牌面画得出的那八样，档案号不在里面', () => {
    const item = draftItemOf(card({ id: 'g-wei-1', name: '夏侯惇' }), 'm0');
    expect(Object.keys(item).sort()).toEqual(
      ['faction', 'hp', 'key', 'meleeAtk', 'name', 'rangedAtk', 'skills', 'type'],
    );
    expect(JSON.stringify(item)).not.toContain('g-wei-1');
  });

  it('本势力那格编 m0…、群那格编 q0…，各按各自那张名单的下标', () => {
    const f = facts();
    expect(f.main.map((i) => i.key)).toEqual(['m0', 'm1']);
    expect(f.qun.map((i) => i.key)).toEqual(['q0']);
  });

  it('「已选」也是这两个号：勾了的按号上线，不在名单上的那颗（旧档残留）一个也不上', () => {
    const picked = [VIEW.draftGenerals[1], VIEW.draftQunGenerals[0], card({ id: 'g-elsewhere', name: '不在名单上' })];
    const f = facts({ selectedDraftGenerals: picked });
    expect(f.pickedKeys).toEqual(['m1', 'q0']);
  });

  it('候选面比上界还宽时按上界切（生产者今天给不出，切了也仍是一帧收得下的真话）', () => {
    const wide = Array.from({ length: MAX_DRAFT_ITEMS + 20 }, (_, i) => card({ id: `w${i}`, name: `将${i}` }));
    const f = facts({ draftGenerals: wide });
    expect(f.main).toHaveLength(MAX_DRAFT_ITEMS);
    expect(f.main[MAX_DRAFT_ITEMS - 1].key).toBe(`m${MAX_DRAFT_ITEMS - 1}`);
  });
});

describe('⑤c 卡面那几格的收法：宁画一个怪数，不把一帧真话判成假消息', () => {
  it('点数不是数字／负的／大到荒谬 ⇒ 各收到一个可用的数', () => {
    expect(draftItemOf(card({ id: 'x', name: 'a', hp: -3 }), 'm0').hp).toBe(0);
    expect(draftItemOf(card({ id: 'x', name: 'a', hp: '四' as unknown as number }), 'm0').hp).toBe(0);
    expect(draftItemOf(card({ id: 'x', name: 'a', meleeAtk: 99_999 }), 'm0').meleeAtk).toBe(MAX_DRAFT_STAT_VALUE);
    expect(draftItemOf(card({ id: 'x', name: 'a', rangedAtk: Number.NaN }), 'm0').rangedAtk).toBe(0);
  });

  it('将名与技能名各自收进线上上界，技能格数也收——超了一律是"少画"，不是"整帧被丢"', () => {
    const long = '长'.repeat(MAX_MOVE_LABEL_LENGTH + 90);
    const item = draftItemOf(
      card({ id: 'x', name: long, skills: Array.from({ length: MAX_DRAFT_SKILLS + 10 }, (_, i) => ({ name: `技${i}${long}` })) }),
      'm0',
    );
    expect(item.name.length).toBeLessThanOrEqual(MAX_MOVE_LABEL_LENGTH + 1); // clampText 超长时留一个省略号
    expect(item.skills).toHaveLength(MAX_DRAFT_SKILLS);
    const text = encodeEnvelope({ t: 'draftlist', from: 'host-1', to: 'g-1', seat: 1, total: 10, instruction: 'x', main: [item], qun: [], picked: [], canConfirm: false });
    expect(parseEnvelope(text)).not.toBeNull();
  });

  it('将名缺格（DIY 半张卡）⇒ 画「无名将领」，不是画 undefined', () => {
    expect(draftItemOf({ id: 'x' }, 'm0').name).toBe('无名将领');
    expect(draftItemOf({ id: 'x', name: '   ' }, 'm0').name).toBe('无名将领');
  });
});

describe('⑤c 算给哪一席（㈠ 收件人先于内容）', () => {
  it('还没绑到椅子的那位（观战、椅子没排到）⇒ 一帧也不发，不是发一张空名单', () => {
    expect(buildDraftListFrame(facts(), null)).toBeNull();
  });

  it('桌上没有这一席的账（房主换了桌）⇒ 空名单＋那句实底，而不是不发', () => {
    const frame = buildDraftListFrame(facts(), 7);
    expect(frame).toMatchObject({ seat: 7, main: [], qun: [], picked: [] });
    expect(frame!.instruction).toContain('没有你这一席的征召账');
  });

  it('不在征召那一段 ⇒ 一句"现在不在征召那一段"，一个号也不带（不发一个上一段的"已选"）', () => {
    const frame = buildDraftListFrame(facts({ phase: 'diceRoll', selectedDraftGenerals: [VIEW.draftGenerals[0]] }), 1);
    expect(frame!.instruction).toContain('现在不在征召那一段');
    expect(frame!.picked).toEqual([]);
    expect(frame!.main).toEqual([]);
  });

  it('轮到别人那一席 ⇒ 空名单＋"现在轮到第几席挑将"；已经挑完的那席 ⇒ 一句"已经完成"', () => {
    const waiting = buildDraftListFrame(facts(), 2)!;
    expect(waiting).toMatchObject({ seat: 2, main: [], qun: [], picked: [] });
    expect(waiting.instruction).toContain('还没轮到你这一席');
    expect(waiting.instruction).toContain('现在轮到第 1 席挑将');

    const afterMe = buildDraftListFrame(facts({ draftPlayerIndex: 1, phase: 'generalDraft' }), 1)!;
    expect(afterMe.instruction).toContain('你这一席的征召已经完成了');
    expect(afterMe.main).toEqual([]);
  });

  /** 「已经过了我这席」按 store 数组下标判（下标就是热座的征召先后），不是按席位号大小——
   *  骰子排的座次与 playerId 谁大谁小没有一定之规。 */
  it('席位号与先后无关：第 2 席在下标 0 ⇒ 他是"正在挑"那一格', () => {
    const f = facts({ players: [{ id: 2 }, { id: 1 }] });
    expect(buildDraftListFrame(f, 2)!.main).toHaveLength(2);
    expect(buildDraftListFrame(f, 1)!.instruction).toContain('现在轮到第 2 席挑将');
  });

  it('轮到自己那一席 ⇒ 两份名单整格上线，号也带上', () => {
    const f = facts({ selectedDraftGenerals: [VIEW.draftGenerals[0], VIEW.draftQunGenerals[0]] });
    const frame = buildDraftListFrame(f, 1)!;
    expect(frame.main.map((i) => i.name)).toEqual(['夏侯惇', '张辽']);
    expect(frame.qun.map((i) => i.name)).toEqual(['华雄']);
    expect(frame.picked).toEqual(['m0', 'q0']);
    expect(frame.total).toBe(DRAFT_PICK_TOTAL);
  });
});

describe('⑤c 那句人话（㈢ 由房主按真闸算，字面跟着热座那句走）', () => {
  /** `components/GeneralDraft.tsx:183` 那颗钮没凑够时的文案，逐字：
   *  `选择10名将领（群势力1-3名，当前${qunCount}名）`。 */
  const HOT_SEAT_BUTTON = (qunCount: number) => `选择10名将领（群势力1-3名，当前${qunCount}名）`;

  it('没凑够 ⇒ 与热座那颗钮的字面逐字相同（客人那边不重算这条规则，也就不会两边各说一套）', () => {
    const frame = buildDraftListFrame(facts(), 1)!;
    expect(frame.instruction).toBe(HOT_SEAT_BUTTON(0));
    const oneQun = facts({ selectedDraftGenerals: [VIEW.draftQunGenerals[0]] });
    expect(buildDraftListFrame(oneQun, 1)!.instruction).toBe(HOT_SEAT_BUTTON(1));
  });

  /** 凑够那一支的闸与热座 `canConfirm` 同一条（`GeneralDraft.tsx:22`）：人数、群至少一名、群至多三名，三者一起判。 */
  const tenOf = (qunCount: number) => {
    const mainN = 10 - qunCount;
    const main = Array.from({ length: mainN }, (_, i) => card({ id: `mm${i}`, name: `将${i}` }));
    const qun = Array.from({ length: qunCount }, (_, i) => card({ id: `qq${i}`, name: `群${i}`, faction: '群' }));
    return draftListFactsOf({
      phase: 'generalDraft',
      draftPlayerIndex: 0,
      draftGenerals: main,
      draftQunGenerals: qun,
      selectedDraftGenerals: [...main, ...qun],
      players: [{ id: 1 }, { id: 2 }],
    });
  };

  it('凑够 10 名且群在 1-3 ⇒ 说"凑够了"与那颗钮的名字；腿3 之后不再说"还没接到你这边"（旧句必须不在）', () => {
    const frame = buildDraftListFrame(tenOf(1), 1)!;
    expect(frame.instruction).toContain(`名单凑够了 ${DRAFT_PICK_TOTAL} 名`);
    expect(frame.instruction).toContain('群势力 1 名');
    // ⑤c 那一版在这里写的是"确认那一步在这一版还没接到你这边（⑤d）"——腿3 做到了，这句就一个字不许留。
    expect(frame.instruction).not.toContain('还没接到你这边');
    expect(frame.instruction).not.toContain('⑤d');
    expect(frame.instruction).toContain('确认征召');
    expect(frame.instruction.length).toBeLessThanOrEqual(MAX_DRAFT_INSTRUCTION_LENGTH);
    expect(frame.picked).toHaveLength(10);
    expect(frame.canConfirm).toBe(true);
  });

  it('那三格派生的口径是一致的一笔账：`canConfirm` 与那句人话同真同假，`picked` 就是数进句里的那几个号', () => {
    // 界面上那颗钮读 `canConfirm`、那句话读 `picked`/`qunCount`，两处背后是同一个 `draftTally`（派单要的"单一真值"）。
    const yes = buildDraftListFrame(tenOf(2), 1)!;
    expect(yes.canConfirm).toBe(true);
    expect(yes.instruction).toContain('名单凑够了');
    const no = buildDraftListFrame(tenOf(0), 1)!;
    expect(no.canConfirm).toBe(false);
    expect(no.instruction).toContain('群势力1-3名，当前0名');
  });

  it('10 名里一颗群牌也没有 ⇒ 照样没过闸，说的仍是热座那句（不是"凑够了"）', () => {
    expect(buildDraftListFrame(tenOf(0), 1)!.instruction).toBe(HOT_SEAT_BUTTON(0));
  });

  it('群超过 3 名 ⇒ 那句话回到"没凑够"的字面（闸没过的说法只有热座那一种）', () => {
    expect(buildDraftListFrame(tenOf(4), 1)!.instruction).toBe(HOT_SEAT_BUTTON(4));
  });

  it('名单上一个号也没勾 ⇒ 那句里的"当前 n 名"是 0，不是把这句整个省掉', () => {
    const frame = buildDraftListFrame(facts({ draftGenerals: [], draftQunGenerals: [] }), 1)!;
    expect(frame.instruction).toBe(HOT_SEAT_BUTTON(0));
    expect(frame.main).toEqual([]);
  });
});

describe('⑤c 内容没变＝同一个引用（㈣）', () => {
  const FRAME: NetDraftListFrame = {
    seat: 1, total: 10, instruction: '选择10名将领（群势力1-3名，当前1名）',
    main: [{ key: 'm0', name: '夏侯惇', faction: '魏', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: ['刚勇'] }],
    qun: [{ key: 'q0', name: '华雄', faction: '群', type: '武将', hp: 4, meleeAtk: 2, rangedAtk: 1, skills: [] }],
    picked: ['q0'], canConfirm: false,
  };
  const copy = (): NetDraftListFrame => JSON.parse(JSON.stringify(FRAME)) as NetDraftListFrame;

  it('逐字段一样但引用不同 ⇒ 算"没变"；任一字段动了 ⇒ 算"变了"', () => {
    expect(sameDraftListFrames(FRAME, copy())).toBe(true);
    expect(sameDraftListFrames(FRAME, { ...copy(), instruction: '别的' })).toBe(false);
    expect(sameDraftListFrames(FRAME, { ...copy(), picked: ['m0'] })).toBe(false);
    expect(sameDraftListFrames(FRAME, { ...copy(), main: [] })).toBe(false);
    const mutated = copy();
    mutated.main[0] = { ...mutated.main[0], skills: ['刚勇', '疾走'] };
    expect(sameDraftListFrames(FRAME, mutated)).toBe(false);
    const mutated2 = copy();
    mutated2.qun[0] = { ...mutated2.qun[0], hp: 5 };
    expect(sameDraftListFrames(FRAME, mutated2)).toBe(false);
  });

  it('两边都没收到（null vs null）才算一样，一边有一边没有不算', () => {
    expect(sameDraftListFrames(null, null)).toBe(true);
    expect(sameDraftListFrames(FRAME, null)).toBe(false);
    expect(sameDraftListFrames(null, FRAME)).toBe(false);
  });

  it('算出来的那一帧发得出去、也收得回来（房主发得出的一定收得下，两侧上界对得上）', () => {
    const frame = buildDraftListFrame(facts({ selectedDraftGenerals: [VIEW.draftQunGenerals[0]] }), 1)!;
    const parsed = parseEnvelope(encodeEnvelope({ t: 'draftlist', from: 'host-1', to: 'g-1', ...frame }));
    expect(parsed).toEqual({ t: 'draftlist', from: 'host-1', to: 'g-1', ...frame });
  });
});

describe('⑤c 那一格里的号指不到牌时不画', () => {
  it('摘取尺给的 picked 里那颗不在当前名单上的号，出帧时被丢掉（客人屏上不出现一条猜出来的"已选"）', () => {
    // 房主勾了 m0，随后候选面被换掉（沙盒／重开一桌留着的旧勾选）⇒ 那个号在这格上指不到牌。
    const f = draftListFactsOf({
      phase: 'generalDraft',
      draftPlayerIndex: 0,
      draftGenerals: [card({ id: 'brand-new', name: '全新的一张' })],
      draftQunGenerals: [],
      selectedDraftGenerals: [card({ id: 'g-wei-2', name: '张辽' })],
      players: [{ id: 1 }],
    });
    expect(f.pickedKeys).toEqual([]); // 摘取尺那一步已经找不到它（名单里没有这颗）
    const frame = buildDraftListFrame({ ...f, pickedKeys: ['m9'] }, 1)!;
    expect(frame.picked).toEqual([]);
    expect(frame.main.map((i: NetDraftItem) => i.key)).toEqual(['m0']);
  });
});

/** 凑够 n 名（main 与 qun 各几张）的真摘取结果；腿3 的重判与那句人话都从这里取材料。 */
const draftMaterial = (mainN: number, qunN: number, pickedMain = mainN, pickedQun = qunN) => {
  const main = Array.from({ length: mainN }, (_, i) => card({ id: `mm${i}`, name: `将${i}` }));
  const qun = Array.from({ length: qunN }, (_, i) => card({ id: `qq${i}`, name: `群${i}`, faction: '群' }));
  return draftListFactsOf({
    phase: 'generalDraft',
    draftPlayerIndex: 0,
    draftGenerals: main,
    draftQunGenerals: qun,
    selectedDraftGenerals: [...main.slice(0, pickedMain), ...qun.slice(0, pickedQun)],
    players: [{ id: 1 }, { id: 2 }],
  });
};

describe('⑤d 那一笔账（draftTally）：句子、帧上那个布尔、房主重判共用它', () => {
  /** 直接喂两份名单与勾了的号，不走摘取尺——这一笔账的判据要能在"名单有多宽"之外单独量。 */
  const items = (prefix: 'm' | 'q', n: number): NetDraftItem[] =>
    Array.from({ length: n }, (_, i) => draftItemOf(card({ id: `${prefix}${i}`, name: `${prefix}${i}`, faction: prefix === 'q' ? '群' : '魏' }), `${prefix}${i}`));
  const keys = (prefix: 'm' | 'q', n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const tally = (mainN: number, qunN: number, pickMain: number, pickQun: number, total = DRAFT_PICK_TOTAL) =>
    draftTally(items('m', mainN), items('q', qunN), [...keys('m', pickMain), ...keys('q', pickQun)], total);

  it('人数、群至少一名、群至多三名：三条一起判，缺一不过', () => {
    expect(tally(9, 1, 9, 1).canConfirm).toBe(true); // 10 名、群 1
    expect(tally(7, 3, 7, 3).canConfirm).toBe(true); // 10 名、群 3（上限那一边）
    expect(tally(9, 1, 9, 0).canConfirm).toBe(false); // 差一名
    expect(tally(9, 1, 8, 1).canConfirm).toBe(false); // 一名群牌也没勾
    expect(tally(6, 4, 6, 4).canConfirm).toBe(false); // 人数够了，群超了三名
  });

  it('勾的数用「等于」而不是「不少于」：一个多出来的名单也不许交卷', () => {
    // 派单给的字面是"凑够 10 名且群牌 1-3 名"；今天的热座面板勾不出第 11 颗，但那条闸若要能站住，
    // 判据就不许写成 `>=`——否则将来界面一放宽，客人那条路上就会多放过一条本该拒的。
    expect(tally(9, 2, 9, 2, 10).canConfirm).toBe(false);
    expect(tally(9, 2, 9, 2, 10).picked).toHaveLength(11);
  });

  it('指不到牌的号不进这笔账：既不数进人数，也不数进群牌', () => {
    const t = draftTally(items('m', 9), items('q', 1), ['m0', 'm9', 'q0', 'q7'], DRAFT_PICK_TOTAL);
    expect(t.picked).toEqual(['m0', 'q0']);
    expect(t.qunCount).toBe(1);
  });

  it('群牌那一档数的是"在不在这份群名单上"，不是牌面那个势力字', () => {
    // 这一条钉的是口径本身。今天两边必然一致：本势力那格按 `faction === 席位势力` 筛、群那格按 `faction === '群'`
    // 筛（`setup/runtimeSetup.ts:156`／`:174`），而席位势力只可能是魏蜀吴晋（`:66`）⇒ 本势力名单里不会出现群牌。
    // 但热座那句数的是势力字（`components/GeneralDraft.tsx` 的 `qunCount`），这里数的是名单归属：
    // 一旦有人把它改成"按牌面势力数"，这两句就可能各说一套——由这条先红。
    const fakeQunInMain = [draftItemOf(card({ id: 'odd', name: '一颗不该出现在这里的群牌', faction: '群' }), 'm0')];
    const t = draftTally(fakeQunInMain, [], ['m0'], 1);
    expect(t.picked).toEqual(['m0']);
    expect(t.qunCount).toBe(0);
    expect(t.canConfirm).toBe(false);
  });

  it('摘取尺与这笔账在真 store 材料上给同一个数（房主那句人话背后就是它）', () => {
    const f = draftMaterial(9, 2, 9, 1); // 本势力 9 名全勾 + 群 1 名 = 10 名且群在 1-3 ⇒ 已过闸
    const t = draftTally(f.main, f.qun, f.pickedKeys, f.total);
    const frame = buildDraftListFrame(f, 1)!;
    expect(t.picked).toEqual(frame.picked);
    expect(frame.canConfirm).toBe(t.canConfirm);
    // 句子里那个"当前 n 名"数的就是 `t.qunCount`：两处是同一个函数的同一个读数，不是各抄一遍。
    const notYet = draftMaterial(9, 2, 7, 1);
    expect(buildDraftListFrame(notYet, 1)!.instruction).toContain(`当前${draftTally(notYet.main, notYet.qun, notYet.pickedKeys, notYet.total).qunCount}名`);
    expect(buildDraftListFrame(notYet, 1)!.instruction).toContain('当前1名');
  });
});

describe('⑤d 房主重判客人交回来的那两下（唯一依据＝他自己发出去的那一帧）', () => {
  const READY = () => draftMaterial(9, 1, 9, 1); // 凑够 10 名、群 1 名，第 1 席正在挑
  const frameTo1 = (f = READY()) => buildDraftListFrame(f, 1)!;

  it('五条拒话各有一条路径，且没有一条是静默的（判不住必带一句人话）', () => {
    const f = READY();
    const sent = frameTo1(f);
    const cases: [string, ReturnType<typeof judgeDraftPick>][] = [
      ['椅子还没绑', judgeDraftPick(f, sent, null, 'm0')],
      ['不在征召那一段', judgeDraftPick({ ...f, phase: 'diceRoll' }, sent, 1, 'm0')],
      ['没轮到这一席', judgeDraftPick({ ...f, draftPlayerIndex: 1 }, sent, 1, 'm0')],
      ['房主还没发过帧', judgeDraftPick(f, null, 1, 'm0')],
      ['那一帧是发给别席的', judgeDraftPick(f, { ...sent, seat: 2 }, 1, 'm0')],
      ['编号不在那一帧上', judgeDraftPick(f, sent, 1, 'm9')],
    ];
    for (const [what, verdict] of cases) {
      expect(verdict.ok, what).toBe(false);
      expect((verdict as { reason: string }).reason, what).not.toBe('');
    }
    expect((cases[0][1] as { reason: string }).reason).toContain('绑好椅子');
    expect((cases[4][1] as { reason: string }).reason).toContain('不是发给你现在这一席');
    expect((cases[5][1] as { reason: string }).reason).toContain('不在我发给你的那份名单上');
  });

  it('本势力与群那两格的号都算合法（客人只交回号，房主按自己发过的那格认）', () => {
    const f = READY();
    expect(judgeDraftPick(f, frameTo1(f), 1, 'm0').ok).toBe(true);
    expect(judgeDraftPick(f, frameTo1(f), 1, 'q0').ok).toBe(true);
  });

  /** 交过卷之后 `draftPlayerIndex` 往前挪（`gameStore.ts` 的 `confirmDraft`），那一席就不再是当下那一席。 */
  it('重复交卷被同一句"没轮到你"挡住：那一格的光标已经不在这一席', () => {
    const f = READY();
    const after = { ...f, draftPlayerIndex: 1 };
    expect(judgeDraftConfirm(after, frameTo1(f), 1)).toEqual({ ok: false, reason: expect.stringContaining('不是轮到你这一席') });
  });

  it('确认那一档：房主自己再算一遍，绝不读帧上那个 `canConfirm`', () => {
    const f = READY();
    // ㈠ 帧上写着"够了"（那是上一刻真发出去过的那一帧），店里此刻已经不算够了 ⇒ 仍拒，理由给的是房主当下的数。
    const gone = { ...f, pickedKeys: [] as string[] };
    const verdict = judgeDraftConfirm(gone, frameTo1(f), 1);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('还交不了卷：现在 0/10 名、群势力 0 名');
    expect((verdict as { reason: string }).reason).toContain('群势力 1-3 名');
    // ㈡ 反过来：帧上当时写着"没够"，客人随后在房主那边被勾够了 ⇒ 这一条办得了。
    //     客人屏上那颗钮还没跟着变（下一帧就到），但房主不因为"我发过的是 false"就把真话按住。
    const early = draftMaterial(9, 1, 9, 0);
    expect(judgeDraftConfirm(READY(), frameTo1(early), 1).ok).toBe(true);
  });

  /** 更正轮㈡ 给点将那一档补了数量闸，这一条的说法得跟着换：那道闸拦的是「加不进去」那三种形状，
   *  不是「还没凑够」——凑够没有只归确认那颗钮管。 */
  it('点将那一档不看「凑够没凑够」：人数还差着一大截，一颗加得进去的牌照样能勾', () => {
    const f = draftMaterial(9, 1, 5, 0); // 只勾了 5 颗主：离 10 名差 5 颗，三档上限一档没撞
    const sent = frameTo1(f);
    expect(sent.canConfirm).toBe(false); // 「够不够交卷」由确认那一档说，这里照旧是 false
    expect(judgeDraftPick(f, sent, 1, 'm8').ok).toBe(true); // 一颗没勾过的主牌
    expect(judgeDraftPick(f, sent, 1, 'q0').ok).toBe(true); // 群势力当下 0 名，第一颗群牌正该勾得动
  });

  it('拿那个号查回店里那张牌的对象：命中的是同一个引用，查不到给 null', () => {
    const main = Array.from({ length: 9 }, (_, i) => card({ id: `mm${i}`, name: `将${i}` }));
    const qun = [card({ id: 'qq0', name: '群0', faction: '群' })];
    const f = draftListFactsOf({
      phase: 'generalDraft', draftPlayerIndex: 0, draftGenerals: main, draftQunGenerals: qun,
      selectedDraftGenerals: [], players: [{ id: 1 }, { id: 2 }],
    });
    const sent = frameTo1(f);
    // ⚠️ 这三行钉的是派单第 5 条：房主把编号换算成**自己数组里的那个对象**，交给 store 那颗 `selectDraftGeneral`；
    // 线上传来的任何东西（将名、档案号、理由）在这里一个都不出现。
    expect(cardAtKey(main, qun, sent.main, sent.qun, 'm3')).toBe(main[3]);
    expect(cardAtKey(main, qun, sent.main, sent.qun, 'q0')).toBe(qun[0]);
    expect(cardAtKey(main, qun, sent.main, sent.qun, 'm9')).toBeNull();
  });

  it('那一帧的号还在、店里的名单却短了 ⇒ null（不拿旧帧去勾一张此刻不存在的牌）', () => {
    const main = Array.from({ length: 9 }, (_, i) => card({ id: `mm${i}`, name: `将${i}` }));
    const f = draftListFactsOf({
      phase: 'generalDraft', draftPlayerIndex: 0, draftGenerals: main, draftQunGenerals: [],
      selectedDraftGenerals: [], players: [{ id: 1 }, { id: 2 }],
    });
    const sent = frameTo1(f);
    expect(sent.main).toHaveLength(9);
    expect(cardAtKey(main.slice(0, 2), [], sent.main, sent.qun, 'm5')).toBeNull();
  });
});

/**
 * 更正轮（㈡）：`judgeDraftPick` 里那第五道——数量闸。
 *
 * 派单逮到的形态是"房主放行了、store 自己却静默不办"：`selectDraftGeneral` 只挡满 10 颗那一档，
 * 于是那一帧与上一帧一字未动 ⇒ `sameDraftListFrames` 判定"没变"、一条也不发，客人屏幕上真的什么都没发生。
 * 另一头是群牌那一档 store 压根不挡 ⇒ 客人做出一种热座永远点不出来的形状。
 * 这两条各有一枚证人，句子与热座那颗牌共用 `domain/draftQuota` 同一把尺。
 */
describe('更正轮㈡ 点将那一档补上的数量闸：store 会静默不办的那一颗，房主先当面拒掉', () => {
  const frameOfSeat1 = (f: ReturnType<typeof draftMaterial>) => buildDraftListFrame(f, 1)!;

  it('已经勾满 10 颗，再点一颗没勾的 ⇒ 拒，且给的是"满 10 颗、先退一颗"那一句（不是"没凑够"）', () => {
    const f = draftMaterial(9, 2, 9, 1); // 11 张候选、勾着 10 颗（9 主 + 1 群）：人数这一档早就够了
    const sent = frameOfSeat1(f);
    expect(sent.picked).toHaveLength(10); // 正面凭据：材料真的摆满了 10 颗
    expect(sent.canConfirm).toBe(true);
    const verdict = judgeDraftPick(f, sent, 1, 'q1'); // q1 是唯一那颗没勾的群牌
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('已经勾满 10 颗');
    expect((verdict as { reason: string }).reason).toContain('要先退掉一颗');
  });

  it('群牌到 3 名上限，再点第 4 颗群 ⇒ 拒那一句；同一份材料点本势力那颗照样放行（拒的是那一条，不是一片）', () => {
    const f = draftMaterial(6, 4, 6, 3); // 9 颗里 6 主 3 群
    const sent = frameOfSeat1(f);
    expect(sent.picked.filter((k) => k.startsWith('q'))).toHaveLength(3);
    const qun = judgeDraftPick(f, sent, 1, 'q3');
    expect(qun.ok).toBe(false);
    expect((qun as { reason: string }).reason).toContain('群势力最多 3 名');
    expect((qun as { reason: string }).reason).toContain('现在 3 名');
    expect(judgeDraftPick(f, sent, 1, 'm0').ok).toBe(true); // m0 已勾 ⇒ 退一颗，恒放行
  });

  it('9 主 0 群时点第 10 颗本势力 ⇒ 那是热座点不出来的形状，房主当面拒；点那颗群牌照样放行', () => {
    const f = draftMaterial(10, 1, 9, 0); // 10 主 1 群候选，勾着 9 颗主
    const sent = frameOfSeat1(f);
    expect(sent.picked).toHaveLength(9);
    const main = judgeDraftPick(f, sent, 1, 'm9');
    expect(main.ok).toBe(false);
    expect((main as { reason: string }).reason).toContain('得给群势力留一颗位置');
    expect(judgeDraftPick(f, sent, 1, 'q0').ok).toBe(true); // 补上那一名群，位置就腾出来了
  });

  it('三句拒话分得开（派单逐字：「人数满 10／群牌已 3 名，两句要分得开」）', () => {
    const full = (judgeDraftPick(draftMaterial(9, 2, 9, 1), frameOfSeat1(draftMaterial(9, 2, 9, 1)), 1, 'q1') as { reason: string }).reason;
    const qun = (judgeDraftPick(draftMaterial(6, 4, 6, 3), frameOfSeat1(draftMaterial(6, 4, 6, 3)), 1, 'q3') as { reason: string }).reason;
    const main = (judgeDraftPick(draftMaterial(10, 1, 9, 0), frameOfSeat1(draftMaterial(10, 1, 9, 0)), 1, 'm9') as { reason: string }).reason;
    expect(new Set([full, qun, main]).size).toBe(3);
    for (const line of [full, qun, main]) expect(line).not.toBe('');
  });

  it('这颗是群还是主，取的是号落在房主自己哪一份名单上，不是牌面那个势力字', () => {
    // 一颗牌面写着"群"的本势力候选（今天真材料里不会出现：`runtimeSetup.ts` 那两格是按势力筛的）。
    // 按牌面数 ⇒ 它算群牌、`qunCount` 才 0 名于是放行；按名单归属数 ⇒ 它是第 10 颗主，被"给群留位置"那一条拦下。
    const main = [...Array.from({ length: 9 }, (_, i) => card({ id: `mm${i}`, name: `将${i}` })), card({ id: 'mm9', name: '牌面写着群的怪卡', faction: '群' })];
    const qun = [card({ id: 'qq0', name: '群0', faction: '群' })];
    const f = draftListFactsOf({
      phase: 'generalDraft', draftPlayerIndex: 0, draftGenerals: main, draftQunGenerals: qun,
      selectedDraftGenerals: main.slice(0, 9), players: [{ id: 1 }, { id: 2 }],
    });
    const sent = buildDraftListFrame(f, 1)!;
    expect(sent.main.at(-1)!.faction).toBe('群'); // 正面凭据：帧上那个字确实是"群"，拦下它的不是那个字
    const verdict = judgeDraftPick(f, sent, 1, 'm9');
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toContain('得给群势力留一颗位置');
  });

  it('满 10 颗也照样退得掉：退一颗恒放行（与热座那句 `always allow deselecting` 同向）', () => {
    const f = draftMaterial(9, 2, 9, 1); // 勾满 10 颗
    const sent = frameOfSeat1(f);
    expect(sent.picked).toHaveLength(10);
    for (const key of ['m0', 'm8', 'q0']) {
      expect(judgeDraftPick(f, sent, 1, key).ok, key).toBe(true);
    }
  });

  it('数量闸不许顺手把"够不够交卷"也判了：还差几名照样勾得动', () => {
    const f = draftMaterial(10, 2, 2, 0); // 只勾了 2 颗，离 10 名还远
    const sent = frameOfSeat1(f);
    expect(sent.canConfirm).toBe(false);
    expect(judgeDraftPick(f, sent, 1, 'm5').ok).toBe(true);
    expect(judgeDraftPick(f, sent, 1, 'q1').ok).toBe(true);
  });
});
