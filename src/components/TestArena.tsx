import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore, FieldGeneral, Position, Player } from '../store/gameStore';
import {
  getValidTargets, getMoveTargets, canFieldGeneralMove,
  hasFreeCampSlot, isInEnemyTerritory,
} from '../rules/battlefieldRules';
import { General, factionColors, skillTagColors, allGenerals } from '../data/generals';
import { getGeneralCardVisual } from '../utils/generalCardVisual';
import { GameCard } from '../data/cards';
import { getRuntimeCardId } from '../utils/runtimeIdentity';
import { SC, Bar, Btn } from './testArena/compactPrimitives';

type ViewMode = 'board'|'inspect'|'deploy'|'deployTarget'|'selectAttackCard'|'selectMoveCard'|'selectSupplyCards';
interface InspectTarget { type:'general'|'card'|'fieldGeneral'; general?:General; card?:GameCard; fieldGeneral?:FieldGeneral; playerId?:number; }
function isGen(c:General|GameCard):c is General{return 'skills' in c;}

export default function TestArena(){
  const players=useGameStore(s=>s.players);
  const cpi=useGameStore(s=>s.currentPlayerIndex);
  const round=useGameStore(s=>s.currentRound);
  const endTurn=useGameStore(s=>s.endTurn);
  const surrender=useGameStore(s=>s.surrender);
  const deployGeneral=useGameStore(s=>s.deployGeneral);
  const moveGeneral=useGameStore(s=>s.moveGeneral);
  const attackTarget=useGameStore(s=>s.attackTarget);
  const supplyGeneral=useGameStore(s=>s.supplyGeneral);
  const defeatEvent=useGameStore(s=>s.defeatEvent);
  const clearDefeatEvent=useGameStore(s=>s.clearDefeatEvent);
  const skillEdits=useGameStore(s=>s.skillEdits);
  const skillActivations=useGameStore(s=>s.skillActivations);
  const clearSkillActivation=useGameStore(s=>s.clearSkillActivation);
  const resetGame=useGameStore(s=>s.resetGame);
  const setCurrentPlayerIndex=useGameStore(s=>s.setCurrentPlayerIndex);

  // Test-specific actions
  const testDrawCards=useGameStore(s=>s.testDrawCards);
  const testDrawSpecificGeneral=useGameStore(s=>s.testDrawSpecificGeneral);
  const testDiscardCard=useGameStore(s=>s.testDiscardCard);
  const testAddPlayer=useGameStore(s=>s.testAddPlayer);
  const testRemovePlayer=useGameStore(s=>s.testRemovePlayer);
  const testSetGeneralHp=useGameStore(s=>s.testSetGeneralHp);
  const testSetGeneralMaxHp=useGameStore(s=>s.testSetGeneralMaxHp);
  const testDamageGeneral=useGameStore(s=>s.testDamageGeneral);
  const testHealGeneral=useGameStore(s=>s.testHealGeneral);
  const testSetBaseHp=useGameStore(s=>s.testSetBaseHp);
  const testDamageBase=useGameStore(s=>s.testDamageBase);
  const testHealBase=useGameStore(s=>s.testHealBase);
  const testResetActions=useGameStore(s=>s.testResetActions);

  const [vm,setVm]=useState<ViewMode>('board');
  const [ins,setIns]=useState<InspectTarget|null>(null);
  const [depGen,setDepGen]=useState<General|null>(null);
  const [depCards,setDepCards]=useState<(General|GameCard)[]>([]);
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
  const [hitBaseIds,setHitBaseIds]=useState<number[]>([]);
  const [hitGeneralIds,setHitGeneralIds]=useState<string[]>([]);
  const [healGeneralIds,setHealGeneralIds]=useState<string[]>([]);
  const [screenShaking,setScreenShaking]=useState(false);
  const prevBaseHpRef=useRef<Record<number,number>|null>(null);
  const prevGeneralHpRef=useRef<Record<string,number>>({});

  // Dev panel state
  const [showDevPanel,setShowDevPanel]=useState(true);
  const [devTab,setDevTab]=useState<'players'|'generals'|'pool'>('players');
  const [poolSearch,setPoolSearch]=useState('');
  const [dmgAmount,setDmgAmount]=useState(1);
  const [dmgType,setDmgType]=useState<'attack'|'skill'|'lose'>('attack');

  // Track action counts locally
  const [actionCounts,setActionCounts]=useState<Record<string,{atk:number;mov:number;sup:number}>>({});

  const cp=players[cpi]; if(!cp) return null;
  const cpColor=factionColors[cp.faction!]||'#eab308';

  const validTgts=useMemo(()=>atkGen?getValidTargets(atkGen,cp.id,players,atkRanged):[],[atkGen,cp.id,players,atkRanged]);

  useEffect(()=>{
    const currentBaseMap:Record<number,number>=Object.fromEntries(players.map(p=>[p.id,p.baseHp]));
    const currentGeneralMap:Record<string,number>=Object.fromEntries(players.flatMap(p=>p.fieldGenerals.map(fg=>[getRuntimeCardId(fg.general),fg.currentHp]as const)));
    if(prevBaseHpRef.current===null){prevBaseHpRef.current=currentBaseMap;prevGeneralHpRef.current=currentGeneralMap;return;}
    const dmgBases=players.filter(p=>(prevBaseHpRef.current?.[p.id]??p.baseHp)>p.baseHp).map(p=>p.id);
    const dmgGens=Object.entries(currentGeneralMap).filter(([id,hp])=>(prevGeneralHpRef.current[id]??hp)>hp).map(([id])=>id);
    const healGens=Object.entries(currentGeneralMap).filter(([id,hp])=>(prevGeneralHpRef.current[id]??hp)<hp).map(([id])=>id);
    const timers:number[]=[];
    if(dmgBases.length>0||dmgGens.length>0){if(dmgBases.length>0)setHitBaseIds(dmgBases);if(dmgGens.length>0)setHitGeneralIds(dmgGens);setScreenShaking(true);timers.push(window.setTimeout(()=>setHitBaseIds([]),900));timers.push(window.setTimeout(()=>setHitGeneralIds([]),900));timers.push(window.setTimeout(()=>setScreenShaking(false),500));}
    if(healGens.length>0){setHealGeneralIds(healGens);timers.push(window.setTimeout(()=>setHealGeneralIds([]),900));}
    prevBaseHpRef.current=currentBaseMap;prevGeneralHpRef.current=currentGeneralMap;
    // Keep animation timers alive across unrelated player-state updates. The
    // previous dependency cleanup cancelled them and left the hit class stuck.
  },[players]);

  useEffect(()=>{if(!defeatEvent)return;const t=window.setTimeout(()=>clearDefeatEvent(),2200);return()=>window.clearTimeout(t);},[defeatEvent,clearDefeatEvent]);
  useEffect(()=>{if(skillActivations.length===0)return;const timers=skillActivations.map(a=>window.setTimeout(()=>clearSkillActivation(a.id),3000));return()=>{timers.forEach(t=>window.clearTimeout(t));};},[skillActivations,clearSkillActivation]);

  const allFg=players.flatMap(p=>p.fieldGenerals);
  const fgAt=(areaId:number,zone:'camp'|'front',slot:number)=>allFg.find(fg=>fg.position.zone===zone&&fg.position.areaOwnerId===areaId&&fg.position.slot===slot);
  const battleFg=(slot:number)=>allFg.find(fg=>fg.position.zone==='battle'&&fg.position.slot===slot);
  const ownerOf=(fg:FieldGeneral)=>players.find(p=>p.id===fg.ownerId);

  // In test mode, actions don't consume limits: we track counts but reset hasMoved/hasAttacked/hasSupplied after each action
  const trackAction=(generalId:string,type:'atk'|'mov'|'sup')=>{
    setActionCounts(prev=>{const cur=prev[generalId]||{atk:0,mov:0,sup:0};return{...prev,[generalId]:{...cur,[type]:cur[type]+1}};});
  };

  const startDeploy=(g:General)=>{setDepGen(g);setDepCards([]);setVm('deploy');};
  const toggleDep=(c:General|GameCard)=>{const key=getRuntimeCardId(c);if(depCards.some(x=>getRuntimeCardId(x)===key)){setDepCards(p=>p.filter(x=>getRuntimeCardId(x)!==key));return;}if(depGen&&depCards.length<depGen.hp)setDepCards(p=>[...p,c]);};
  const confirmDep=()=>{if(depCards.length>0)setVm('deployTarget');};
  const doDeploy=(slot:number)=>{
    if(!depGen||depCards.length===0)return;
    const success=deployGeneral(depGen,slot,depCards);
    if(!success){
      setDepNotice('登场失败');
      setTimeout(()=>setDepNotice(null),1200);
      return;
    }
    setDepNotice(depGen.name);setTimeout(()=>setDepNotice(null),1200);
    setDepGen(null);setDepCards([]);setVm('board');
  };
  const cancelDep=()=>{setDepGen(null);setDepCards([]);setVm('board');};

  const startAtk=(fg:FieldGeneral,ranged:boolean)=>{if(cp.hand.length===0)return;setAtkGen(fg);setAtkRanged(ranged);setAtkCard(null);setIns(null);setVm('selectAttackCard');};
  const resetAtk=()=>{setAtkGen(null);setAtkRanged(false);setAtkCard(null);setVm('board');};
  const pickAtkCard=(c:General|GameCard)=>{setAtkCard(c);setVm('board');};
  const doAtk=(tid:string)=>{
    if(atkGen&&atkCard){
      trackAction(getRuntimeCardId(atkGen.general),'atk');
      attackTarget(getRuntimeCardId(atkGen.general),tid,atkRanged,atkCard);
      // Reset the general's hasAttacked so it can attack again in test mode
      setTimeout(()=>testResetActions(getRuntimeCardId(atkGen.general)),50);
      resetAtk();
    }
  };

  const startMove=(fg:FieldGeneral)=>{
    const tgts=getMoveTargets(fg,players);if(tgts.length===0)return;
    const isSch=fg.general.type==='文将';if(isSch&&cp.hand.length===0)return;
    setMovGen(fg);setIns(null);
    // Only battle-zone movement needs explicit destination selection.
    // Camp/front movement keeps the original one-path behavior.
    if(fg.position.zone!=='battle' && tgts.length===1){
      const target=tgts[0];
      setMoveOptions([]);setMovTgt(target);
      if(isSch){setVm('selectMoveCard');return;}
      trackAction(getRuntimeCardId(fg.general),'mov');
      moveGeneral(getRuntimeCardId(fg.general),target);
      setTimeout(()=>testResetActions(getRuntimeCardId(fg.general)),50);
      setMovGen(null);setMovTgt(null);setVm('board');
      return;
    }
    // Battle movement always requires an explicit destination choice, even
    // when there is only one legal direction, and can be cancelled.
    setMoveOptions(tgts);setMovTgt(null);setVm('board');
  };
  const chooseMoveTarget=(target:Position)=>{
    if(!movGen)return;const isSch=movGen.general.type==='文将';setMovTgt(target);setMoveOptions([]);
    if(isSch){setVm('selectMoveCard');return;}
    trackAction(getRuntimeCardId(movGen.general),'mov');
    moveGeneral(getRuntimeCardId(movGen.general),target);
    setTimeout(()=>testResetActions(getRuntimeCardId(movGen.general)),50);
    setMovGen(null);setMovTgt(null);setVm('board');
  };
  const pickMoveCard=(c:General|GameCard)=>{
    if(movGen&&movTgt){
      trackAction(getRuntimeCardId(movGen.general),'mov');
      moveGeneral(getRuntimeCardId(movGen.general),movTgt,c);
      setTimeout(()=>testResetActions(getRuntimeCardId(movGen.general)),50);
      setMovGen(null);setMovTgt(null);setMoveOptions([]);setIns(null);setVm('board');
    }
  };
  const cancelMov=()=>{setMovGen(null);setMovTgt(null);setMoveOptions([]);setVm('board');};

  const startSup=(fg:FieldGeneral)=>{if(cp.hand.length===0)return;setSupGen(fg);setSupCards([]);setIns(null);setVm('selectSupplyCards');};
  const toggleSup=(c:General|GameCard)=>{if(!supGen)return;const inE=isInEnemyTerritory(supGen);const extra=inE?1:0;const mx=supGen.maxHp-supGen.currentHp+extra;if(supCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(c))){setSupCards(p=>p.filter(x=>getRuntimeCardId(x)!==getRuntimeCardId(c)));return;}if(supCards.length<mx)setSupCards(p=>[...p,c]);};
  const confirmSup=()=>{
    if(supGen&&supCards.length>0){
      trackAction(getRuntimeCardId(supGen.general),'sup');
      supplyGeneral(getRuntimeCardId(supGen.general),supCards);
      setTimeout(()=>testResetActions(getRuntimeCardId(supGen.general)),50);
      setSupGen(null);setSupCards([]);setVm('board');
    }
  };
  const cancelSup=()=>{setSupGen(null);setSupCards([]);setVm('board');};

  const clickFg=(fg:FieldGeneral)=>{if(atkCard&&atkGen&&validTgts.some(t=>t.id===getRuntimeCardId(fg.general))&&getRuntimeCardId(fg.general)!==getRuntimeCardId(atkGen.general)){doAtk(getRuntimeCardId(fg.general));return;}setIns({type:'fieldGeneral',fieldGeneral:fg,playerId:fg.ownerId});setVm('inspect');};
  const clickBase=(pid:number)=>{if(!atkCard||!atkGen)return;if(validTgts.some(t=>t.id===`base_${pid}`)&&pid!==cp.id)doAtk(`base_${pid}`);};

  const arrange=()=>{const n=players.length;type Pos='bottom'|'top'|'left'|'right';const o:{player:Player;pos:Pos}[]=[];if(n===2){o.push({player:players[cpi],pos:'bottom'},{player:players[(cpi+1)%n],pos:'top'});}else if(n===3){o.push({player:players[cpi],pos:'bottom'},{player:players[(cpi+1)%n],pos:'left'},{player:players[(cpi+2)%n],pos:'right'});}else{o.push({player:players[cpi],pos:'bottom'},{player:players[(cpi+1)%n],pos:'left'},{player:players[(cpi+2)%n],pos:'top'});if(n>=4)o.push({player:players[(cpi+3)%n],pos:'right'});}return o;};
  const arr=arrange();
  const bot=arr.find(x=>x.pos==='bottom')!.player;
  const top=arr.find(x=>x.pos==='top')?.player;
  const lft=arr.find(x=>x.pos==='left')?.player;
  const rgt=arr.find(x=>x.pos==='right')?.player;

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
      const baseHit=hitBaseIds.includes(areaOwner.id);
      return(<button type="button" onClick={()=>atkBase&&clickBase(areaOwner.id)}
        className={`relative flex h-[76px] w-[62px] flex-col items-center justify-center rounded-lg border-2 transition-all ${atkBase?'animate-pulse ring-2 ring-red-500':''} ${baseHit?'animate-base-hit animate-pulse-glow ring-2 ring-red-400':''}`}
        style={{borderColor:atkBase?'#ef4444':baseHit?'#f87171':bc,background:`linear-gradient(180deg,${bc}30 0%,${bc}10 100%)`}}>
        <div className="absolute -top-2 left-0 right-0 flex justify-center gap-0.5">{[0,1,2,3,4].map(i=><span key={i} className="text-[7px]" style={{opacity:i<fl?1:0.15}}>🚩</span>)}</div>
        <div className="text-lg">🏯</div><p className="text-[9px] font-black" style={{color:bc}}>本营</p><p className={`text-[10px] font-black ${baseHit?'text-red-300 animate-number-pop':'text-red-400'}`}>❤️{areaOwner.baseHp}</p>
      </button>);
    }

    const fgColor=fg?factionColors[ownerOf(fg)?.faction||areaOwner.faction!]:bc;
    const generalHit=!!(fg&&hitGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalHeal=!!(fg&&healGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalVisual=fg?getGeneralCardVisual(fg.general,ownerOf(fg)?.faction||areaOwner.faction!,generalHit||generalHeal?'rgba(0,0,0,0.46)':'rgba(0,0,0,0.40)'):null;
    return(<button type="button" onClick={()=>{if(fg)clickFg(fg);else if(canDep)doDeploy(slot===0?0:2);else if(moveTarget)chooseMoveTarget({zone,slot,areaOwnerId:areaOwner.id});}}
      className={`relative flex h-[76px] w-[62px] items-center justify-center rounded-lg border-2 transition-all ${(fg||canDep||moveTarget)?'cursor-pointer hover:brightness-125':'cursor-default'} ${atkFg?`animate-pulse ring-2 ${atkFgFriendly?'ring-yellow-400':'ring-red-500'}`:''} ${moveTarget?'animate-pulse ring-2 ring-cyan-400':''} ${generalHit?'animate-base-hit':''}`}
      style={{...(generalVisual??{}),borderColor:moveTarget?'#22d3ee':atkFg?(atkFgFriendly?'#facc15':'#ef4444'):fg?(generalVisual?.borderColor??fgColor):canDep?'#22c55e':`${bc}55`,...(fg?{}:{background:canDep?'rgba(34,197,94,0.12)':moveTarget?'rgba(34,211,238,0.12)':'rgba(0,0,0,0.28)'})}}>
      {fg?(<div className="px-0.5 text-center"><div className="text-lg">{fg.general.type==='武将'?'⚔️':'📜'}</div><p className="truncate text-[8px] font-black leading-tight text-amber-200">{fg.general.name}</p><p className={`text-[8px] ${generalHit?'text-red-300':generalHeal?'text-green-300':'text-red-400'}`}>❤️{fg.currentHp}/{fg.maxHp}</p></div>):(<span className="text-[8px] text-amber-700/30">{moveTarget?'可前进':zone==='camp'?'营地':'前线'}</span>)}</button>);
  };

  const BSlot=({slot}:{slot:number})=>{
    const fg=battleFg(slot);
    const atkOk=!!(atkCard&&fg&&validTgts.some(t=>t.id===getRuntimeCardId(fg.general)));
    const atkFriendly=!!(atkOk&&fg&&fg.ownerId===cp.id);
    const generalHit=!!(fg&&hitGeneralIds.includes(getRuntimeCardId(fg.general)));
    const generalHeal=!!(fg&&healGeneralIds.includes(getRuntimeCardId(fg.general)));
    const moveTarget=!!moveOptions.find(t=>t.zone==='battle'&&t.areaOwnerId===null&&t.slot===slot);
    const o=fg?ownerOf(fg):null;
    const c=o?.faction?factionColors[o.faction]:'#444';
    const generalVisual=fg?getGeneralCardVisual(fg.general,o?.faction,null):null;
    return(<button type="button" onClick={()=>{if(fg)clickFg(fg);else if(moveTarget)chooseMoveTarget({zone:'battle',slot,areaOwnerId:null});}}
      className={`flex h-[76px] w-[62px] items-center justify-center rounded-lg border-2 transition-all ${fg||moveTarget?'cursor-pointer hover:brightness-125':'cursor-default'} ${atkOk?`animate-pulse ring-2 ${atkFriendly?'ring-yellow-400':'ring-red-500'}`:''} ${moveTarget?'animate-pulse ring-2 ring-cyan-400':''} ${generalHit?'animate-base-hit':''}`}
      style={{...(generalVisual??{}),borderColor:moveTarget?'#22d3ee':atkOk?(atkFriendly?'#facc15':'#ef4444'):fg?(generalVisual?.borderColor??c):'#333',...(fg?{}:{background:moveTarget?'rgba(34,211,238,0.12)':'rgba(0,0,0,0.4)'})}}>
      {fg?(<div className="text-center"><div className="text-lg">{fg.general.type==='武将'?'⚔️':'📜'}</div><p className="text-[8px] font-black leading-tight text-amber-200">{fg.general.name}</p><p className={`text-[8px] ${generalHit?'text-red-300':generalHeal?'text-green-300':'text-red-400'}`}>❤️{fg.currentHp}/{fg.maxHp}</p></div>):(<span className={`text-[8px] ${moveTarget?'text-cyan-300':'text-amber-700/20'}`}>{moveTarget?'可前进':'战场'}</span>)}
    </button>);
  };

  const TerritoryBottom=({p}:{p:Player})=>(<div className="flex flex-col items-center gap-1"><div className="flex gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div><div className="flex gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div></div>);
  const TerritoryTop=({p}:{p:Player})=>(<div className="flex flex-col items-center gap-1"><div className="flex gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div><div className="flex gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div></div>);
  const TerritorySide=({p,side}:{p:Player;side:'left'|'right'})=>(<div className={`flex ${side==='left'?'flex-row':'flex-row-reverse'} items-center gap-1`}><div className="flex flex-col gap-1">{[0,1,2].map(s=><Slot key={`c${s}`} zone="camp" slot={s} areaOwner={p} fg={s===1?undefined:fgAt(p.id,'camp',s===0?0:2)}/>)}</div><div className="flex flex-col gap-1">{[0,1,2].map(s=><Slot key={`f${s}`} zone="front" slot={s} areaOwner={p} fg={fgAt(p.id,'front',s)}/>)}</div></div>);

  const canUse=(c:General|GameCard)=>!(vm==='deploy'&&depGen&&getRuntimeCardId(c)===getRuntimeCardId(depGen));

  // Pool search for dev panel
  const filteredPool=useMemo(()=>{
    if(!poolSearch.trim())return allGenerals;
    const s=poolSearch.toLowerCase();
    return allGenerals.filter(g=>g.name.toLowerCase().includes(s)||g.faction.includes(s)||g.type.includes(s));
  },[poolSearch]);

  return(
    <div className={`relative flex h-screen flex-col overflow-hidden text-white ${screenShaking?'animate-screenShake':''}`} style={{background:'radial-gradient(ellipse at center,#1a1a2e 0%,#0d0d1a 60%,#000 100%)'}}>
      {/* top bar */}
      <div className="z-20 flex flex-shrink-0 items-center justify-between border-b border-amber-800/20 bg-black/60 px-3 py-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-black text-amber-500 bg-amber-900/30 border border-amber-700/30 rounded px-2 py-0.5">⚗️ 测试场</span>
          <span className="text-xs font-bold text-amber-400">第{round}轮</span>
          <span className="text-xs text-amber-100">操控：<span style={{color:cpColor}}>{cp.name}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowDevPanel(!showDevPanel)} className={`rounded border px-2 py-0.5 text-xs font-bold transition-all ${showDevPanel?'border-amber-500/50 bg-amber-900/30 text-amber-300':'border-gray-700/30 bg-black/30 text-gray-500'}`}>🔧 工具</button>
          {cp.isAlive&&<button onClick={()=>surrender(cp.id)} className="rounded border border-orange-800/30 bg-orange-900/30 px-2 py-0.5 text-xs text-orange-300">⚑ 投降</button>}
          <button onClick={resetGame} className="rounded border border-red-800/30 bg-red-900/30 px-2 py-0.5 text-xs text-red-300">✕ 退出</button>
        </div>
      </div>
      {/* player switch bar */}
      <div className="flex flex-shrink-0 items-center justify-center gap-2 bg-black/30 px-3 py-1">
        {players.map((p,pi)=>{const a=p.id===cp.id;const c=factionColors[p.faction!];return(
          <button key={p.id} onClick={()=>setCurrentPlayerIndex(pi)} className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 transition-all ${a?'border-amber-500/60 bg-amber-900/20 scale-105':!p.isAlive?'border-gray-800/30 opacity-30':'border-gray-700/20 hover:border-amber-700/40'}`}>
            <div className="h-2 w-2 rounded-full" style={{backgroundColor:c}}/><span className="text-[10px] font-bold" style={{color:c}}>{p.name}</span><span className="text-[9px] text-red-400/80">🏯{p.baseHp}</span><span className="text-[9px] text-amber-300/50">🃏{p.hand.length}</span></button>);})}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Board area */}
        <div className="relative flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-1.5">
            {top&&<div className="flex flex-col items-center"><span className="mb-0.5 text-[9px] font-bold" style={{color:factionColors[top.faction!]}}>{top.name}({top.faction})</span><TerritoryTop p={top}/></div>}
            <div className="flex items-center gap-3">
              {lft&&<div className="flex flex-col items-center"><span className="mb-0.5 text-[9px] font-bold" style={{color:factionColors[lft.faction!]}}>{lft.name}</span><TerritorySide p={lft} side="left"/></div>}
              <div className="relative mx-1"><div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold tracking-[0.2em] text-amber-600/50">⚔ 战 场 ⚔</div><div className="rounded-xl border border-amber-800/20 bg-black/20 p-2"><div className="flex gap-1">{Array.from({length:players.length},(_,i)=><BSlot key={i} slot={i}/>)}</div></div></div>
              {rgt&&<div className="flex flex-col items-center"><span className="mb-0.5 text-[9px] font-bold" style={{color:factionColors[rgt.faction!]}}>{rgt.name}</span><TerritorySide p={rgt} side="right"/></div>}
            </div>
            <div className="flex flex-col items-center"><TerritoryBottom p={bot}/><span className="mt-0.5 text-[9px] font-bold" style={{color:factionColors[bot.faction!]}}>{bot.name}({bot.faction})</span></div>
          </div>
          {/* skill activations */}
          {skillActivations.length>0&&<div className="pointer-events-none absolute left-2 top-2 z-40 flex flex-col gap-1.5 max-w-[200px]">{skillActivations.map(a=>(<div key={a.id} className="rounded-lg border-2 bg-black/90 px-3 py-2 animate-slideUp" style={{borderColor:a.color+'80',boxShadow:`0 0 12px ${a.color}30`}}><div className="flex items-center gap-1.5 mb-0.5"><span className="text-xs">⚡</span><span className="text-xs font-black" style={{color:a.color}}>{a.generalName}</span><span className="text-[8px] px-1 py-0.5 rounded-full font-bold" style={{color:a.color,backgroundColor:a.color+'15'}}>【{a.skillName}】</span></div><p className="text-[10px] text-amber-200/80">{a.message}</p></div>))}</div>}
          {depNotice&&<div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2"><div className="rounded-xl border-2 border-amber-500 bg-black/90 px-6 py-3 text-center animate-fadeIn"><p className="text-lg font-black text-amber-400">⚔️ 将领登场</p><p className="text-base text-amber-200">{depNotice}</p></div></div>}
          {defeatEvent&&<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center animate-fadeIn"><div className="absolute inset-0 bg-black/70"/><div className="relative flex flex-col items-center gap-3"><div className="text-6xl animate-pulse-glow">💥🏯💥</div><div className="rounded-2xl border-2 px-8 py-4 text-center" style={{borderColor:defeatEvent.faction?factionColors[defeatEvent.faction]:'#ef4444',background:'rgba(0,0,0,0.85)'}}><p className="text-3xl font-black" style={{color:defeatEvent.faction?factionColors[defeatEvent.faction]:'#fca5a5'}}>{defeatEvent.faction?`${defeatEvent.faction}势力击破`:'势力击破'}</p></div></div></div>}
          {atkCard&&atkGen&&<div className="absolute left-1/2 top-1 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-red-500 bg-red-900/90 px-4 py-1.5 animate-fadeIn"><span className="text-xs font-bold text-red-200">⚔️{atkRanged?'远程':'近战'}攻击 - 点击目标</span><button onClick={resetAtk} className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white">取消</button></div>}
          {/* action buttons */}
          {(vm==='board'||vm==='inspect')&&!atkCard&&<div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1.5">
            <button onClick={endTurn} className="rounded-lg border border-red-700/50 bg-red-900/60 px-2.5 py-2 text-[10px] font-bold text-red-200">⏭️结束回合</button>
          </div>}
        </div>

        {/* Dev panel */}
        {showDevPanel&&(
          <div className="w-72 flex-shrink-0 border-l border-amber-800/20 bg-black/60 flex flex-col overflow-hidden">
            <div className="flex border-b border-amber-800/20 flex-shrink-0">
              {([['players','玩家'],['generals','场上'],['pool','将领池']] as const).map(([k,l])=>(
                <button key={k} onClick={()=>setDevTab(k)} className={`flex-1 py-1.5 text-[10px] font-bold transition-all ${devTab===k?'bg-amber-900/30 text-amber-300 border-b-2 border-amber-500':'text-gray-500 hover:text-gray-300'}`}>{l}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
              {devTab==='players'&&(<>
                {players.map((p,pi)=>{const c=factionColors[p.faction!];return(
                  <div key={p.id} className="rounded-lg border border-gray-800/40 bg-black/30 p-2.5">
                    <div className="flex items-center justify-between mb-2"><span className="font-bold" style={{color:c}}>{p.name} ({p.faction})</span>
                      <div className="flex gap-1">
                        <button onClick={()=>setCurrentPlayerIndex(pi)} className="px-1.5 py-0.5 rounded bg-amber-800/40 text-amber-300 text-[9px] hover:bg-amber-700/40">操控</button>
                        {p.isAlive&&<button onClick={()=>surrender(p.id)} className="px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 text-[9px] hover:bg-orange-800/40">投降</button>}
                        {players.length>2&&<button onClick={()=>testRemovePlayer(p.id)} className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 text-[9px] hover:bg-red-800/40">移除</button>}
                      </div>
                    </div>
                    <div className="flex gap-1 mb-1.5">
                      <span className="text-red-400">🏯{p.baseHp}/{p.baseMaxHp}</span><span className="text-amber-300">🃏{p.hand.length}</span><span className="text-green-400">👤{p.generalPool.length}</span>
                    </div>
                    {/* Base HP controls: mirror the general HP test tools. */}
                    <div className="space-y-1 mb-1.5">
                      <div className="flex gap-1 items-center flex-wrap">
                        <span className="text-gray-500 w-8">本营</span>
                        <button onClick={()=>testHealBase(p.id,1)} className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/40">+1</button>
                        <button onClick={()=>testSetBaseHp(p.id,p.baseMaxHp)} className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/40">满</button>
                        <button onClick={()=>testSetBaseHp(p.id,1)} className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 hover:bg-red-800/40">→1</button>
                      </div>
                      <div className="flex gap-1 items-center flex-wrap">
                        <span className="text-gray-500 w-8">伤害</span>
                        <button onClick={()=>testDamageBase(p.id,dmgAmount,dmgType)} className="px-1.5 py-0.5 rounded bg-red-800/60 text-red-200 hover:bg-red-700/60">-{dmgAmount}</button>
                        <button onClick={()=>testHealBase(p.id,dmgAmount)} className="px-1.5 py-0.5 rounded bg-green-800/50 text-green-200 hover:bg-green-700/50">+{dmgAmount}</button>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={()=>testDrawCards(p.id,1)} className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 hover:bg-blue-800/40">+1牌</button>
                      <button onClick={()=>testDrawCards(p.id,5)} className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 hover:bg-blue-800/40">+5牌</button>
                    </div>
                    {/* hand cards with discard */}
                    {p.hand.length>0&&<div className="mt-1.5 flex flex-wrap gap-0.5">{p.hand.map((card,ci)=>(<button key={`${card.id}-${ci}`} onClick={()=>testDiscardCard(p.id,card.id)} title={`丢弃: ${isGen(card)?card.name:(card as GameCard).name}`} className="px-1 py-0.5 rounded text-[8px] bg-gray-800/60 text-gray-400 hover:bg-red-900/40 hover:text-red-300 truncate max-w-[60px]">{isGen(card)?card.name:(card as GameCard).name}</button>))}</div>}
                  </div>
                );})}
                {players.length<4&&<button onClick={testAddPlayer} className="w-full py-2 rounded-lg border-2 border-dashed border-amber-700/30 text-amber-400/60 font-bold hover:bg-amber-900/10 hover:text-amber-300">+ 添加玩家</button>}
              </>)}
              {devTab==='generals'&&(<>
                {allFg.length===0&&<p className="text-center text-gray-600 py-6">场上暂无将领</p>}
                {allFg.map(fg=>{const o=ownerOf(fg);const c=factionColors[o?.faction||'群'];const ac=actionCounts[getRuntimeCardId(fg.general)]||{atk:0,mov:0,sup:0};return(
                  <div key={getRuntimeCardId(fg.general)} className="rounded-lg border border-gray-800/40 bg-black/30 p-2.5">
                    <div className="flex items-center gap-2 mb-1.5"><div className="w-2 h-2 rounded-full" style={{backgroundColor:c}}/><span className="font-bold text-amber-200">{fg.general.name}</span><span className="text-[9px] text-gray-500">{o?.name}</span></div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-red-400">❤️{fg.currentHp}/{fg.maxHp}</span>
                      <span className="text-[9px] text-gray-500">⚔{ac.atk} 🚶{ac.mov} 💊{ac.sup}</span>
                    </div>
                    <div className="space-y-1">
                      {/* HP controls */}
                      <div className="flex gap-1 items-center">
                        <span className="text-gray-500 w-8">体力</span>
                        <button onClick={()=>testHealGeneral(getRuntimeCardId(fg.general),1)} className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/40">+1</button>
                        <button onClick={()=>testSetGeneralHp(getRuntimeCardId(fg.general),fg.maxHp)} className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 hover:bg-green-800/40">满</button>
                        <button onClick={()=>testSetGeneralHp(getRuntimeCardId(fg.general),1)} className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 hover:bg-red-800/40">→1</button>
                      </div>
                      {/* Max HP controls */}
                      <div className="flex gap-1 items-center">
                        <span className="text-gray-500 w-8">上限</span>
                        <button onClick={()=>testSetGeneralMaxHp(getRuntimeCardId(fg.general),fg.maxHp+1)} className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 hover:bg-purple-800/40">+1</button>
                        <button onClick={()=>testSetGeneralMaxHp(getRuntimeCardId(fg.general),Math.max(1,fg.maxHp-1))} className="px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 hover:bg-purple-800/40">-1</button>
                        <span className="text-purple-400/60">({fg.maxHp})</span>
                      </div>
                      {/* Damage controls */}
                      <div className="flex gap-1 items-center flex-wrap">
                        <span className="text-gray-500 w-8">伤害</span>
                        <input type="number" min={1} max={99} value={dmgAmount} onChange={e=>setDmgAmount(Math.max(1,parseInt(e.target.value)||1))} className="w-10 px-1 py-0.5 rounded bg-black/50 border border-gray-700/30 text-gray-200 text-center"/>
                        <select value={dmgType} onChange={e=>setDmgType(e.target.value as 'attack'|'skill'|'lose')} className="px-1 py-0.5 rounded bg-black/50 border border-gray-700/30 text-gray-200">
                          <option value="attack">攻击</option><option value="skill">技能</option><option value="lose">失去</option>
                        </select>
                        <button onClick={()=>testDamageGeneral(getRuntimeCardId(fg.general),dmgAmount,dmgType)} className="px-1.5 py-0.5 rounded bg-red-800/60 text-red-200 hover:bg-red-700/60">执行</button>
                      </div>
                    </div>
                  </div>
                );})}
              </>)}
              {devTab==='pool'&&(<>
                <input type="text" value={poolSearch} onChange={e=>setPoolSearch(e.target.value)} placeholder="搜索将领..." className="w-full px-2 py-1 rounded bg-black/50 border border-gray-700/30 text-gray-200 text-xs placeholder-gray-600 mb-1"/>
                <p className="text-gray-500 mb-1">点击将领添加到{cp.name}手牌 (全部{allGenerals.length}名)</p>
                {filteredPool.length===0&&<p className="text-center text-gray-600 py-4">无匹配将领</p>}
                <div className="space-y-0.5">{filteredPool.map((g,gi)=>{const c=factionColors[g.faction];return(
                  <button key={`${g.id}-${gi}`} onClick={()=>testDrawSpecificGeneral(cp.id,g.id)} className="w-full text-left px-2 py-1.5 rounded hover:bg-amber-900/20 flex items-center gap-2 transition-all">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor:c}}/><span className="font-bold text-amber-200 flex-1">{g.name}</span><span className="text-[9px] text-gray-500">{g.faction}·{g.type}·❤️{g.hp}</span>
                  </button>
                );})}</div>
              </>)}
            </div>
          </div>
        )}
      </div>

      {/* Overlays for deploy/attack/move/supply */}
      {vm==='deploy'&&<Bar><span className="text-xs text-amber-200">登场：<b>{depGen?.name}</b> (消耗{depCards.length}/{depGen?.hp})</span><Btn ok={depCards.length>0} onClick={confirmDep}>确认</Btn><Btn onClick={cancelDep} red>取消</Btn></Bar>}
      {vm==='deployTarget'&&<Bar><span className="text-xs font-bold text-green-300 animate-pulse">📍点击营地空格放置</span><Btn onClick={cancelDep} red>取消</Btn></Bar>}
      {vm==='selectAttackCard'&&<Bar><span className="text-xs font-bold text-red-300">选择攻击消耗牌</span><Btn onClick={resetAtk}>取消</Btn></Bar>}
      {moveOptions.length>1&&movGen&&<Bar><span className="text-xs font-bold text-cyan-300">选择移动目标</span><Btn onClick={cancelMov}>取消</Btn></Bar>}
      {vm==='selectMoveCard'&&<Bar><span className="text-xs font-bold text-blue-300">选择移动消耗牌</span><Btn onClick={cancelMov}>取消</Btn></Bar>}
      {vm==='selectSupplyCards'&&supGen&&(()=>{const inE=isInEnemyTerritory(supGen);const extra=inE?1:0;const actualHeal=Math.max(0,supCards.length-extra);return <Bar><span className="text-xs text-green-300">补给(已选{supCards.length}张，补{Math.min(actualHeal,supGen.maxHp-supGen.currentHp)}点)</span><Btn ok={supCards.length>extra} onClick={confirmSup}>确认</Btn><Btn onClick={cancelSup}>取消</Btn></Bar>;})()}

      {/* hand */}
      <div className="z-20 flex-shrink-0 border-t border-amber-800/20 bg-black/70 px-3 py-1">
        <div className="mb-0.5 flex items-center gap-2"><span className="text-[10px] font-bold text-amber-400">🃏手牌({cp.hand.length})</span>
          {vm==='deploy'&&<span className="text-[10px] text-green-400">— 选择消耗</span>}
          {vm==='selectAttackCard'&&<span className="text-[10px] text-red-400">— 选择攻击消耗</span>}
          {vm==='selectMoveCard'&&<span className="text-[10px] text-blue-400">— 选择移动消耗</span>}
          {vm==='selectSupplyCards'&&<span className="text-[10px] text-green-400">— 选择补给牌</span>}
        </div>
        <div className="flex min-h-[70px] items-end gap-0.5 overflow-x-auto pb-0.5">
          {cp.hand.map((card,i)=>{const sd=vm==='deploy'&&depCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(card));const ss=vm==='selectSupplyCards'&&supCards.some(x=>getRuntimeCardId(x)===getRuntimeCardId(card));const dd=vm==='deploy'&&depGen&&getRuntimeCardId(depGen)===getRuntimeCardId(card);const h=hovIdx===i;
            const generalVisual = isGen(card) ? getGeneralCardVisual(card, cp.faction, sd||ss ? 'rgba(20,50,20,0.42)' : dd ? 'rgba(70,45,10,0.42)' : h ? 'rgba(0,0,0,0.60)' : 'rgba(0,0,0,0.40)') : null;
            const stateBorder = sd||ss ? '#4ade80' : dd||h ? '#fbbf24' : null;
            return(<div key={`${getRuntimeCardId(card)}-${i}`} className={`relative w-[50px] flex-shrink-0 rounded-lg border-2 cursor-pointer transition-all duration-200 ${sd||ss?'border-green-400 bg-green-900/40 -translate-y-2':dd?'border-amber-400 bg-amber-900/40 -translate-y-2':h?'z-30 -translate-y-3 scale-110 border-amber-400/60 bg-black/60 shadow-xl':'border-amber-800/25 bg-black/40 hover:-translate-y-1'}`} style={{height:h?'78px':'66px', ...(generalVisual ?? {}), ...(stateBorder ? {borderColor:stateBorder} : {})}} onMouseEnter={()=>setHovIdx(i)} onMouseLeave={()=>setHovIdx(null)}
              onClick={()=>{if(vm==='deploy'&&!dd&&canUse(card))toggleDep(card);else if(vm==='selectAttackCard')pickAtkCard(card);else if(vm==='selectMoveCard')pickMoveCard(card);else if(vm==='selectSupplyCards')toggleSup(card);else if(isGen(card)){setIns({type:'general',general:card});setVm('inspect');}else{setIns({type:'card',card});setVm('inspect');}}}>
              <div className="p-0.5 text-center">{isGen(card)?(<><div className="mb-0.5 inline-block rounded px-0.5 text-[7px] font-bold" style={{backgroundColor:`${factionColors[card.faction]}40`,color:factionColors[card.faction]}}>{card.faction}</div><div className="text-sm">{card.type==='武将'?'⚔️':'📜'}</div><p className="truncate text-[7px] font-bold leading-tight text-amber-200">{card.name}</p></>):(<><div className="mt-0.5 text-sm">{card.type==='粮草'?'🌾':card.type==='材料'?'⛏️':'🛡️'}</div><p className="truncate text-[7px] font-bold leading-tight text-amber-200">{(card as GameCard).name}</p><p className="text-[6px] text-amber-500/50">{card.type}</p></>)}</div>
              {(sd||ss)&&<div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 text-[7px] font-black text-white">✓</div>}
            </div>);})}
          {cp.hand.length===0&&<div className="flex h-[66px] w-full items-center justify-center text-xs text-amber-700/40">手牌为空</div>}
        </div>
      </div>

      {/* inspect modal */}
      {vm==='inspect'&&ins&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={()=>{setVm('board');setIns(null);}}>
        <div className="mx-4 w-full max-w-md rounded-2xl border border-amber-600/40 bg-gradient-to-b from-gray-900 via-gray-900 to-black p-5 shadow-2xl" onClick={e=>e.stopPropagation()}>
          {(ins.type==='general'||ins.type==='fieldGeneral')?(()=>{
            const g=ins.general||ins.fieldGeneral?.general;if(!g)return null;
            const fg=ins.fieldGeneral;const own=fg?fg.ownerId===cp.id:false;
            const isSch=g.type==='文将';
            const moveOk=fg?canFieldGeneralMove(fg,players):false;
            const meleeN=fg?getValidTargets(fg,cp.id,players,false).length:0;
            const rangeN=fg?getValidTargets(fg,cp.id,players,true).length:0;
            // In test mode: always allow actions (no limit check)
            const canMov=!!(fg&&own&&moveOk&&(isSch?cp.hand.length>0:true));
            const canAtk=!!(fg&&own&&cp.hand.length>0);
            const inEnemy=fg?isInEnemyTerritory(fg):false;const supNeedCards=fg?(1+(inEnemy?1:0)):1;
            const canSup=!!(fg&&own&&fg.currentHp<fg.maxHp&&cp.hand.length>=supNeedCards);
            const campFree=hasFreeCampSlot(cp.id,players);
            const canDeploy=!fg&&ins.type==='general'&&campFree&&cp.hand.length>1;
            const ac=fg?actionCounts[getRuntimeCardId(fg.general)]||{atk:0,mov:0,sup:0}:null;
            return(<>
              <div className="mb-2 flex items-center gap-2"><div className="h-3 w-3 rounded-full" style={{backgroundColor:factionColors[g.faction]}}/><span className="rounded px-2 py-0.5 text-sm font-bold" style={{backgroundColor:`${factionColors[g.faction]}25`,color:factionColors[g.faction]}}>{g.faction}</span><span className="text-sm text-amber-400/70">{g.type}</span>{fg&&<span className="ml-auto text-xs text-green-400/60">场上</span>}</div>
              <h2 className="mb-0.5 text-2xl font-black text-amber-100">{g.name}</h2>
              {g.title&&<p className="mb-3 text-sm text-amber-500/60">{g.title}</p>}
              <div className="mb-3 grid grid-cols-4 gap-1.5">
                <SC l="❤️体力" v={fg?`${fg.currentHp}/${fg.maxHp}`:`${g.hp}`} c="text-red-400"/>
                <SC l="⚔️近战" v={`${fg?.meleeAtk??g.meleeAtk}`} c="text-orange-300"/>
                <SC l="🏹远程" v={`${fg?.rangedAtk??g.rangedAtk}`} c="text-cyan-300"/>
                <SC l="🛡️护甲" v={`${fg?.armor??g.armor}`} c="text-blue-300"/>
              </div>
              {ac&&<div className="mb-2 flex items-center gap-3 text-[10px] text-gray-400 bg-gray-900/30 rounded-lg px-3 py-1.5">
                <span>本回合：</span><span className="text-red-300">⚔攻击 {ac.atk}次</span><span className="text-blue-300">🚶移动 {ac.mov}次</span><span className="text-green-300">💊补给 {ac.sup}次</span>
              </div>}
              {fg&&own&&inEnemy&&<p className="mb-2 text-center text-xs text-yellow-500/60">⚠️ 敌方区域：补给额外消耗1张</p>}
              <div className="mb-3"><h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-amber-400/80">技能</h3><div className="flex flex-wrap gap-1">{(skillEdits[g.id]??g.skills).map((s,i)=><div key={i} className="rounded-lg border border-amber-700/20 bg-amber-900/30 px-2 py-0.5 text-xs text-amber-200"><span className="font-bold">{s.name}</span>{s.tag&&<span className="ml-1 text-[9px] px-1 py-0.5 rounded-full font-bold border" style={{color:skillTagColors[s.tag],borderColor:skillTagColors[s.tag]+'50',backgroundColor:skillTagColors[s.tag]+'15'}}>{s.tag}</span>}{s.description&&<span className="text-amber-300/50 text-[10px] ml-1">— {s.description}</span>}</div>)}</div></div>
              {fg&&own&&<div className="flex flex-wrap gap-1.5 border-t border-amber-800/20 pt-2.5">
                <button onClick={()=>canMov&&startMove(fg)} disabled={!canMov} className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${canMov?'bg-blue-700/80 text-white hover:bg-blue-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>🚶前进{isSch?' (-1牌)':''}</button>
                <button onClick={()=>canAtk&&meleeN>0&&startAtk(fg,false)} disabled={!canAtk||meleeN===0} className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${canAtk&&meleeN>0?'bg-red-700/80 text-white hover:bg-red-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>⚔️近战</button>
                <button onClick={()=>canAtk&&rangeN>0&&startAtk(fg,true)} disabled={!canAtk||rangeN===0} className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${canAtk&&rangeN>0?'bg-purple-700/80 text-white hover:bg-purple-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>🏹远程</button>
                <button onClick={()=>canSup&&startSup(fg)} disabled={!canSup} className={`flex-1 rounded-lg py-1.5 text-xs font-bold ${canSup?'bg-green-700/80 text-white hover:bg-green-600':'cursor-not-allowed bg-slate-800 text-slate-500'}`}>💊补给</button>
              </div>}
              {canDeploy&&<button onClick={()=>{setIns(null);startDeploy(g);}} className="mt-2 w-full rounded-xl bg-gradient-to-r from-amber-600 to-red-700 py-2 text-sm font-bold text-white">⚔️登场将领</button>}
            </>);
          })():ins.card?(<><div className="mb-2 text-center text-3xl">{ins.card.type==='粮草'?'🌾':ins.card.type==='材料'?'⛏️':'🛡️'}</div><h2 className="mb-2 text-center text-xl font-black text-amber-200">{ins.card.name}</h2><p className="text-center text-sm text-amber-100/60">{ins.card.description}</p></>):null}
          <button onClick={()=>{setVm('board');setIns(null);}} className="mt-3 w-full rounded-xl border border-gray-700/30 bg-gray-800/80 py-2 font-bold text-amber-200/80 text-sm">关闭</button>
        </div>
      </div>}
    </div>
  );
}

