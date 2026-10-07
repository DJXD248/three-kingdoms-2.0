import { useEffect, useRef, useState } from 'react';
import { composeRoomUrl, createRoomCode } from '../network/netProtocol';
import { joinRoom, newPeerId, type NetRole, type SessionState } from '../network/netSession';

const DEFAULT_ADDRESS = 'ws://127.0.0.1:8787';
const PHASE_LABEL: Record<SessionState['phase'], string> = {
  idle: '还没连',
  dialing: '正在对上版本',
  'in-room': '已连上',
  refused: '被拒（没连上）',
  left: '已离开',
};

/**
 * J1 只做到"连得上、版本对得上、看得见谁在场"：
 * 牌桌画面同步＝J2，左上角 ping 表与掉线判定＝J3，客人动手＝J4。
 */
export default function OnlineLobby({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<NetRole>('host');
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [name, setName] = useState('玩家');
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState<SessionState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const connection = useRef<ReturnType<typeof joinRoom> | null>(null);

  useEffect(() => () => connection.current?.leave(), []);

  const start = () => {
    setFormError(null);
    const code = role === 'host' ? createRoomCode() : roomCode;
    const composed = composeRoomUrl(address, code);
    if (!composed.ok) {
      setFormError(composed.reason);
      return;
    }
    if (role === 'host') setRoomCode(composed.roomCode);
    connection.current?.leave();
    connection.current = joinRoom(
      { role, name, url: composed.url, roomCode: composed.roomCode, selfId: newPeerId() },
      setSession,
    );
  };

  const connected = session !== null;
  const shownCode = session?.roomCode ?? roomCode;

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
              牌由房主那台机器算，传话程序只转发。这一格先做到"连得上、版本对得上、看得见谁在场"。
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

            {session.phase === 'refused' && (
              <div className="rounded-lg border border-red-700/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                没让进房，原因是：{session.note}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { connection.current?.leave(); setSession(null); }}
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
          还没做的：牌桌画面同步（J2）、左上角 ping 表与掉线判定（J3）、客人动手（J4）。
          现在连上也不会真的开始一局联机对局。
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
