export interface GameHistoryEntry {
  roomId:string;
  winner?:string;
  startedAt:number;
  finishedAt?:number;
}
