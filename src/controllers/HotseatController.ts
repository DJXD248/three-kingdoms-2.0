import { LocalController } from './LocalController';

/** Local controller with explicit seat ownership for hotseat mode. */
export class HotseatController extends LocalController {
  activeSeat = 0;

  switchSeat(nextSeat: number) {
    if (!Number.isInteger(nextSeat) || nextSeat < 0) {
      throw new Error('Seat index must be a non-negative integer');
    }
    this.activeSeat = nextSeat;
  }
}
