// TestArena 紧凑展示原语（2.2.16 稳定期 F 序列纯移动拆分，自 TestArena.tsx 尾部逐字外移，零行为变化）。
// 注意：这是棋盘版 gameBoard/uiPrimitives 的"紧凑变体"——同名组件但 CSS 尺寸不同（测试场整体更紧凑），
// 两者刻意不合并：合并=改样式=行为变化，违背纯移动纪律。未来若要统一需单独立项做视觉回归。
// SC（统计小卡）/ Bar（底部浮动操作条）/ Btn（确认/取消按钮，含禁用态）均为无状态捕获纯 props 组件。

function SC({l,v,c}:{l:string;v:string;c:string}){return(<div className="rounded-lg border border-slate-800/40 bg-black/50 p-2 text-center"><p className="mb-0.5 text-[9px] text-amber-400/60">{l}</p><p className={`text-lg font-black ${c}`}>{v}</p></div>);}
function Bar({children}:{children:React.ReactNode}){return(<div className="absolute bottom-[90px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-800/40 bg-black/90 px-5 py-2 animate-slideUp">{children}</div>);}
function Btn({children,onClick,ok=true,red}:{children:React.ReactNode;onClick:()=>void;ok?:boolean;red?:boolean}){return(<button onClick={ok?onClick:undefined} disabled={!ok} className={`rounded-lg px-3 py-1 text-xs font-bold ${!ok?'cursor-not-allowed bg-gray-700 text-gray-500':red?'bg-red-900/60 text-red-300':'bg-green-600 text-white'}`}>{children}</button>);}

export { SC, Bar, Btn };
