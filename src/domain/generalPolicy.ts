/**
 * v2.8.6 地基刀2 — the ONE 「这张卡现在能不能被改」 judgement (§H3).
 *
 * Three enforcement layers share this single root and nothing else:
 *   ① 录入面 (editor / Excel / text import)  → asks before offering the write
 *   ② store mutation actions                 → refuses the write, reports why
 *   ③ assembly (pool build, merge, disable)  → stops applying + marks blocked
 * A policy duplicated per layer is a policy that drifts per layer (§H3 取证:
 * today only the UI gated, so calling the store directly rewrote official cards).
 *
 * What counts as official here = the repository ledger (legacy-shaped ids such
 * as `wei_001`), i.e. `isRepositoryOfficial`. A local record in the `G-`/`D-`
 * namespaces is the machine's own content and stays editable even outside
 * developer mode — an official LOCAL DRAFT (§H2) still needs human review to
 * reach the ledger, not a permission flag to keep existing.
 */
import { isAuthoredId } from './generalProvenance';

export type GeneralPolicyContext = { developerMode: boolean };

/**
 * v2.8.8 N2 (§H8): the WRITE side carries one more computation on top of §H3 —
 * the user's own manual lock (白锁). The two systems are computed INDEPENDENTLY
 * and only the write gate combines them, stricter-wins. The assembly view
 * (`GeneralPolicyContext`, used by layer ③) deliberately does NOT read locks:
 * a locked card's existing content keeps applying; the lock only stops future
 * writes (编辑/删除/覆盖). A lock that deactivated content would be inventing
 * gameplay, which §H8 forbids.
 */
export type GeneralWriteContext = GeneralPolicyContext & { lockedIds: ReadonlySet<string> };

export type EditDenial = 'OFFICIAL_READ_ONLY' | 'USER_LOCKED';

export type EditDecision = { allowed: true } | { allowed: false; denial: EditDenial };

/** The single root predicate (§H3, system layer only). Unknown/legacy id shapes fall to the STRICTER side. */
export function mayModifyGeneral(id: string, ctx: GeneralPolicyContext): EditDecision {
  if (isAuthoredId(id)) return { allowed: true };
  return ctx.developerMode ? { allowed: true } : { allowed: false, denial: 'OFFICIAL_READ_ONLY' };
}

/** §H3 + §N2 combined — THE write gate. Check order is stricter-agnostic: either denial blocks. */
export function mayWriteGeneral(id: string, ctx: GeneralWriteContext): EditDecision {
  const system = mayModifyGeneral(id, ctx);
  if (!system.allowed) return system;
  if (ctx.lockedIds.has(id)) return { allowed: false, denial: 'USER_LOCKED' };
  return { allowed: true };
}

/**
 * §H8 N2: can this session toggle the manual (white) lock on this card?
 * Non-developers face repository officials with an unlockable-by-nobody gold
 * lock — the visualization of §H3, never a second transition path, so they
 * cannot even add a white lock there. Everything else (own DIY, or any card
 * while in developer mode) toggles freely.
 */
export function mayToggleGeneralLock(id: string, ctx: GeneralPolicyContext): EditDecision {
  return mayModifyGeneral(id, ctx);
}

export function isReadOnlyGeneral(id: string, ctx: GeneralPolicyContext): boolean {
  return !mayModifyGeneral(id, ctx).allowed;
}

const DENIAL_TEXT: Record<EditDenial, string> = {
  OFFICIAL_READ_ONLY: '官方将领在开发者模式外只读：改动不会被记录，也不会生效',
  USER_LOCKED: '这张卡已被你手动锁定（白锁）：编辑/删除/覆盖都不会被记录，直到你解锁',
};

/** Plain-language reason for a denial — every layer reports, none swallows. */
export function denialMessage(denial: EditDenial): string {
  return DENIAL_TEXT[denial];
}

/** Which save-file a blocked overlay came from (the report names them apart). */
export type OverlayKind = 'skillEdits' | 'generalEdits' | 'disabled';

export type BlockedOverlay = { id: string; kind: OverlayKind };

/** Object-keyed saves (`skillEdits`, `generalEdits`). */
export function partitionEditMap<T>(
  edits: Record<string, T>,
  kind: OverlayKind,
  ctx: GeneralPolicyContext,
): { permitted: Record<string, T>; blocked: BlockedOverlay[] } {
  const permitted: Record<string, T> = {};
  const blocked: BlockedOverlay[] = [];
  for (const [id, value] of Object.entries(edits)) {
    if (mayModifyGeneral(id, ctx).allowed) permitted[id] = value;
    else blocked.push({ id, kind });
  }
  return { permitted, blocked };
}

/** Set-keyed save (`disabledGenerals`). */
export function partitionIdSet(
  ids: Iterable<string>,
  kind: OverlayKind,
  ctx: GeneralPolicyContext,
): { permitted: Set<string>; blocked: BlockedOverlay[] } {
  const permitted = new Set<string>();
  const blocked: BlockedOverlay[] = [];
  for (const id of ids) {
    if (mayModifyGeneral(id, ctx).allowed) permitted.add(id);
    else blocked.push({ id, kind });
  }
  return { permitted, blocked };
}
