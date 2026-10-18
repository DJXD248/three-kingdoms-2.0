/**
 * J4 席位绑定与"这一步叫什么"（v2.9.11）。
 *
 * 这一层只有**判据**，没有引擎、没有 store、没有网络：给它房主当下的局面与
 * 在场名单，它回答三件事——
 *
 *  1. **谁坐哪一席**（{@link buildSeatMap}）：房主占第一个非 AI 席，客人按进房
 *     顺序占后面的非 AI 席；AI 席永不绑（司机在打，不在人的名单里）。绑不到人的
 *     那一席 `peer:null`＝现在仍由房主那台机器自己点（热座）。
 *  2. **这一步怎么称呼**（{@link moveKey} + {@link describeMove}）：线上传的是
 *     "编号＋人读的那句话"，**动作本体绝不上线**。编号由"清单里的位置＋动作类型＋
 *     载荷的确定性摘要"拼成：同一个局面重算两次得到同一个编号，清单内容或顺序一变，
 *     旧编号自然失效（那就是"这一步已经不成立"）。载荷里不含 `action.id`——它是
 *     进程计数器，重算必变，掺进去等于每次刷新都换一批按钮。
 *  3. **不让走的时候怎么说**（{@link refusalReason}）：门码翻成一句人读的话，
 *     认得的照翻，认不出的把原码带上（绝不编一句好听的话糊弄过去）。
 *
 * 措辞对齐牌桌（§12-112：显示那句必须逐字对得上引擎行为）——「⏭️结束回合」「🚶前进」
 * 「💊补给」「🛡️叠甲」「⚔️登场将领」「🚫 跳过」「结算失去体力」「✓ 确认」与
 * 「选项N：…」都取自热座界面已有的那几行，不另立第二套词。
 */
import type { ActionType, GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import { getReactionAsk } from '../skills/reactionChain';
import { listTurnEndSkillCandidates } from '../skills/turnEndSkills';
import {
  MAX_MOVE_ITEMS,
  MAX_MOVE_LABEL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_REFUSAL_LENGTH,
  type NetMoveItem,
  type NetSeatRow,
} from './netProtocol';

/** 一个能坐人的席位（从局面里摘出来的最小输入）。 */
export type SeatSpec = { seat: number; isAi: boolean; label: string };
/** 在场的人：id＝连线里的 peerId，name＝自报并被房主校验过的名字。 */
export type PeerSpec = { id: string; name: string };

function clampText(raw: unknown, max: number, fallback: string): string {
  // 这些字符是客人自报的：一个换行就能把席位表那行拆成两行，所以整段控制字符一律抹掉。
  // eslint-disable-next-line no-control-regex
  const text = String(raw ?? '').replace(/[\u0000-\u001f]/g, '').trim();
  if (!text) return fallback;
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

/**
 * 席位表。只列**能坐人的席位**（非 AI 席）——客人那边的快照本来就带 `isAi`，
 * AI 席再列一次等于把房主的配置抄上线。顺序＝席位号从小到大。
 */
export function buildSeatMap(opts: {
  seats: SeatSpec[];
  host: PeerSpec;
  guests: PeerSpec[];
}): NetSeatRow[] {
  const holdable = [...opts.seats]
    .filter(s => Number.isInteger(s.seat) && s.isAi !== true)
    .sort((a, b) => a.seat - b.seat);
  const people = [opts.host, ...opts.guests];
  return holdable.map((seat, index) => {
    const person = people[index];
    return person
      ? { peer: person.id, seat: seat.seat, name: clampText(person.name, MAX_NAME_LENGTH, '玩家') }
      : { peer: null, seat: seat.seat, name: clampText(seat.label, MAX_NAME_LENGTH, `席位${seat.seat}`) };
  });
}

/** 客人侧照抄：我坐哪一席？（没绑到我 ⇒ null，这一格只看不动） */
export function seatOfPeer(rows: NetSeatRow[] | null, peerId: string): number | null {
  if (!Array.isArray(rows)) return null;
  const hit = rows.find(r => r.peer === peerId);
  return hit ? hit.seat : null;
}

/** 两张席位表内容一样吗。房主每次局面变化都会重发，多数时候那张表根本没动。 */
export function sameSeatRows(a: NetSeatRow[] | null, b: NetSeatRow[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((row, i) => row.seat === b[i].seat && row.peer === b[i].peer && row.name === b[i].name);
}

/** 这一席现在是不是我（客人点按钮前的第一道闸；真正的合法性在房主那边）。 */
export function isMySeat(rows: NetSeatRow[] | null, peerId: string, seat: number): boolean {
  return seatOfPeer(rows, peerId) === seat;
}

// ── 编号：位置＋类型＋载荷摘要 ────────────────────────────────────────────

/** FNV-1a（32 位）：零依赖、跨端逐字稳定的小摘要。只用来给按钮编号，不扛安全。 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 载荷的确定性写法：对象的键按字典序排，数组保持记录顺序，`undefined` 丢掉。
 * 不这么做的后果很实际——同一个动作在不同调用点可能带出不同的键顺序，
 * 于是"重算两次"给出两个编号，客人每次点都会被判成"这一步已经不成立"。
 */
export function canonicalPayload(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalPayload(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function moveKey(index: number, action: GameAction): string {
  return `${index}-${action.type}-${fnv1a(canonicalPayload(action.payload ?? null))}`;
}

/** 清单里的一条：编号＋那句话＋动作类型（封顶时房主要靠类型留住那个"收尾出口"）。 */
export type SeatMove = { key: string; label: string; kind: ActionType };

/** 发给某一位客人的那一份清单（封顶后的形状，也是客人注册表里存的那一格）。 */
export type SeatMoveList = { seat: number; items: NetMoveItem[]; omitted: number };

export function buildSeatMoves(state: EngineState, actions: GameAction[]): SeatMove[] {
  return actions.map((action, index) => ({
    key: moveKey(index, action),
    label: describeMove(state, action),
    kind: action.type,
  }));
}

/** 线上传的那一小格（类型留在房主自己手里，不占线上字节）。 */
export function toWireItems(moves: SeatMove[]): NetMoveItem[] {
  return moves.map(m => ({ key: m.key, label: m.label }));
}

/** 收尾出口：清单被封顶时也要留住的那一步——它永远合法，是"这一步我过完了"。 */
const GUARANTEED_EXITS: ActionType[] = ['END_TURN', 'CONFIRM_DRAW', 'SKIP_REACTION'];

/**
 * 封顶。一桌八人时合法集能上百条（每个将领 × 每个能落的格子），线上和界面都装不下。
 * 取记录顺序的前 `max` 条，并且**保证收尾出口一定在**：宁挤掉一条攻击，也不让客人
 * 连"结束回合"都点不到——那会把整桌停在这一席。`omitted` 是被挤掉的条数，界面上
 * 要照这个数字说一句真话（房主本机那一侧仍看得见全部）。
 */
export function capSeatMoves(
  moves: SeatMove[],
  max: number = MAX_MOVE_ITEMS,
): { sent: NetMoveItem[]; omitted: number } {
  if (moves.length <= max) return { sent: toWireItems(moves), omitted: 0 };
  const head = moves.slice(0, max);
  if (!head.some(m => GUARANTEED_EXITS.includes(m.kind))) {
    const exit = moves.find(m => GUARANTEED_EXITS.includes(m.kind));
    if (exit) head[head.length - 1] = exit;
  }
  return { sent: toWireItems(head), omitted: moves.length - head.length };
}

export function findSeatMove(moves: SeatMove[], key: string): SeatMove | null {
  return moves.find(m => m.key === key) ?? null;
}

/**
 * 编号在清单里的下标（房主执行那一步要用）。`buildSeatMoves` 与传进来的动作数组同序，
 * 所以这个下标取得回动作本体——线上永远只跑编号，本体留在房主自己手里。
 */
export function findSeatMoveIndex(moves: SeatMove[], key: string): number {
  return moves.findIndex(m => m.key === key);
}

/** 两份清单内容一样吗：座位号、每一条的编号与句子、以及"还有几条没列出来"都算内容。 */
export function sameMoveLists(a: SeatMoveList | null, b: SeatMoveList): boolean {
  if (!a) return false;
  if (a.seat !== b.seat || a.omitted !== b.omitted || a.items.length !== b.items.length) return false;
  return a.items.every((item, i) => item.key === b.items[i].key && item.label === b.items[i].label);
}

// ── 人读的那句话 ──────────────────────────────────────────────────────────

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function runtimeId(card: unknown): string {
  const c = card as { instanceId?: string; id?: string } | null | undefined;
  return String(c?.instanceId ?? c?.id ?? '');
}

function playerById(state: EngineState, playerId: number | null | undefined) {
  return state.players.find(p => p.id === playerId);
}

/** 场上／手里的将，按运行时实例号找名字；`base_3` 是营地。 */
function nameOfRef(state: EngineState, ref: string): string {
  if (!ref) return '未知';
  const base = /^base_(\d+)$/.exec(ref);
  if (base) {
    const owner = playerById(state, Number(base[1]));
    return owner ? `${clampText(owner.name, MAX_NAME_LENGTH, '玩家')}的营地` : `营地 ${base[1]}`;
  }
  for (const p of listOf<Record<string, unknown>>(state.players)) {
    for (const fg of listOf<{ general?: { name?: unknown } }>(p.fieldGenerals)) {
      if (runtimeId(fg?.general) === ref) return clampText(fg?.general?.name, MAX_NAME_LENGTH, '将领');
    }
    for (const card of listOf<{ name?: unknown }>(p.hand)) {
      if (runtimeId(card) === ref) return clampText(card.name, MAX_NAME_LENGTH, '牌');
    }
  }
  return '不在场上的将';
}

function zoneName(state: EngineState, target: unknown): string {
  const t = target as { zone?: string; slot?: number; areaOwnerId?: number | null } | undefined;
  if (!t) return '未知位置';
  if (t.zone === 'battle') return `战场第${Number(t.slot ?? 0) + 1}格`;
  const owner = playerById(state, t.areaOwnerId as number);
  const who = owner ? clampText(owner.name, MAX_NAME_LENGTH, '玩家') : '某家';
  const cell = Number(t.slot ?? 0) + 1;
  return t.zone === 'camp' ? `${who}的营地区域第${cell}格` : `${who}的前线第${cell}格`;
}

function cardCount(payload: Record<string, any> | undefined, field: string): number {
  return listOf(payload?.[field]).length;
}

/** 技能那一格的两个来源：响应问句（欠答那一席）／回合结束候选。 */
function skillLabel(state: EngineState, playerId: number, skillId: string, generalId: string): string {
  const ask = getReactionAsk(state);
  const reaction = ask?.playerId === playerId
    ? ask.options.find(o => o.skillId === skillId)
    : undefined;
  if (reaction) {
    const who = clampText(ask?.generalName ?? nameOfRef(state, generalId), MAX_NAME_LENGTH, '将');
    return `⚡${who}【${clampText(reaction.skillName, MAX_NAME_LENGTH, '技能')}】`;
  }
  const candidate = listTurnEndSkillCandidates(state, playerId).find(c => c.definition.id === skillId);
  if (candidate) {
    const who = clampText(candidate.generalName, MAX_NAME_LENGTH, '将');
    return `⚡${who}【${clampText(candidate.definition?.name, MAX_NAME_LENGTH, '技能')}】`;
  }
  return '⚡发动技能';
}

/** 一句人读的"这一步"，取自热座已有的措辞；长度收在线上的上界里，长了在词边界收口。 */
export function describeMove(state: EngineState, action: GameAction): string {
  const p = action.payload as Record<string, any> | undefined;
  const mine = (v: unknown) => clampText(v, MAX_NAME_LENGTH, '我');
  const seatName = mine(playerById(state, action.playerId)?.name ?? `玩家${action.playerId}`);
  switch (action.type) {
    case 'DRAW': {
      const fromGenerals = Number(p?.fromGeneralPool ?? 0);
      const fromCards = Number(p?.fromCardPool ?? 0);
      const total = fromGenerals + fromCards;
      if (total === 0) return '🃏抽取 0 张（直接确认）';
      const parts = [
        fromGenerals > 0 ? `将领池 ${fromGenerals}` : '',
        fromCards > 0 ? `抽牌堆 ${fromCards}` : '',
      ].filter(Boolean).join(' ＋');
      return clampText(`🃏抽取 ${total} 张（${parts}）`, MAX_MOVE_LABEL_LENGTH, `🃏抽取 ${total} 张`);
    }
    case 'CONFIRM_DRAW':
      return '✓ 确认（抽完了）';
    case 'RESOLVE_BASE_LOSS':
      return '🏯结算失去体力';
    case 'DEPLOY_GENERAL':
      return clampText(
        `⚔️登场将领：${mine(p?.general?.name)} → 营地区域第${Number(p?.slot ?? 0) + 1}格（消耗${cardCount(p, 'consumeCards')}张）`,
        MAX_MOVE_LABEL_LENGTH,
        `⚔️登场将领：${mine(p?.general?.name)}`,
      );
    case 'MOVE_GENERAL':
      return clampText(
        `🚶前进：${nameOfRef(state, String(p?.generalId ?? ''))} → ${zoneName(state, p?.target)}`
        + (p?.consumeCard ? '（消耗1张）' : ''),
        MAX_MOVE_LABEL_LENGTH,
        '🚶前进',
      );
    case 'ATTACK':
      return clampText(
        `${p?.ranged === true ? '🏹远程' : '⚔️近战'}攻击：${nameOfRef(state, String(p?.attackerId ?? ''))} → ${nameOfRef(state, String(p?.targetId ?? ''))}`
        + (p?.consumeCard ? '（消耗1张）' : ''),
        MAX_MOVE_LABEL_LENGTH,
        '攻击',
      );
    case 'SUPPLY':
      return clampText(
        `💊补给：${nameOfRef(state, String(p?.generalId ?? ''))}（用${cardCount(p, 'consumeCards')}张）`,
        MAX_MOVE_LABEL_LENGTH,
        '💊补给',
      );
    case 'EQUIP_ARMOR':
      return clampText(
        `🛡️叠甲：${nameOfRef(state, String(p?.generalId ?? ''))}（军备${cardCount(p, 'armorCards')}张）`,
        MAX_MOVE_LABEL_LENGTH,
        '🛡️叠甲',
      );
    case 'ACTIVATE_SKILL':
      return clampText(
        skillLabel(state, action.playerId, String(p?.skillId ?? ''), String(p?.generalId ?? '')),
        MAX_MOVE_LABEL_LENGTH,
        '⚡发动技能',
      );
    case 'SKIP_REACTION':
      return '🚫 跳过（这一格一个也不发动）';
    case 'CHOOSE_OPTION': {
      const index = Number(p?.optionIndex ?? 0);
      const option = listOf<{ label?: unknown }>(state.pendingChoice?.options)[index];
      // 欠答那一席就是动作者（合法集只发给 pending.playerId），所以名字取本席。
      return clampText(`🔀选项${index + 1}：${option?.label ?? '（这一项没有文字）'}（${seatName}）`, MAX_MOVE_LABEL_LENGTH, `🔀选项${index + 1}`);
    }
    case 'END_TURN':
      return '⏭️结束回合';
    case 'SURRENDER':
      return '🏳️确认投降';
    case 'BEGIN_DRAW':
      return '🃏开始抽牌';
    default:
      return clampText(`（这一步我还不认识：${String(action.type)}）`, MAX_MOVE_LABEL_LENGTH, '（这一步还不认识）');
  }
}

// ── 退回时怎么说 ──────────────────────────────────────────────────────────

/** 房主自己的那几句话（不走引擎门码，因为它们是"这一步轮不到你"这一层的话）。 */
export const MOVE_REFUSAL = {
  notBound: '这一席现在没交给你，我这边看它还是本机在点',
  aiSeat: '这一席是电脑在打，交不出去',
  boundToOther: '这一席绑的是别人，我不能让你点他的座',
  notMyTurn: '现在轮不到这一席动手（或者局面已经走到下一步了）',
  stale: '这一步已经不成立——清单是按房主当下的局面重算的，牌一动就换一批',
  unknownKey: '这个编号我这边算不出来（清单变了，或者这一步本来就不是合法动作）',
  notExecuted: '这一步引擎当场没收下，牌桌没动',
} as const;

/** 引擎与校验器的门码 → 人读（逐字来自 `src/rules` 与各 resolver 的 reason）。 */
const REASON_TEXT: Record<string, string> = {
  INVALID_ACTION: '这一步的形状不对',
  NOT_CHOICE_PLAYER: '这个选择不是你这席要答的',
  CHOICE_PENDING: '还有个选择没答完，先答它',
  REACTION_PENDING: '还有个响应没问完',
  NOT_REACTION_PLAYER: '这一格轮不到你表态',
  NOT_DRAW_PLAYER: '现在不是你这席抽牌',
  NOT_CURRENT_PLAYER: '现在轮不到这一席行动',
  ACTION_NOT_ALLOWED_IN_PHASE: '这一步在当前阶段不让走',
  INVALID_ATTACK_PAYLOAD: '攻击这一步缺了要打谁',
  INVALID_DEPLOY_PAYLOAD: '登场这一步缺了要上哪员将',
  INVALID_SUPPLY_PAYLOAD: '补给这一步缺了补给谁',
  INVALID_ARMOR_PAYLOAD: '叠甲这一步缺了上哪员将',
  INVALID_MOVE_PAYLOAD: '前进这一步缺了走到哪',
  INVALID_ACTIVATE_SKILL_PAYLOAD: '发动技能这一步缺了技能编号',
  INVALID_CHOOSE_OPTION_PAYLOAD: '选择这一步缺了选项编号',
  INVALID_SKIP_REACTION_PAYLOAD: '跳过这一格没点名是哪一格',
  INVALID_CAMP_SLOT: '这个营地格子不存在',
  CAMP_SLOT_OCCUPIED: '这个营地格子已经站了将',
  GENERAL_ALREADY_DEPLOYED: '这员将已经在场上',
  GENERAL_NOT_IN_HAND: '这员将不在手里',
  GENERAL_NOT_ON_FIELD: '这员将不在场上',
  GENERAL_NOT_CONTROLLED: '这员将不是你的',
  GENERAL_DEFEATED: '这员将已经阵亡',
  GENERAL_IS_ARMING: '这员将在整备中，本回合不能动',
  GENERAL_ALREADY_ARMING: '这员将已经在整备中',
  GENERAL_ALREADY_MOVED: '这员将这回合已经走过',
  GENERAL_ALREADY_SUPPLIED: '这员将这回合已经补过',
  GENERAL_ALREADY_FULL_HP: '这员将体力已满，不用补',
  GENERAL_CANNOT_CONSUME_SELF: '登场不能拿自己当消耗',
  INVALID_DEPLOY_COST: '登场的消耗张数不对',
  CONSUMED_CARD_NOT_IN_HAND: '要消耗的那张牌不在手里',
  DUPLICATE_CONSUMED_CARD: '同一张牌不能消耗两次',
  MOVE_COST_CARD_NOT_IN_HAND: '前进要消耗的那张牌不在手里',
  SCHOLAR_REQUIRES_MOVE_COST: '文将前进必须消耗 1 张手牌',
  WARRIOR_MOVE_HAS_NO_COST: '武将前进不能带消耗',
  INVALID_MOVE_TARGET: '这个位置去不了',
  INVALID_SUPPLY_COST: '补给的消耗张数不对',
  INSUFFICIENT_SUPPLY_COST: '补给的消耗不够',
  SUPPLY_COST_CARD_NOT_IN_HAND: '补给要用的牌不在手里',
  SUPPLY_REQUIRES_CARD_COST: '补给必须消耗手牌',
  SUPPLY_TARGET_DEAD: '要补的将已阵亡',
  SUPPLY_TARGET_NOT_CONTROLLED: '要补的将不是你的',
  SUPPLY_TARGET_NOT_FOUND: '要补的将找不到了',
  NO_ARMOR_SELECTED: '一张军备也没选',
  NON_ARMAMENT_CARD_SELECTED: '选进去的不是军备牌',
  DUPLICATE_OR_INVALID_ARMOR_CARD: '军备牌重复或不合法',
  ARMOR_CARD_NOT_IN_HAND: '那张军备牌不在手里',
  ARMOR_CAPACITY_EXCEEDED: '叠甲超过体力上限了',
  DRAW_PLAYER_NOT_FOUND: '这一桌找不到该抽牌的那一席',
  DRAW_TOTAL_MISMATCH: '这次抽的张数对不上',
  NO_PENDING_DRAW: '现在没有等着的抽牌',
  NO_PENDING_DRAW_CONFIRMATION: '这一轮已经抽完了',
  NO_PENDING_BASE_LOSS: '现在没有要结算的营地失体力',
  PLAYER_NOT_FOUND: '找不到这一席',
  PLAYER_ALREADY_DEFEATED: '这一席已经阵亡',
  GENERAL_ALREADY_IN_POOL: '这员将已经在将领池里',
};

/** 门码翻成人读的一句；认不出来的原样带出编号，绝不编一句好听的话。 */
export function refusalReason(code: unknown): string {
  const key = String(code ?? '').trim();
  if (!key) return MOVE_REFUSAL.notExecuted;
  const text = REASON_TEXT[key];
  if (text) return text;
  if (key === 'SURRENDER') return '这一席已经举白旗了';
  return clampText(`这一步没走成：${key}`, MAX_REFUSAL_LENGTH, MOVE_REFUSAL.notExecuted);
}
