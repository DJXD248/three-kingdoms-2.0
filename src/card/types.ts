export type CardType = 'BASIC'|'EQUIPMENT'|'TRICK';

export interface CardData {
 id:string;
 name:string;
 type:CardType;
 description:string;
}

export interface CardInstance {
 uid:string;
 cardId:string;
}
