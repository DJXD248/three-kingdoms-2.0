import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, FieldGeneral, Position, Player } from '../store/gameStore';
import {
  getValidTargets, getMoveTargets, canFieldGeneralMove,
  hasFreeCampSlot, isInEnemyTerritory,
} from '../rules/battlefieldRules';
import { General, factionColors, skillTagColors } from '../data/generals';
import { GameCard } from '../data/cards';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { getGeneralCardVisual } from '../utils/generalCardVisual';
import { clearLocalGameSnapshot, saveLocalGameSnapshot } from '../store/localGameSnapshot';
import Rules from './Rules';
import Settings from './Settings';
import { SC, StatPill, Bar, Btn, Modal } from './gameBoard/uiPrimitives';

type ViewMode = 'board'|'inspect'|'deploy'|'deployTarget'|'selectAttackCard'|'selectMoveCard'|'selectSupplyCards'|'selectArmorCards';
interface InspectTarget { type:'general'|'card'|'fieldGeneral'; general?:General; card?:GameCard; fieldGeneral?:FieldGeneral; playerId?:number; }
function isGen(c:General|GameCard):c is General{return 'skills' in c;}

export default function GameBoard(){
  const players=useGameStore(s=>s.players);
  const cpi=useGameStore(s=>s.currentPlayerIndex);
  const round=useGameStore(s=>s.currentRound);
  const cardDeck=useGameStore(s=>s.cardDeck);
  const discardPile=useGameStore(s=>s.discardPile);
  const endTurn=useGameStore(s=>s.endTurn);
  const surrender=useGameStore(s=>s.surrender);
  const deployGeneral=useGameStore(s=>s.deployGeneral);
  const moveGeneral=useGameStore(s=>s.moveGeneral);
  const attackTarget=useGameStore(s=>s.attackTarget);
  const supplyGeneral=useGameStore(s=>s.supplyGeneral);
  const armGeneral=useGameStore(s=>s.armGeneral);
  const defeatEvent=useGameStore(s=>s.defeatEvent);
  const clearDefeatEvent=useGameStore(s=>s.clearDefeatEvent);
  const skillEdits=useGameStore(s=>s.skillEdits);
  const skillActivations=useGameStore(s=>s.skillActivations);
  const clearSkillActivation=useGameStore(s=>s.clearSkillActivation);
  const resetGame=useGameStore(s=>s.resetGame);
  const reactionWindow=useGameStore(s=>s.reactionWindow);
  const passReaction=useGameStore(s=>s.passReaction);

  const [vm,setVm]=useState<ViewMode>('board');
  const [ins,setIns]=useState<InspectTarget|null>(null);
  const [depGen,setDepGen]=useState<General|null>(null);
  const [depCards,setDepCards]=useState<(General|GameCard)[]>([]);
  const [surConf,setSurConf]=useState(false);
  const [showGeneralPool,setShowGeneralPool]=useState(false);
  const [showDeck,setShowDeck]=useState(false);
  const [showDiscard,setShowDiscard]=useState(false);
  const [showGrave,setShowGrave]=useState(false);
  const [showPauseMenu,setShowPauseMenu]=useState(false);
  const [snapshotMessage,setSnapshotMessage]=useState('');
  const [showAbandonConfirm,setShowAbandonConfirm]=useState(false);
  const [showInGameRules,setShowInGameRules]=useState(false);
  const [showInGameSettings,setShowInGameSettings]=useState(false);
  const [hovIdx,setHovIdx]=useState<number|null>(null);
  const [depNotice,setDepNotice]=useState<string|null>(null);
  const [atkGen,setAtkGen]=useState<FieldGeneral|null>(null);
  const [atkRanged,setAtkRanged]=useState(false);
  const [atkCard,setAtkCard]=useState<General|GameCard|null>(null);
  const [movGen,setMovGen]=useState<FieldGeneral|null>(null);
  const [movTgt,setMovTgt]=useState<Position|null>(null);
  const [moveOptions,setMoveOptions]=useState<Position[]>([]);
  const [supGen,setSupGen]=useState<FieldGeneral|null>(null);
  const [supCards,setSupCards]=useState<(General|GameCard)[]>([]);
  const [armGen,setArmGen]=useState<FieldGeneral|null>(null);
  const [armCards,setArmCards]=useState<GameCard[]>([]);
  const [hitBaseIds,setHitBaseIds]=useState<number[]>([]);
  const [hitGeneralIds,setHitGeneralIds]=useState<string[]>([]);
  const [healGeneralIds,setHealGeneralIds]=useState<string[]>([]);
  const [screenShaking,setScreenShaking]=useState(false);
  const prevBaseHpRef=useRef<Record<number, number> | null>(null);
  const prevGeneralHpRef=useRef<Record<string, number>>({});
  const boardViewportRef=useRef<HTMLDivElement | null>(null);
  const boardContentRef=useRef<HTMLDivElement | null>(null);
  const [boardScale,setBoardScale]=useState(1);

  const cp=players[cpi] ?? players.find(p => p.isAlive !== false) ?? players[0]; if(!cp) return null;
  const activeIndex=Math.max(0,players.findIndex(p=>p.id===cp.id));
  const cpColor=factionColors[cp.faction!]||'#eab308';

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showInGameRules || showInGameSettings) return;
      event.preventDefault();
      setShowPauseMenu(open => !open);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showInGameRules, showInGameSettings]);

  const validTgts=useMemo(()=>atkGen?getValidTargets(atkGen,cp.id,players,atkRanged):[],[atkGen,cp.id,players,atkRanged]);

  const cardTypeOrder: Record<GameCard['type'], number> = { '粮草': 0, '材料': 1, '军备': 2 };
  const deckPreview = useMemo(() => {
    if (!showDeck) return [] as GameCard[];
    return [...cardDeck].sort((a, b) => {
      const orderDiff = cardTypeOrder[a.type] - cardTypeOrder[b.type];
      return orderDiff !== 0 ? orderDiff : a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [showDeck, cardDeck]);

  const deckTypeCounts = useMemo(() => ({
    粮草: cardDeck.filter(c => c.type === '粮草').length,
    材料: cardDeck.filter(c => c.type === '材料').length,
    军备: cardDeck.filter(c => c.type === '军备').length,
  }), [cardDeck]);

  const generalPoolPreview = useMemo(() => {
    if (!showGeneralPool) return [] as General[];
    return [...cp.generalPool].sort((a, b) => {
      if (a.type !== b.type) return a.type === '武将' ? -1 : 1;
      if (a.faction !== b.faction) return a.faction.localeCompare(b.faction, 'zh-CN');
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [showGeneralPool, cp.generalPool]);

  const generalPoolCounts = useMemo(() => ({
    武将: cp.generalPool.filter(g => g.type === '武将').length,
    文将: cp.generalPool.filter(g => g.type === '文将').length,
    魏: cp.generalPool.filter(g => g.faction === '魏').length,
    蜀: cp.generalPool.filter(g => g.faction === '蜀').length,
    吴: cp.generalPool.filter(g => g.faction === '吴').length,
    群: cp.generalPool.filter(g => g.faction === '群').length,
    晋: cp.generalPool.filter(g => g.faction === '晋').length,
  }), [cp.generalPool]);

  useEffect(() => {
    const viewport = boardViewportRef.current;
    const content = boardContentRef.current;
    if (!viewport || !content) return;
    const measure = () => {
      const availableWidth = Math.max(1, viewport.clientWidth - 12);
      const availableHeight = Math.max(1, viewport.clientHeight - 12);
      const naturalWidth = Math.max(1, content.offsetWidth);
      const naturalHeight = Math.max(1, content.offsetHeight);
      const next = Math.max(0.52, Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight));
      setBoardScale(prev => Math.abs(prev-next)<0.01 ? prev : next);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(viewport);
    ro?.observe(content);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [players.length]);

  useEffect(()=>{
    const currentBaseMap: Record<number, number> = Object.fromEntries(players.map(p=>[p.id,p.baseHp]));
    const currentGeneralMap: Record<string, number> = Object.fromEntries(
      players.flatMap(p=>p.fieldGenerals.map(fg=>[getRuntimeCardId(fg.general), fg.currentHp] as const))
    );

    if(prevBaseHpRef.current===null){
      prevBaseHpRef.current=currentBaseMap;
      prevGeneralHpRef.current=currentGeneralMap;
      return;
    }

    const damagedBaseIds = players
      .filter(p => (prevBaseHpRef.current?.[p.id] ?? p.baseHp) > p.baseHp)
      .map(p => p.id);

    const damagedGeneralIds = Object.entries(currentGeneralMap)
      .filter(([id, hp]) => (prevGeneralHpRef.current[id] ?? hp) > hp)
      .map(([id]) => id);

    const healedGeneralIds = Object.entries(currentGeneralMap)
      .filter(([id, hp]) => (prevGeneralHpRef.current[id] ?? hp) < hp)
      .map(([id]) => id);

    const timers:number[]=[];
    if(damagedBaseIds.length>0 || damagedGeneralIds.length>0){
      if(damagedBaseIds.length>0) setHitBaseIds(damagedBaseIds);
      if(damagedGeneralIds.length>0) setHitGeneralIds(damagedGeneralIds);
      setScreenShaking(true);
      timers.push(window.setTimeout(()=>setHitBaseIds([]), 900));
      timers.push(window.setTimeout(()=>setHitGeneralIds([]), 900));
      timers.push(window.setTimeout(()=>setScreenShaking(false), 500));
    }
    if(healedGeneralIds.length>0){
      setHealGeneralIds(healedGeneralIds);
      timers.push(window.setTimeout(()=>setHealGeneralIds([]), 900));
    }

    prevBaseHpRef.current=currentBaseMap;
    prevGeneralHpRef.current=currentGeneralMap;
    // Do not return a dependency-change cleanup here. React re-renders this effect
    // whenever any player state changes; cancelling the flash timers on every
    // ordinary action left the hit class stuck on the board. The timers are
    // intentionally allowed to finish on their own.
  },[players]);

  // Auto-dismiss the "X势力击破" overlay after a short dramatic pause
  useEffect(()=>{
    if(!defeatEvent) return;
    const t=window.setTimeout(()=>clearDefeatEvent(), 2200);
    return ()=>window.clearTimeout(t);
  },[defeatEvent,clearDefeatEvent]);

  // Auto-dismiss skill activations
  useEffect(()=>{
    if(skillActivations.length===0)return;
    const timers=skillActivations.map(a=>window.setTimeout(()=>clearSkillActivation(a.id),3000));
    return()=>{timers.forEach(t=>window.clearTimeout(t));};
  },[skillActivations,clearSkillActivation]);

  // ── find generals at positions ──
  const allFg=players.flatMap(p=>p.fieldGenerals);
  const fgAt=(areaId:number,zone:'camp'|'front',slot:number)=>allFg.find(fg=>fg.position.zone===zone&&fg.position.areaOwnerId===areaId&&fg.position.slot===slot);
  const battleFg=(slot:number)=>allFg.find(fg=>fg.position.zone==='battle'&&fg.position.slot===slot);
  const ownerOf=(fg:FieldGeneral)=>players.find(p=>p.id===fg.ownerId);

  // ── actions ──
  const startDeploy=(g:General)=>{setDepGen(g);setDepCards([]);setVm('deploy');};
  const toggleDep=(c:General|GameCard)=>{
    const key=getRuntimeCardId(c);if(depCards.some(x=>getRuntimeCardId(x)===key)){setDepCards(p=>p.filter(x=>getRuntimeCardId(x)!==key));return;}
    if(depGen&&depCards.length<depGen.hp)setDepCards(p=>[...p,c]);
  };
  const confirmDep=()=>{if(depCards.length>0)setVm('deployTarget');};
  const doDeploy=(slot:number)=>{
    if(!depGen||depCards.length===0)return;
    const success=deployGeneral(depGen,slot,depCards);
    if(!success){
      setDepNotice('登场失败：请重新选择');
      setTimeout(()=>setDepNotice(null),1500);
      return;
    }
    setDepNotice(depGen.name);setTimeout(()=>setDepNotice(null),1200);
    setDepGen(null);setDepCards([]);setVm('board');
  };
  const cancelDep=()=>{setDepGen(null);setDepCards([]);setVm('board');};

  const startAtk=(fg:FieldGeneral,ranged:boolean)=>{
    if(cp.hand.length===0)return;
    setAtkGen(fg);setAtkRanged(ranged);setAtkCard(null);setIns(null);setVm('selectAttackCard');
  };
  const resetAtk=()=>{setAtkGen(null);setAtkRanged(false);setAtkCard(null);setVm('board');};
  const pickAtkCard=(c:General|GameCard)=>{setAtkCard(c);setVm('board');};
  const doAtk=(tid:string)=>{if(atkGen&&atkCard){attackTarget(getRuntimeCardId(atkGen.general),tid,atkRanged,atkCard);resetAtk();}};

  const startMove=(fg:FieldGeneral)=>{
    const tgts=getMoveTargets(fg,players);if(tgts.length===0)return;
    const isSch=fg.general.type==='文将';
    if(isSch&&cp.hand.length===0)return;
    setMovGen(fg);
    setIns(null);

    // Only movement that starts in the battle zone requires an explicit
    // destination selection. Camp/front movement keeps the original
    // one-path convenience: the only legal destination is resolved directly.
    if(fg.position.zone!=='battle' && tgts.length===1){
      const target=tgts[0];
      setMoveOptions([]);
      setMovTgt(target);
      if(isSch){
        setVm('selectMoveCard');
        return;
      }
      moveGeneral(getRuntimeCardId(fg.general),target);
      setMovGen(null);setMovTgt(null);setVm('board');
      return;
    }

    // Battle-zone movement always asks the player to choose a destination,
    // even when there is only one legal direction. This prevents accidental
    // movement into the wrong player's front line and keeps cancellation clear.
    setMoveOptions(tgts);
    setMovTgt(null);
    setVm('board');
  };
  const chooseMoveTarget=(target:Position)=>{
    if(!movGen)return;
    const isSch=movGen.general.type==='文将';
    setMovTgt(target);
    setMoveOptions([]);
    if(isSch){setVm('selectMoveCard');return;}
    moveGeneral(getRuntimeCardId(movGen.general),target);
    setMovGen(null);setMovTgt(null);setVm('board');
  };
  const pickMoveCard=(c:General|GameCard)=>{if(movGen&&movTgt){moveGeneral(getRuntimeCardId(movGen.general),movTgt,c);setMovGen(null);setMovTgt(null);setMoveOptions([]);setIns(null);setVm('board');}};
  const cancelMov=()=>{setMovGen(null);setMovTgt(null);setMoveOptions([]);setVm('board');};

  const startSup=(fg:FieldGeneral)=>{if(cp.hand.length===0)return;setSupGen(fg);setSupCards([]);setIns(null);setVm('selectSupplyCards');};
  const toggleSup=(c:General|GameCard)=>{
    if(!supGen)return;
    const inE=isInEnemyTerritory(supGen);const extra=inE?1:0;
    const mx=supGen.maxHp-supGen.currentHp+extra; // max cards = heal amount + extra cost
    if(supCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(c))){setSupCards(p=>p.filter(x=>getRuntimeCardId(x)!==getRuntimeCardId(c)));return;}
    if(supCards.length<mx)setSupCards(p=>[...p,c]);
  };
  const confirmSup=()=>{if(supGen&&supCards.length>0){supplyGeneral(getRuntimeCardId(supGen.general),supCards);setSupGen(null);setSupCards([]);setVm('board');}};
  const cancelSup=()=>{setSupGen(null);setSupCards([]);setVm('board');};

  // Armor actions
  const startArm=(fg:FieldGeneral)=>{const armorInHand=cp.hand.filter(c=>!isGen(c)&&(c as GameCard).type==='军备') as GameCard[];if(armorInHand.length===0)return;setArmGen(fg);setArmCards([]);setIns(null);setVm('selectArmorCards');};
  const toggleArm=(c:GameCard)=>{if(!armGen)return;const mx=armGen.maxHp-armGen.currentArmor;if(armCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(c))){setArmCards(p=>p.filter(x=>getRuntimeCardId(x)!==getRuntimeCardId(c)));return;}if(armCards.length<mx)setArmCards(p=>[...p,c]);};
  const confirmArm=()=>{if(armGen&&armCards.length>0){const ok=armGeneral(getRuntimeCardId(armGen.general),armCards);if(ok){setArmGen(null);setArmCards([]);setVm('board');}}};
  const cancelArm=()=>{setArmGen(null);setArmCards([]);setVm('board');};

  const clickFg=(fg:FieldGeneral)=>{
    if(atkCard&&atkGen&&validTgts.some(t=>t.id===getRuntimeCardId(fg.general))&&getRuntimeCardId(fg.general)!==getRuntimeCardId(atkGen.general)){doAtk(getRuntimeCardId(fg.general));return;}
    setIns({type:'fieldGeneral',fieldGeneral:fg,playerId:fg.ownerId});setVm('inspect');
  };
  const clickBase=(pid:number)=>{
    if(!atkCard||!atkGen)return;
    if(validTgts.some(t=>t.id===`base_${pid}`)&&pid!==cp.id)doAtk(`base_${pid}`);
  };

  // ── layout ──
  const arrange=()=>{
    const n=players.length;
    type Pos='bottom'|'top'|'left'|'right';
    const o:{player:Player;pos:Pos}[]=[];
    if(n===2){o.push({player:players[activeIndex] ?? players.find(p=>p.isAlive!==false)!,pos:'bottom'},{player:players[(activeIndex+1)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'top'});}
    else if(n===3){o.push({player:players[activeIndex] ?? players.find(p=>p.isAlive!==false)!,pos:'bottom'},{player:players[(activeIndex+1)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'left'},{player:players[(activeIndex+2)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'right'});}
    else if(n===4){o.push({player:players[activeIndex] ?? players.find(p=>p.isAlive!==false)!,pos:'bottom'},{player:players[(activeIndex+1)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'left'},{player:players[(activeIndex+2)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'top'},{player:players[(activeIndex+3)%n] ?? players.find(p=>p.isAlive!==false)!,pos:'right'});}
    return o;
  };
  const arr=arrange();
  const bot=arr.find(x=>x.pos==='bottom')!.player;
  const top=arr.find(x=>x.pos==='top')?.player;
  const lft=arr.find(x=>x.pos==='left')?.player;
  const rgt=arr.find(x=>x.pos==='right')?.player;

  // ── slot rendering ──
  const Slot=({zone,slot,areaOwner,fg}:{zone:'camp'|'front';slot:number;areaOwner:Player;fg?:FieldGeneral})=>{
    const bc=factionColors[areaOwner.faction!]||'#666';
    const isBase=zone==='camp'&&slot===1;
    const atkFg=!!(atkCard&&fg&&validTgts.some(t=>t.id===getRuntimeCardId(fg.general)));
    const atkFgFriendly=!!(atkFg&&fg&&fg.ownerId===cp.id);
    const atkBase=!!(atkCard&&isBase&&validTgts.some(t=>t.id===`base_${areaOwner.id}`));
    const moveTarget=!!moveOptions.find(t=>t.zone===zone&&t.areaOwnerId===areaOwner.id&&t.slot===slot);
    const canDep=vm==='deployTarget'&&areaOwner.id===cp.id&&zone==='camp'&&slot!==1&&!fg;

    if(isBase){
      const fl=Math.min(5,areaOwner.baseHp);
      const baseHit = hitBaseIds.includes(areaOwner.id);
      return(<button type="button" onClick={()=>atkBase&&clickBase(areaOwner.id)}
        className={`relative flex h-[88px] w-[72px] flex-col items-center justify-center rounded-lg border-2 transition-all ${atkBase?'animate-pulse ring-2 ring-red-500':''} ${baseHit?'animate-base-hit animate-pulse-glow ring-2 ring-red-400':''}`}
        style={{borderColor:atkBase?'#ef4444':baseHit?'#f87171':bc,background:`linear-gradient(180deg,${bc}30 0%,${bc}10 100%)`}}>
        <div className="absolute -top-3 left-0 right-0 flex justify-center gap-0.5">{[0,1,2,3,4].map(i=><span key={i} className="text-[8px]" style={{opacity:i<fl?1:0.15}}>🚩</span>)}</div>
        <div className="text-xl">🏯</div>
        <p className="text-[10px] font-black" style={{color:bc}}>本营</p>
        <p className={`text-xs font-black ${baseHit?'text-red-300 animate-number-pop':'text-red-400'}`}>❤️{areaOwner.baseHp}</p>
      </button>);
    }

    const fgColor=fg?factionColors[ownerOf(fg)?.faction||areaOwner.faction!]:bc;
    const generalHit=!!(fg&&hitGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalHeal=!!(fg&&healGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalVisual = fg ? getGeneralCardVisual(
      fg.general,
      areaOwner.faction,
      generalHit || generalHeal ? 'rgba(0,0,0,0.46)' : 'rgba(0,0,0,0.40)'
    ) : null;
    return(<button type="button"
      onClick={()=>{if(fg)clickFg(fg);else if(canDep)doDeploy(slot===0?0:2);else if(moveTarget)chooseMoveTarget({zone,slot,areaOwnerId:areaOwner.id});}}
      className={`relative flex h-[88px] w-[72px] items-center justify-center rounded-lg border-2 transition-all ${(fg||canDep||moveTarget)?'cursor-pointer hover:brightness-125':'cursor-default'} ${atkFg?`animate-pulse ring-2 ${atkFgFriendly?'ring-yellow-400':'ring-red-500'}`:''} ${moveTarget?'animate-pulse ring-2 ring-cyan-400':''} ${generalHit?'animate-base-hit':''}`}
      style={{
        ...(generalVisual ?? {}),
        borderColor: moveTarget ? '#22d3ee' : atkFg ? (atkFgFriendly ? '#facc15' : '#ef4444') : fg ? (generalVisual?.borderColor ?? fgColor) : canDep ? '#22c55e' : `${bc}55`,
        ...(fg ? {} : { background: canDep ? 'rgba(34,197,94,0.12)' : moveTarget ? 'rgba(34,211,238,0.12)' : 'rgba(0,0,0,0.28)' }),
      }}>
      {fg?(<div className="px-0.5 text-center"><div className="text-xl">{fg.general.type==='武将'?'⚔️':'📜'}</div><p className="truncate text-[9px] font-black leading-tight text-amber-200">{fg.general.name}{fg.isArming&&<span className="text-[7px] text-blue-300"> 整备</span>}</p>{fg.currentArmor>0&&<p className="text-[8px] text-blue-300">🛡️{fg.currentArmor}</p>}<p className={`text-[9px] ${generalHit?'text-red-300 animate-number-pop':generalHeal?'text-green-300 animate-number-pop-heal':'text-red-400'}`}>❤️{fg.currentHp}/{fg.maxHp}</p></div>):(<span className="text-[9px] text-amber-700/30">{moveTarget?'可前进':zone==='camp'?'营地':'前线'}</span>)}
    </button>);
  };

  const BSlot=({slot}:{slot:number})=>{
    const fg=battleFg(slot);
    const atkOk=!!(atkCard&&fg&&validTgts.some(t=>t.id===getRuntimeCardId(fg.general)));
    const atkFriendly=!!(atkOk&&fg&&fg.ownerId===cp.id);
    const generalHit=!!(fg&&hitGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalHeal=!!(fg&&healGeneralIds.includes(getRuntimeCardId(fg.general)));
    const moveTarget=!!moveOptions.find(t=>t.zone==='battle'&&t.areaOwnerId===null&&t.slot===slot);
    const o=fg?ownerOf(fg):null;const c=o?.faction?factionColors[o.faction]:'#444';
    const generalVisual = fg ? getGeneralCardVisual(
      fg.general,
      o?.faction,
      generalHit || generalHeal ? 'rgba(0,0,0,0.46)' : 'rgba(0,0,0,0.40)'
    ) : null;
    return(<button type="button" onClick={()=>{if(fg)clickFg(fg);else if(moveTarget)chooseMoveTarget({zone:'battle',slot,areaOwnerId:null});}}
      className={`flex h-[88px] w-[72px] items-center justify-center rounded-lg border-2 transition-all ${fg||moveTarget?'cursor-pointer hover:brightness-125':'cursor-default'} ${atkOk?`animate-pulse ring-2 ${atkFriendly?'ring-yellow-400':'ring-red-500'}`:''} ${moveTarget?'animate-pulse ring-2 ring-cyan-400':''} ${generalHit?'animate-base-hit':''}`}
      style={{
        ...(generalVisual ?? {}),
        borderColor: moveTarget ? '#22d3ee' : atkOk ? (atkFriendly ? '#facc15' : '#ef4444') : fg ? (generalVisual?.borderColor ?? c) : '#333',
        ...(fg ? {} : { background: moveTarget ? 'rgba(34,211,238,0.12)' : 'rgba(0,0,0,0.4)' }),
      }}>
      {fg?(<div className="text-center"><div className="text-xl">{fg.general.type==='武将'?'⚔️':'📜'}</div><p className="text-[9px] font-black leading-tight text-amber-200">{fg.general.name}{fg.isArming&&<span className="text-[7px] text-blue-300"> 整备</span>}</p>{fg.currentArmor>0&&<p className="text-[8px] text-blue-300">🛡️{fg.currentArmor}</p>}<p className={`text-[9px] ${generalHit?'text-red-300 animate-number-pop':generalHeal?'text-green-300 animate-number-pop-heal':'text-red-400'}`}>❤️{fg.currentHp}/{fg.maxHp}</p></div>):(<span className={`text-[9px] ${moveTarget?'text-cyan-300':'text-amber-700/20'}`}>{moveTarget?'可前进':'战场'}</span>)}
    </button>);
  };

  /** Bottom player: front row on top (closer to battlefield), camp row on bottom */
  const TerritoryBottom=({p}:{p:Player})=>(<div className="flex flex-col items-center gap-1">
    <div className="flex gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div>
    <div className="flex gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div>
  </div>);

  /** Top/opponent player: camp row on top (far from battlefield), front row on bottom (close to battlefield) */
  const TerritoryTop=({p}:{p:Player})=>(<div className="flex flex-col items-center gap-1">
    <div className="flex gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div>
    <div className="flex gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div>
  </div>);

  /** Side player: camp column outer side, front column inner side (close to battlefield) */
  const TerritorySide=({p,side}:{p:Player;side:'left'|'right'})=>(<div className={`flex ${side==='left'?'flex-row':'flex-row-reverse'} items-center gap-1`}>
    <div className="flex flex-col gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div>
    <div className="flex flex-col gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div>
  </div>);

  const canUse=(c:General|GameCard)=>!(vm==='deploy'&&depGen&&c.id===depGen.id);

  const saveGameSnapshot = () => {
    try {
      const state = useGameStore.getState();
      saveLocalGameSnapshot(state.createSerializedSnapshot(state.roomName));
      setSnapshotMessage('对局已保存');
    } catch (error) {
      console.error('[Recovery] Local snapshot save failed', error);
      setSnapshotMessage('保存失败，请稍后再试');
    }
  };

  const saveAndExit = () => {
    saveGameSnapshot();
    window.setTimeout(() => resetGame(), 250);
  };

  const abandonAndExit = () => {
    setShowAbandonConfirm(false);
    clearLocalGameSnapshot();
    resetGame();
  };

  const restartGame = () => {
    const playerCount = players.length;
    clearLocalGameSnapshot();
    resetGame();
    const store = useGameStore.getState();
    store.setPlayerCount(playerCount);
    store.createRoom();
  };

  return(
    <div className={`relative flex h-screen flex-col overflow-hidden text-white ${screenShaking?'animate-screenShake':''}`} style={{background:'radial-gradient(ellipse at center,#1a1a2e 0%,#0d0d1a 60%,#000 100%)'}}>
      <button
        onClick={()=>{setShowPauseMenu(true);setSnapshotMessage('');}}
        className="fixed left-3 top-1/2 z-50 -translate-y-1/2 rounded-lg border border-purple-400/70 bg-purple-950/95 px-4 py-3 text-sm font-black text-purple-100 shadow-lg shadow-purple-950/50 hover:bg-purple-800"
      >
        ⏸️ 菜单
      </button>
      {/* top bar */}
      <div className="z-20 flex flex-shrink-0 items-center justify-between border-b border-amber-800/20 bg-black/60 px-2 sm:px-4 py-1 sm:py-1.5">
        <div className="flex items-center gap-2 sm:gap-4"><span className="text-xs sm:text-sm font-bold text-amber-400">第{round}轮</span><span className="text-xs sm:text-sm text-amber-100">回合：<span style={{color:cpColor}}>{cp.name}</span></span></div>
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          <button onClick={()=>setShowGeneralPool(true)} className="rounded border border-emerald-800/30 bg-emerald-900/30 px-2.5 py-1 text-xs text-emerald-300">👤将领池({cp.generalPool.length})</button>
          <button onClick={()=>setShowDeck(true)} className="rounded border border-blue-800/30 bg-blue-900/30 px-2.5 py-1 text-xs text-blue-300">🎴抽牌堆({cardDeck.length})</button>
          <button onClick={()=>setShowDiscard(true)} className="rounded border border-amber-800/30 bg-amber-900/30 px-2.5 py-1 text-xs text-amber-300">📋弃牌堆({discardPile.length})</button>
          <button onClick={()=>setShowGrave(true)} className="rounded border border-red-800/30 bg-red-900/30 px-2.5 py-1 text-xs text-red-300">💀墓地({players.reduce((s,p)=>s+p.graveyard.length,0)})</button>
        </div>
      </div>
      {/* player bar */}
      <div className="flex flex-shrink-0 items-center justify-center gap-3 bg-black/30 px-4 py-1">
        {players.map(p=>{const a=p.id===cp.id;const c=factionColors[p.faction!];return(
          <div key={p.id} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${a?'border-amber-500/60 bg-amber-900/20':!p.isAlive?'border-gray-800/30 opacity-30':'border-gray-700/20'}`}>
            <div className="h-2 w-2 rounded-full" style={{backgroundColor:c}}/><span className="text-[11px] font-bold" style={{color:c}}>{p.isAi?'🤖':''}{p.name}</span><span className="text-[10px] text-red-400/80">🏯{p.baseHp}</span><span className="text-[10px] text-amber-300/50">🃏{p.hand.length}</span></div>);})}
      </div>
      {/* board */}
      <div ref={boardViewportRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2">
        <div ref={boardContentRef} className="flex flex-col items-center gap-2 board-scale" style={{transform:`scale(${boardScale})`,transformOrigin:'center center',willChange:'transform'}}>
          {top&&<div className="flex flex-col items-center"><span className="mb-1 text-[10px] font-bold" style={{color:factionColors[top.faction!]}}>{top.name}({top.faction})</span><TerritoryTop p={top}/></div>}
          <div className="flex items-center gap-4">
            {lft&&<div className="flex flex-col items-center"><span className="mb-1 text-[10px] font-bold" style={{color:factionColors[lft.faction!]}}>{lft.name}</span><TerritorySide p={lft} side="left"/></div>}
            <div className="relative mx-2">
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold tracking-[0.2em] text-amber-600/50">⚔ 战 场 ⚔</div>
              <div className="rounded-xl border border-amber-800/20 bg-black/20 p-3"><div className="flex gap-1">{Array.from({length:players.length},(_,i)=><BSlot key={i} slot={i}/>)}</div></div>
            </div>
            {rgt&&<div className="flex flex-col items-center"><span className="mb-1 text-[10px] font-bold" style={{color:factionColors[rgt.faction!]}}>{rgt.name}</span><TerritorySide p={rgt} side="right"/></div>}
          </div>
          <div className="flex flex-col items-center"><TerritoryBottom p={bot}/><span className="mt-1 text-[10px] font-bold" style={{color:factionColors[bot.faction!]}}>{bot.name}({bot.faction}) — {bot.isAi?'AI 出手中…':'你的回合'}</span></div>
        </div>
        {/* Skill activation notifications */}
        {skillActivations.length>0&&<div className="pointer-events-none absolute left-3 top-12 z-40 flex flex-col gap-2 max-w-xs">{skillActivations.map(a=>(
          <div key={a.id} className="rounded-lg border-2 bg-black/90 px-4 py-2.5 animate-slideUp" style={{borderColor:a.color+'80',boxShadow:`0 0 16px ${a.color}30`}}>
            <div className="flex items-center gap-2 mb-1"><span className="text-base">⚡</span><span className="text-sm font-black" style={{color:a.color}}>{a.generalName}</span><span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold border" style={{color:a.color,borderColor:a.color+'50',backgroundColor:a.color+'15'}}>【{a.skillName}】</span></div>
            <p className="text-xs text-amber-200/80">{a.message}</p>
          </div>
        ))}</div>}
        {/* 2.2.25 §12-9c: reaction-window HUD — entry mechanism only, mirrors the resident container */}
        {reactionWindow&&<div className="absolute left-1/2 top-12 z-40 -translate-x-1/2">
          <div className="rounded-xl border-2 border-sky-500 bg-black/90 px-6 py-3 text-center animate-fadeIn" style={{boxShadow:'0 0 24px rgba(14,165,233,0.35)'}}>
            <p className="text-sm font-black text-sky-300">⏳ 反应窗口开启 · 等待通过</p>
            <p className="mt-0.5 text-[10px] text-sky-200/60">{reactionWindow.id}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              {reactionWindow.participants.map(pid=>{
                const name=players.find(p=>p.id===pid)?.name ?? `玩家${pid}`;
                const done=reactionWindow.passed.includes(pid);
                return done
                  ? <span key={pid} className="rounded-full border border-emerald-500/50 px-2 py-0.5 text-xs text-emerald-300">✓ {name}</span>
                  : <Btn key={pid} onClick={()=>passReaction(pid)}>🫱 {name} 通过</Btn>;
              })}
            </div>
          </div>
        </div>}
        {depNotice&&<div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2"><div className="rounded-xl border-2 border-amber-500 bg-black/90 px-8 py-4 text-center animate-fadeIn"><p className="text-xl font-black text-amber-400">⚔️ 将领登场</p><p className="text-lg text-amber-200">{depNotice}</p></div></div>}
        {defeatEvent&&<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center animate-fadeIn">
          <div className="absolute inset-0 bg-black/70 animate-screenShake"/>
          <div className="relative flex flex-col items-center gap-4 animate-base-hit">
            <div className="text-7xl animate-pulse-glow">💥🏯💥</div>
            <div className="rounded-2xl border-2 px-10 py-5 text-center" style={{borderColor:defeatEvent.faction?factionColors[defeatEvent.faction]:'#ef4444',background:'rgba(0,0,0,0.85)',boxShadow:`0 0 40px ${defeatEvent.faction?factionColors[defeatEvent.faction]:'#ef4444'}`}}>
              <p className="mb-1 text-sm tracking-[0.4em] text-red-300">BASE DESTROYED</p>
              <p className="text-4xl font-black" style={{color:defeatEvent.faction?factionColors[defeatEvent.faction]:'#fca5a5'}}>{defeatEvent.faction?`${defeatEvent.faction}势力击破`:'势力击破'}</p>
              <p className="mt-2 text-sm text-amber-200/70">{defeatEvent.name}</p>
            </div>
          </div>
        </div>}
        {atkCard&&atkGen&&<div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-red-500 bg-red-900/90 px-5 py-2 animate-fadeIn"><span className="text-sm font-bold text-red-200">⚔️{atkRanged?'远程':'近战'}攻击 - 点击高亮目标</span><button onClick={resetAtk} className="rounded bg-gray-700 px-3 py-1 text-xs text-white">取消</button></div>}
        {(vm==='board'||vm==='inspect')&&!atkCard&&<div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
          <button onClick={endTurn} className="rounded-lg border border-red-700/50 bg-red-900/60 px-3 py-2.5 text-xs font-bold text-red-200">⏭️结束回合</button>
          <button onClick={()=>setSurConf(true)} className="rounded-lg border border-gray-700/40 bg-gray-900/60 px-3 py-2 text-xs font-bold text-gray-400">🏳️投降</button>
        </div>}
      </div>
      {/* overlays */}
      {vm==='deploy'&&<Bar><span className="text-sm text-amber-200">登场：<b className="text-amber-100">{depGen?.name}</b> <span className="text-amber-400/60">(消耗{depCards.length}/{depGen?.hp}张)</span></span><Btn ok={depCards.length>0} onClick={confirmDep}>确认位置</Btn><Btn onClick={cancelDep} red>取消</Btn></Bar>}
      {vm==='deployTarget'&&<div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2"><div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-green-500/50 bg-black/90 px-5 py-2.5 shadow-xl"><span className="text-sm font-bold text-green-300 animate-pulse">📍请选择你的营地空格放置将领</span><Btn onClick={cancelDep} red>取消</Btn></div></div>}
      {vm==='selectAttackCard'&&<Bar><span className="text-sm font-bold text-red-300">选择一张手牌作为攻击消耗</span><Btn onClick={resetAtk}>取消</Btn></Bar>}
      {moveOptions.length>0&&movGen&&<Bar><span className="text-sm font-bold text-cyan-300">请选择一个高亮可进入区域</span><Btn onClick={cancelMov}>取消</Btn></Bar>}
      {vm==='selectMoveCard'&&<Bar><span className="text-sm font-bold text-blue-300">选择一张手牌作为移动消耗</span><Btn onClick={cancelMov}>取消</Btn></Bar>}
      {vm==='selectSupplyCards'&&supGen&&(()=>{
        const inE=isInEnemyTerritory(supGen);const extra=inE?1:0;
        const maxH=supGen.maxHp-supGen.currentHp;
        const actualHeal=Math.max(0,supCards.length-extra);
        return <Bar><span className="text-sm text-green-300">选择补给手牌(已选{supCards.length}张{inE?`，含额外消耗1张`:``}，实际补给{Math.min(actualHeal,maxH)}点，最多{maxH}点)</span><Btn ok={supCards.length>extra} onClick={confirmSup}>确认补给</Btn><Btn onClick={cancelSup}>取消</Btn></Bar>;
      })()}
      {vm==='selectArmorCards'&&armGen&&(()=>{
        const maxAdd=armGen.maxHp-armGen.currentArmor;
        return <Bar><span className="text-sm text-sky-300">选择军备牌叠甲(已选{armCards.length}张，最多{maxAdd}张，叠甲后进入整备状态)</span><Btn ok={armCards.length>0} onClick={confirmArm}>确认叠甲</Btn><Btn onClick={cancelArm}>取消</Btn></Bar>;
      })()}
      {/* hand */}
      <div className="z-20 flex-shrink-0 border-t border-amber-800/20 bg-black/70 px-2 sm:px-4 py-1 sm:py-1.5 hand-scale">
        <div className="mb-1 flex items-center gap-2"><span className="text-xs font-bold text-amber-400">🃏手牌({cp.hand.length})</span>
          {vm==='deploy'&&<span className="text-[11px] text-green-400">— 选择登场消耗</span>}
          {vm==='selectAttackCard'&&<span className="text-[11px] text-red-400">— 选择攻击消耗</span>}
          {vm==='selectMoveCard'&&<span className="text-[11px] text-blue-400">— 选择移动消耗</span>}
          {vm==='selectSupplyCards'&&<span className="text-[11px] text-green-400">— 选择补给用牌</span>}
          {vm==='selectArmorCards'&&<span className="text-[11px] text-sky-400">— 选择军备牌叠甲</span>}
        </div>
        <div className="flex min-h-[82px] items-end gap-1 overflow-x-auto pb-1">
          {cp.hand.map((card,i)=>{
            const sd=vm==='deploy'&&depCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(card));
            const ss=vm==='selectSupplyCards'&&supCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(card));
            const sa=vm==='selectArmorCards'&&armCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(card));
            const dd=vm==='deploy'&&depGen&&getRuntimeCardId(depGen)===getRuntimeCardId(card);
            const h=hovIdx===i;
            const isArmorSelectable=vm==='selectArmorCards'&&!isGen(card)&&(card as GameCard).type==='军备';
            const generalVisual = isGen(card) ? getGeneralCardVisual(card, cp.faction, sd||ss||sa ? 'rgba(20,50,20,0.42)' : dd ? 'rgba(70,45,10,0.42)' : h ? 'rgba(0,0,0,0.60)' : 'rgba(0,0,0,0.40)') : null;
            const stateBorder = sd||ss||sa ? '#4ade80' : dd||h ? '#fbbf24' : null;
            return(<div key={`${getRuntimeCardId(card)}-${i}`} className={`relative w-[56px] flex-shrink-0 rounded-lg border-2 cursor-pointer transition-all duration-200 ${sd||ss||sa?'border-green-400 bg-green-900/40 -translate-y-3':dd?'border-amber-400 bg-amber-900/40 -translate-y-3':h?'z-30 -translate-y-4 scale-110 border-amber-400/60 bg-black/60 shadow-xl':'border-amber-800/25 bg-black/40 hover:-translate-y-1'} ${vm==='selectArmorCards'&&!isArmorSelectable&&!sa?'opacity-30':''}`}
              style={{height:h?'88px':'76px', ...(generalVisual ?? {}), ...(stateBorder ? {borderColor:stateBorder} : {})}} onMouseEnter={()=>setHovIdx(i)} onMouseLeave={()=>setHovIdx(null)}
              onClick={()=>{
                if(vm==='deploy'&&!dd&&canUse(card))toggleDep(card);
                else if(vm==='selectAttackCard')pickAtkCard(card);
                else if(vm==='selectMoveCard')pickMoveCard(card);
                else if(vm==='selectSupplyCards')toggleSup(card);
                else if(vm==='selectArmorCards'&&isArmorSelectable)toggleArm(card as GameCard);
                else if(isGen(card)){setIns({type:'general',general:card});setVm('inspect');}
                else{setIns({type:'card',card});setVm('inspect');}
              }}>
              <div className="p-1 text-center">{isGen(card)?(<><div className="mb-0.5 inline-block rounded px-1 text-[8px] font-bold" style={{backgroundColor:`${factionColors[card.faction]}40`,color:factionColors[card.faction]}}>{card.faction}</div><div className="text-base">{card.type==='武将'?'⚔️':'📜'}</div><p className="truncate text-[8px] font-bold leading-tight text-amber-200">{card.name}</p>{h&&<div className="text-[7px] text-amber-400/70">❤️{card.hp}</div>}</>):(<><div className="mt-1 text-base">{card.type==='粮草'?'🌾':card.type==='材料'?'⛏️':'🛡️'}</div><p className="truncate text-[8px] font-bold leading-tight text-amber-200">{card.name}</p><p className="text-[7px] text-amber-500/50">{card.type}</p></>)}</div>
              {(sd||ss||sa)&&<div className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[8px] font-black text-white">✓</div>}
            </div>);
          })}
          {cp.hand.length===0&&<div className="flex h-[76px] w-full items-center justify-center text-sm text-amber-700/40">手牌为空</div>}
        </div>
      </div>
      {/* inspect modal */}
      {vm==='inspect'&&ins&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={()=>{setVm('board');setIns(null);}}>
        <div className="mx-4 w-full max-w-md rounded-2xl border border-amber-600/40 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
          {(ins.type==='general'||ins.type==='fieldGeneral')?(()=>{
            const g=ins.general||ins.fieldGeneral?.general;if(!g)return null;
            const fg=ins.fieldGeneral; const own=fg?fg.ownerId===cp.id:false;
            const isSch=g.type==='文将'; const isWar=g.type==='武将';
            const moveOk=fg?canFieldGeneralMove(fg,players):false;
            const meleeN=fg?getValidTargets(fg,cp.id,players,false).length:0;
            const rangeN=fg?getValidTargets(fg,cp.id,players,true).length:0;
            let canMov=false,canAtk=false;
            if(fg&&own){
              // isArming blocks move and attack
              if(fg.isArming){canMov=false;canAtk=false;}
              else if(isWar){canMov=!fg.hasMoved&&moveOk;canAtk=!fg.hasAttacked&&cp.hand.length>0;}
              else if(fg.justDeployed){const acted=fg.hasMoved||fg.hasAttacked;canMov=!acted&&moveOk&&cp.hand.length>0;canAtk=!acted&&cp.hand.length>0;}
              else{canMov=!fg.hasMoved&&moveOk&&cp.hand.length>0;canAtk=!fg.hasAttacked&&cp.hand.length>0;}
            }
            // Supply: extra cost if in enemy territory
            const inEnemy=fg?isInEnemyTerritory(fg):false;
            const supExtraCost=inEnemy?1:0;
            const supNeedCards=fg?(1+supExtraCost):1;
            const canSup=!!(fg&&own&&!fg.hasSupplied&&fg.currentHp<fg.maxHp&&cp.hand.length>=supNeedCards);
            // Armor: need armor cards in hand, armor < maxHp
            const armorInHand=cp.hand.filter(c=>!isGen(c)&&(c as GameCard).type==='军备').length;
            const canArm=!!(fg&&own&&!fg.isArming&&fg.currentArmor<fg.maxHp&&armorInHand>0);
            // Deploy: check camp has free slot
            const campFree=hasFreeCampSlot(cp.id,players);
            const canDeploy=!fg&&ins.type==='general'&&campFree&&cp.hand.length>1;
            return(<>
              <div className="mb-3 flex items-center gap-2"><div className="h-3 w-3 rounded-full" style={{backgroundColor:factionColors[g.faction]}}/><span className="rounded px-2 py-0.5 text-sm font-bold" style={{backgroundColor:`${factionColors[g.faction]}25`,color:factionColors[g.faction]}}>{g.faction}</span><span className="text-sm text-amber-400/70">{g.type}</span>{fg&&fg.isArming&&<span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/30">整备中</span>}{fg&&<span className="ml-auto text-xs text-green-400/60">场上</span>}</div>
              <h2 className="mb-0.5 text-3xl font-black text-amber-100">{g.name}</h2>
              {g.title&&<p className="mb-4 text-sm text-amber-500/60">{g.title}</p>}
              <div className="mb-4 grid grid-cols-5 gap-2">
                <SC l="❤️体力" v={fg?`${fg.currentHp}/${fg.maxHp}`:`${g.hp}`} c="text-red-400"/>
                <SC l="🛡️护甲" v={fg?`${fg.currentArmor}/${fg.maxHp}`:'0'} c="text-blue-300"/>
                <SC l="⚔️近战" v={`${fg?.meleeAtk??g.meleeAtk}`} c="text-orange-300"/>
                <SC l="🏹远程" v={`${fg?.rangedAtk??g.rangedAtk}`} c="text-cyan-300"/>
                <SC l="🛡️基础" v={`${fg?.armor??g.armor}`} c="text-gray-400"/>
              </div>
              {fg&&own&&fg.isArming&&<p className="mb-2 text-center text-xs text-blue-400/70">🛡️ 整备状态：本回合无法移动和攻击</p>}
              {fg&&own&&isSch&&fg.justDeployed&&!fg.isArming&&<p className="mb-2 text-center text-xs text-amber-500/60">📜文将登场回合只能移动或攻击其一</p>}
              {fg&&own&&inEnemy&&<p className="mb-2 text-center text-xs text-yellow-500/60">⚠️ 敌方区域：补给额外消耗1张手牌</p>}
              <div className="mb-4"><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400/80">技能</h3><div className="flex flex-wrap gap-1.5">{(skillEdits[g.id]??g.skills).map((s,i)=><div key={i} className="rounded-lg border border-amber-700/20 bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-200"><span className="font-bold">{s.name}</span>{s.tag&&<span className="ml-1 text-[9px] px-1 py-0.5 rounded-full font-bold border" style={{color:skillTagColors[s.tag],borderColor:skillTagColors[s.tag]+'50',backgroundColor:skillTagColors[s.tag]+'15'}}>{s.tag}</span>}{s.description&&<span className="text-amber-300/50 text-[10px] ml-1">— {s.description}</span>}</div>)}</div></div>
              {fg&&own&&<div className="flex flex-wrap gap-2 border-t border-amber-800/20 pt-3">
                <button onClick={()=>canMov&&startMove(fg)} disabled={!canMov} className={`flex-1 rounded-lg py-2 text-sm font-bold ${canMov?'bg-blue-700/80 text-white hover:bg-blue-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>🚶前进{isSch?' (-1牌)':''}</button>
                <button onClick={()=>canAtk&&meleeN>0&&startAtk(fg,false)} disabled={!canAtk||meleeN===0} className={`flex-1 rounded-lg py-2 text-sm font-bold ${canAtk&&meleeN>0?'bg-red-700/80 text-white hover:bg-red-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>⚔️近战(-1牌)</button>
                <button onClick={()=>canAtk&&rangeN>0&&startAtk(fg,true)} disabled={!canAtk||rangeN===0} className={`flex-1 rounded-lg py-2 text-sm font-bold ${canAtk&&rangeN>0?'bg-purple-700/80 text-white hover:bg-purple-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>🏹远程(-1牌)</button>
                <button onClick={()=>canSup&&startSup(fg)} disabled={!canSup} className={`flex-1 rounded-lg py-2 text-sm font-bold ${canSup?'bg-green-700/80 text-white hover:bg-green-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>💊补给{inEnemy?' (额外-1)':''}</button>
                <button onClick={()=>canArm&&startArm(fg)} disabled={!canArm} className={`flex-1 rounded-lg py-2 text-sm font-bold ${canArm?'bg-sky-700/80 text-white hover:bg-sky-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>🛡️叠甲</button>
              </div>}
              {canDeploy&&<button onClick={()=>{setIns(null);startDeploy(g);}} className="mt-3 w-full rounded-xl bg-gradient-to-r from-amber-600 to-red-700 py-2.5 text-lg font-bold text-white">⚔️登场将领</button>}
              {!fg&&ins.type==='general'&&!campFree&&<p className="mt-3 text-center text-xs text-red-400/60">营地已满，无法登场</p>}
            </>);
          })():ins.card?(<><div className="mb-3 text-center text-4xl">{ins.card.type==='粮草'?'🌾':ins.card.type==='材料'?'⛏️':'🛡️'}</div><div className="mb-1 text-center"><span className="rounded-full bg-amber-800/30 px-3 py-1 text-sm font-bold text-amber-300">{ins.card.type}</span></div><h2 className="mt-3 mb-3 text-center text-2xl font-black text-amber-200">{ins.card.name}</h2><p className="text-center text-sm text-amber-100/60">{ins.card.description}</p></>):null}
          <button onClick={()=>{setVm('board');setIns(null);}} className="mt-4 w-full rounded-xl border border-gray-700/30 bg-gray-800/80 py-2.5 font-bold text-amber-200/80">关闭</button>
        </div>
      </div>}
      {/* surrender */}
      {surConf&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"><div className="mx-4 w-full max-w-sm rounded-2xl border border-red-600/40 bg-gradient-to-b from-gray-900 to-black p-8 text-center shadow-2xl">
        <div className="mb-4 text-5xl">🏳️</div><h2 className="mb-3 text-2xl font-black text-red-300">确认投降？</h2><p className="mb-8 text-sm text-amber-100/50">投降后立即结束当前回合</p>
        <div className="flex gap-3"><button onClick={()=>{surrender(cp.id);setSurConf(false);}} className="flex-1 rounded-xl bg-red-700 py-3 font-bold text-white">确认投降</button><button onClick={()=>setSurConf(false)} className="flex-1 rounded-xl bg-gray-700 py-3 font-bold text-white">取消</button></div>
      </div></div>}
      {showPauseMenu&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-sm rounded-2xl border border-purple-600/40 bg-gradient-to-b from-gray-900 to-black p-8 text-center shadow-2xl">
          <div className="mb-3 text-5xl">⏸️</div>
          <h2 className="mb-6 text-2xl font-black text-purple-200">对局菜单</h2>
          <div className="flex flex-col gap-3">
            <button onClick={saveGameSnapshot} className="rounded-xl bg-amber-700 py-3 font-bold text-white hover:bg-amber-600">保存对局</button>
            <button onClick={saveAndExit} className="rounded-xl bg-amber-800 py-3 font-bold text-white hover:bg-amber-700">保存对局并退出</button>
            <button onClick={()=>setShowAbandonConfirm(true)} className="rounded-xl bg-red-800 py-3 font-bold text-white hover:bg-red-700">放弃对局并退出</button>
            <button onClick={restartGame} className="rounded-xl bg-orange-800 py-3 font-bold text-white hover:bg-orange-700">重开对局</button>
            <button onClick={()=>{setShowInGameRules(true);setShowPauseMenu(false);}} className="rounded-xl bg-slate-700 py-3 font-bold text-white hover:bg-slate-600">游戏规则</button>
            <button onClick={()=>{setShowInGameSettings(true);setShowPauseMenu(false);}} className="rounded-xl bg-slate-700 py-3 font-bold text-white hover:bg-slate-600">游戏设置</button>
            <button onClick={()=>setShowPauseMenu(false)} className="rounded-xl bg-gray-700 py-3 font-bold text-white hover:bg-gray-600">返回对局</button>
            {snapshotMessage&&<p className="text-sm text-amber-300">{snapshotMessage}</p>}
          </div>
        </div>
      </div>}
      {showAbandonConfirm&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-sm rounded-2xl border border-red-600/50 bg-gradient-to-b from-gray-900 to-black p-8 text-center shadow-2xl">
          <div className="mb-3 text-5xl">⚠️</div>
          <h2 className="mb-3 text-2xl font-black text-red-300">放弃当前对局？</h2>
          <p className="mb-6 text-sm text-amber-100/60">未保存的进度将会丢失，确定要退出吗？</p>
          <div className="flex gap-3">
            <button onClick={abandonAndExit} className="flex-1 rounded-xl bg-red-700 py-3 font-bold text-white">确定退出</button>
            <button onClick={()=>setShowAbandonConfirm(false)} className="flex-1 rounded-xl bg-gray-700 py-3 font-bold text-white">取消</button>
          </div>
        </div>
      </div>}
      {showInGameRules&&<div className="fixed inset-0 z-[55] overflow-y-auto bg-black/90"><Rules onBack={()=>setShowInGameRules(false)} /></div>}
      {showInGameSettings&&<div className="fixed inset-0 z-[55] overflow-y-auto bg-black/90"><Settings onBack={()=>setShowInGameSettings(false)} hideDeveloper /></div>}
      {/* pool / deck / discard / graveyard modals */}
      {showGeneralPool&&<Modal title={`👤将领池(${cp.generalPool.length})`} onClose={()=>setShowGeneralPool(false)}>
        <div className="mb-4 space-y-3">
          <div className="rounded-xl border border-emerald-800/20 bg-emerald-900/10 p-3">
            <p className="mb-2 text-xs text-emerald-300/80">类型统计</p>
            <div className="flex flex-wrap gap-2">
              <StatPill label="武将" value={generalPoolCounts.武将} tone="emerald" />
              <StatPill label="文将" value={generalPoolCounts.文将} tone="emerald" />
            </div>
          </div>
          <div className="rounded-xl border border-emerald-800/20 bg-emerald-900/10 p-3">
            <p className="mb-2 text-xs text-emerald-300/80">势力统计</p>
            <div className="flex flex-wrap gap-2">
              <StatPill label="魏" value={generalPoolCounts.魏} tone="blue" />
              <StatPill label="蜀" value={generalPoolCounts.蜀} tone="red" />
              <StatPill label="吴" value={generalPoolCounts.吴} tone="green" />
              <StatPill label="群" value={generalPoolCounts.群} tone="yellow" />
              <StatPill label="晋" value={generalPoolCounts.晋} tone="purple" />
            </div>
          </div>
        </div>
        {generalPoolPreview.length===0?<p className="py-10 text-center text-emerald-500/40">将领池为空</p>:<div className="grid grid-cols-4 gap-2">{generalPoolPreview.map((g,i)=><div key={`${g.id}-${i}`} className="rounded-lg border border-emerald-800/15 bg-black/40 p-2 text-center text-xs"><div className="text-base">{g.type==='武将'?'⚔️':'📜'}</div><p className="text-[10px] font-bold text-emerald-200">{g.name}</p><p className="text-[9px] mt-1" style={{color:factionColors[g.faction]}}>{g.faction} · {g.type}</p></div>)}</div>}
      </Modal>}
      {showDeck&&<Modal title={`🎴抽牌堆(${cardDeck.length})`} onClose={()=>setShowDeck(false)}>
        <div className="mb-4 rounded-xl border border-blue-800/20 bg-blue-900/10 p-3">
          <p className="mb-2 text-xs text-blue-300/80">类型剩余</p>
          <div className="flex flex-wrap gap-2">
            <StatPill label="粮草" value={deckTypeCounts.粮草} tone="green" />
            <StatPill label="材料" value={deckTypeCounts.材料} tone="blue" />
            <StatPill label="军备" value={deckTypeCounts.军备} tone="red" />
          </div>
        </div>
        {deckPreview.length===0?<p className="py-10 text-center text-blue-500/40">抽牌堆为空</p>:<div className="grid grid-cols-4 gap-2">{deckPreview.map((c,i)=><div key={`${c.id}-${i}`} className="rounded-lg border border-blue-800/15 bg-black/40 p-2 text-center text-xs"><div className="text-base">{c.type==='粮草'?'🌾':c.type==='材料'?'⛏️':'🛡️'}</div><p className="text-[10px] text-blue-200">{c.name}</p><p className="text-[9px] mt-1 text-blue-300/70">{c.type}</p></div>)}</div>}
      </Modal>}
      {showDiscard&&<Modal title={`📋弃牌堆(${discardPile.length})`} onClose={()=>setShowDiscard(false)}>{discardPile.length===0?<p className="py-10 text-center text-amber-500/40">弃牌堆为空</p>:<div className="grid grid-cols-4 gap-2">{discardPile.map((c,i)=><div key={`${c.id}-${i}`} className="rounded-lg border border-amber-800/15 bg-black/40 p-2 text-center text-xs"><div className="text-base">{c.type==='粮草'?'🌾':c.type==='材料'?'⛏️':'🛡️'}</div><p className="text-[10px] text-amber-200">{c.name}</p></div>)}</div>}</Modal>}
      {showGrave&&<Modal title="💀墓地" onClose={()=>setShowGrave(false)}>{players.every(p=>p.graveyard.length===0)?<p className="py-10 text-center text-red-500/40">墓地为空</p>:players.filter(p=>p.graveyard.length>0).map(p=><div key={p.id} className="mb-4"><h3 className="mb-2 text-sm font-bold" style={{color:factionColors[p.faction!]}}>{p.name}</h3><div className="grid grid-cols-4 gap-2">{p.graveyard.map((g,i)=><div key={`${g.id}-${i}`} className="rounded-lg border border-red-800/15 bg-black/40 p-2 text-center text-xs"><div className="text-base">{g.type==='武将'?'⚔️':'📜'}</div><p className="text-[10px] font-bold text-amber-200">{g.name}</p></div>)}</div></div>)}</Modal>}
    </div>
  );
}
