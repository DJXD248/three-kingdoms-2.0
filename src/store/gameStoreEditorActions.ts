// Editor/developer-mode slice extracted from gameStore.ts (stabilization
// stage B, D-6 first split). Behavior is a verbatim move; the store wires
// these in via `...buildEditorActions(get, set)`.
import type { General } from '../data/generals';
import { allGenerals } from '../data/generals';
import { tagsOf, parseSkillTagsCell } from '../domain/skillTags';
import {
  persistSkillEdits,
  persistGeneralEdits,
  persistDisabledGenerals,
  persistIdentityRegistry,
  persistAuthoredGenerals,
  persistLockedGenerals,
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
  mayWriteGeneral,
  mayToggleGeneralLock,
  partitionEditMap,
  partitionIdSet,
  type BlockedOverlay,
  type EditDecision,
  type GeneralPolicyContext,
  type GeneralWriteContext,
} from '../domain/generalPolicy';
import type { GameState } from './gameStoreTypes';

type SetState = (patch: Partial<GameState>) => void;
type GetState = () => GameState;

type SkillEditList = GameState['skillEdits'][string];
type GeneralEdit = GameState['generalEdits'][string];
// v2.8.8 N2: rejected splits into two named lists — 「系统禁改」和「你自己的
// 白锁」是两个不同的句子（§12-55：拒绝原因逐条点名，绝不并栏）。
type BatchResult = { applied: string[]; rejected: string[]; deniedLock: string[] };

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
  | 'toggleGeneralLock'
  | 'batchToggleLocked'
  | 'isGeneralLocked'
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
  // v2.8.8 N2: the WRITE ctx carries the user's white locks on top of §H3
  // (independent computations, stricter wins). The ASSEMBLY ctx (`policy()`)
  // deliberately does not: locking a card stops future writes, never the
  // application of what it already holds (§H8 住所与归属).
  const policy = (): GeneralPolicyContext => ({ developerMode: get().developerMode });
  const writeCtx = (): GeneralWriteContext => ({ ...policy(), lockedIds: get().lockedGeneralIds });
  const guard = (generalId: string): EditDecision => mayWriteGeneral(generalId, writeCtx());
  const batchWrite = (ids: string[], apply: (permitted: string[]) => void): BatchResult => {
    const permitted: string[] = [];
    const rejected: string[] = [];
    const deniedLock: string[] = [];
    for (const id of ids) {
      const decision = mayWriteGeneral(id, writeCtx());
      if (decision.allowed) permitted.push(id);
      else if (decision.denial === 'USER_LOCKED') deniedLock.push(id);
      else rejected.push(id);
    }
    if (permitted.length > 0) apply(permitted);
    return { applied: permitted, rejected, deniedLock };
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
    // v2.8.8 N2: 「删除」is a write too — a locked card refuses, and the denial
    // is named so the UI can say which lock stopped it (a dead id says nothing).
    removeAuthoredGeneral: (id: string) => {
      const decision = guard(id);
      if (!decision.allowed) return { ok: false, denial: decision.denial };
      if (!isAuthoredId(id)) return { ok: false, denial: null };
      const authoredGenerals = get().authoredGenerals.filter(g => g.id !== id);
      if (authoredGenerals.length === get().authoredGenerals.length) return { ok: false, denial: null };
      // The record is gone, so its differential patches have no subject left:
      // deleting must not leave an orphan overlay keyed by a dead id.
      const skillEdits = { ...get().skillEdits };
      const generalEdits = { ...get().generalEdits };
      delete skillEdits[id];
      delete generalEdits[id];
      const disabledGenerals = new Set(get().disabledGenerals);
      disabledGenerals.delete(id);
      // v2.8.8: same orphan rule for the lock list — a dead id must not keep
      // squatting a lock slot (and its old id can never be re-minted anyway).
      const lockedGeneralIds = new Set(get().lockedGeneralIds);
      lockedGeneralIds.delete(id);
      persistSkillEdits(skillEdits);
      persistGeneralEdits(generalEdits);
      persistDisabledGenerals(disabledGenerals);
      persistAuthoredGenerals(authoredGenerals);
      persistLockedGenerals(lockedGeneralIds);
      set({ authoredGenerals, skillEdits, generalEdits, disabledGenerals, lockedGeneralIds });
      return { ok: true, denial: null };
    },

    // §H8 N2: the white-lock switch itself. Guarded by the SYSTEM layer only
    // (mayToggleGeneralLock) — a manual lock must never block its own removal,
    // or the protection would become a one-way trap.
    toggleGeneralLock: id => {
      const decision = mayToggleGeneralLock(id, policy());
      if (!decision.allowed) return decision;
      const next = new Set(get().lockedGeneralIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistLockedGenerals(next);
      set({ lockedGeneralIds: next });
      return decision;
    },

    batchToggleLocked: (ids, locked) => {
      const ctx = policy();
      const permitted = ids.filter(id => mayToggleGeneralLock(id, ctx).allowed);
      const rejected = ids.filter(id => !permitted.includes(id));
      if (permitted.length > 0) {
        const next = new Set(get().lockedGeneralIds);
        for (const id of permitted) {
          if (locked) next.add(id); else next.delete(id);
        }
        persistLockedGenerals(next);
        set({ lockedGeneralIds: next });
      }
      return { applied: permitted, rejected };
    },

    isGeneralLocked: id => get().lockedGeneralIds.has(id),

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
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      let count = 0;
      const rejected: string[] = [];
      // v2.8.8: two independent reasons get two named lists — 「被系统禁改」和
      // 「被你自己的白锁挡住」are different sentences to the user, never merged.
      const deniedLock: string[] = [];
      const edits = { ...get().skillEdits };
      const wctx = writeCtx();
      // v2.8.13: 写入方必须报得出"我写了谁"——导入总结由调用方按生效视图前后各取
      // 一次来派生，这里只交结构化名单，绝不交措辞（词表住在录入面，§12-67③）。
      const applied: string[] = [];
      for (const line of lines) {
        const parts = line.split('|').map(part => part.trim());
        if (parts.length < 2) continue;
        const general = allGenerals.find(g => g.name === parts[0]);
        if (!general) continue;
        // A denied row is named in the result, never quietly dropped (§12-46①).
        const decision = mayWriteGeneral(general.id, wctx);
        if (!decision.allowed) {
          if (decision.denial === 'USER_LOCKED') deniedLock.push(general.name);
          else rejected.push(general.name);
          continue;
        }
        const skillNames = parts[1].split(',').map(v => v.trim()).filter(Boolean);
        const descriptions = parts.length >= 3 ? parts[2].split(',').map(v => v.trim()) : [];
        const tagCells = parts.length >= 4 ? parts[3].split(',').map(v => v.trim()) : [];
        edits[general.id] = skillNames.map((name, index) => {
          const read = parseSkillTagsCell(tagCells[index] ?? '');
          // 认不出的徽章名照旧点名，绝不静默丢（§12-76①）。
          for (const u of read.unknown) {
            console.warn(`[content] 将领 ${general.name}·${name} 的徽章我不认识，所以没记下 → ${u}`);
          }
          return {
            name,
            description: descriptions[index] || '',
            tags: read.tags.length > 0 ? read.tags : undefined,
          };
        });
        count++;
        applied.push(general.id);
      }
      persistSkillEdits(edits);
      set({ skillEdits: edits });
      return { count, rejected, deniedLock, applied };
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
          tags: tagsOf(skill),
          trigger: skill.trigger,
          effects: skill.effects,
          effectMode: skill.effectMode,
          conditions: skill.conditions,
          forced: skill.forced,
        }));
      }
      return result;
    },

    mayEditGeneral: generalId => mayWriteGeneral(generalId, writeCtx()).allowed,

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
      persistIdentityRegistry(registry.map(n => (n === oldName ? newName : n)));
      set({ identityRegistry: registry.map(n => (n === oldName ? newName : n)) });
      // Cascade: every general edit referencing the old name follows it
      // (身份改名级联, D1 保守方案的写侧). §H3: the cascade is still a write,
      // so it only follows overlays this session may own — official overlays it
      // cannot touch are left byte-identical (blocked, not rewritten).
      // v2.8.8 N2: 「覆盖」counts as a write too — a white-locked card's edit
      // is also left byte-identical rather than silently followed.
      const wctx = writeCtx();
      const nextEdits = { ...get().generalEdits };
      let touched = false;
      for (const [gid, edit] of Object.entries(nextEdits)) {
        if (edit.identity === oldName && mayWriteGeneral(gid, wctx).allowed) {
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
