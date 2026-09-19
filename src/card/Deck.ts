import type {CardInstance} from './types';

export class Deck {
 private cards:CardInstance[]=[];

 constructor(cards:CardInstance[]=[]){
  this.cards=cards;
 }

 shuffle(){
  this.cards.sort(()=>Math.random()-0.5);
 }

 draw(){
  return this.cards.pop();
 }

 size(){
  return this.cards.length;
 }
}
