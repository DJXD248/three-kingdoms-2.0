import { useState, useSyncExternalStore } from 'react';
import { composeRoomUrl, createRoomCode } from '../network/netProtocol';
import { joinRoom, newPeerId, type NetRole, type SessionState } from '../network/netSession';
import {
  attachRoom,
  bumpNetRoom,
  clearRefusal,
  deliverHostAction,
  deliverHostReady,
  detachRoom,
  getActiveRoom,
  getDraftProgress,
  getGuestSnapshot,
  getNetStatus,
  getReadyTable,
  getRefusal,
  getSeatMap,
  getSeatMoves,
  getStartGate,
  receiveDraftProgress,
  receiveGuestSnapshot,
  receiveNetStatus,
  receiveReadyTable,
  receiveRefusal,
  receiveSeatMap,
  receiveSeatMoves,
  subscribeNetRoom,
} from '../network/netRoom';
import NetSpectator from './NetSpectator';
import { NetSeatPanel } from './NetSeatPanel';
import { NetPingPanel } from './NetPingPanel';
import { NetDraftProgressPanel } from './NetDraftProgressPanel';
import { NetSetupPanel } from './NetSetupPanel';

const DEFAULT_ADDRESS = 'ws://127.0.0.1:8787';
const PHASE_LABEL: Record<SessionState['phase'], string> = {
  idle: '还没连',
  dialing: '正在对上版本',
  'in-room': '已连上',
  refused: '被拒（没连上）',
  left: '已离开',
};

/**
 * J1 做到"连得上、版本对得上、看得见谁在场"；J2（v2.9.2）再加上"客人看得见
 * 房主那一局的牌桌"——发出去的是遮蔽过的局面；J3（v2.9.10）再加上
 * "左上角公开连线表＋15 秒掉线判定"（判定只有房主做，客人只照抄那张表）；
 * J4（v2.9.11）再加上"客人能动自己那一席"：椅子由房主绑，按钮由房主算，
 * 客人交回来的只是席位号与编号，合法性与执行全在房主那台机器。
 * 联机切片③（v2.9.25）把 J2 那"一份全桌通用的遮蔽局面"改成**按席位各出一份**：
 * 收件人自己那一席的手牌与征召池照发牌面，别人的仍只发数量；信封上多一个收件人，
 * 不是指名给自己的那一条客人不采纳。
 * 联机切片⑤a（v2.9.25）再加上"进房的人各点一颗准备钮"：那张表由房主算（谁点了、谁还算数），
 * 客人只照抄；全员准备之前房主那颗「开始游戏」按不下去（钮在、只是不亮，并写明还在等谁）。
 * 联机切片⑤·腿1（v2.9.25，㈢ 演出刀）再加上"开局那一段客人也看得见"：房主那边先把这一步算完
 * 就**立刻推**、推送不等回信，客人这一屏只画收到的那些数、没收到的写着「还没定」，本机一颗骰子也不摇。
 * 这一格**没有新增信封**：房主 store 的那段相位名本来就随每一条指名快照一起上线
 * （`store/engineAwareSetter.ts:20-27`＋`store/gameStateAdapter.ts:80`），点数／势力／座次又都是公开字段，
 * 所以"走到第几步"与"那一步定下的数"在同一份快照里一次到位，跨消息接头的空档不存在。
 * 剩下：客人自己那一席的候选名单与点将＝⑤c／⑤d、掉线后那两选一＝J5、局外开新局投票＝J6，都还没做。
 */
export default function OnlineLobby({ onClose }: { onClose: () => void }) {
  // 连线住在房间里（netRoom），不住在这个弹窗里：房主要关窗去开局，线不能断。
  const [session, setSession] = useState<SessionState | null>(() => getActiveRoom()?.connection.state ?? null);
  const [role, setRole] = useState<NetRole>(() => getActiveRoom()?.role ?? 'host');
  const [address, setAddress] = useState(() => getActiveRoom()?.address ?? DEFAULT_ADDRESS);
  const [name, setName] = useState(() => getActiveRoom()?.name ?? '玩家');
  const [roomCode, setRoomCode] = useState(() => getActiveRoom()?.roomCode ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const guestSnapshot = useSyncExternalStore(subscribeNetRoom, getGuestSnapshot, getGuestSnapshot);
  const netRows = useSyncExternalStore(subscribeNetRoom, getNetStatus, getNetStatus);
  // J4：席位表、给我这一席的清单、上一次没走成的那句话——三样都是房主发来的，这里只照抄。
  const seatMap = useSyncExternalStore(subscribeNetRoom, getSeatMap, getSeatMap);
  const seatMoves = useSyncExternalStore(subscribeNetRoom, getSeatMoves, getSeatMoves);
  const refusal = useSyncExternalStore(subscribeNetRoom, getRefusal, getRefusal);
  // 切片⑤a：那张准备表也是房主算好发来的（客人这边不自算"谁还算数"，更不自报自的家）。
  const readyTable = useSyncExternalStore(subscribeNetRoom, getReadyTable, getReadyTable);
  // 切片⑤b：那张征召进度表——同样只照抄房主算好的那一份（里面只有座次与两个数，没有牌）。
  const draftProgress = useSyncExternalStore(subscribeNetRoom, getDraftProgress, getDraftProgress);
  /** 闸门那句人话的唯一出处（房主那屏那颗「开始游戏」读的是同一格，两边不会说两套）。 */
  const gate = useSyncExternalStore(subscribeNetRoom, getStartGate, getStartGate);

  const hostId = session?.peers.find((p) => p.role === 'host')?.id ?? session?.selfId ?? '';
  /** 那颗准备钮只发给名册上那位真房主（`hostId` 在名册还没到时退回自己，那条路不能拿去点准备）。 */
  const hostPeerId = session?.peers.find((p) => p.role === 'host')?.id ?? '';

  /** 客人交回一步：线上只走「第几席＋编号」，动作本体与牌面内容一个都不发。 */
  const playMove = (item: { key: string; label: string }) => {
    const room = getActiveRoom();
    if (!room || !seatMoves || !session) return;
    room.connection.send({ t: 'act', from: session.selfId, to: hostId, seat: seatMoves.seat, key: item.key });
  };

  /**
   * 客人那一颗准备钮交回去的只有一个布尔。他点没点由**房主算出的那张表**说了算：
   * 按下去不算数（按钮不亮）直到表上自己那一行翻过来——客人这边绝不自家报自家。
   */
  const sendReady = (on: boolean) => {
    const room = getActiveRoom();
    if (!room || !session) return;
    room.connection.send({ t: 'ready', from: session.selfId, to: hostPeerId, on });
  };
  /** 我这一行的读数来自房主那张表（还没回来＝按"没点"算，再点一次还是同一句话，不会多点出一步）。 */
  const myReadyRow = session ? readyTable?.find((row) => row.peer === session.selfId) : undefined;

  const start = () => {
    setFormError(null);
    const code = role === 'host' ? createRoomCode() : roomCode;
    // 切片⑥：这一串号既进握手网址、又当线上那个 `selfId`，两边必须是同一个值——
    // 分成两次取数就会出现"网址上绑的是甲、帧里自报的是乙"，那份指名给乙的信就没人收了。
    const selfId = newPeerId();
    const composed = composeRoomUrl(address, code, selfId);
    if (!composed.ok) {
      setFormError(composed.reason);
      return;
    }
    if (role === 'host') setRoomCode(composed.roomCode);
    const connection = joinRoom(
      {
        role,
        name,
        url: composed.url,
        roomCode: composed.roomCode,
        selfId,
        onSnapshot: (snapshot) => {
          if (receiveGuestSnapshot(snapshot)) bumpNetRoom();
        },
        // J3：这条连线用心跳那一套（房主探测＋15 秒判定；客人只回话、只照抄房主发来的表）。
        heartbeat: {},
        onTable: (rows) => {
          receiveNetStatus(rows);
        },
        // J4：席位表与清单都是房主算好发来的，客人只照抄；清单一换，上一句退回说明跟着作废。
        onSeatMap: (rows) => {
          receiveSeatMap(rows);
        },
        onMoves: (msg) => {
          if (receiveSeatMoves(msg)) clearRefusal();
        },
        onRefusal: (msg) => {
          receiveRefusal(msg);
        },
        // 客人交回来的那一条只有房主那台机器会收到（发话人自己听不见）。
        onAction: (msg) => {
          deliverHostAction(msg);
        },
        // 切片⑤a：客人那颗准备钮递给房主那台机器上的准备发布者；那张表两边都进同一格，界面照抄。
        onReadyMark: (msg) => {
          deliverHostReady(msg);
        },
        onReadyTable: (rows) => {
          if (receiveReadyTable(rows)) bumpNetRoom();
        },
        // 切片⑤b：房主算好的那张征召进度表进同一格（房主自己那屏读的也是这一格，两边同一份）。
        onDraftProgress: (rows) => {
          if (receiveDraftProgress(rows)) bumpNetRoom();
        },
      },
      (next) => {
        setSession(next);
        bumpNetRoom();
      },
    );
    attachRoom({ role, name, roomCode: composed.roomCode, address, url: composed.url, connection });
  };

  const leave = () => {
    getActiveRoom()?.connection.leave();
    detachRoom();
    setSession(null);
  };

  const connected = session !== null;
  const shownCode = session?.roomCode ?? roomCode;
  const guestCount = (session?.peers ?? []).filter((p) => p.role === 'guest').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-amber-700/30 bg-gradient-to-b from-stone-950 to-stone-900 p-5 text-amber-100 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-xl font-bold text-amber-300">🌐 联网对战</h2>
            <p className="text-xs text-amber-200/50 mt-1">
              牌由房主那台机器算，传话程序只转发。现在做到"连得上、版本对得上、看得见谁在场，客人能看见房主那一局的牌桌、
              还能点自己那一席（按钮由房主算好发过来），全桌共用一张公开连线表，牌桌那一份按席位各发一条——各自看得见自己手里的牌，
              进房的人各点一颗准备钮、全员准备之前房主那颗「开始游戏」按不下去，开局那一段客人只画房主定下来发过来的数"。
            </p>
          </div>
          <button onClick={onClose} className="text-amber-300/60 hover:text-amber-200 text-lg leading-none">✕</button>
        </div>

        {!connected && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <RolePick active={role} onPick={setRole} />
            </div>

            <Field label="传话程序地址（局域网/虚拟网/服务器都填这里，换形态只换这一行）">
              <input value={address} onChange={e => setAddress(e.target.value)} className={inputClass} placeholder={DEFAULT_ADDRESS} />
            </Field>

            <Field label="我这边的名字（最多 12 个字；账户名功能还没做，这里先手填）">
              <input value={name} onChange={e => setName(e.target.value)} className={inputClass} maxLength={12} />
            </Field>

            {role === 'guest' && (
              <Field label="房间码（房主那边显示的那六个字符）">
                <input
                  value={roomCode}
                  onChange={e => setRoomCode(e.target.value.toUpperCase())}
                  className={inputClass}
                  placeholder="例如 K7M2QX"
                  maxLength={10}
                />
              </Field>
            )}

            {role === 'host' && (
              <p className="text-xs text-amber-200/45">
                点「开房间」会当场生成一个房间码；客人填同一个地址＋同一个房间码就能进来。
              </p>
            )}

            {formError && (
              <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                ⚠️ {formError}
              </div>
            )}

            <button onClick={start} className={buttonClass}>
              {role === 'host' ? '🏠 开房间' : '🚪 进房间'}
            </button>
          </div>
        )}

        {session && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Info label="状态">
                <span className={phaseColor(session.phase)}>{PHASE_LABEL[session.phase]}</span>
                <span className="text-amber-200/60"> · {session.note}</span>
              </Info>
              <Info label="房间码">{session.role === 'host' ? shownCode || '—' : session.roomCode ?? '—'}</Info>
            </div>

            {session.role === 'host' && shownCode && (
              <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2 text-xs">
                <p className="text-amber-300/80 mb-1">客人要填的两样东西</p>
                <p>地址：<span className="select-all text-amber-100">{address}</span></p>
                <p>房间码：<span className="select-all text-amber-100">{shownCode}</span></p>
                <p className="text-amber-200/40 mt-1">同一屋里填上面这行；异地经虚拟网或服务器时，把地址换成那台机器的地址。</p>
                {guestCount > 0 && (
                  <p className="text-emerald-300/80 mt-1">
                    现在有 {guestCount} 位客人正在看这一局。每次局面变化都按席位**各发一份**指名的局面：
                    那位客人自己那一席的手牌与征召池发的是牌面，别人的、以及牌堆顺序仍只发数量。
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="text-xs text-amber-300/70 mb-1.5">在场名单（共 {session.peers.length} 人）</p>
              {session.peers.length === 0 ? (
                <p className="text-xs text-amber-200/40">还没人进来。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {session.peers.map(peer => (
                    <li key={peer.id} className="flex items-center gap-2 rounded border border-amber-700/20 bg-black/20 px-2 py-1 text-sm">
                      <span className="font-bold">{peer.name}</span>
                      {peer.id === session.selfId && <span className="text-xs text-emerald-300/70">（我）</span>}
                      <span className="text-xs text-amber-200/45">{peer.role === 'host' ? '房主·算牌' : '客人'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 切片⑤a：谁准备了。这张表由房主算（连"这个人还算不算数"一起算），两边都只照抄。 */}
            <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2">
              <p className="text-xs text-amber-300/70 mb-1.5">准备情况（这张表由房主算，客人只照抄）</p>
              {readyTable === null ? (
                <p className="text-xs text-amber-200/40">房主那边还没把这张表算出来。</p>
              ) : readyTable.length === 0 ? (
                <p className="text-xs text-amber-200/40">屋里一个客人都没有，没有人在等。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {readyTable.map(row => (
                    <li key={row.peer} className="flex items-center gap-2 rounded border border-amber-700/20 bg-black/20 px-2 py-1 text-sm">
                      <span className="font-bold">{row.name}</span>
                      {row.peer === session.selfId && <span className="text-xs text-emerald-300/70">（我）</span>}
                      <span className={row.on ? 'text-xs text-emerald-300/80' : 'text-xs text-amber-200/45'}>
                        {row.on ? '✓ 已准备' : '还没点准备'}
                      </span>
                      {!row.counted && <span className="text-xs text-red-300/80">房主判他掉线，不等他</span>}
                    </li>
                  ))}
                </ul>
              )}

              {gate.applicable && !gate.open && (
                <p className="text-xs text-amber-200/60 mt-1.5">
                  {gate.waiting.length > 0
                    ? `还在等 ${gate.waiting.join('、')} 点准备——他们点完，房主那颗「开始游戏」才会亮。`
                    : '准备名单还在算（房主这边刚连上线）。'}
                </p>
              )}
              {gate.applicable && gate.open && (readyTable?.length ?? 0) > 0 && (
                <p className="text-xs text-emerald-300/80 mt-1.5">还在场的客人都准备了 ⇒ 房主那颗「开始游戏」按得下去。</p>
              )}

              {session.role === 'guest' && (
                <button
                  onClick={() => sendReady(myReadyRow?.on !== true)}
                  disabled={!hostPeerId}
                  className={`mt-2 w-full rounded-xl border px-4 py-2 text-sm font-bold ${
                    myReadyRow?.on === true
                      ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-100'
                      : 'border-amber-600/40 bg-black/20 text-amber-200 hover:border-amber-400/70'
                  } disabled:opacity-40`}
                >
                  {myReadyRow?.on === true ? '✓ 已准备（点这里取消）' : '🖐 我准备好了'}
                </button>
              )}
            </div>

            {/* 切片⑤·腿1（㈢ 演出刀）：开局那一段的读数。读的还是那一条指名快照，客人只照抄。 */}
            {session.role === 'guest' && <NetSetupPanel snapshot={guestSnapshot} />}

            {/* 切片⑤b：房主开始征召之后，这一格才有线上读数；之前一直是"还没开始征召"。 */}
            <NetDraftProgressPanel rows={draftProgress} />

            {netRows !== null && netRows.length > 0 && (
              <NetPingPanel
                rows={netRows}
                selfId={session.selfId}
                hostId={session.peers.find(p => p.role === 'host')?.id ?? session.selfId}
              />
            )}

            {session.phase === 'refused' && (
              <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                没让进房，原因是：{session.note}
              </div>
            )}

            {session.role === 'guest' && (
              <NetSpectator snapshot={guestSnapshot} mySeat={seatMap?.find((r) => r.peer === session.selfId)?.seat ?? null} />
            )}

            <NetSeatPanel
              seatMap={seatMap}
              moves={seatMoves}
              refusal={refusal}
              selfId={session.selfId}
              isHost={session.role === 'host'}
              onPick={session.role === 'host' ? undefined : playMove}
            />

            <div className="flex gap-2">
              <button
                onClick={leave}
                className="flex-1 rounded-xl border border-red-800/40 bg-red-950/30 px-4 py-2 text-sm text-red-100 hover:border-red-600/60"
              >
                离开房间
              </button>
              {session.role === 'host' && (
                <button onClick={start} className="flex-1 rounded-xl border border-amber-700/30 bg-black/20 px-4 py-2 text-sm text-amber-200/70">
                  换个房间码重开
                </button>
              )}
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-amber-200/40">
          先关掉这个窗不会退房——连线还在，房主那边继续发局面，左上角那张连线表也会继续刷新。真要断线请点「离开房间」。
          谁掉线由房主那台机器判（15 秒收不到某人任何一条消息才算），客人这边只照抄房主发来的表；探测约 2 秒一次，所以判定最多比真正断线晚约两秒显示出来。
          客人动手（J4）现在做到：椅子由房主按进房顺序排（房主占第一把，全是电脑在打就没有能坐的椅子），
          按钮上那几句是房主按当下的局面算给那一席的清单，客人点出去只交回「第几席＋编号」，
          房主重算对得上才走、对不上退回并说明；清单一次最多列 32 步，没列出的条数会写在下面。
          牌桌那一份现在按席位各发一条（联机切片③）：指名给谁，谁才采纳那一条，而且只有他自己那一席的手牌与征召池发的是牌面，
          别人的、以及牌堆顺序仍只发数量。
          准备那一段（联机切片⑤a）：每位客人一颗「我准备好了」，那张「谁点了、谁还算数」的表由房主算、全桌照抄；
          还在场的客人都点之前，房主那边那颗「开始游戏」存在但按不下去，并且会写明还在等谁。
          中途退掉的人不再有一行，被房主判成掉线的人留着那一行但已不进分母——不会出现"永远等一个已经不在的人"。
          传话程序这一侧（联机切片⑥）现在做的是按人投递：连接进来时把它网址上那串身份号与该身份号绑在一起，
          帧里写了收件人就只交给绑着那串号的那条连接、查不到收件人就整帧丢掉（绝不退回抄给全屋），没写收件人的照旧全房——观战那条路留着。
          开局那一段（联机切片⑤·腿1）现在客人那屏也跟着变：房主那边每动一次就把当下这一份推出去、推完不等任何人回话
          （"推了就完、不等人回话"本来就是传话那侧的做法，这一格没改它），客人这边只画收到的点数、势力与座次，
          还没收到的那一格写着「还没定」——本机不摇骰子，也不画一个没收到的数。
          迟到或中途重连的人一进来拿到的就是已经定下来的那一份，所以他那一屏直接落定，不会补看一遍滚动。
          这一版不防作弊：它仍然只是传话，线上是明文，而它信的是连接自己带来的那串身份号，没有钥匙也没有验证；
          所以跑传话程序的那台机器、以及在网络上偷听这条线的人，照样看得见别人那一席的那些字与牌面。
          还没做的：客人自己那一席的候选名单与点将＝⑤c／⑤d、掉线之后那两选一（保存并退出／交给 AI 继续）＝J5、局外开新局投票＝J6。
        </p>
      </div>
    </div>
  );
}

const inputClass =
  'w-full bg-black/40 border border-amber-700/40 rounded px-2 py-1.5 text-amber-100 focus:outline-none focus:border-amber-400/70 text-sm';
const buttonClass =
  'rounded-xl border border-amber-600/40 bg-gradient-to-r from-amber-950/60 to-red-950/40 px-4 py-2.5 text-base font-bold text-amber-100 hover:border-amber-400/70';

function phaseColor(phase: SessionState['phase']) {
  if (phase === 'in-room') return 'text-emerald-300 font-bold';
  if (phase === 'refused') return 'text-red-300 font-bold';
  return 'text-amber-300 font-bold';
}

function RolePick({ active, onPick }: { active: NetRole; onPick: (role: NetRole) => void }) {
  const options: Array<{ role: NetRole; label: string; hint: string }> = [
    { role: 'host', label: '我开房间', hint: '这台机器算牌' },
    { role: 'guest', label: '我去别人房间', hint: '连房主的地址' },
  ];
  return (
    <>
      {options.map(o => (
        <button
          key={o.role}
          onClick={() => onPick(o.role)}
          className={`flex-1 rounded-xl border px-3 py-2 text-sm transition-colors ${
            active === o.role
              ? 'border-amber-400/70 bg-amber-900/40 text-amber-100'
              : 'border-amber-700/25 bg-black/20 text-amber-200/50 hover:text-amber-200'
          }`}
        >
          <span className="font-bold">{o.label}</span>
          <span className="ml-2 text-xs text-amber-200/40">{o.hint}</span>
        </button>
      ))}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-amber-300/70">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2">
      <p className="text-[11px] text-amber-300/60 mb-0.5">{label}</p>
      <p className="text-sm">{children}</p>
    </div>
  );
}
