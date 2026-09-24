// GameBoard 纯展示原语（2.2.15 稳定期 F 序列纯移动拆分，自 GameBoard.tsx 尾部逐字外移，零行为变化）。
// 这些组件只依赖 React 与自身 props，不捕获任何组件状态；全部为 GameBoard 专用（全库无其他引用，2026-09-24 grep 确认）。
// Bar / Btn 仅用于对局内浮动操作条与确认覆盖层；Modal / StatPill / SC 用于牌库·弃牌·墓地·将池等查看弹窗与暂停菜单。

function SC({l,v,c}:{l:string;v:string;c:string}){return(<div className="rounded-lg border border-slate-800/40 bg-black/50 p-2.5 text-center"><p className="mb-0.5 text-[10px] text-amber-400/60">{l}</p><p className={`text-xl font-black ${c}`}>{v}</p></div>);}
function StatPill({label,value,tone}:{label:string;value:number;tone:'emerald'|'green'|'blue'|'red'|'yellow'|'purple'}){
  const toneMap={
    emerald:'border-emerald-700/30 bg-emerald-900/20 text-emerald-200',
    green:'border-green-700/30 bg-green-900/20 text-green-200',
    blue:'border-blue-700/30 bg-blue-900/20 text-blue-200',
    red:'border-red-700/30 bg-red-900/20 text-red-200',
    yellow:'border-yellow-700/30 bg-yellow-900/20 text-yellow-200',
    purple:'border-purple-700/30 bg-purple-900/20 text-purple-200',
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${toneMap[tone]}`}><span>{label}</span><span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] leading-none">{value}</span></span>;
}
function Bar({children}:{children:React.ReactNode}){return(<div className="absolute bottom-[110px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-amber-800/40 bg-black/90 px-6 py-3 animate-slideUp">{children}</div>);}
function Btn({children,onClick,ok=true,red}:{children:React.ReactNode;onClick:()=>void;ok?:boolean;red?:boolean}){return(<button onClick={ok?onClick:undefined} disabled={!ok} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${!ok?'cursor-not-allowed bg-gray-700 text-gray-500':red?'bg-red-900/60 text-red-300':'bg-green-600 text-white'}`}>{children}</button>);}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){return(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={onClose}><div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-amber-600/40 bg-gradient-to-b from-gray-900 to-black p-6" onClick={e=>e.stopPropagation()}><h2 className="mb-4 text-xl font-bold text-amber-200">{title}</h2>{children}<button onClick={onClose} className="mt-4 w-full rounded-xl bg-gray-800 py-2 font-bold text-amber-200/80">关闭</button></div></div>);}

export { SC, StatPill, Bar, Btn, Modal };
