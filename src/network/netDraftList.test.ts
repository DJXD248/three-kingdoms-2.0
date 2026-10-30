/**
 * 联机切片⑤c（v2.9.25）逐席候选名单那笔账的判据证人。
 *
 * 这里钉的是"这一格该装什么、不该装什么"；「别席那一格有没有整块漏上线」不住这里，
 * 那条在 `netDraftListPrivacy.test.ts`（拿真 store 走一遍再扫线上）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDraftListFrame,
  draftItemOf,
  draftListFactsOf,
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
    const text = encodeEnvelope({ t: 'draftlist', from: 'host-1', to: 'g-1', seat: 1, total: 10, instruction: 'x', main: [item], qun: [], picked: [] });
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
  /** `components/GeneralDraft.tsx:188` 那颗钮没凑够时的文案，逐字：
   *  `选择10名将领（群势力1-3名，当前${qunCount}名）`。 */
  const HOT_SEAT_BUTTON = (qunCount: number) => `选择10名将领（群势力1-3名，当前${qunCount}名）`;

  it('没凑够 ⇒ 与热座那颗钮的字面逐字相同（客人那边不重算这条规则，也就不会两边各说一套）', () => {
    const frame = buildDraftListFrame(facts(), 1)!;
    expect(frame.instruction).toBe(HOT_SEAT_BUTTON(0));
    const oneQun = facts({ selectedDraftGenerals: [VIEW.draftQunGenerals[0]] });
    expect(buildDraftListFrame(oneQun, 1)!.instruction).toBe(HOT_SEAT_BUTTON(1));
  });

  /** 凑够那一支的闸与热座 `canConfirm` 同一条（`GeneralDraft.tsx:21`）：人数、群至少一名、群至多三名，三者一起判。 */
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

  it('凑够 10 名且群在 1-3 ⇒ 说"凑够了"，并当场说破确认那颗钮还没接到客人这边（⑤d）', () => {
    const frame = buildDraftListFrame(tenOf(1), 1)!;
    expect(frame.instruction).toContain(`名单凑够了 ${DRAFT_PICK_TOTAL} 名`);
    expect(frame.instruction).toContain('群势力 1 名');
    expect(frame.instruction).toContain('⑤d');
    expect(frame.instruction.length).toBeLessThanOrEqual(MAX_DRAFT_INSTRUCTION_LENGTH);
    expect(frame.picked).toHaveLength(10);
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
    picked: ['q0'],
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
