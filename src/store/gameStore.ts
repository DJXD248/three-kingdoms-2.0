import { create } from 'zustand';
import { General, allGenerals } from '../data/generals';
import { GameCard, createCardDeck } from '../data/cards';
import { createLobbyPlayers, buildDraftCandidates, generateRoomName, assignFactions, rollAndSortPlayers, shuffle, defaultSeatModes, pickAiDraftPicks } from '../setup/runtimeSetup';
import { dispatchStoreAction, openReactionWindowStore, passReactionStore, resetReactionWindowStore } from './engineExecutionBridge';
import { buildDrawContext, describeDrawSubtitle, engineStateToStoreProjection, storeStateToEngineState } from './gameStateAdapter';
import type { EngineState } from '../core/GameState';
import { cloneRngState, rngNext, type RngState } from '../core/rng';
import { createAction } from '../action/ActionTypes';
import type { SkillActivation } from '../skills/dataTypes';
import {
  loadPersistedSkillEdits,
  loadPersistedGeneralEdits,
  loadDisabledGenerals,
  loadIdentityRegistry,
  loadAuthoredGenerals,
  loadLockedGenerals,
} from './editorPersistence';
import { buildTestArenaActions, buildTestArenaState } from './testArenaActions';
import { buildEditorActions } from './gameStoreEditorActions';
import { buildRecoveryActions } from './gameStoreRecovery';
import { cloneWithRuntimeInstance } from '../utils/runtimeIdentity';
import { createEngineAwareSetter } from './engineAwareSetter';
import { clearLocalGameSnapshot, saveLocalGameSnapshot } from './localGameSnapshot';
import { resetLiveReplay } from '../replay/liveReplayRecorder';
import { loadReplaySettings, persistReplaySettings } from '../replay/replayStorage';
import type { GamePhase, DrawContext, Player, GameState, TurnEndAsk, TurnEndAskCandidate, SkillPromptMode } from './gameStoreTypes';
import { listTurnEndAskItems, listForcedTurnEndActivations, type TurnEndAskItem } from '../skills/turnEndSkills';
import { getReactionAsk } from '../skills/reactionChain';
import { activationNoticesFrom } from './activationNotices';
import type { GameEvent, ReactionAnsweredData } from '../core/Event';

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

  // 2.3.1 turn-end ask: candidate shaping (store view of an engine-derived
  // candidate — never a second rule source, see skills/turnEndSkills).
  const toTurnEndAskCandidate = (c: TurnEndAskItem): TurnEndAskCandidate => ({
    skillId: c.definition.id,
    generalId: c.generalId,
    generalName: c.generalName,
    skillName: c.definition.name,
    description: c.definition.description,
    activatable: c.activatable,
    disabledReason: c.disabledReason,
  });

  // 2.8.17 (#42) 技能提示两档的唯一分档处：智能＝只列可发动的（＝合法集合），
  // 完整＝场上只要有回合结束技能就全列，不可发动的置灰写明原因。两档共用同一个
  // 派生源，所以"看得见"永远不等于"能发动"——合法判定一处都没放宽。
  const visibleTurnEndAskItems = (
    engineState: EngineState,
    playerId: number,
    mode: SkillPromptMode,
  ): TurnEndAskItem[] => {
    const items = listTurnEndAskItems(engineState, playerId);
    return mode === 'full' ? items : items.filter(item => item.activatable);
  };

  // 发动通知的唯一接线处（v2.9.17＝用户「一定要通知玩家有什么技能发动了」）。判据一句＝
  // 这一次 dispatch 的事件流里有没有那一身 `SKILL_ACTIVATED`；三条发动路都从
  // `skills/skillQuota.ts` 同一个生产点出声，所以"到点自己响、压根不问人"的那一路
  // 从此也照样飘得出来。B 类展示事实⇒不进状态、不进录像、不动两把锚。
  const noticePatch = (
    state: GameState,
    engineState: EngineState,
    events: GameEvent[],
  ): Pick<GameState, 'skillActivations'> | Record<string, never> => {
    const notices = activationNoticesFrom(events, engineState);
    return notices.length === 0
      ? {}
      : { skillActivations: [...state.skillActivations, ...notices] };
  };

  // 强制发动·回合结束（v2.9.17＝用户「强制发动永远是强制发动，无论什么节点」）：
  // 轮到结束这一刻，勾了那一格的定义**不进那扇逢人就问的窗**，由系统替这一席发动。
  // 走的是同一条规范动作 `ACTIVATE_SKILL`⇒与玩家亲手点逐字同形、进录像、扣同一本账，
  // 通知也照样从上面那一处飘出来。放在席位判断**之前**＝人席／AI 席／热座／沙盒一律
  // 先过这一步："不问"靠技能自己身上那一格，不靠坐在那一席的是谁。
  const autoFireForcedTurnEndSkills = (playerId: number) => {
    // 一枚发动会改状态（抽牌、甚至终局），所以每发完一枚都从新状态重推一次候选，
    // 绝不一开始就抓一份快照清单。`declined` 只防一种如实的失败（引擎按"宁可不发，
    // 绝不空耗"退回，如择一逐项门槛全不过），防的是同一枚被反复重试。
    const declined = new Set<string>();
    for (let step = 0; step < 64; step += 1) {
      const current = get();
      if (current.engineState.currentPlayerId !== playerId) return;
      const next = listForcedTurnEndActivations(current.engineState, playerId)
        .find(candidate => !declined.has(candidate.definition.id));
      if (!next) return;
      if (!get().activateTurnEndSkill(next.definition.id, next.generalId)) {
        declined.add(next.definition.id);
      }
    }
  };

  // The real END_TURN commit, shared verbatim by the ungated endTurn path and
  // skipTurnEndAsk — exactly one place ever dispatches END_TURN in the store.
  const commitEndTurn = () => {
    const state = get();
    const{currentPlayerIndex,currentRound,isTestMode}=state;
    const activePlayer=state.players[currentPlayerIndex];
    if(!activePlayer) return;

    // 这一次 dispatch 里会出「回合开始时」那一声（`TurnResolver` 发 `TURN_START`），
    // 所以下一席那些勾了「强制发动」的回合开始技能正是在这儿自己响的⇒通知必须接得上。
    // 本回合结束那几枚勾了强制发动的定义则由上面 `autoFireForcedTurnEndSkills` 在这一次
    // 提交**之前**替这一席发动，不会跑到这里来。
    const { engineState, events } = dispatchStoreAction(
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
        ...noticePatch(state, engineState, events),
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
        turnEndAsk:null,
        phase:'gameOver',
        ...noticePatch(state, engineState, events),
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
      ...noticePatch(state, engineState, events),
    });
    if (get().settings.autoSave) {
      saveLocalGameSnapshot(get().createSerializedSnapshot(get().roomName));
    }
  };

  // v2.8.22 响应链执法刀 (#71)：响应链问答的两个出口共用这一次提交。欠债的那一席、
  // 是哪一格、能选哪几枚，全部从 EngineState 现算（`getReactionAsk`＝唯一推导点），
  // 调用方只能递"想发动哪一枚"，永远决定不了"该谁答、答哪格"。热座玩家点按钮与
  // AI 司机挑动作都落在这里——基础游戏规则不分人和 AI（用户 2026-09-30 口径）。
  const commitReactionAnswer = (skillId: string | null, generalId: string | null): boolean => {
    const state = get();
    const ask = getReactionAsk(state.engineState);
    if (!ask) return false;
    const option = skillId === null ? undefined
      : ask.options.find(entry => entry.skillId === skillId && entry.generalId === generalId);
    if (skillId !== null && !option) return false;

    const action = skillId === null
      ? createAction('SKIP_REACTION', ask.playerId, { nodeKey: ask.nodeKey })
      : createAction('ACTIVATE_SKILL', ask.playerId, { skillId, generalId });
    const { engineState, events } = dispatchStoreAction(state, action);
    // 诚实拒绝：这一句表态没能记进事件流（门槛不过／问句已换人），投影就一动不动，
    // 窗还开着，玩家看得见自己没点成。
    const answered = events.find(event => event.type === 'REACTION_ANSWERED')
      ?.data as ReactionAnsweredData | undefined;
    if (!answered) return false;

    if (state.isTestMode) {
      set({ ...buildTestArenaState(state, engineState), ...noticePatch(state, engineState, events) });
      return true;
    }

    // 效果可能打死将领、击破势力甚至终局——照 chooseOption/activateTurnEndSkill 的
    // 口径做全量投影，绝不局部打补丁。
    const defeatedPlayerId = (events.find(event => event.type === 'PLAYER_DEFEATED')?.data as any)?.playerId;
    const defeatedEventPlayer = typeof defeatedPlayerId === 'number'
      ? engineState.players.find(player => player.id === defeatedPlayerId)
      : undefined;
    const pendingDraw = engineState.drawState;
    const outcome = deriveResultState(state, engineState);

    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
      currentRound: engineState.round || state.currentRound,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      winnerId: outcome.winnerId,
      defeatEvent: typeof defeatedPlayerId === 'number' && defeatedEventPlayer
        ? { faction: (defeatedEventPlayer as any).faction ?? null, name: (defeatedEventPlayer as any).name ?? '' }
        : state.defeatEvent,
      drawContext: pendingDraw ? buildDrawContext(engineState, pendingDraw) : null,
      revealedDrawCards: pendingDraw ? [] : state.revealedDrawCards,
      // 只有真发动才飘一条：跳过那一手压根没有 `SKILL_ACTIVATED` 那一身⇒自然一条都不飘
      // （旧口径里那句"跳过不是发动"如今由事件流自己保证，界面不再需要认路）。
      ...noticePatch(state, engineState, events),
    });
    return true;
  };

  return ({
  phase:'menu',playerCount:0,roomName:generateRoomName(),players:[],currentPlayerIndex:0,
  engineState:storeStateToEngineState({phase:'menu',players:[],currentPlayerIndex:0,currentRound:1,cardDeck:[],discardPile:[],turnPhase:'start',isFirstTurn:true}),
  currentRound:1,cardDeck:[],discardPile:[],battlefieldSlots:0,
  turnPhase:'start',winnerId:null,gameOverBanner:null,defeatEvent:null,pendingTurnTransition:null,isFirstTurn:true,
  skillActivations:[],
  drawContext:defaultDraw,revealedDrawCards:[],initialDrawPlayerIndex:0,
  draftGenerals:[],draftQunGenerals:[],selectedDraftGenerals:[],draftPlayerIndex:0,draftDistributed:[],
  seatModes:defaultSeatModes(),
  reactionWindow:null,
  turnEndAsk:null,
  settings:{resolution:'1920x1080',windowMode:'全屏',animationSpeed:1,masterVolume:80,musicVolume:60,sfxVolume:70,autoSave:false,skillPromptMode:'smart',...loadReplaySettings()},
  developerMode:false,
  skillEdits:loadPersistedSkillEdits(),
  generalEdits:loadPersistedGeneralEdits(),
  disabledGenerals:loadDisabledGenerals(),
  identityRegistry:loadIdentityRegistry(),
  authoredGenerals:loadAuthoredGenerals(),
  lockedGeneralIds:loadLockedGenerals(),
  isTestMode:false,
  testActionCounts:{},

  setPhase:p=>set({phase:p}),setPlayerCount:c=>set({playerCount:c}),setRoomName:n=>set({roomName:n}),

  createRoom:()=>{
    resetLiveReplay();
    resetReactionWindowStore();
    const{playerCount,roomName,seatModes}=get();
    const rng=setupCursor();
    const random=()=>rngNext(rng);
    const ps=createLobbyPlayers(playerCount, seatModes, random) as Player[];
    commitSetup({players:ps,roomName,phase:'lobby',battlefieldSlots:playerCount,cardDeck:createCardDeck(random),turnEndAsk:null},rng);
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

  // v2.8.5: the LOCAL play surface = repository ledger + this machine's
  // authored records, both read through the editor merge (an edited identity or
  // faction must steer the lock — 契约表 格11). ai/matchSetup deliberately keeps
  // reading `allGenerals`, which is what makes B10 CI-rebuildable (§H2).
  poolGenerals:()=>[...allGenerals,...get().authoredGenerals].map(g=>get().getGeneralWithEdits(g)),

  distributeDraftGenerals:()=>{
    const dis=get().effectiveDisabledGenerals();
    const fp=get().players[0];if(!fp?.faction)return;
    const rng=setupCursor();
    // v2.8.0: distribution reads editor-merged reality, so an edited
    // identity/faction steers the lock (契约表 格11 录入面).
    const pool = get().poolGenerals();
    const candidates = buildDraftCandidates(fp.faction, dis, [], ()=>rngNext(rng), pool);
    commitSetup({phase:'generalDraft',draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[],draftPlayerIndex:0,draftDistributed:[...candidates.main,...candidates.qun]},rng);
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
    const dis=get().effectiveDisabledGenerals();
    // v2.8.0 identity lock: the exclusion set is everything DEALT to earlier
    // seats (选过 or 沉没), not just confirmed picks — 分发即锁.
    const distributed=get().draftDistributed;
    const pool = get().poolGenerals();
    const rng=setupCursor();
    const candidates = buildDraftCandidates(np.faction, dis, distributed, ()=>rngNext(rng), pool);
    commitSetup({players:u,draftPlayerIndex:ni,draftGenerals:candidates.main,draftQunGenerals:candidates.qun,selectedDraftGenerals:[],draftDistributed:[...distributed,...candidates.main,...candidates.qun]},rng);
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
      ...noticePatch(state, engineState, events),
    });
    return true;
  },

  // ── unified draw: confirm and transition ──
  confirmDraw:()=>{
    const state = get();
    const{drawContext}=state;
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
      // 回合开始那一声就落在这一次 dispatch 里⇒勾了「强制发动」的回合开始技能在这里
      // 自己响，玩家不会被动静骗过去。
      ...noticePatch(state, engineState, events),
    });
  },

  resolvePendingDrawLoss:()=>{
    const state = get();
    const draw = state.drawContext;
    if (!draw?.baseLossPending) return;
    const { engineState, events } = dispatchStoreAction(
      state,
      createAction('RESOLVE_BASE_LOSS', draw.playerId, { reason: draw.reason }),
    );
    let finalEngineState = engineState;
    const allEvents = [...events];
    const nextDraw = engineState.drawState;
    if (nextDraw && nextDraw.reason === 'turnStart' && nextDraw.totalCards === 0 && !nextDraw.baseLossPending) {
      const followUp = dispatchStoreAction(
        { ...state, engineState },
        createAction('CONFIRM_DRAW', nextDraw.playerId, { reason: nextDraw.reason }),
      );
      finalEngineState = followUp.engineState;
      allEvents.push(...followUp.events);
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
      ...noticePatch(state, finalEngineState, allEvents),
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
      // 登场那一刻正是「将领登场时」那一格的发声点⇒到点自己响的强制发动也在这里飘出来。
      ...noticePatch(state, engineState, result.events),
    });
    return true;
  },

  moveGeneral:(generalId,target,consumeCard,sandboxAllowArming)=>{
    const state=get();
    const {engineState, events}=dispatchStoreAction(
      state,
      createAction('MOVE_GENERAL', state.players[state.currentPlayerIndex]?.id ?? 0, {
        generalId,
        target,
        consumeCard,
        // 演练场（沙盒）旁路：整备中的将允许移动。GameBoard／AI／回放都不传⇒正式玩法不受影响。
        ...(sandboxAllowArming === true ? { sandboxAllowArming: true } : {}),
      }),
    );
    const currentPlayerIndex = engineState.players.findIndex(player => player.id === engineState.currentPlayerId);
    set({
      engineState,
      players:engineState.players as unknown as Player[],
      cardDeck:engineState.deck as GameCard[],
      discardPile:engineState.discardPile as GameCard[],
      currentPlayerIndex: currentPlayerIndex >= 0 ? currentPlayerIndex : state.currentPlayerIndex,
      ...noticePatch(state, engineState, events),
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
      set({ ...buildTestArenaState(state, engineState), ...noticePatch(state, engineState, events) });
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
      ...noticePatch(state, engineState, events),
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
      ...noticePatch(state, engineState, events),
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
      ...noticePatch(state, engineState, events),
    });
    return true;
  },

  surrender:(id)=>{
    const state = get();
    const { engineState, events } = dispatchStoreAction(state, createAction('SURRENDER', id));

    // Test arena is an instrumentation sandbox: surrender should immediately
    // advance to the next live player without leaving the arena or opening the
    // normal game's full-screen draw view. Resolve the pending draw inside the
    // same canonical Engine pipeline, then keep the UI mounted on testArena.
    if(state.isTestMode){
      set({
        ...buildTestArenaState(state, engineState),
        phase:'testArena',
        turnPhase:'main',
        ...noticePatch(state, engineState, events),
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
      ...noticePatch(state, engineState, events),
    });
  },

  // ── 2.2.25 (§12-9c) reaction-window business entry ──
  // Container-layer timing through the resident engine (decision D-1: the
  // window never touches TransitionCore/EngineState, so it is structurally
  // absent from the replay stream and from four-way reconciliation). No
  // skill auto-opens a window in this cut — content coverage stays with D-3.
  openReactionWindow:(sourceEvent?,participants?)=>{
    const state=get();
    const ids=(participants ?? state.players.filter(p=>p.isAlive!==false).map(p=>p.id));
    if(ids.length===0)return null;
    const win=openReactionWindowStore(
      state,
      sourceEvent ?? { type:'CUSTOM', data:{ reason:'manual-reaction-window' } },
      ids,
    );
    set({ reactionWindow:{ ...win, passed:[...win.passed] } });
    return win;
  },
  passReaction:(playerId)=>{
    const { accepted, window } = passReactionStore(get(), playerId);
    if(!accepted)return false;
    set({ reactionWindow: window && !window.closed ? { ...window, passed:[...window.passed] } : null });
    return true;
  },

  endTurn:()=>{
    const state=get();
    const activePlayer=state.players[state.currentPlayerIndex];
    if(!activePlayer) return;

    // Ask already open and END_TURN pressed again (right-rail button, keyboard
    // mash) — that IS the skip decision: close the container window honestly,
    // then commit. Never a silent bypass leaving a stale ask behind.
    if(state.turnEndAsk){ get().skipTurnEndAsk(); return; }

    // v2.9.17：先替这一席把勾了「强制发动」的回合结束定义发动掉（同一条规范动作），
    // 再决定要不要开窗问剩下的。窗子从此只问"需要人点头"的那些。
    autoFireForcedTurnEndSkills(activePlayer.id);
    // 那几发自己响的效果有可能把这一局直接打死：终局了就到此为止，绝不再提交一次
    // 结束回合（那只会往录像里多一笔被引擎退回的空动作）。
    const afterAutoFire=get();
    if(afterAutoFire.phase==='gameOver') return;

    // 回合结束询问门 (2.3.1, HANDOFF §4 "回合结束如存在可发动的将领技能，应进入
    // 询问/结算窗口"): a human seat with still-activatable onTurnEnd skills does
    // NOT dispatch END_TURN yet — a container-layer ask opens instead (class B,
    // never recorded). Decisions inside the window are canonical: activation is
    // an ACTIVATE_SKILL action, skipping commits the real END_TURN (class A,
    // recorded). "窗口可以不录；窗口里的游戏决策不能不录" — D-3c 钉死句首检.
    // Engine-level END_TURN legality is unchanged (contract-table 口径): AI
    // seats never pass through this gate (their activations arrive as ordinary
    // policy-picked ACTIVATE_SKILL actions), and the test arena stays ungated.
    // 2.8.17 两档：智能＝有可发动的才开窗；完整＝场上只要有回合结束技能就开窗，
    // 不可发动的一律置灰写明原因。合法集合仍是 listTurnEndSkillCandidates。
    // 判定读的是**上面那几发自己响之后**的新状态（`afterAutoFire`）：没有勾强制发动的
    // 定义时那一步一位不动，这个对象与 `state` 是同一个；动了的话，窗必须按新世界列，
    // 否则刚替玩家发动的那一枚会以"还能发动"的样子再问一遍。
    if(!afterAutoFire.isTestMode && !activePlayer.isAi && !afterAutoFire.turnEndAsk
       && afterAutoFire.phase==='playing' && afterAutoFire.engineState.currentPlayerId===activePlayer.id){
      const visible=visibleTurnEndAskItems(afterAutoFire.engineState, activePlayer.id, afterAutoFire.settings.skillPromptMode);
      if(visible.length>0){
        const turn=afterAutoFire.engineState.turn ?? 0;
        const win=get().openReactionWindow(
          { type:'CUSTOM', data:{ reason:'turn-end-ask', playerId:activePlayer.id, stableId:`turn-end-ask:${turn}:${activePlayer.id}` } },
          [activePlayer.id],
        );
        if(win){
          set({ turnEndAsk:{ playerId:activePlayer.id, windowId:win.id, candidates:visible.map(toTurnEndAskCandidate) } });
          return;
        }
        // window refused (no participants) — fall through and commit honestly
      }
    }
    commitEndTurn();
  },

  skipTurnEndAsk:()=>{
    const ask=get().turnEndAsk;
    if(ask){
      get().passReaction(ask.playerId); // sole participant passes → window closes
      set({ turnEndAsk:null });
    }
    commitEndTurn();
  },

  activateTurnEndSkill:(skillId,generalId)=>{
    const state=get();
    const actorId=state.turnEndAsk?.playerId
      ?? state.engineState.currentPlayerId
      ?? state.players[state.currentPlayerIndex]?.id;
    if(typeof actorId!=='number') return false;

    const { engineState, events } = dispatchStoreAction(
      state,
      createAction('ACTIVATE_SKILL', actorId, { skillId, generalId }),
    );
    const activated=events.find(event=>event.type==='SKILL_ACTIVATED');
    if(!activated) return false;

    if(state.isTestMode){
      set({ ...buildTestArenaState(state, engineState), turnEndAsk:null, ...noticePatch(state, engineState, events) });
      return true;
    }

    // The effect may kill a general, defeat a player or even end the game —
    // project the full state (attackTarget 对账口径), never a partial patch.
    const defeatedPlayerId=(events.find(event=>event.type==='PLAYER_DEFEATED')?.data as any)?.playerId;
    const defeatedEventPlayer=typeof defeatedPlayerId==='number'
      ? engineState.players.find(player=>player.id===defeatedPlayerId)
      : undefined;
    const pendingDraw=engineState.drawState;
    const outcome=deriveResultState(state, engineState);

    // Ask bookkeeping from the NEW state (consumption already applied): zero
    // remaining candidates → the container window closes with the ask.
    // 完整模式下"剩下"含置灰项（技能刚用过＝改列「本回合已发动过」），窗体继续
    // 留着，出口只有「都不发动」；智能模式沿用原样——没有可发动的就闭窗。
    const wasAsked=state.turnEndAsk && state.turnEndAsk.playerId===actorId;
    let nextAsk:TurnEndAsk|null=null;
    if(wasAsked){
      const remaining=visibleTurnEndAskItems(engineState, actorId, state.settings.skillPromptMode);
      nextAsk=remaining.length===0
        ? null
        : { ...state.turnEndAsk!, candidates:remaining.map(toTurnEndAskCandidate) };
    }

    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
      currentRound: engineState.round || state.currentRound,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      winnerId: outcome.winnerId,
      defeatEvent: typeof defeatedPlayerId==='number' && defeatedEventPlayer
        ? { faction:(defeatedEventPlayer as any).faction ?? null, name:(defeatedEventPlayer as any).name ?? '' }
        : state.defeatEvent,
      drawContext: pendingDraw ? buildDrawContext(engineState, pendingDraw) : null,
      revealedDrawCards: pendingDraw ? [] : state.revealedDrawCards,
      turnEndAsk: nextAsk,
      // 发动通知（v2.9.17）：这一路的手工出口与"强制发动自己响"共用同一处推导，
      // 所以替玩家发动的那几发照样飘得出来，措辞与玩家亲手点完全一样。
      ...noticePatch(state, engineState, events),
    });
    if(wasAsked && nextAsk===null){
      get().passReaction(actorId); // no candidates left → close the container window
    }
    return true;
  },

  // 2.6.3 choice channel: the frozen-world release valve. The offer lives in
  // EngineState.pendingChoice (A-class slot — resident/rebuild/replay all see
  // it), the pick is a canonical CHOOSE_OPTION action, and the chosen branch
  // settles inside this same dispatch. Projection mirrors activateTurnEndSkill
  // (effects can kill/defeat/end the game — never patch partially).
  chooseOption:(optionIndex)=>{
    const state=get();
    const pending=state.engineState.pendingChoice;
    if(!pending) return false;

    const { engineState, events } = dispatchStoreAction(
      state,
      createAction('CHOOSE_OPTION', pending.playerId, { choiceKey: pending.key, optionIndex }),
    );
    if(!events.some(event=>event.type==='CHOICE_RESOLVED')) return false;

    if(state.isTestMode){
      set({ ...buildTestArenaState(state, engineState), ...noticePatch(state, engineState, events) });
      return true;
    }

    const defeatedPlayerId=(events.find(event=>event.type==='PLAYER_DEFEATED')?.data as any)?.playerId;
    const defeatedEventPlayer=typeof defeatedPlayerId==='number'
      ? engineState.players.find(player=>player.id===defeatedPlayerId)
      : undefined;
    const pendingDraw=engineState.drawState;
    const outcome=deriveResultState(state, engineState);

    set({
      ...engineStateToStoreProjection(engineState, state.currentPlayerIndex),
      currentRound: engineState.round || state.currentRound,
      phase: outcome.phase,
      turnPhase: outcome.turnPhase,
      winnerId: outcome.winnerId,
      defeatEvent: typeof defeatedPlayerId==='number' && defeatedEventPlayer
        ? { faction:(defeatedEventPlayer as any).faction ?? null, name:(defeatedEventPlayer as any).name ?? '' }
        : state.defeatEvent,
      drawContext: pendingDraw ? buildDrawContext(engineState, pendingDraw) : null,
      revealedDrawCards: pendingDraw ? [] : state.revealedDrawCards,
      ...noticePatch(state, engineState, events),
    });
    return true;
  },

  // v2.8.22 响应链执法刀 (#71)：三键问窗的两个出口，各自都是一条 canonical 动作
  // （发动＝ACTIVATE_SKILL／跳过＝SKIP_REACTION）。窗体本身仍是容器的观察面，
  // 窗里的每一次表态都进事件流、进录像。
  activateReactionSkill:(skillId,generalId)=>commitReactionAnswer(skillId,generalId),
  skipReaction:()=>commitReactionAnswer(null,null),

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
    resetReactionWindowStore();
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
      draftDistributed:[] as General[],
      isTestMode:false,
      reactionWindow:null as GameState['reactionWindow'],
      turnEndAsk:null as GameState['turnEndAsk'],
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
      identityRegistry:state.identityRegistry,
      authoredGenerals:state.authoredGenerals,
      // v2.8.8 N2: locks are player assets on this machine (§H8), not match
      // state — same rule as authoredGenerals (玩家资产≠对局状态).
      lockedGeneralIds:state.lockedGeneralIds,
    });
  },

  setCurrentPlayerIndex: i => set({ currentPlayerIndex: i }),

  ...buildTestArenaActions(get, set, shuffle),
});
});
