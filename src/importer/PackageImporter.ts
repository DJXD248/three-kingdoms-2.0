
import type { ImportPackage } from "./types";

export class PackageImporter {
  validate(pkg: ImportPackage) {
    return !!pkg.version;
  }

  import(pkg: ImportPackage) {
    if (!this.validate(pkg)) {
      throw new Error("Invalid content package");
    }
    return pkg;
  }
}
