import { create } from 'zustand';
import { General, Faction, allGenerals, SkillTag, SkillTriggerConfig, SkillEffect, SkillEffectMode } from '../data/generals';
import { GameCard, createCardDeck } from '../data/cards';
import { createLobbyPlayers, buildDraftCandidates, generateRoomName, assignFactions, rollAndSortPlayers, shuffle } from '../setup/runtimeSetup';
import { dispatchStoreAction } from './engineExecutionBridge';
import { applyEngineStateToStore, buildDrawContext, describeDrawSubtitle, engineStateToStoreProjection, isRestorableEngineState, storeStateToEngineState } from './gameStateAdapter';
import type { EngineState } from '../core/GameState';
import { createAction } from '../action/ActionTypes';
import type { SkillActivation } from '../data/skillEffects';
import {
  loadPersistedSkillEdits,
  persistSkillEdits,
  loadPersistedGeneralEdits,
  persistGeneralEdits,
  loadDisabledGenerals,
  persistDisabledGenerals,
} from './editorPersistence';
import { buildTestArenaActions } from './testArenaActions';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';
import { createEngineAwareSetter } from './engineAwareSetter';
import { StateSerializer } from '../network/StateSerializer';
import { clearLocalGameSnapshot, saveLocalGameSnapshot } from './localGameSnapshot';

// ── types ────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'menu' | 'codex' | 'settings' | 'createRoom' | 'lobby'
  | 'diceRoll' | 'factionAssign' | 'generalDraft'
  | 'drawing'   // ← single unified draw phase
  | 'playing' | 'gameOver'
  | 'rules'
  | 'testArena'; // developer test mode

export type DrawReason = 'initial' | 'turnStart' | 'compensation';

export interface DrawContext {
  reason: DrawReason;
  playerId: number;
  totalCards: number;
  phaseAfter: GamePhase;
  subtitle: string;
  baseLossPending?: boolean;
  resumePhase?: string;
  resumePlayerId?: number | null;
}

export interface Position { zone:'camp'|'front'|'battle'; slot:number; areaOwnerId:number|null; }

export interface FieldGeneral {
  general:General; currentHp:number; maxHp:number;
  meleeAtk:number; rangedAtk:number; armor:number;
  currentArmor:number;   // 当前护甲值（动态，由军备牌叠加）
  armorCards:GameCard[]; // 实际附着在将领上的军备卡实例
  isArming:boolean;      // 整备状态（叠甲后本回合不能移动/攻击）
  hasMoved:boolean; hasAttacked:boolean; hasSupplied:boolean; justDeployed:boolean;
  position:Position; ownerId:number;
}

export interface Player {
  id:number; name:string; faction:Faction|null; seatOrder:number; diceRoll:number;
  generalPool:General[]; hand:(General|GameCard)[]; fieldGenerals:FieldGeneral[];
  baseHp:number; baseMaxHp:number; isAlive:boolean; isSpectating:boolean;
  avatarGeneral:General|null; graveyard:General[];
}

export interface GameState {
  phase:GamePhase; playerCount:number; roomName:string; players:Player[];
  /** Phase 5.35.6: canonical runtime state for migrated engine flows. */
  engineState:EngineState;
  currentPlayerIndex:number; currentRound:number;
  cardDeck:GameCard[]; discardPile:GameCard[]; battlefieldSlots:number;
  turnPhase:'start'|'draw'|'main'|'end'; winnerId:number|null;
  gameOverBanner:string|null;
  // Dramatic "X势力击破" overlay shown on the board before results / on eliminations
  defeatEvent:{ faction:Faction|null; name:string } | null;
  pendingTurnTransition:{ nextIndex:number; nextRound:number } | null;
  isFirstTurn:boolean;
  // Skill system
  skillActivations:SkillActivation[];
  // Unified draw
  drawContext:DrawContext|null;
  revealedDrawCards:(General|GameCard)[];
  // For initial draw: track which player index is drawing next
  initialDrawPlayerIndex:number;
  // Draft
  draftGenerals:General[]; draftQunGenerals:General[];
  selectedDraftGenerals:General[]; draftPlayerIndex:number;
  settings:{resolution:string;windowMode:string;animationSpeed:number;masterVolume:number;musicVolume:number;sfxVolume:number;autoSave:boolean;};
  developerMode:boolean;
  skillEdits:Record<string, {name:string;description?:string;tag?:SkillTag;trigger?:SkillTriggerConfig;effects?:SkillEffect[];effectMode?:SkillEffectMode;forced?:boolean}[]>;
  generalEdits:Record<string, {name?:string;faction?:Faction;hp?:number;meleeAtk?:number;rangedAtk?:number}>;
  disabledGenerals:Set<string>;

  setPhase:(p:GamePhase)=>void; setPlayerCount:(c:number)=>void; setRoomName:(n:string)=>void;
  createRoom:()=>void; startGame:()=>void; rollDice:()=>void; assignFactions:()=>void;
  distributeDraftGenerals:()=>void; selectDraftGeneral:(g:General)=>void; confirmDraft:()=>void;
  // Unified draw actions
  executeDraw:(fromPool:number,fromDeck:number)=>boolean;
  confirmDraw:()=>void;
  resolvePendingDrawLoss:()=>void;
  deployGeneral:(g:General,slot:number,consume:(General|GameCard)[])=>boolean;
  moveGeneral:(id:string,target:Position,consume?:General|GameCard)=>void;
  attackTarget:(atkId:string,tgtId:string,ranged:boolean,consume?:General|GameCard)=>void;
  supplyGeneral:(id:string,cards:(General|GameCard)[])=>void;
  armGeneral:(id:string,armorCards:GameCard[])=>boolean;
  endTurn:()=>void; surrender:(id:number)=>void;
  updateSettings:(s:Partial<GameState['settings']>)=>void;
  clearDefeatEvent:()=>void;
  clearSkillActivation:(id:string)=>void;
  toggleDeveloperMode:(password:string)=>boolean;
  setDeveloperMode:(v:boolean)=>void;
  updateSkillEdit:(generalId:string, skills:{name:string;description?:string;tag?:SkillTag;trigger?:SkillTriggerConfig;effects?:SkillEffect[];effectMode?:SkillEffectMode;forced?:boolean}[])=>void;
  updateGeneralEdit:(generalId:string, edits:{name?:string;faction?:Faction;hp?:number;meleeAtk?:number;rangedAtk?:number})=>void;
  batchDeleteEdits:(generalIds:string[])=>void;
  toggleDisabledGeneral:(id:string)=>void;
  batchToggleDisabled:(ids:string[],disabled:boolean)=>void;
  importSkillEditsFromText:(text:string)=>number;
  getGeneralWithEdits:(general:General)=>General;
  createSerializedSnapshot:(roomId:string)=>string;
  restoreEngineState:(snapshot:unknown)=>boolean;
  restoreSerializedSnapshot:(data:string,expectedRoomId?:string)=>boolean;
  resetGame:()=>void; setCurrentPlayerIndex:(i:number)=>void;
  // ── test arena ──
  isTestMode:boolean;
  testActionCounts:Record<string, {attacks:number;moves:number;supplies:number}>;
  startTestArena:()=>void;
  testDrawCards:(playerId:number,count:number)=>void;
  testDrawSpecificGeneral:(playerId:number,generalId:string)=>void;
  testDiscardCard:(playerId:number,cardId:string)=>void;
  testAddPlayer:()=>void;
  testRemovePlayer:(playerId:number)=>void;
  testSetGeneralHp:(generalId:string,hp:number)=>void;
  testSetGeneralMaxHp:(generalId:string,maxHp:number)=>void;
  testDamageGeneral:(generalId:string,amount:number,type:'attack'|'skill'|'lose')=>void;
  testHealGeneral:(generalId:string,amount:number)=>void;
  testSetBaseHp:(playerId:number,hp:number)=>void;
  testDamageBase:(playerId:number,amount:number,type:'attack'|'skill'|'lose')=>void;
  testHealBase:(playerId:number,amount:number)=>void;
  testResetActions:(generalId:string)=>void;
}

// ── helpers ──────────────────────────────────────────────────────────────────


// ── store ────────────────────────────────────────────────────────────────────

const defaultDraw:DrawContext|null=null;

const settleDrawInTestArena = (state: GameState, engineState: EngineState): EngineState => {
  let nextEngineState = engineState;
  let draw = nextEngineState.drawState;

  if (draw?.baseLossPending) {
    nextEngineState = dispatchStoreAction(
      { ...state, engineState: nextEngineState },
      createAction('RESOLVE_BASE_LOSS', draw.playerId, { reason: draw.reason }),
    ).engineState;
    draw = nextEngineState.drawState;
  }

  if (draw) {
    if (draw.totalCards > 0 && nextEngineState.players.some(player => player.id === draw?.playerId && player.isAlive !== false)) {
      nextEngineState = dispatchStoreAction(
        { ...state, engineState: nextEngineState },
        createAction('DRAW', draw.playerId, { fromGeneralPool:0, fromCardPool:draw.totalCards, reason:draw.reason }),
      ).engineState;
    }

    const remainingDraw = nextEngineState.drawState;
    if (remainingDraw) {
      nextEngineState = dispatchStoreAction(
        { ...state, engineState: nextEngineState },
        createAction('CONFIRM_DRAW', remainingDraw.playerId, { reason: remainingDraw.reason }),
      ).engineState;
    }
  }

  return nextEngineState;
};

const buildTestArenaState = (state: GameState, engineState: EngineState): Partial<GameState> => {
  const resolvedEngineState = settleDrawInTestArena(state, engineState);
  const nextPlayerIndex = resolvedEngineState.players.findIndex(player => player.id === resolvedEngineState.currentPlayerId);
  const gameOver = resolvedEngineState.phase === 'gameOver';
  const winnerId = typeof resolvedEngineState.metadata?.winnerId === 'number' ? resolvedEngineState.metadata.winnerId : null;

  return {
    engineState: resolvedEngineState,
    players: resolvedEngineState.players as unknown as Player[],
    cardDeck: resolvedEngineState.deck as GameCard[],
    discardPile: resolvedEngineState.discardPile as GameCard[],
    currentPlayerIndex: nextPlayerIndex >= 0 ? nextPlayerIndex : state.currentPlayerIndex,
    currentRound: resolvedEngineState.round || state.currentRound,
    phase: gameOver ? 'gameOver' as const : 'testArena' as const,
    turnPhase: gameOver ? 'end' as const : 'main' as const,
    winnerId: gameOver ? winnerId : state.winnerId,
    gameOverBanner: null,
    defeatEvent: null,
    drawContext: null,
    pendingTurnTransition: null,
    revealedDrawCards: [],
    isFirstTurn: false,
  };
};

const deriveResultState = (state: GameState, engineState: EngineState, fallbackPhase: GamePhase = state.phase) => {
  const winnerId = typeof engineState.metadata?.winnerId === 'number' ? engineState.metadata.winnerId : null;
  const nextDraw = engineState.drawState;
  const nextPhase = engineState.phase === 'gameOver'
    ? 'gameOver'
    : nextDraw
      ? 'drawing'
      : engineState.phase === 'turn' || engineState.timelinePhase === 'ACTION'
        ? 'playing'
        : fallbackPhase;

  return {
    winnerId,
    phase: nextPhase,
    turnPhase: engineState.phase === 'gameOver'
      ? 'end'
      : engineState.timelinePhase === 'GAME_OVER'
        ? 'end'
        : engineState.timelinePhase === 'DRAW'
          ? 'draw'
          : engineState.timelinePhase === 'ACTION'
            ? 'main'
            : state.turnPhase,
  };
};

export const useGameStore=create<GameState>((zustandSet,get)=>{
  const set = createEngineAwareSetter<GameState>(zustandSet as unknown as (
    updater: (current: GameState) => GameState,
    replace?: boolean,
  ) => void);

  return ({
  phase:'menu',playerCount:0,roomName:generateRoomName(),players:[],currentPlayerIndex:0,
  engineState:storeStateToEngineState({phase:'menu',players:[],currentPlayerIndex:0,currentRound:1,cardDeck:[],discardPile:[],turnPhase:'start',isFirstTurn:true}),
  currentRound:1,cardDeck:[],discardPile:[],battlefieldSlots:0,
  turnPhase:'start',winnerId:null,gameOverBanner:null,defeatEvent:null,pendingTurnTransition:null,isFirstTurn:true,
  skillActivations:[],
  drawContext:defaultDraw,revealedDrawCards:[],initialDrawPlayerIndex:0,
  draftGenerals:[],draftQunGenerals:[],selectedDraftGenerals:[],draftPlayerIndex:0,
  settings:{resolution:'1920x1080',windowMode:'全屏',animationSpeed:1,masterVolume:80,musicVolume:60,sfxVolume:70,autoSave:false},
  developerMode:false,
  skillEdits:loadPersistedSkillEdits(),
  generalEdits:loadPersistedGeneralEdits(),
  disabledGenerals:loadDisabledGenerals(),
  isTestMode:false,
  testActionCounts:{},

  setPhase:p=>set({phase:p}),setPlayerCount:c=>set({playerCount:c}),setRoomName:n=>set({roomName:n}),

  createRoom:()=>{
    const{playerCount,roomName}=get();
    const ps=createLobbyPlayers(playerCount) as Player[];
    set({players:ps,roomName,phase:'lobby',battlefieldSlots:playerCount,cardDeck:createCardDeck()});
  },
  startGame:()=>set({phase:'diceRoll'}),
  rollDice:()=>set({players:rollAndSortPlayers(get().players)}),
  assignFactions:()=>{const ps=get().players;set({players:assignFactions(ps)});setTimeout(()=>get().distributeDraftGenerals(),1500);},

  distributeDraftGenerals:()=>{
    const{disabledGenerals:dis}=get();
    const fp=get().players[0];if(!fp?.faction)return;
    const candidates = buildDraftCandidates(fp.faction, dis);
    set({phase:'generalDraft',draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[],draftPlayerIndex:0});
  },
  selectDraftGeneral:(g)=>{const sd=get().selectedDraftGenerals;set({selectedDraftGenerals:sd.some(x=>x.id===g.id)?sd.filter(x=>x.id!==g.id):sd.length<10?[...sd,g]:sd});},
  confirmDraft:()=>{
    const{players,draftPlayerIndex,selectedDraftGenerals}=get();
    const u=[...players];
    // Every drafted general becomes a distinct physical runtime card.
    // The same definition/name may exist across seats or be intentionally
    // duplicated by test tooling, so definitionId alone must never be used
    // as runtime identity.
    const draftedPool=selectedDraftGenerals.map(g=>cloneWithRuntimeInstance(g));
    u[draftPlayerIndex]={...u[draftPlayerIndex],generalPool:draftedPool};
    const ni=draftPlayerIndex+1;
    if(ni>=players.length){
      // All drafted → start the initial draw through the Core Engine.
      const p0=u[0];
      if(!p0){set({players:u});return;}
      set({players:u});
      const {engineState, events}=dispatchStoreAction(
        get(),
        createAction('BEGIN_DRAW',p0.id,{reason:'initial',playerId:p0.id,totalCards:5}),
      );
      const drawRequired = events.some(event => event.type === 'DRAW_REQUIRED');
      if (!drawRequired || !engineState.drawState) {
        console.error('[Phase 5.35.11] BEGIN_DRAW failed', events);
        set({players:u});
        return;
      }
      set({
        engineState,
        players:engineState.players as unknown as Player[],
        cardDeck:engineState.deck as GameCard[],
        discardPile:engineState.discardPile as GameCard[],
        currentPlayerIndex:0,
        currentRound:engineState.round || get().currentRound,
        initialDrawPlayerIndex:0,
        drawContext:engineState.drawState ? buildDrawContext(engineState, engineState.drawState, {
          phaseAfter: 'playing',
          subtitle: describeDrawSubtitle(engineState, engineState.drawState, `${p0.name} 初始抽卡 (5张)`),
        }) : null,
        phase:'drawing',
        turnPhase:'draw',
      });
      return;
    }
    const np=u[ni];if(!np.faction)return;
    const{disabledGenerals:dis}=get();
    const ids=u.slice(0,ni).flatMap(p=>p.generalPool.map(g=>g.id));
    const candidates = buildDraftCandidates(np.faction, dis, ids);
    set({players:u,draftPlayerIndex:ni,draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[]});
  },

  // ── unified draw: execute ──
  executeDraw:(fromPool,_fromDeck)=>{
    const state=get();
    const {drawContext,engineState:currentEngineState}=state;
    if(!drawContext)return false;

    // The engine-owned drawState is authoritative. The Zustand drawContext is
    // presentation state and can briefly lag behind after TURN_END/
    // TURN_START, especially when eliminated seats are skipped. Normalize the
    // player/reason/total from the engine before validating the DRAW action.
    const pendingDraw=currentEngineState.drawState;
    if(!pendingDraw) {
      console.warn('[Phase 5.35.25.2] DRAW rejected: engine has no pending draw', {
        uiPlayerId: drawContext.playerId,
        uiReason: drawContext.reason,
      });
      return false;
    }

    const activeEnginePlayer=currentEngineState.players.find(p=>p.id===pendingDraw.playerId);
    if(!activeEnginePlayer || activeEnginePlayer.isAlive===false)return false;

    const requestedTotal=Math.max(0,Math.floor(pendingDraw.totalCards));
    const maxFromPool=Math.min(requestedTotal,Array.isArray(activeEnginePlayer.generalPool)?activeEnginePlayer.generalPool.length:0);
    const requestedGeneral=Math.min(Math.max(0,Math.floor(fromPool)),maxFromPool);
    const requestedCards=Math.max(0,requestedTotal-requestedGeneral);
    const generalAvailable=Array.isArray(activeEnginePlayer.generalPool)?activeEnginePlayer.generalPool.length:0;
    const cardAvailable=(Array.isArray(currentEngineState.deck)?currentEngineState.deck.length:0)+(Array.isArray(currentEngineState.discardPile)?currentEngineState.discardPile.length:0);
    if(pendingDraw.baseLossPending){
      console.warn('[Phase 5.35.25.2] DRAW rejected: base loss must be resolved first', {
        playerId: pendingDraw.playerId,
        totalCards: requestedTotal,
      });
      return false;
    }
    if(requestedGeneral+requestedCards!==requestedTotal){
      console.warn('[Phase 5.35.25.2] DRAW rejected: normalized total mismatch', {
        requestedGeneral, requestedCards, requestedTotal,
        generalAvailable, cardAvailable,
      });
      return false;
    }
    if(requestedGeneral>generalAvailable){
      console.warn('[Phase 5.35.11.3] DRAW rejected: general pool shortage', {requestedGeneral,generalAvailable});
      return false;
    }
    if(requestedCards>cardAvailable){
      console.warn('[Phase 5.35.11.3] DRAW rejected: card pool shortage', {requestedCards,cardAvailable});
      return false;
    }

    const beforeHand=Array.isArray(activeEnginePlayer.hand)?activeEnginePlayer.hand.length:0;
    const {engineState,events}=dispatchStoreAction(
      state,
      createAction('DRAW', activeEnginePlayer.id, {fromGeneralPool:requestedGeneral,fromCardPool:requestedCards,reason:pendingDraw.reason}),
    );

    const rejected=events.find(event=>event.type==='ACTION_REJECTED');
    const drawEvent=events.find(event=>event.type==='DRAW');
    if(rejected || !drawEvent){
      console.error('[Phase 5.35.25.2] DRAW failed', {
        rejected: rejected?.data ?? rejected ?? null,
        events,
        pendingDraw,
        requestedGeneral,
        requestedCards,
      });
      return false;
    }

    const updatedPlayer=engineState.players.find(p=>p.id===activeEnginePlayer.id);
    const afterHand=Array.isArray(updatedPlayer?.hand)?updatedPlayer.hand:[];
    const revealed=afterHand.slice(beforeHand) as (General|GameCard)[];
    const expectedCount=requestedTotal;
    if(revealed.length!==expectedCount){
      console.warn('[Phase 5.35.11.3] DRAW result count mismatch', {expectedCount, actual:revealed.length, events});
    }

    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      revealedDrawCards:revealed,
    });
    return true;
  },

  // ── unified draw: confirm and transition ──
  confirmDraw:()=>{
    const{drawContext}=get();
    if(!drawContext)return;
    const{engineState,events}=dispatchStoreAction(
      get(),
      createAction('CONFIRM_DRAW',drawContext.playerId,{reason:drawContext.reason}),
    );

    const confirmed=events.find(e=>e.type==='DRAW_CONFIRMED')?.data as any;
    const phaseChanged=events.find(e=>e.type==='PHASE_CHANGED')?.data as any;
    const nextIndex=typeof confirmed?.nextPlayerIndex==='number' ? confirmed.nextPlayerIndex : get().currentPlayerIndex;

    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      currentPlayerIndex:nextIndex,
      currentRound:engineState.round || get().currentRound,
      phase:phaseChanged?.to==='ACTION'?'playing':'drawing',
      turnPhase:phaseChanged?.to==='ACTION'?'main':'draw',
      drawContext:engineState.drawState
        ? buildDrawContext(engineState, engineState.drawState, { phaseAfter: 'playing' })
        : null,
      revealedDrawCards:[],
      initialDrawPlayerIndex:
        drawContext.reason==='initial' && confirmed?.completed===false
          ? nextIndex
          : 0,
      isFirstTurn:engineState.isFirstTurn ?? get().isFirstTurn,
    });
  },

  resolvePendingDrawLoss:()=>{
    const state = get();
    const draw = state.drawContext;
    if (!draw?.baseLossPending) return;
    const { engineState } = dispatchStoreAction(
      state,
      createAction('RESOLVE_BASE_LOSS', draw.playerId, { reason: draw.reason }),
    );
    let finalEngineState = engineState;
    const nextDraw = engineState.drawState;
    if (nextDraw && nextDraw.reason === 'turnStart' && nextDraw.totalCards === 0 && !nextDraw.baseLossPending) {
      finalEngineState = dispatchStoreAction(
        { ...state, engineState },
        createAction('CONFIRM_DRAW', nextDraw.playerId, { reason: nextDraw.reason }),
      ).engineState;
    }
    const currentPlayerIndex = finalEngineState.players.findIndex(player => player.id === finalEngineState.currentPlayerId);
    set({
      engineState: finalEngineState,
      players: finalEngineState.players as unknown as Player[],
      cardDeck: finalEngineState.deck as GameCard[],
      discardPile: finalEngineState.discardPile as GameCard[],
      currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : state.currentPlayerIndex,
      currentRound: finalEngineState.round || state.currentRound,
      winnerId: typeof finalEngineState.metadata?.winnerId === 'number' ? finalEngineState.metadata.winnerId : state.winnerId,
      gameOverBanner: finalEngineState.phase === 'gameOver' ? state.gameOverBanner : state.gameOverBanner,
      defeatEvent: state.defeatEvent,
      drawContext: finalEngineState.drawState
        ? buildDrawContext(finalEngineState, finalEngineState.drawState, {
            phaseAfter: 'playing',
            subtitle: `${finalEngineState.players.find(p => p.id === finalEngineState.drawState?.playerId)?.name ?? ''}${finalEngineState.drawState.reason === 'turnStart' ? ` 回合开始（抽${finalEngineState.drawState.totalCards}张）` : ' 抽卡'}`,
          })
        : null,
      phase: finalEngineState.phase === 'gameOver' ? 'gameOver' : finalEngineState.drawState ? 'drawing' : 'playing',
      turnPhase: finalEngineState.timelinePhase === 'DRAW' ? 'draw' : finalEngineState.timelinePhase === 'ACTION' ? 'main' : state.turnPhase,
    });
  },

  deployGeneral:(general,slot,consumeCards)=>{
    const state=get();
    const result=dispatchStoreAction(
      state,
      createAction('DEPLOY_GENERAL', state.players[state.currentPlayerIndex]?.id ?? 0, {
        general,
        slot,
        consumeCards,
      }),
    );
    const success=result.events.some(event=>event.type==='GENERAL_DEPLOYED');
    if(!success)return false;
    const {engineState}=result;
    const currentPlayerIndex = engineState.players.findIndex(player => player.id === engineState.currentPlayerId);
    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : state.currentPlayerIndex,
    });
    return true;
  },

  moveGeneral:(generalId,target,consumeCard)=>{
    const state=get();
    const {engineState}=dispatchStoreAction(
      state,
      createAction('MOVE_GENERAL', state.players[state.currentPlayerIndex]?.id ?? 0, {
        generalId,
        target,
        consumeCard,
      }),
    );
    const currentPlayerIndex = engineState.players.findIndex(player => player.id === engineState.currentPlayerId);
    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : state.currentPlayerIndex,
    });
  },

  attackTarget:(attackerId,targetId,isRanged,consumeCard)=>{
    const state=get();
    const {engineState,events}=dispatchStoreAction(
      state,
      createAction('ATTACK', state.players[state.currentPlayerIndex]?.id ?? 0, {
        attackerId,
        targetId,
        ranged:isRanged,
        consumeCard:consumeCard ?? null,
      }),
    );

    // A normal GENERAL DEATH must never be treated as player defeat.
    // Only the explicit PLAYER_DEFEATED event should trigger the faction-defeated overlay.
    const defeatedPlayerId = (events.find(event => event.type === 'PLAYER_DEFEATED')?.data as any)?.playerId;
    const defeatedEventPlayer = typeof defeatedPlayerId === 'number'
      ? engineState.players.find(player => player.id === defeatedPlayerId)
      : undefined;
    if(state.isTestMode){
      set(buildTestArenaState(state, engineState));
      return;
    }

    const currentPlayerIndex = engineState.players.findIndex(player => player.id === engineState.currentPlayerId);
    const pendingDraw = engineState.drawState;
    const outcome = deriveResultState(state, engineState);

    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : state.currentPlayerIndex,
      currentRound: engineState.round || state.currentRound,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      winnerId: outcome.winnerId,
      defeatEvent: typeof defeatedPlayerId === 'number' && defeatedEventPlayer
        ? { faction: (defeatedEventPlayer as any).faction ?? null, name: (defeatedEventPlayer as any).name ?? '' }
        : state.defeatEvent,
      drawContext: pendingDraw ? buildDrawContext(engineState, pendingDraw) : null,
      revealedDrawCards: pendingDraw ? [] : state.revealedDrawCards,
    });
  },

  supplyGeneral:(generalId,cards)=>{
    const state=get();
    const player=state.players[state.currentPlayerIndex];
    if(!player)return;
    const {engineState, events}=dispatchStoreAction(
      state,
      createAction('SUPPLY', player.id, { generalId, consumeCards: cards }),
    );
    if (!events.some(event => event.type === 'SUPPLY_RESOLVED')) return;
    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
    });
  },

  armGeneral:(generalId,armorCards)=>{
    const state=get();
    const player=state.players[state.currentPlayerIndex];
    if(!player)return false;
    const {engineState,events}=dispatchStoreAction(
      state,
      createAction('EQUIP_ARMOR', player.id, { generalId, armorCards }),
    );
    const success=events.some(event => event.type === 'ARMOR_EQUIPPED');
    if(!success)return false;
    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
    });
    return true;
  },

  surrender:(id)=>{
    const state = get();
    let { engineState } = dispatchStoreAction(state, createAction('SURRENDER', id));

    // Test arena is an instrumentation sandbox: surrender should immediately
    // advance to the next live player without leaving the arena or opening the
    // normal game's full-screen draw view. Resolve the pending draw inside the
    // same canonical Engine pipeline, then keep the UI mounted on testArena.
    if(state.isTestMode){
      set({
        ...buildTestArenaState(state, engineState),
        phase:'testArena',
        turnPhase:'main',
      });
      if (get().settings.autoSave && engineState.phase !== 'gameOver') {
        saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
      }
      if (engineState.phase === 'gameOver') clearLocalGameSnapshot();
      return;
    }

    const nextDraw = engineState.drawState;
    const outcome = deriveResultState(state, engineState);
    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
      winnerId: outcome.winnerId,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      drawContext: nextDraw ? buildDrawContext(engineState, nextDraw, {
        phaseAfter: nextDraw.reason === 'turnStart' ? 'playing' : 'drawing',
        subtitle: describeDrawSubtitle(engineState, nextDraw),
      }) : null,
      revealedDrawCards: [],
    });
  },

  endTurn:()=>{
    const{currentPlayerIndex,currentRound,isTestMode}=get();
    const activePlayer=get().players[currentPlayerIndex];
    if(!activePlayer) return;

    let { engineState } = dispatchStoreAction(
      get(),
      createAction('END_TURN', activePlayer.id),
    );

    if(isTestMode){
      // Keep the test arena mounted while still executing the real turn/draw
      // pipeline. This makes the test sandbox behave like a live match without
      // ejecting the persistent debug controls when phase changes.
      const testArenaState = buildTestArenaState(get(), engineState) as Partial<GameState> & { engineState: EngineState };
      set({
        ...testArenaState,
        phase: testArenaState.engineState.phase === 'gameOver' ? 'gameOver' : 'testArena',
        turnPhase: testArenaState.engineState.phase === 'gameOver' ? 'end' : 'main',
      });
      return;
    }

    const nextPlayerId=engineState.currentPlayerId;
    const nextIndex=engineState.players.findIndex(player=>player.id===nextPlayerId);
    const safeNextIndex=nextIndex>=0?nextIndex:currentPlayerIndex;
    const nextRound=engineState.round || currentRound;
    const alive=engineState.players.filter(player=>player.isAlive !== false);

    if(alive.length<=1){
      set({
        engineState,
        players:engineState.players as unknown as Player[],
        cardDeck:engineState.deck as GameCard[],
        discardPile:engineState.discardPile as GameCard[],
        currentPlayerIndex:safeNextIndex,
        currentRound:nextRound,
        winnerId:alive.length===1?alive[0].id:null,
        gameOverBanner:null,
        defeatEvent:null,
        pendingTurnTransition:null,
        phase:'gameOver',
      });
      clearLocalGameSnapshot();
      return;
    }

    const nextPlayer=engineState.players[safeNextIndex];
    if(!nextPlayer)return;

    const outcome = deriveResultState(get(), engineState, 'playing');
    set({
      engineState,
      players:engineState.players as unknown as Player[],
      currentPlayerIndex:safeNextIndex,
      currentRound:nextRound,
      isFirstTurn:false,
      drawContext:engineState.drawState ? buildDrawContext(engineState, engineState.drawState, {
        phaseAfter: 'playing',
        subtitle: describeDrawSubtitle(engineState, engineState.drawState, `${nextPlayer.name} 回合抽卡 (${engineState.drawState.totalCards}张)`),
      }) : null,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      winnerId: outcome.winnerId,
    });
    if (get().settings.autoSave) {
      saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    }
  },

  updateSettings: s => set((st: GameState) => ({ settings: { ...st.settings, ...s } })),

  clearSkillActivation: id => set((st: GameState) => ({
    skillActivations: st.skillActivations.filter(a => a.id !== id),
  })),

  toggleDeveloperMode: password => {
    if (password !== 'djxdzx000') return false;
    set((st: GameState) => ({ developerMode: !st.developerMode }));
    return true;
  },

  setDeveloperMode: v => set({ developerMode: v }),

  updateSkillEdit: (generalId, skills) => {
    const next = { ...get().skillEdits, [generalId]: skills };
    persistSkillEdits(next);
    set({ skillEdits: next });
  },

  updateGeneralEdit: (generalId, edits) => {
    const next = { ...get().generalEdits, [generalId]: edits };
    persistGeneralEdits(next);
    set({ generalEdits: next });
  },

  batchDeleteEdits: generalIds => {
    const skillEdits = { ...get().skillEdits };
    const generalEdits = { ...get().generalEdits };
    for (const id of generalIds) {
      delete skillEdits[id];
      delete generalEdits[id];
    }
    persistSkillEdits(skillEdits);
    persistGeneralEdits(generalEdits);
    set({ skillEdits, generalEdits });
  },

  toggleDisabledGeneral: id => {
    const next = new Set(get().disabledGenerals);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistDisabledGenerals(next);
    set({ disabledGenerals: next });
  },

  batchToggleDisabled: (ids, disabled) => {
    const next = new Set(get().disabledGenerals);
    for (const id of ids) {
      if (disabled) next.add(id); else next.delete(id);
    }
    persistDisabledGenerals(next);
    set({ disabledGenerals: next });
  },

  importSkillEditsFromText: text => {
    const validTags = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    let count = 0;
    const edits = { ...get().skillEdits };
    for (const line of lines) {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length < 2) continue;
      const general = allGenerals.find(g => g.name === parts[0]);
      if (!general) continue;
      const skillNames = parts[1].split(',').map(v => v.trim()).filter(Boolean);
      const descriptions = parts.length >= 3 ? parts[2].split(',').map(v => v.trim()) : [];
      const tags = parts.length >= 4 ? parts[3].split(',').map(v => v.trim()) : [];
      edits[general.id] = skillNames.map((name, index) => ({
        name,
        description: descriptions[index] || '',
        tag: tags[index] && validTags.includes(tags[index]) ? tags[index] as SkillTag : undefined,
      }));
      count++;
    }
    persistSkillEdits(edits);
    set({ skillEdits: edits });
    return count;
  },

  getGeneralWithEdits: general => {
    const { skillEdits, generalEdits } = get();
    let result = { ...general };
    const gEdits = generalEdits[general.id];
    if (gEdits) {
      if (gEdits.name) result.name = gEdits.name;
      if (gEdits.faction) result.faction = gEdits.faction;
      if (gEdits.hp != null) {
        result.hp = gEdits.hp;
        result.type = gEdits.hp >= 4 ? '武将' : '文将';
      }
      if (gEdits.meleeAtk != null) result.meleeAtk = gEdits.meleeAtk;
      if (gEdits.rangedAtk != null) result.rangedAtk = gEdits.rangedAtk;
    }
    const sEdits = skillEdits[general.id];
    if (sEdits) {
      result.skills = sEdits.map(skill => ({
        name: skill.name,
        description: skill.description,
        tag: skill.tag,
        trigger: skill.trigger,
        effects: skill.effects,
        effectMode: skill.effectMode,
        forced: skill.forced,
      }));
    }
    return result;
  },

  // UI compatibility helpers. These do not contain game rules.
  clearDefeatEvent:()=>set({defeatEvent:null}),

  restoreEngineState: snapshot => {
    if (!isRestorableEngineState(snapshot)) {
      console.error('[Recovery] Invalid EngineState snapshot rejected');
      return false;
    }
    applyEngineStateToStore(snapshot, patch => set(patch as Partial<GameState>));
    return true;
  },

  createSerializedSnapshot: roomId => {
    const normalizedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    if (!normalizedRoomId) {
      throw new Error('[Recovery] Snapshot room ID is required');
    }
    const serializer = new StateSerializer();
    const snapshotRoomName = get().roomName || normalizedRoomId;
    const snapshotPlayerCount = Number.isFinite(get().playerCount)
      ? Number(get().playerCount)
      : Math.max(get().players.length, get().engineState.players.length || 0);
    return serializer.serialize(serializer.createSnapshot(normalizedRoomId, get().engineState, snapshotRoomName, snapshotPlayerCount));
  },

  restoreSerializedSnapshot: (data, expectedRoomId) => {
    try {
      const snapshot = new StateSerializer().deserialize(data);
      if (expectedRoomId !== undefined && snapshot.roomId !== expectedRoomId) {
        console.error('[Recovery] Snapshot room mismatch rejected');
        return false;
      }
      const restored = get().restoreEngineState(snapshot.state);
      if (!restored) {
        clearLocalGameSnapshot();
        return false;
      }
      set({
        roomName: snapshot.roomName || snapshot.roomId || get().roomName,
        playerCount: Number.isFinite(snapshot.playerCount) ? snapshot.playerCount : snapshot.state.players.length,
      });
      return true;
    } catch (error) {
      clearLocalGameSnapshot();
      console.error('[Recovery] Serialized snapshot rejected', error);
      return false;
    }
  },

  resetGame:()=>{
    const state=get();
    const baseState = {
      phase:'menu' as GamePhase,
      playerCount:0,
      roomName:generateRoomName(),
      players:[] as Player[],
      currentPlayerIndex:0,
      currentRound:1,
      cardDeck:[] as GameCard[],
      discardPile:[] as GameCard[],
      battlefieldSlots:0,
      turnPhase:'start' as const,
      winnerId:null as number|null,
      gameOverBanner:null as string|null,
      defeatEvent:null as GameState['defeatEvent'],
      pendingTurnTransition:null as GameState['pendingTurnTransition'],
      isFirstTurn:true,
      skillActivations:[] as SkillActivation[],
      drawContext:null as DrawContext|null,
      revealedDrawCards:[] as (General|GameCard)[],
      initialDrawPlayerIndex:0,
      draftGenerals:[] as General[],
      draftQunGenerals:[] as General[],
      selectedDraftGenerals:[] as General[],
      draftPlayerIndex:0,
      isTestMode:false,
      testActionCounts:{} as GameState['testActionCounts'],
    };
    const engineState=storeStateToEngineState(baseState);
    set({
      ...baseState,
      engineState,
      // Return-to-menu should not erase user preferences or editor content.
      settings:state.settings,
      developerMode:state.developerMode,
      skillEdits:state.skillEdits,
      generalEdits:state.generalEdits,
      disabledGenerals:state.disabledGenerals,
    });
  },

  setCurrentPlayerIndex: i => set({ currentPlayerIndex: i }),

  ...buildTestArenaActions(get, set, shuffle),
});
});
