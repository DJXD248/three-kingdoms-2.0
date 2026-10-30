/**
 * 联机切片⑤b（v2.9.25）征召进度表的那笔账——**只算数量，一张牌也不搬**。
 *
 * 用户 2026-10-30 把这张表能说什么裁死了：「和热座一样」**不**延伸到别人那几格的私有信息，
 * 客人看得见的就是进度那一行话（「第 2 席正在征召（已选 7/10）」）⇒
 * 这一层的输入是房主自己那台机器上的征召事实，输出是一桌每席一行、行里只有座次与两个数。
 * 候选名单、已选的将名、档案号一个都不进来（`netDraftProgressPrivacy.test.ts` 拿真 store 扫过一遍）。
 *
 * 三条判据与准备表那三条同一个形状：
 *
 * ㈠征召还没开始（掷骰、分势力那几段）⇒ **这张表没有话要说**（返回 null，不发一帧空表）。
 *   征召跑完之后不撒手：那一段结束不等于"没发生过"，客人有权看见一桌人都 `done` 的那一份。
 * ㈡正在征召那一席的 `picked` 取自房主当下勾了几名，已完成那一席取自那一席的征召池长度——
 *   两处都是房主机器上的事实，客人这边绝不"按 10 倒推"（沙盒与 AI 席能勾出别的数）。
 * ㈢内容没变＝同一个引用（房主每次点将、每次界面重绘都会问一遍，多数时候那张表根本没动）。
 *
 * 这里没有"该发给哪一席"那一回事：这张表全桌广播。指名给某一席的那条路是征召问答通道，
 * 这一版**没有**它（用户 2026-10-30 令等外部评审二检，不许先建）。
 */
import { MAX_NAME_LENGTH, type NetDraftProgressRow, type NetDraftState } from './netProtocol';
import { clampText } from './netSeat';

/**
 * 征召要凑够几名＝这张表的分母。房主那侧今日两处写着同一个字面量
 * （勾第 11 名时挡回去的 `gameStore.ts` 的 `selectDraftGeneral`、面板上那句「已选 n/10」），
 * 线上这一份由 `netDraftProgress.test.ts` 拿 store 那条真闸钉住：两处数不一致就红。
 */
export const DRAFT_PICK_TOTAL = 10;

/** 房主机器上一席的最小事实：座次（引擎的 playerId）、界面上的名字、已经征召进池几名。 */
export type DraftSeatFact = { seat: number; name: string; poolSize: number };

/**
 * 出这张表要读的四样，全部来自房主自己的 store（`seats` 的顺序就是征召的先后＝store 的数组下标）。
 * 这里不 import store：接线那头（`components/NetRoomBridge`）负责把 store 翻成这四样，
 * 与 `netHostAuthority` 读 `EngineState` 同一个手法——判据住这一层，搬运住接线。
 */
export type DraftProgressFacts = {
  phase: string;
  seats: DraftSeatFact[];
  draftPlayerIndex: number;
  pickedCount: number;
};

/** 征召已经翻过去的那几段：表还要说话（一桌人都 `done`），但不再有人说"正在"。 */
const AFTER_DRAFT_PHASES: readonly string[] = ['drawing', 'playing', 'gameOver'];

function rowOf(seat: DraftSeatFact, state: NetDraftState, picked: number): NetDraftProgressRow {
  return {
    seat: seat.seat,
    name: clampText(seat.name, MAX_NAME_LENGTH, `席位${seat.seat}`),
    state,
    picked,
    total: DRAFT_PICK_TOTAL,
  };
}

/** 行的顺序＝席位号从小到大，与席位表同一把尺（两张表并排看不会数反）。 */
const bySeat = (a: NetDraftProgressRow, b: NetDraftProgressRow): number => a.seat - b.seat;

/**
 * 把房主那台机器上的征召格翻成这张表要的四样（`NetRoomBridge` 与进度表的隐私证人共用这一份）。
 * 摘出来的只有座次、称呼、两名数——`players[i].generalPool` 与那两格候选名单**整格不进**，
 * 这里连长度都只取一个数（`poolSize`）。
 */
export function draftFactsOf(state: {
  phase: string;
  draftPlayerIndex: number;
  selectedDraftGenerals: readonly unknown[];
  players: readonly { id: number | string; name: string; generalPool: readonly unknown[] }[];
}): DraftProgressFacts {
  return {
    phase: state.phase,
    draftPlayerIndex: state.draftPlayerIndex,
    pickedCount: state.selectedDraftGenerals.length,
    // 这里的顺序就是征召的先后（`confirmDraft` 按这个下标一席一席往前走）。
    seats: state.players.map((p) => ({ seat: Number(p.id), name: String(p.name ?? ''), poolSize: p.generalPool.length })),
  };
}

export function buildDraftProgressRows(facts: DraftProgressFacts): NetDraftProgressRow[] | null {
  // 一席都没有＝桌上还没摆椅子（没建房、或已经清场），这跟"征召还没开始"是同一句话。
  if (facts.seats.length === 0) return null;
  if (facts.phase === 'generalDraft') {
    return facts.seats
      .map((seat, index) => {
        const state: NetDraftState =
          index < facts.draftPlayerIndex ? 'done' : index === facts.draftPlayerIndex ? 'picking' : 'waiting';
        return rowOf(seat, state, state === 'picking' ? facts.pickedCount : state === 'done' ? seat.poolSize : 0);
      })
      .sort(bySeat);
  }
  if (AFTER_DRAFT_PHASES.includes(facts.phase)) {
    return facts.seats.map((seat) => rowOf(seat, 'done', seat.poolSize)).sort(bySeat);
  }
  return null;
}

/** 内容口径与 `sameReadyRows` 一样逐字段比；两边都是 null 才算一样。 */
export function sameDraftProgressRows(a: NetDraftProgressRow[] | null, b: NetDraftProgressRow[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return row.seat === other.seat && row.name === other.name && row.state === other.state
      && row.picked === other.picked && row.total === other.total;
  });
}
