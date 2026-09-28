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
import {
  mayModifyGeneral,
  partitionEditMap,
  partitionIdSet,
  type BlockedOverlay,
  type EditDecision,
  type GeneralPolicyContext,
} from '../domain/generalPolicy';
import type { GameState } from './gameStoreTypes';

type SetState = (patch: Partial<GameState>) => void;
type GetState = () => GameState;

type SkillEditList = GameState['skillEdits'][string];
type GeneralEdit = GameState['generalEdits'][string];
type BatchResult = { applied: string[]; rejected: string[] };

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
  | 'mayEditGeneral'
  | 'effectiveDisabledGenerals'
  | 'blockedEdits'
  | 'addIdentity'
  | 'renameIdentity'
  | 'deleteIdentity'
> {
  // §H3 layer ②: every mutation in this slice passes through this one gate.
  // The gate is the store's, not the component's — a caller that skips the UI
  // still cannot write, and a denial comes back with a reason instead of
  // silently landing in localStorage.
  const policy = (): GeneralPolicyContext => ({ developerMode: get().developerMode });
  const guard = (generalId: string): EditDecision => mayModifyGeneral(generalId, policy());
  const batchWrite = (ids: string[], apply: (permitted: string[]) => void): BatchResult => {
    const permitted = ids.filter(id => mayModifyGeneral(id, policy()).allowed);
    const rejected = ids.filter(id => !permitted.includes(id));
    if (permitted.length > 0) apply(permitted);
    return { applied: permitted, rejected };
  };

  return {
    enableDeveloperMode: digest => {
      if (!matchesDeveloperModeDigest(digest)) return false;
      set({ developerMode: true });
      return true;
    },

    // Leaving developer mode needs no credential: it only removes capability.
    disableDeveloperMode: () => set({ developerMode: false }),

    updateSkillEdit: (generalId, skills) => {
      const decision = guard(generalId);
      if (!decision.allowed) return decision;
      const next = { ...get().skillEdits, [generalId]: skills };
      persistSkillEdits(next);
      set({ skillEdits: next });
      return decision;
    },

    updateGeneralEdit: (generalId, edits) => {
      const decision = guard(generalId);
      if (!decision.allowed) return decision;
      const next = { ...get().generalEdits, [generalId]: edits };
      persistGeneralEdits(next);
      set({ generalEdits: next });
      return decision;
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

    // §H3: a non-developer may not DELETE an official card's overlay either —
    // 「原数据仍保留、不删除、不回滚」 is half of the blocked-state contract, so
    // bulk delete is limited to what this session is allowed to touch.
    batchDeleteEdits: generalIds =>
      batchWrite(generalIds, permitted => {
        const skillEdits = { ...get().skillEdits };
        const generalEdits = { ...get().generalEdits };
        for (const id of permitted) {
          delete skillEdits[id];
          delete generalEdits[id];
        }
        persistSkillEdits(skillEdits);
        persistGeneralEdits(generalEdits);
        set({ skillEdits, generalEdits });
      }),

    toggleDisabledGeneral: id => {
      const decision = guard(id);
      if (!decision.allowed) return decision;
      const next = new Set(get().disabledGenerals);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistDisabledGenerals(next);
      set({ disabledGenerals: next });
      return decision;
    },

    batchToggleDisabled: (ids, disabled) =>
      batchWrite(ids, permitted => {
        const next = new Set(get().disabledGenerals);
        for (const id of permitted) {
          if (disabled) next.add(id); else next.delete(id);
        }
        persistDisabledGenerals(next);
        set({ disabledGenerals: next });
      }),

    importSkillEditsFromText: text => {
      const validTags = ['锁定技', '限定技', '登场技', '遗计技', '觉醒技'];
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      let count = 0;
      const rejected: string[] = [];
      const edits = { ...get().skillEdits };
      const ctx = policy();
      for (const line of lines) {
        const parts = line.split('|').map(part => part.trim());
        if (parts.length < 2) continue;
        const general = allGenerals.find(g => g.name === parts[0]);
        if (!general) continue;
        // A denied row is named in the result, never quietly dropped (§12-46①).
        if (!mayModifyGeneral(general.id, ctx).allowed) {
          rejected.push(general.name);
          continue;
        }
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
      return { count, rejected };
    },

    getGeneralWithEdits: general => {
      const { skillEdits, generalEdits } = get();
      const result = { ...general } as General;
      // §H3 layer ③: an overlay this session may not hold is neither deleted
      // nor rolled back — it simply stops steering the assembly, and
      // `blockedEdits()` reports that it is there.
      const mayEdit = mayModifyGeneral(general.id, policy()).allowed;
      const gEdits: GeneralEdit | undefined = mayEdit ? generalEdits[general.id] : undefined;
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
      const sEdits: SkillEditList | undefined = mayEdit ? skillEdits[general.id] : undefined;
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

    mayEditGeneral: generalId => mayModifyGeneral(generalId, policy()).allowed,

    // Assembly consumers read the disable list through this, never the raw
    // save-file: an official general left disabled by an earlier developer
    // session must not keep vanishing from the draft pool (§H3 layer ③).
    effectiveDisabledGenerals: () =>
      partitionIdSet(get().disabledGenerals, 'disabled', policy()).permitted,

    // The third state §H3 requires: 原数据仍保留 / 已禁止应用 / 冲突已标明.
    blockedEdits: () => {
      const ctx = policy();
      const nameOf = (id: string) =>
        [...allGenerals, ...get().authoredGenerals].find(g => g.id === id)?.name ?? id;
      const blocked: { id: string; name: string; kind: BlockedOverlay['kind'] }[] = [];
      const push = (entries: BlockedOverlay[]) => {
        for (const entry of entries) blocked.push({ ...entry, name: nameOf(entry.id) });
      };
      push(partitionEditMap(get().skillEdits, 'skillEdits', ctx).blocked);
      push(partitionEditMap(get().generalEdits, 'generalEdits', ctx).blocked);
      push(partitionIdSet(get().disabledGenerals, 'disabled', ctx).blocked);
      return blocked;
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
      const ctx = policy();
      persistIdentityRegistry(registry.map(n => (n === oldName ? newName : n)));
      set({ identityRegistry: registry.map(n => (n === oldName ? newName : n)) });
      // Cascade: every general edit referencing the old name follows it
      // (身份改名级联, D1 保守方案的写侧). §H3: the cascade is still a write,
      // so it only follows overlays this session may own — official overlays it
      // cannot touch are left byte-identical (blocked, not rewritten).
      const nextEdits = { ...get().generalEdits };
      let touched = false;
      for (const [gid, edit] of Object.entries(nextEdits)) {
        if (edit.identity === oldName && mayModifyGeneral(gid, ctx).allowed) {
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
