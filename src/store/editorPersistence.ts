import type { Faction, General, SkillEffect, SkillEffectMode, SkillTag, SkillTriggerConfig } from '../data/generals';
import { isAcceptableAuthoredRecord, stripFrozenFields } from '../domain/generalProvenance';

export type SkillEdit = {
  name: string;
  description?: string;
  tag?: SkillTag;
  trigger?: SkillTriggerConfig;
  effects?: SkillEffect[];
  effectMode?: SkillEffectMode;
  forced?: boolean;
};

export type SkillEdits = Record<string, SkillEdit[]>;
export type GeneralEdit = { name?: string; faction?: Faction; hp?: number; meleeAtk?: number; rangedAtk?: number; identity?: string };
export type GeneralEdits = Record<string, GeneralEdit>;

// Exported for tests only: the keys are part of the save-file contract, and a
// fixture that hardcodes them silently rots when one is renamed.
const SKILL_EDITS_KEY = 'three_kingdoms_skill_edits';
export const GENERAL_EDITS_KEY = 'three_kingdoms_general_edits';
const DISABLED_GENERALS_KEY = 'three_kingdoms_disabled_generals';
// v2.8.0 identity registry (身份管理): a maintained list of identity names.
// Old saves without this key simply start with an empty registry.
const IDENTITY_REGISTRY_KEY = 'three_kingdoms_identity_registry';

export function loadPersistedSkillEdits(): SkillEdits {
  try {
    const raw = localStorage.getItem(SKILL_EDITS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function persistSkillEdits(edits: SkillEdits): void {
  try {
    localStorage.setItem(SKILL_EDITS_KEY, JSON.stringify(edits));
  } catch {
    // Persistence is best effort; the in-memory store remains authoritative for this session.
  }
}

export function loadPersistedGeneralEdits(): GeneralEdits {
  try {
    const raw = localStorage.getItem(GENERAL_EDITS_KEY);
    const parsed: GeneralEdits = raw ? JSON.parse(raw) : {};
    // Frozen fields (`id`/`source`) never ride an edit patch, even if a saved
    // blob carries them — and the refusal is reported, not swallowed (§H1).
    const clean: GeneralEdits = {};
    for (const [id, patch] of Object.entries(parsed)) {
      const { clean: fields, rejected } = stripFrozenFields(patch as Record<string, unknown>);
      if (rejected.length > 0) {
        console.warn(`[content] 忽略编号/来源上的改写：将领 ${id} 的差异包含 ${rejected.join('、')}`);
      }
      clean[id] = fields as GeneralEdit;
    }
    return clean;
  } catch {
    return {};
  }
}

export function persistGeneralEdits(edits: GeneralEdits): void {
  try {
    localStorage.setItem(GENERAL_EDITS_KEY, JSON.stringify(edits));
  } catch {
    // Persistence is best effort.
  }
}

export function loadDisabledGenerals(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_GENERALS_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function persistDisabledGenerals(disabled: Set<string>): void {
  try {
    localStorage.setItem(DISABLED_GENERALS_KEY, JSON.stringify([...disabled]));
  } catch {
    // Persistence is best effort.
  }
}

export function loadIdentityRegistry(): string[] {
  try {
    const raw = localStorage.getItem(IDENTITY_REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function persistIdentityRegistry(registry: string[]): void {
  try {
    localStorage.setItem(IDENTITY_REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Persistence is best effort.
  }
}

// v2.8.5 authored content (§H1/§H2): locally created general records, each one
// already carrying its frozen `id` + `source`. A record whose provenance does
// not check out is refused at load — the authored list can never shadow or
// rewrite a repository ledger card, and a reload never re-mints a number.
export const AUTHORED_GENERALS_KEY = 'three_kingdoms_authored_generals';

export function loadAuthoredGenerals(): General[] {
  try {
    const raw = localStorage.getItem(AUTHORED_GENERALS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const accepted: General[] = [];
    for (const value of parsed) {
      if (!isAcceptableAuthoredRecord(value)) continue;
      if (seen.has(value.id)) continue;
      seen.add(value.id);
      accepted.push(value);
    }
    return accepted;
  } catch {
    return [];
  }
}

export function persistAuthoredGenerals(generals: General[]): void {
  try {
    localStorage.setItem(AUTHORED_GENERALS_KEY, JSON.stringify(generals));
  } catch {
    // Persistence is best effort.
  }
}
