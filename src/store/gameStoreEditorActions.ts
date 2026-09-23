// Editor/developer-mode slice extracted from gameStore.ts (stabilization
// stage B, D-6 first split). Behavior is a verbatim move; the store wires
// these in via `...buildEditorActions(get, set)`.
import type { General, SkillTag } from '../data/generals';
import { allGenerals } from '../data/generals';
import {
  persistSkillEdits,
  persistGeneralEdits,
  persistDisabledGenerals,
} from './editorPersistence';
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
  | 'toggleDeveloperMode'
  | 'setDeveloperMode'
  | 'updateSkillEdit'
  | 'updateGeneralEdit'
  | 'batchDeleteEdits'
  | 'toggleDisabledGeneral'
  | 'batchToggleDisabled'
  | 'importSkillEditsFromText'
  | 'getGeneralWithEdits'
> {
  return {
    toggleDeveloperMode: password => {
      if (password !== 'djxdzx000') return false;
      set({ developerMode: !get().developerMode });
      return true;
    },

    setDeveloperMode: v => set({ developerMode: v }),

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
  };
}
