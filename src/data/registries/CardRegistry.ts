
import type { CardData } from "../types";

export class CardRegistry {
  private cards = new Map<string, CardData>();

  register(data: CardData) {
    this.cards.set(data.id, data);
  }

  get(id: string) {
    return this.cards.get(id);
  }

  import(data: CardData[]) {
    data.forEach(item => this.register(item));
  }
}
