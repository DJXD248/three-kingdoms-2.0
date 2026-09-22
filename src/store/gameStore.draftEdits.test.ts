/**
 * Draft-time editor-merge regression (2.2.x bug fix).
 *
 * Bug found during the browser E2E regression (checklist item ⑦):
 * a DIY "援军" (DRAW_CARD at 回合开始时) skill configured in the SkillEditor
 * was saved and displayed correctly, but never fired in a live game —
 * confirmDraft cloned the RAW general, so the drafted runtime card carried
 * no skill edits and syncPlayerSkills had nothing to compile.
 *
 * These tests pin the fix: drafted cards must carry the editor-merged
 * definition (skillEdits + generalEdits) and the canonical compiler must
 * then produce a real onTurnStart DRAW_CARD definition from it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from './gameStore';
import type { Player } from './gameStore';
import type { General } from '../data/generals';
import { compileGeneralSkills } from '../skills/skillCompiler';

const EDITED_GENERAL: General = {
  id: 'wu_003',
  name: '吕蒙',
  faction: '吴',
  hp: 4,
  type: '武将',
  meleeAtk: 2,
  rangedAtk: 1,
  armor: 0,
  skills: [{ name: '克己' }], // raw data: description-only, never executable
};

const YUANJUN_EDIT = {
  name: '援军',
  description: '回合开始时，摸一张牌',
  effectMode: 'all' as const,
  forced: true,
  effects: [{
    id: 'e1',
    label: '效果1',
    description: '回合开始时，摸一张牌',
    trigger: { type: 'onTurnStart' as const, turnSubType: 'selfTurn' as const },
    runtime: { type: 'DRAW_CARD' as const, value: 1, target: 'SELF' as const },
  }],
};

function twoPlayerDraftState() {
  const players = [
    { id: 1, name: '玩家1', faction: '吴', seatOrder: 0 },
    { id: 2, name: '玩家2', faction: '蜀', seatOrder: 1 },
  ] as unknown as Player[];
  return { players };
}

describe('gameStore.confirmDraft: drafted cards absorb editor edits', () => {
  beforeEach(() => {
    useGameStore.setState({ skillEdits: {}, generalEdits: {} });
  });

  it('applies skillEdits to the drafted runtime card so the compiler emits a DRAW_CARD definition', () => {
    useGameStore.setState({
      ...twoPlayerDraftState(),
      draftPlayerIndex: 0,
      selectedDraftGenerals: [EDITED_GENERAL],
      skillEdits: { [EDITED_GENERAL.id]: [{ name: '克己' }, YUANJUN_EDIT] },
    } as Partial<ReturnType<typeof useGameStore.getState>>);

    useGameStore.getState().confirmDraft();

    const pool = useGameStore.getState().players[0].generalPool;
    expect(pool).toHaveLength(1);
    const drafted = pool[0];

    // Runtime identity is still minted per physical card.
    const instanceId = (drafted as { instanceId?: string }).instanceId;
    expect(instanceId).toBeTruthy();
    expect(instanceId).not.toBe(drafted.id);

    // The DIY skill reached the runtime card as structured data.
    const yuanjun = drafted.skills.find(s => s.name === '援军');
    expect(yuanjun).toBeTruthy();
    expect(yuanjun?.effects?.[0]?.runtime).toEqual({ type: 'DRAW_CARD', value: 1, target: 'SELF' });

    // And the canonical compiler can execute it (trigger present → definition).
    const compiled = compileGeneralSkills(drafted, instanceId);
    const drawDef = compiled.definitions.find(
      d => d.trigger === 'onTurnStart' && d.effects[0]?.type === 'DRAW_CARD',
    );
    expect(drawDef).toBeTruthy();
    expect(drawDef?.effects[0]?.value).toBe(1);
  });

  it('applies generalEdits (stat/name changes) to the drafted card too', () => {
    useGameStore.setState({
      ...twoPlayerDraftState(),
      draftPlayerIndex: 0,
      selectedDraftGenerals: [EDITED_GENERAL],
      generalEdits: { [EDITED_GENERAL.id]: { name: '吕蒙改', hp: 5 } },
    } as Partial<ReturnType<typeof useGameStore.getState>>);

    useGameStore.getState().confirmDraft();

    const drafted = useGameStore.getState().players[0].generalPool[0];
    expect(drafted.name).toBe('吕蒙改');
    expect(drafted.hp).toBe(5);
    expect(drafted.type).toBe('武将');
  });

  it('without edits the drafted card keeps its raw definition untouched', () => {
    useGameStore.setState({
      ...twoPlayerDraftState(),
      draftPlayerIndex: 0,
      selectedDraftGenerals: [EDITED_GENERAL],
    } as Partial<ReturnType<typeof useGameStore.getState>>);

    useGameStore.getState().confirmDraft();

    const drafted = useGameStore.getState().players[0].generalPool[0];
    expect(drafted.skills).toEqual([{ name: '克己' }]);
    // Description-only skills must NOT silently become executable.
    const compiled = compileGeneralSkills(drafted, (drafted as { instanceId?: string }).instanceId);
    expect(compiled.definitions).toHaveLength(0);
    expect(compiled.skipped.some(s => s.reason === 'NO_RUNTIME_PAYLOAD')).toBe(true);
  });
});
