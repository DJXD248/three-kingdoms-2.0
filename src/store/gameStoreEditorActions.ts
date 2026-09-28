// Editor/developer-mode slice extracted from gameStore.ts (stabilization
// stage B, D-6 first split). Behavior is a verbatim move; the store wires
// these in via `...buildEditorActions(get, set)`.
import type { General, SkillTag } from '../data/generals';
import { allGenerals } from '../data/generals';
import {
  persistSkillEdits,
  persistGeneralEdits,
  persistDisabledGenerals,
  persistIdentityRegistry,
  persistAuthoredGenerals,
} from './editorPersistence';
import {
  createAuthoredGeneral,
  isAuthoredId,
  type AuthoredGeneralInput,
} from '../domain/generalProvenance';
import type { GeneralSource } from '../data/generals';
import { identityOf } from '../domain/identity';
import { matchesDeveloperModeDigest } from '../domain/devGate';
import type { GameState } from './gameStoreTypes';

type SetState = (patch: Partial<GameState>) => void;
type GetState = () => GameState;

type SkillEditList = GameState['skillEdits'][string];
type GeneralEdit = GameState['generalEdits'][string];

export function buildEditorActions(
  get: GetState,
  set: SetState,
): Pick<
  GameState,
  | 'enableDeveloperMode'
  | 'disableDeveloperMode'
  | 'updateSkillEdit'
  | 'updateGeneralEdit'
  | 'addAuthoredGeneral'
  | 'removeAuthoredGeneral'
  | 'batchDeleteEdits'
  | 'toggleDisabledGeneral'
  | 'batchToggleDisabled'
  | 'importSkillEditsFromText'
  | 'getGeneralWithEdits'
  | 'addIdentity'
  | 'renameIdentity'
  | 'deleteIdentity'
> {
  return {
    enableDeveloperMode: digest => {
      if (!matchesDeveloperModeDigest(digest)) return false;
      set({ developerMode: true });
      return true;
    },

    // Leaving developer mode needs no credential: it only removes capability.
    disableDeveloperMode: () => set({ developerMode: false }),

    updateSkillEdit: (generalId, skills) => {
      const next = { ...get().skillEdits, [generalId]: skills };
      persistSkillEdits(next);
      set({ skillEdits: next });
    },

    updateGeneralEdit: (generalId, edits) => {
      const next = { ...get().generalEdits, [generalId]: edits };
      persistGeneralEdits(next);
      set({ generalEdits: next });
    },

    // v2.8.5 authoring (§H2): the source a new record is stamped with is not
    // caller-choice — an authenticated developer creates an official LOCAL
    // DRAFT, anyone else creates DIY content. Neither path can mint a record
    // into the repository ledger, and no path lets the caller pick an id.
    addAuthoredGeneral: (input: AuthoredGeneralInput, requestedSource: GeneralSource) => {
      const source: GeneralSource =
        get().developerMode && requestedSource === 'official' ? 'official' : 'DIY';
      const result = createAuthoredGeneral(input, source);
      if (!result.ok) return { ok: false, reason: result.reason };
      const authoredGenerals = [...get().authoredGenerals, result.general];
      persistAuthoredGenerals(authoredGenerals);
      set({ authoredGenerals });
      return { ok: true, general: result.general };
    },

    // Only authored records are removable. A ledger card is unremovable here
    // by construction (the id namespace check), independent of any UI gate.
    removeAuthoredGeneral: (id: string) => {
      if (!isAuthoredId(id)) return false;
      const authoredGenerals = get().authoredGenerals.filter(g => g.id !== id);
      if (authoredGenerals.length === get().authoredGenerals.length) return false;
      // The record is gone, so its differential patches have no subject left:
      // deleting must not leave an orphan overlay keyed by a dead id.
      const skillEdits = { ...get().skillEdits };
      const generalEdits = { ...get().generalEdits };
      delete skillEdits[id];
      delete generalEdits[id];
      const disabledGenerals = new Set(get().disabledGenerals);
      disabledGenerals.delete(id);
      persistSkillEdits(skillEdits);
      persistGeneralEdits(generalEdits);
      persistDisabledGenerals(disabledGenerals);
      persistAuthoredGenerals(authoredGenerals);
      set({ authoredGenerals, skillEdits, generalEdits, disabledGenerals });
      return true;
    },

    batchDeleteEdits: generalIds => {
      const skillEdits = { ...get().skillEdits };
      const generalEdits = { ...get().generalEdits };
      for (const id of generalIds) {
        delete skillEdits[id];
        delete generalEdits[id];
      }
      persistSkillEdits(skillEdits);
      persistGeneralEdits(generalEdits);
      set({ skillEdits, generalEdits });
    },

    toggleDisabledGeneral: id => {
      const next = new Set(get().disabledGenerals);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistDisabledGenerals(next);
      set({ disabledGenerals: next });
    },

    batchToggleDisabled: (ids, disabled) => {
      const next = new Set(get().disabledGenerals);
      for (const id of ids) {
        if (disabled) next.add(id); else next.delete(id);
      }
      persistDisabledGenerals(next);
      set({ disabledGenerals: next });
    },

    importSkillEditsFromText: text => {
      const validTags = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      let count = 0;
      const edits = { ...get().skillEdits };
      for (const line of lines) {
        const parts = line.split('|').map(part => part.trim());
        if (parts.length < 2) continue;
        const general = allGenerals.find(g => g.name === parts[0]);
        if (!general) continue;
        const skillNames = parts[1].split(',').map(v => v.trim()).filter(Boolean);
        const descriptions = parts.length >= 3 ? parts[2].split(',').map(v => v.trim()) : [];
        const tags = parts.length >= 4 ? parts[3].split(',').map(v => v.trim()) : [];
        edits[general.id] = skillNames.map((name, index) => ({
          name,
          description: descriptions[index] || '',
          tag: tags[index] && validTags.includes(tags[index]) ? tags[index] as SkillTag : undefined,
        }));
        count++;
      }
      persistSkillEdits(edits);
      set({ skillEdits: edits });
      return count;
    },

    getGeneralWithEdits: general => {
      const { skillEdits, generalEdits } = get();
      const result = { ...general } as General;
      const gEdits: GeneralEdit | undefined = generalEdits[general.id];
      if (gEdits) {
        if (gEdits.name) result.name = gEdits.name;
        if (gEdits.faction) result.faction = gEdits.faction;
        // v2.8.0: '' (explicit 无身份) must survive the merge, so test
        // undefined — not truthiness — here.
        if (gEdits.identity !== undefined) result.identity = gEdits.identity;
        if (gEdits.hp != null) {
          result.hp = gEdits.hp;
          result.type = gEdits.hp >= 4 ? '武将' : '文将';
        }
        if (gEdits.meleeAtk != null) result.meleeAtk = gEdits.meleeAtk;
        if (gEdits.rangedAtk != null) result.rangedAtk = gEdits.rangedAtk;
      }
      const sEdits: SkillEditList | undefined = skillEdits[general.id];
      if (sEdits) {
        result.skills = sEdits.map(skill => ({
          name: skill.name,
          description: skill.description,
          tag: skill.tag,
          trigger: skill.trigger,
          effects: skill.effects,
          effectMode: skill.effectMode,
          forced: skill.forced,
        }));
      }
      return result;
    },

    addIdentity: rawName => {
      const name = rawName.trim();
      if (name === '') return false;
      const registry = get().identityRegistry;
      if (registry.includes(name)) return false;
      const next = [...registry, name];
      persistIdentityRegistry(next);
      set({ identityRegistry: next });
      return true;
    },

    renameIdentity: (oldName, rawNewName) => {
      const newName = rawNewName.trim();
      const registry = get().identityRegistry;
      if (newName === '' || !registry.includes(oldName) || registry.includes(newName)) return false;
      persistIdentityRegistry(registry.map(n => (n === oldName ? newName : n)));
      set({ identityRegistry: registry.map(n => (n === oldName ? newName : n)) });
      // Cascade: every general edit referencing the old name follows it
      // (身份改名级联, D1 保守方案的写侧).
      const nextEdits = { ...get().generalEdits };
      let touched = false;
      for (const [gid, edit] of Object.entries(nextEdits)) {
        if (edit.identity === oldName) {
          nextEdits[gid] = { ...edit, identity: newName };
          touched = true;
        }
      }
      if (touched) persistGeneralEdits(nextEdits);
      set({ generalEdits: nextEdits });
      return true;
    },

    deleteIdentity: name => {
      const { identityRegistry, generalEdits, authoredGenerals } = get();
      if (!identityRegistry.includes(name)) return { ok: false, referrers: [] };
      const referrers: string[] = [];
      // Authored cards carry their identity on the record itself (never derived
      // from a rename), so scanning them is required for the same guarantee.
      for (const g of [...allGenerals, ...authoredGenerals]) {
        const explicit = generalEdits[g.id]?.identity;
        const resolved = identityOf(explicit !== undefined ? { name: g.name, identity: explicit } : g);
        if (resolved === name) referrers.push(g.name);
      }
      if (referrers.length > 0) return { ok: false, referrers };
      persistIdentityRegistry(identityRegistry.filter(n => n !== name));
      set({ identityRegistry: identityRegistry.filter(n => n !== name) });
      return { ok: true, referrers: [] };
    },
  };
}
