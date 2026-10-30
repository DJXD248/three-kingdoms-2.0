/**
 * 联机切片⑤c（v2.9.25）逐席候选名单的那笔账——**指名发给那一席本人，别席一个字节也不进**。
 *
 * 用户 2026-10-30 的口径逐字是：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」。
 * ⑤b 那张进度表因此只报数量、一张牌也不搬；这一格是同一句话的另一半：**自己那一格可以搬**，
 * 因为它本来就是发给那一席本人的。ARCH_MAP 第 7 条㈡ 说的就是这一枚新增的指名信封。
 *
 * 四条判据与准备表／进度表同一个形状：
 *
 * ㈠**收件人先于内容**：这一帧只有"被绑到某一席的这位客人"能拿到，且拿到的只有他那一席的。
 *   同一时刻房主那边只有一个席位在征召（`draftPlayerIndex` 指的那一席），其余席位收到的是
 *   **空名单＋一句"没轮到你／已经完成了"**——空名单在这里是一句真话（与 `moves` 那条同判据），
 *   不是"漏发"；隐私证人 `netDraftListPrivacy.test.ts` 量的正是"别席那一格有没有整块漏上线"。
 * ㈡**位置编号是唯一的指认方式**：卡片在帧里靠 `m0…`／`q0…` 认，档案号（`g.id`）永不上线。
 *   腿3（⑤d）客人交回"我勾哪一颗"时用的就是这一个号，房主拿**同一个规则**把自己发过的那格查回来——
 *   绝不采信客人发来的将名（用户 2026-10-30 裁，ARCH_MAP 第 7 条㈢）。
 * ㈢**那句人话由房主算**：客人屏幕上那句"该做什么"是房主按自己那台机器上的真闸拼出来的，
 *   字面与热座征召面板上的同一句（`components/GeneralDraft.tsx` 的 `canConfirm` 与那颗钮的文案）。
 *   客人那边不重算这条规则，也就不会出现两边对"凑够没凑够"各说一套。
 * ㈣内容没变＝同一个引用（房主每次点将、每次界面重绘都会问一遍，多数时候那一格根本没动）。
 *
 * 这一层不 import store：`draftListFactsOf` 是接线那头（`components/NetRoomBridge`）与隐私证人共用的
 * 那一把摘取尺，与 `draftFactsOf` 同一手法——判据住这一层，搬运住接线。
 *
 * 腿3（⑤d）之后，这一层还多装了**重判**那一半：`judgeDraftPick`／`judgeDraftConfirm` 拿的是房主自己发过的那一帧
 * 与 `draftTally` 那笔账（句子与判据共用同一个函数，派单要的"单一真值"），怎么执行住在 `netHostDraftList`。
 * 这里依然没有网络、没有 store、没有 React。
 */
import { DRAFT_PICK_TOTAL } from './netDraftProgress';
import { clampText } from './netSeat';
import {
  MAX_DRAFT_INSTRUCTION_LENGTH,
  MAX_DRAFT_ITEMS,
  MAX_DRAFT_SKILLS,
  MAX_DRAFT_STAT_VALUE,
  MAX_MOVE_LABEL_LENGTH,
  MAX_NAME_LENGTH,
  type NetDraftItem,
  type NetDraftListFrame,
} from './netProtocol';

/** 房主 store 里一张候选卡的最小形状（`General` 的这几格；这里不 import 数据层，与 `DraftSeatFact` 一个理由）。 */
export type DraftCardLike = {
  id?: string;
  name?: unknown;
  faction?: unknown;
  type?: unknown;
  hp?: unknown;
  meleeAtk?: unknown;
  rangedAtk?: unknown;
  skills?: readonly { name?: unknown }[];
};

export type DraftListFacts = {
  phase: string;
  /** 席位号（引擎的 playerId）按 store 数组下标的顺序——下标就是征召的先后。 */
  seats: number[];
  draftPlayerIndex: number;
  /** 正在征召那一席的两格候选，已按先后编好位置编号（`m0…`／`q0…`）。不在那一段时两格为空。 */
  main: NetDraftItem[];
  qun: NetDraftItem[];
  /** 房主当下勾了哪几颗，用的仍是这两个编号；勾了但不在这两格上的那颗（旧档残留）不上线。 */
  pickedKeys: string[];
  total: number;
};

/**
 * 点数按边界收下来再上线：房主那台机器上的数今天到不了 1000（名册里体力是个位、攻击是个位数），
 * 真出现一个荒谬的数时，画一个"很大"的点数比让客人整屏空白好——
 * 反过来，线上那一侧的封顶是**整帧拒**（不截断），两侧合起来保证"房主发得出的一定收得下"。
 */
function statOf(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(MAX_DRAFT_STAT_VALUE, Math.max(0, n));
}

/**
 * 一张卡上线的那几样。编号是**发出去的位置**（第几张），不是档案号：
 * 腿3 交回来时房主按同一个规则查自己发过的那格，客人写什么名字都不作数。
 */
export function draftItemOf(general: DraftCardLike, key: string): NetDraftItem {
  return {
    key,
    name: clampText(general.name, MAX_MOVE_LABEL_LENGTH, '无名将领'),
    faction: clampText(general.faction, MAX_NAME_LENGTH, '待定'),
    type: clampText(general.type, MAX_NAME_LENGTH, '将领'),
    hp: statOf(general.hp),
    meleeAtk: statOf(general.meleeAtk),
    rangedAtk: statOf(general.rangedAtk),
    skills: (general.skills ?? []).slice(0, MAX_DRAFT_SKILLS).map((s) => clampText(s?.name, MAX_MOVE_LABEL_LENGTH, '技能')),
  };
}

/**
 * 从房主当下的 store 里摘这一格要的那几样（`NetRoomBridge` 与隐私证人共用这一份）。
 * 摘出来的只有卡面上画得出的东西＋勾了哪几颗的编号；`players[i].generalPool`（别席已经定下的池子）
 * **一格都不进**——那是别人的私有信息，⑤b 的进度表里也从来没有它。
 */
export function draftListFactsOf(state: {
  phase: string;
  draftPlayerIndex: number;
  draftGenerals: readonly DraftCardLike[];
  draftQunGenerals: readonly DraftCardLike[];
  selectedDraftGenerals: readonly DraftCardLike[];
  players: readonly { id: number | string }[];
}): DraftListFacts {
  const main = state.draftGenerals.slice(0, MAX_DRAFT_ITEMS).map((g, i) => draftItemOf(g, `m${i}`));
  const qun = state.draftQunGenerals.slice(0, MAX_DRAFT_ITEMS).map((g, i) => draftItemOf(g, `q${i}`));
  const keyById = new Map<string, string>();
  [...state.draftGenerals, ...state.draftQunGenerals].forEach((g, i) => {
    if (g.id === undefined) return;
    keyById.set(g.id, i < state.draftGenerals.length ? `m${i}` : `q${i - state.draftGenerals.length}`);
  });
  return {
    phase: state.phase,
    seats: state.players.map((p) => Number(p.id)),
    draftPlayerIndex: state.draftPlayerIndex,
    main,
    qun,
    pickedKeys: state.selectedDraftGenerals.map((g) => (g.id === undefined ? null : keyById.get(g.id) ?? null))
      .filter((k): k is string => k !== null),
    total: DRAFT_PICK_TOTAL,
  };
}

const NOT_DRAFT_PHASE = '现在不在征召那一段（候选名单只在征召那一段发给你）';
const NOT_SEATED = '桌上现在没有你这一席的征召账（房主那边换了桌，或还没排到你）';
const DONE = '你这一席的征召已经完成了（你那份池子已经定下来）';
/**
 * ⑤d 那五条拒话（用户 2026-10-30 逐字：「拒不得静默」——要么办事，要么当面说一句为什么不走）。
 * 它们走的是**同一枚已有的指名名单信封**：把 `instruction` 那一格换成这句，别的一格不动，
 * 于是客人屏上"这一席该做什么"那一行直接变成回答他的那句话（不新增出口；
 * 句子换了就是一次内容变化，`sameDraftListFrames` 认得出来，这一帧发得出去）。
 */
const REFUSE_NOT_BOUND = '你这一席还没在桌上绑好椅子（房主的席位表里没有你），这一条不认。';
const REFUSE_NOT_DRAFT = '现在不在征召那一段，这一条不认。';
const REFUSE_NOT_YOUR_TURN = '现在不是轮到你这一席挑将，这一条不认。';
const REFUSE_NO_FRAME = '我这边还没给你这一席算出候选名单，这一条不认。';
const REFUSE_OTHER_SEAT = '那一份名单不是发给你现在这一席的，这一条不认。';
const REFUSE_OFF_LIST = '这一颗不在我发给你的那份名单上，这一条不认。';
/** 这句是发布者自己那一档（房主查不到那张牌时才用），所以往外给一个名字。 */
export const REFUSE_NO_CARD = '这一颗在我这边已经查不到那张牌了（名单换了），这一条不认。';

/** 一句人话加上"客人这边还没那颗钮"这一句实底，长度仍在那条封顶之内（超长就整帧被拒，所以这里先收）。 */
function cap(text: string): string {
  return clampText(text, MAX_DRAFT_INSTRUCTION_LENGTH, '这一席该做什么，房主那边没给出一句话');
}

function frameOf(seat: number, total: number, instruction: string, picked: string[]): NetDraftListFrame {
  return { seat, total, instruction: cap(instruction), main: [], qun: [], picked, canConfirm: false };
}

/**
 * 「这一席现在勾了哪几颗、其中群牌几颗、够不够交卷」那一笔账——**这条线唯一的抄本**。
 *
 * 派单（用户 2026-10-30）逐字要的是"单一真值：不要把那条上下限再手抄一遍"。
 * 它一头接**房主拼那句人话**（`buildDraftListFrame` 里的那句），一头接**房主重判客人交回来的那一条**
 * （`judgeDraftConfirm`），中间那一格（帧上的 `canConfirm`）是它的派生物，客人屏上那颗钮只读这一个布尔。
 * 三处共用同一个函数，就长不出"界面上按得下去、房主说这条不合法"那种两套口径。
 *
 * 那条上下限的字面（`total` 名、群势力 1-3 名）与热座面板那颗钮的 `disabled` 判据是同一句
 * （`components/GeneralDraft.tsx:21`，本轮那一格一字不改），由 `NetDraftParity.test.tsx` 拿真 store 三方逐字比对钉住。
 *
 * ⚠️ 这里**不**判"这位发送者是不是当下那一席"——那是 `judgeDraftPick`／`judgeDraftConfirm` 的活；
 * 这一笔账只算数量，谁问都算得出同一个数。
 */
export type DraftTally = { picked: string[]; qunCount: number; canConfirm: boolean };

export function draftTally(
  main: readonly NetDraftItem[],
  qun: readonly NetDraftItem[],
  pickedKeys: readonly string[],
  total: number,
): DraftTally {
  // 只带上这张名单上有的号：一个指不到牌的号画到客人屏上，就是一条猜出来的"已选"。
  const known = new Set([...main, ...qun].map((item) => item.key));
  const picked = pickedKeys.filter((key) => known.has(key));
  // 按"在不在这份群名单上"数，而不是按牌面上的势力字数——两者今天必然相等，理由在两处现场读数：
  // 席位势力只可能来自 `PLAYABLE_FACTIONS`（魏蜀吴晋，`setup/runtimeSetup.ts:66`，分配在 :114-115），
  // 而本势力那格的筛法就是 `faction === 席位势力`（:156）、群那格是 `faction === '群'`（:174）
  // ⇒ 本势力那格里不会出现群牌。热座面板用的正是势力字那个数（`GeneralDraft.tsx` 的 `qunCount`），
  // 这一条由 `netDraftListPrivacy.test.ts` 拿真 store 分完候选、勾过几名之后逐字比对钉住：两边数不一致就红。
  const qunCount = picked.filter((key) => qun.some((item) => item.key === key)).length;
  return { picked, qunCount, canConfirm: picked.length === total && qunCount >= 1 && qunCount <= 3 };
}

/**
 * 算给**这一位客人**的那一帧。`recipientSeat` 是他在席位表上的那一席（表由房主的权威算好抄进 `netRoom`，
 * 这一层不去自己排座次）；`null`＝他还没绑到任何椅子 ⇒ 这一格现在对他没有话要说，一帧也不发。
 */
export function buildDraftListFrame(facts: DraftListFacts, recipientSeat: number | null): NetDraftListFrame | null {
  if (recipientSeat === null) return null;
  const seatIndex = facts.seats.indexOf(recipientSeat);
  if (seatIndex === -1) return frameOf(recipientSeat, facts.total, NOT_SEATED, []);
  if (facts.phase !== 'generalDraft') return frameOf(recipientSeat, facts.total, NOT_DRAFT_PHASE, []);

  const pickingSeat = facts.seats[facts.draftPlayerIndex] ?? null;
  if (recipientSeat !== pickingSeat) {
    if (seatIndex < facts.draftPlayerIndex) return frameOf(recipientSeat, facts.total, DONE, []);
    const waiting = pickingSeat === null
      ? '还没轮到你这一席（房主那边现在没有在征召的席位）'
      : `还没轮到你这一席（现在轮到第 ${pickingSeat} 席挑将）`;
    return frameOf(recipientSeat, facts.total, waiting, []);
  }

  const main = facts.main.slice(0, MAX_DRAFT_ITEMS);
  const qun = facts.qun.slice(0, MAX_DRAFT_ITEMS);
  const tally = draftTally(main, qun, facts.pickedKeys, facts.total);
  // 这一句就是热座面板上那颗钮的文案（`totalCount === 10 && qunCount >= 1 && qunCount <= 3` 那条真闸），
  // 由房主按自己那台机器的读数拼好；客人那边只画收到的这句，不再自己判"够不够"。
  const instruction = tally.canConfirm
    ? `名单凑够了 ${facts.total} 名（群势力 ${tally.qunCount} 名）·按下「确认征召」就交这一席的卷`
    : `选择${facts.total}名将领（群势力1-3名，当前${tally.qunCount}名）`;
  return {
    seat: recipientSeat, total: facts.total, instruction: cap(instruction),
    main, qun, picked: tally.picked, canConfirm: tally.canConfirm,
  };
}

function sameItems(a: readonly NetDraftItem[], b: readonly NetDraftItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const other = b[i];
    return item.key === other.key && item.name === other.name && item.faction === other.faction
      && item.type === other.type && item.hp === other.hp && item.meleeAtk === other.meleeAtk
      && item.rangedAtk === other.rangedAtk
      && item.skills.length === other.skills.length && item.skills.every((s, j) => s === other.skills[j]);
  });
}

/** 内容口径逐字段比（与 `sameDraftProgressRows` 一样：两边都是 null 才算一样）。 */
export function sameDraftListFrames(a: NetDraftListFrame | null, b: NetDraftListFrame | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.seat !== b.seat || a.total !== b.total || a.instruction !== b.instruction) return false;
  // `canConfirm` 今天由 `picked`／`qun`／`total` 派生，理论上不会单独换；这里照比一遍的理由是那句"拒不得静默"：
  // 拒话与闸门读数任何一个换了都必须发得出去，判据不该依赖"这两个字段一定一起动"这种推导。
  if (a.canConfirm !== b.canConfirm) return false;
  if (a.picked.length !== b.picked.length) return false;
  if (!a.picked.every((key, i) => key === b.picked[i])) return false;
  return sameItems(a.main, b.main) && sameItems(a.qun, b.qun);
}

/** 房主重判的一条结论：要么"我照这一条办事"，要么带一句人话说明为什么不走（不许静默）。 */
export type DraftVerdict = { ok: true } | { ok: false; reason: string };

/**
 * 客人交回来的那一条（⑤d）。
 *
 * ⚠️ 这里**没有** `seat`：网上传的那一帧确实带着他自报的席位号（信封的形状，`netProtocol` 那一侧照原样解析），
 * 但那个数在进门这一刻就地丢掉——房主用的是**自己那张席位表**里的绑定席位，不是他报的那一个。
 * 少抄一遍＝少一处"两边的席位读数可能不一样"的可能（与 ⑤a 那颗准备钮同一个手法：只认这个人，不认他自称的身份）。
 */
export type IncomingDraft =
  | { kind: 'pick'; peer: string; key: string }
  | { kind: 'confirm'; peer: string };

/** 当下真正在挑将的那一席（不在那一段／席位表短了 ⇒ `null`）。 */
function pickingSeatOf(facts: DraftListFacts): number | null {
  if (facts.phase !== 'generalDraft') return null;
  return facts.seats[facts.draftPlayerIndex] ?? null;
}

/**
 * 三条共用的前段（派单 2026-10-30 逐字列的那三条闸）：
 * ⓪发送者绑的那一席就是当下 `draftPlayerIndex` 那一席（没轮到＝不认，也就冒充不了别席）；
 * ①房主**给这一位算过并真的发过**一帧，且帧上的席位与他当下绑的席位是同一席。
 * 返回 `ok` 时带上那一帧，供调用方继续查编号；判不住时给一句人话（走已有的名单信封回给他）。
 *
 * 这里没有"客人说自己看到的是什么"这一格：他发回来的将名、档案号、理由，房主一个都不读（ARCH_MAP 第 7 条㈢）。
 */
function judgeShared(facts: DraftListFacts, sent: NetDraftListFrame | null, senderSeat: number | null): DraftVerdict {
  if (senderSeat === null) return { ok: false, reason: REFUSE_NOT_BOUND };
  if (facts.phase !== 'generalDraft') return { ok: false, reason: REFUSE_NOT_DRAFT };
  if (pickingSeatOf(facts) !== senderSeat) return { ok: false, reason: REFUSE_NOT_YOUR_TURN };
  if (sent === null) return { ok: false, reason: REFUSE_NO_FRAME };
  if (sent.seat !== senderSeat) return { ok: false, reason: REFUSE_OTHER_SEAT };
  return { ok: true };
}

/**
 * 重判客人交回来的那一颗点将钮。派单逐字：唯一依据＝房主**自己发给这一席的那一帧**。
 * 所以第四条件是"这个编号在那一帧的两份名单上"——不在就拒，绝不按客人带来的名字自己去凑一张牌。
 * 判下来之后怎么办（查那张牌、调 store 那颗）住在 `netHostDraftList`，这一层只说不合法不合法。
 */
export function judgeDraftPick(
  facts: DraftListFacts,
  sent: NetDraftListFrame | null,
  senderSeat: number | null,
  key: string,
): DraftVerdict {
  const shared = judgeShared(facts, sent, senderSeat);
  if (!shared.ok) return shared;
  const frame = sent as NetDraftListFrame;
  if (!frame.main.some((item) => item.key === key) && !frame.qun.some((item) => item.key === key)) {
    return { ok: false, reason: REFUSE_OFF_LIST };
  }
  return { ok: true };
}

/**
 * 重判客人交回来的那一次"确认"。比上面多两条：
 * ②这一席还没确认过（`draftPlayerIndex` 还指着这一席；交过卷那一格会往前挪，所以这一条同时挡住重复交卷）；
 * ③人数与群牌上下限**由房主自己再算一遍**——`store/gameStore.ts:345` 那颗 `confirmDraft()` 今天不查这些，
 *   收到就转交等于把热座界面那道闸（`GeneralDraft.tsx:21`）绕过去。算的是 `draftTally`，与那句人话同一个函数。
 */
export function judgeDraftConfirm(facts: DraftListFacts, sent: NetDraftListFrame | null, senderSeat: number | null): DraftVerdict {
  const shared = judgeShared(facts, sent, senderSeat);
  if (!shared.ok) return shared;
  const frame = sent as NetDraftListFrame;
  const tally = draftTally(frame.main, frame.qun, facts.pickedKeys, facts.total);
  if (!tally.canConfirm) {
    return { ok: false, reason: `还交不了卷：现在 ${tally.picked.length}/${facts.total} 名、群势力 ${tally.qunCount} 名（要 ${facts.total} 名、群势力 1-3 名）。` };
  }
  return { ok: true };
}

/**
 * 把线上那个位置编号查回**房主自己那两份名单里的那一张牌**。
 *
 * 编号与下标的对应关系住在 `draftListFactsOf`（`m${i}`＝`draftGenerals[i]`、`q${j}`＝`draftQunGenerals[j]`），
 * 所以这里比的是**帧上的 key** 与**同一份 facts 上的 key**：命中之后拿同一个下标去取店里那张对象。
 * ⚠️ 调用方只许把查出来的这个对象交给 store 那颗 `selectDraftGeneral`，绝不把线上传来的任何东西当牌用
 * （派单 2026-10-30 逐字）。查不到 ⇒ `null`：那一颗不办事，界面也不会静默不动，因为调用方会回一句拒话。
 */
export function cardAtKey<TCard extends { id?: string }>(
  main: readonly TCard[],
  qun: readonly TCard[],
  mainItems: readonly NetDraftItem[],
  qunItems: readonly NetDraftItem[],
  key: string,
): TCard | null {
  const mi = mainItems.findIndex((item) => item.key === key);
  if (mi >= 0) return main[mi] ?? null;
  const qi = qunItems.findIndex((item) => item.key === key);
  if (qi >= 0) return qun[qi] ?? null;
  return null;
}
