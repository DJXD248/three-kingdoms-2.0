export type Faction = "WEI" | "SHU" | "WU" | "QUN" | "JIN";
export type GeneralType = "WARRIOR" | "SCHOLAR";
export type CardType = "SUPPLY" | "MATERIAL" | "ARMAMENT";

export interface GeneralDefinition {
  id: string;
  name: string;
  faction: Faction;
  generalType: GeneralType;
  maxHp: number;
  meleeAttack: number;
  rangedAttack: number;
  skillIds: string[];
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
}

export interface CardInstance {
  instanceId: string;
  definitionId: string;
}

export interface GeneralInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  currentHp: number;
  armorCardIds: string[];
  position?: {
    region: "CAMP" | "FRONTLINE" | "BATTLEFIELD";
    index: number;
  };
  hasMoved: boolean;
  hasAttacked: boolean;
  hasSupplied: boolean;
  alive: boolean;
}

export interface GeneralPool {
  playerId: string;
  generalIds: string[];
}

export interface SharedCardPool {
  drawPile: CardInstance[];
  discardPile: CardInstance[];
}

export interface BaseState {
  playerId: string;
  faction: Faction;
  hp: number;
  maxHp: null;
}

export interface PlayerDomainState {
  playerId: string;
  faction: Faction;
  generalPool: GeneralPool;
  hand: CardInstance[];
  graveyard: CardInstance[];
  base: BaseState;
  defeated: boolean;
  spectator: boolean;
}
