/**
 * 乙 线第四片（2026-11-02）＝**逐席私有视图由进程发**。
 *
 * 前三片把开局、名册交料、以及牌桌那 14 步都搬到了浏览器外面；这一片搬的是**发出去的那一份**。
 * 玩家那台机器收到的应当只是他自己那一席能看见的字节——这件事今天的判据已经存在（`snapshotView.buildBroadcastView`
 * 那份字段级白名单、`snapshotBroadcaster` 那套节流/并笔/按席位去重、`netHostAuthority` 那张席位表与逐席清单），
 * 缺的只是**谁来喂它们**。生产那条路喂的是房主浏览器 store 里的那份账（`NetRoomBridge`）；
 * 这一份把同一批发布者接到进程那台机器的账上（`host.engineState`／`legalTableActions`／`applyTableAction`）。
 *
 * 本文件**一条判据也不写**：遮蔽、去重、封顶、验编号、退回怎么说，全是复用。之所以能这么薄——
 * 那三个发布者当初就是按"数据源从外面注入"造的（`readState`／`probe`／`execute`／`send` 全是入参），
 * 换一台机器喂它不需要改一行判据。反过来，这里要是冒出了第二套遮蔽或第二套清单算法，
 * 就正是本线一路在防的那种东西（两份会漂移的口径）。
 *
 * 两格**不许**出现在这里的东西，钉在 `seatViewCompute.test.ts` ㈠：
 *  ㈠ 本机存档与浏览器（`localStorage`／`document`／`window`／`zustand`／Node 的 `fs`），
 *     以及那份一加载就读存档的 `gameStore`——名册来源裁的是**甲**，不能靠宿主自带的存档冒充交上来的那份；
 *  ㈡ 遮蔽那一层的任何零件（`HIDDEN_MARKER`／`maskCount`）。进程只**调**那把尺，绝不**再造**一把。
 *
 * ⚠️ 照实说，这一片**没有**接的三格（登记在交接文档，不许糊）：
 *  ㈢ 生产联机屋里的发送方还住在房主浏览器（`NetRoomBridge` 喂的是 store 那份账）。把这一份换上去＝
 *     要先有"算牌机器到房间"那根跨机器的线，那条线至今没接（乙 线第 0 步之后每一片都写着同一句）。
 *  ㈣ 人类席回合结束那扇"逢人就问"的窗（`tableCompute.ts` 文件头 ⚠️ 留给这一片的那一格）：**窗本身没搬**，
 *     但"问什么、怎么答"这两件事在本片之后**不再缺线上通道**——量出来的事实三条：
 *     ① 那一格要问的技能本来就出现在这一席的私有清单里（`netSeat.skillLabel` 读的正是
 *     `listTurnEndSkillCandidates`，与浏览器开的那扇窗同一份候选判据；`rules/legalActions.ts` 逐颗
 *     推 `ACTIVATE_SKILL`），所以"那位玩家看不见这个选项"并不成立；
 *     ② 答＝客人交回一个编号，走已有的 `act`/`actno` 两个信封，房主按当下重算才执行——**不用新增信封种类、
 *     `NET_PROTOCOL_VERSION` 仍 1**（本片零协议改动）；
 *     ③ 真缺的是**进程那侧的驱动循环不为人类席停这一拍**：`playTable` 一路按策略往下走，
 *     `endTurn` 响完强制发动就直接提交，那里没有"等着人答"这一格。它归界面与措辞那一片（末片），
 *     因为"什么时候算等到了、等了多久算超时"是要跟玩家说话的决定，不是发视图这层能替它定的。
 *  ㈤ 逐席视图里**不含**待答的问句本体（`NEVER_SENT_TOP_LEVEL` 那三格：游标／抉择／响应队列），
 *     这一条沿用切片④已有的口径，这一片不放宽一寸。
 */
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { NetEnvelope, NetPeer, NetSeatRow } from '../network/netProtocol';
import { startHostAuthority, type HostAuthority } from '../network/netHostAuthority';
import {
  startSnapshotBroadcaster,
  type SnapshotBroadcaster,
  type SnapshotRecipient,
} from '../network/snapshotBroadcaster';
import { buildBroadcastView } from '../network/snapshotView';
import { applyTableAction, legalTableActions, type TableHost } from './tableCompute';

export type { SnapshotRecipient };

/**
 * 进程现算的**一席一份**局面。`seat`＝引擎的 playerId（席位号就是它，与 `netSeat.buildSeatMap` 同一口径）；
 * 给 null＝观战面（全桌只发数量）。遮蔽那把尺住在 `snapshotView`，这里只调它。
 */
export function processSeatView(host: TableHost, seat: number | null): EngineState {
  return buildBroadcastView(host.engineState, seat);
}

/** 进程侧那份读数的取法——发视图与发清单两条路都读这一处，绝不另拿浏览器那份账。 */
const processReading = (host: TableHost) => (): EngineState => host.engineState;

export type ProcessViewDeps = {
  host: TableHost;
  /** 屋里现在有哪些收件人、各坐哪一席（还没绑上的拿全遮那份＝观战面）。 */
  recipients: () => SnapshotRecipient[];
  /** 交给传话线：指名给 `to`。返回 false＝线没开着。 */
  send: (view: EngineState, to: string) => boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  minIntervalMs?: number;
};

/**
 * 逐席私有视图的**发布者**（进程那侧）。返回的就是 `snapshotBroadcaster` 那个口子——
 * 节流、并笔、按席位去重那三件事一个字也没重写，换的只有"读谁的账"。
 */
export function startProcessSeatViews(deps: ProcessViewDeps): SnapshotBroadcaster {
  return startSnapshotBroadcaster({
    readState: processReading(deps.host),
    recipients: deps.recipients,
    send: deps.send,
    now: deps.now,
    schedule: deps.schedule,
    cancel: deps.cancel,
    minIntervalMs: deps.minIntervalMs,
  });
}

export type ProcessAuthorityDeps = {
  host: TableHost;
  /** 进程这一侧连线的自己（信封的发话人）。 */
  selfId: () => string;
  /** 名册（顺序＝进房顺序，绑座就按它）。 */
  peers: () => NetPeer[];
  send: (envelope: NetEnvelope) => boolean;
  seatMapSink?: (rows: NetSeatRow[]) => void;
};

/**
 * 席位表＋逐席清单＋收请求那三件事的**把关与执行**（进程那侧）。
 * 三个口子全接进程的真值：清单＝`legalTableActions`（只读探针，不动牌桌、不动游标），
 * 执行＝`applyTableAction`（与热座、AI 司机、联机客人同一个翻译出口），
 * 局面＝`host.engineState`。验证那一段（按当下重算、编号对得上才走、对不上退回并说清）
 * 是 `netHostAuthority` 里那一份，这里一个字没改。
 */
export function startProcessSeatAuthority(deps: ProcessAuthorityDeps): HostAuthority {
  const host = deps.host;
  return startHostAuthority({
    selfId: deps.selfId,
    peers: deps.peers,
    readState: processReading(host),
    probe: (seat: number) => legalTableActions(host, seat),
    execute: (seat: number, action: GameAction) => applyTableAction(host, seat, action),
    send: deps.send,
    seatMapSink: deps.seatMapSink,
  });
}
