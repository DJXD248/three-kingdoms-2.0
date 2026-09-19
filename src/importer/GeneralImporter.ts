
import type { GeneralRegistry } from "../data/registries/GeneralRegistry";

export class GeneralImporter {
  constructor(private registry: GeneralRegistry) {}

  import(data: any[]) {
    this.registry.import(data);
  }
}
