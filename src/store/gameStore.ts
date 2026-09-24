import { create } from 'zustand';
import { General } from '../data/generals';
import { GameCard, createCardDeck } from '../data/cards';
import { createLobbyPlayers, buildDraftCandidates, generateRoomName, assignFactions, rollAndSortPlayers, shuffle, defaultSeatModes, pickAiDraftPicks } from '../setup/runtimeSetup';
import { dispatchStoreAction } from './engineExecutionBridge';
import { buildDrawContext, describeDrawSubtitle, engineStateToStoreProjection, storeStateToEngineState } from './gameStateAdapter';
import type { EngineState } from '../core/GameState';
import { cloneRngState, rngNext, type RngState } from '../core/rng';
import { createAction } from '../action/ActionTypes';
import type { SkillActivation } from '../skills/dataTypes';
import {
  loadPersistedSkillEdits,
  loadPersistedGeneralEdits,
  loadDisabledGenerals,
} from './editorPersistence';
import { buildTestArenaActions, buildTestArenaState } from './testArenaActions';
import { buildEditorActions } from './gameStoreEditorActions';
import { buildRecoveryActions } from './gameStoreRecovery';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';
import { createEngineAwareSetter } from './engineAwareSetter';
import { clearLocalGameSnapshot, saveLocalGameSnapshot } from './localGameSnapshot';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { loadReplaySettings, persistReplaySettings } from '../replay/replayStorage';
import type { GamePhase, DrawContext, Player, GameState } from './gameStoreTypes';

// Store-level types live in gameStoreTypes.ts (stage B split); re-exported
// here so existing consumers keep importing them from this module.
export * from './gameStoreTypes';

// ── store ────────────────────────────────────────────────────────────────────

const defaultDraw:DrawContext|null=null;

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

  // ── D-2 second cut (2.2.19): setup randomness draws from EngineState.rngState ──
  // Each setup step clones the engine's own cursor, consumes it, and commits
  // the advanced cursor back inside the same set(). commitSetup applies the
  // exact storeStateToEngineState projection the engine-aware setter would
  // have run anyway, so the only observable delta is the moved cursor.
  const setupCursor = (): RngState => cloneRngState(get().engineState.rngState, 1);
  const commitSetup = (patch: Partial<GameState>, rng: RngState): void => {
    const merged = { ...get(), ...patch } as GameState;
    set({
      ...patch,
      engineState: { ...storeStateToEngineState(merged), rngState: { s: rng.s >>> 0 } },
    });
  };

  return ({
  phase:'menu',playerCount:0,roomName:generateRoomName(),players:[],currentPlayerIndex:0,
  engineState:storeStateToEngineState({phase:'menu',players:[],currentPlayerIndex:0,currentRound:1,cardDeck:[],discardPile:[],turnPhase:'start',isFirstTurn:true}),
  currentRound:1,cardDeck:[],discardPile:[],battlefieldSlots:0,
  turnPhase:'start',winnerId:null,gameOverBanner:null,defeatEvent:null,pendingTurnTransition:null,isFirstTurn:true,
  skillActivations:[],
  drawContext:defaultDraw,revealedDrawCards:[],initialDrawPlayerIndex:0,
  draftGenerals:[],draftQunGenerals:[],selectedDraftGenerals:[],draftPlayerIndex:0,
  seatModes:defaultSeatModes(),
  settings:{resolution:'1920x1080',windowMode:'全屏',animationSpeed:1,masterVolume:80,musicVolume:60,sfxVolume:70,autoSave:false,...loadReplaySettings()},
  developerMode:false,
  skillEdits:loadPersistedSkillEdits(),
  generalEdits:loadPersistedGeneralEdits(),
  disabledGenerals:loadDisabledGenerals(),
  isTestMode:false,
  testActionCounts:{},

  setPhase:p=>set({phase:p}),setPlayerCount:c=>set({playerCount:c}),setRoomName:n=>set({roomName:n}),

  createRoom:()=>{
    resetLiveReplay();
    const{playerCount,roomName,seatModes}=get();
    const rng=setupCursor();
    const random=()=>rngNext(rng);
    const ps=createLobbyPlayers(playerCount, seatModes, random) as Player[];
    commitSetup({players:ps,roomName,phase:'lobby',battlefieldSlots:playerCount,cardDeck:createCardDeck(random)},rng);
  },
  startGame:()=>set({phase:'diceRoll'}),
  rollDice:()=>{
    const rng=setupCursor();
    commitSetup({players:rollAndSortPlayers(get().players, ()=>rngNext(rng))},rng);
  },
  assignFactions:()=>{
    const rng=setupCursor();
    commitSetup({players:assignFactions(get().players, ()=>rngNext(rng))},rng);
    setTimeout(()=>get().distributeDraftGenerals(),1500);
  },

  distributeDraftGenerals:()=>{
    const{disabledGenerals:dis}=get();
    const fp=get().players[0];if(!fp?.faction)return;
    const rng=setupCursor();
    const candidates = buildDraftCandidates(fp.faction, dis, [], ()=>rngNext(rng));
    commitSetup({phase:'generalDraft',draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[],draftPlayerIndex:0},rng);
  },
  selectDraftGeneral:(g)=>{const sd=get().selectedDraftGenerals;set({selectedDraftGenerals:sd.some(x=>x.id===g.id)?sd.filter(x=>x.id!==g.id):sd.length<10?[...sd,g]:sd});},
  confirmDraft:()=>{
    const{players,draftPlayerIndex,selectedDraftGenerals}=get();
    const u=[...players];
    // Every drafted general becomes a distinct physical runtime card.
    // The same definition/name may exist across seats or be intentionally
    // duplicated by test tooling, so definitionId alone must never be used
    // as runtime identity.
    // Drafted cards carry the editor's merged definition (skill edits like
    // DIY 摸牌 skills and stat edits), so syncPlayerSkills compiles them.
    const draftedPool=selectedDraftGenerals.map(g=>cloneWithRuntimeInstance(get().getGeneralWithEdits(g)));
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
    const rng=setupCursor();
    const candidates = buildDraftCandidates(np.faction, dis, ids, ()=>rngNext(rng));
    commitSetup({players:u,draftPlayerIndex:ni,draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[]},rng);
  },

  setSeatMode:(index, patch) => set(st => ({
    seatModes: st.seatModes.map((m, i) => (i === index ? { ...m, ...patch } : m)),
  })),

  // v2.2.9: an AI seat drafts instantly (7 faction generals + up to 3 群,
  // the seat rule's max-Qun pick). No-ops for human seats and when the
  // candidate pool cannot legally fill 10 cards (falls back to the human UI).
  aiAutoDraft:()=>{
    const {players,draftPlayerIndex,draftGenerals,draftQunGenerals}=get();
    const p=players[draftPlayerIndex];
    if(!p?.isAi)return;
    const picks=pickAiDraftPicks(draftGenerals,draftQunGenerals);
    if(picks.length!==10)return;
    set({selectedDraftGenerals:picks});
    get().confirmDraft();
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
    const { engineState } = dispatchStoreAction(state, createAction('SURRENDER', id));

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

    const { engineState } = dispatchStoreAction(
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

  updateSettings: s => set((st: GameState) => {
    const settings = { ...st.settings, ...s };
    persistReplaySettings({
      autoSaveReplay: settings.autoSaveReplay,
      autoSaveLog: settings.autoSaveLog,
      replayDirName: settings.replayDirName,
    });
    return { settings };
  }),

  clearSkillActivation: id => set((st: GameState) => ({
    skillActivations: st.skillActivations.filter(a => a.id !== id),
  })),

  ...buildEditorActions(get, set),

  // UI compatibility helpers. These do not contain game rules.
  clearDefeatEvent:()=>set({defeatEvent:null}),

  ...buildRecoveryActions(get, set),

  resetGame:()=>{
    resetLiveReplay();
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
