import type { Faction, General, SkillCondition, SkillEffect, SkillEffectMode, SkillTag, SkillTriggerConfig } from '../data/generals';
import { isAcceptableAuthoredRecord, stripFrozenFields } from '../domain/generalProvenance';

export type SkillEdit = {
  name: string;
  description?: string;
  tag?: SkillTag;
  trigger?: SkillTriggerConfig;
  effects?: SkillEffect[];
  effectMode?: SkillEffectMode;
  /** v2.8.11 刀2：整组门槛（技能级）。可选字段——旧存档没有它，读出来即"没门槛"。 */
  conditions?: SkillCondition[];
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

// v2.8.8 N2 (§H8): the user's manual (white) locks. Local to this machine and
// this player — never in source files, EngineState, replays, or CI inputs, and
// never applied across players. It records only which ids the user chose to
// lock; the gold lock is derived (§H3), never stored.
export const LOCKED_GENERALS_KEY = 'three_kingdoms_locked_generals';

export function loadLockedGenerals(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCKED_GENERALS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === 'string'))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function persistLockedGenerals(locked: Set<string>): void {
  try {
    localStorage.setItem(LOCKED_GENERALS_KEY, JSON.stringify([...locked]));
  } catch {
    // Persistence is best effort.
  }
}
