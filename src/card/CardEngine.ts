import type {CardData} from './types';

export class CardEngine {
 resolve(card:CardData){
  return {
   type:'CARD_PLAYED',
   cardId:card.id
  };
 }
}
