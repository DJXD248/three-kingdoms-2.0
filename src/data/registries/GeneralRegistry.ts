
import type { GeneralData } from "../types";

export class GeneralRegistry {
  private generals = new Map<string, GeneralData>();

  register(data: GeneralData) {
    this.generals.set(data.id, data);
  }

  get(id: string) {
    return this.generals.get(id);
  }

  import(data: GeneralData[]) {
    data.forEach(item => this.register(item));
  }

  getAll() {
    return [...this.generals.values()];
  }
}
