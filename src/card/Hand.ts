import type {CardInstance} from './types';

export class Hand {
 private cards:CardInstance[]=[];

 add(card:CardInstance){
  this.cards.push(card);
 }

 remove(uid:string){
  this.cards=this.cards.filter(c=>c.uid!==uid);
 }

 getAll(){
  return this.cards;
 }
}
