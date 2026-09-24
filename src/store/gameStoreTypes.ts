// Store-level types extracted from gameStore.ts (stabilization stage B, D-6
// first split). Pure type moves — shapes and semantics are unchanged.
import type { General, Faction, SkillTag, SkillTriggerConfig, SkillEffect, SkillEffectMode } from '../data/generals';
import type { GameCard } from '../data/cards';
import type { AiSeatMode, AiSeatTier } from '../setup/runtimeSetup';
import type { EngineState } from '../core/GameState';
import type { GameEvent } from '../core/Event';
import type { SkillActivation } from '../skills/dataTypes';
import type { ReactionWindowState } from '../triggers/types';

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
  // v2.2.9 human-vs-AI: stamped at createRoom from seatModes; survives engine
  // dispatch clones via the EnginePlayer index signature.
  isAi?:boolean; aiTier?:AiSeatTier;
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
  // v2.2.9 human-vs-AI: per-seat mode chosen in CreateRoom, stamped onto
  // players at createRoom (index = pre-dice seat).
  seatModes:AiSeatMode[];
  // 2.2.25 (§12-9c): reaction-window business entry — container-layer state
  // mirrored for the HUD. Never part of EngineState or the replay stream.
  reactionWindow:ReactionWindowState|null;
  settings:{
    resolution:string;windowMode:string;animationSpeed:number;masterVolume:number;musicVolume:number;sfxVolume:number;autoSave:boolean;
    // 2.2.6 replay/log saving (persisted in localStorage via replayStorage)
    autoSaveReplay:boolean;autoSaveLog:boolean;replayDirName:string|null;
  };
  developerMode:boolean;
  skillEdits:Record<string, {name:string;description?:string;tag?:SkillTag;trigger?:SkillTriggerConfig;effects?:SkillEffect[];effectMode?:SkillEffectMode;forced?:boolean}[]>;
  generalEdits:Record<string, {name?:string;faction?:Faction;hp?:number;meleeAtk?:number;rangedAtk?:number}>;
  disabledGenerals:Set<string>;

  setPhase:(p:GamePhase)=>void; setPlayerCount:(c:number)=>void; setRoomName:(n:string)=>void;
  createRoom:()=>void; startGame:()=>void; rollDice:()=>void; assignFactions:()=>void;
  distributeDraftGenerals:()=>void; selectDraftGeneral:(g:General)=>void; confirmDraft:()=>void;
  setSeatMode:(index:number, patch:Partial<AiSeatMode>)=>void;
  aiAutoDraft:()=>void;
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
  // 2.2.25 reaction-window entry (no skill auto-opens this cut)
  openReactionWindow:(sourceEvent?:GameEvent,participants?:number[])=>ReactionWindowState|null;
  passReaction:(playerId:number)=>boolean;
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
