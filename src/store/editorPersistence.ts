import type { Faction, SkillEffect, SkillEffectMode, SkillTag, SkillTriggerConfig } from '../data/generals';

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

const SKILL_EDITS_KEY = 'three_kingdoms_skill_edits';
const GENERAL_EDITS_KEY = 'three_kingdoms_general_edits';
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
    return raw ? JSON.parse(raw) : {};
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
