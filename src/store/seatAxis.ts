/**
 * 联机时「这一屏能不能动手」该拿哪一根轴去比席位（2026-11-13 同网真机卡点）。
 *
 * 现场故障：征召阶段房主屏底部写着「这一席是别人的，等他在自己电脑上选」且按钮灰着，
 * 房主自己那一席也点不了将，整局卡在征召。根因＝`App.tsx` 的席位闸一律用
 * `currentPlayerIndex`（出牌席）去比 `viewSeat`，而征召的轮次另有一根轴
 * `draftPlayerIndex`（挑将席）：`confirmDraft()` 只在**全部挑完、进抽卡**时才把
 * 出牌席归零（gameStore.ts:402），挑将期间它一直是 0。骰子又把 `players` 按点数
 * 重排过，于是 `players[0]` 可能不是房主 ⇒ 房主被自己的「不许替别人点」闸锁死。
 *
 * 这一格只回答「当前阶段该用哪个下标」，不判合法性、不碰席位表、不改结算：
 * 抽卡与牌桌两段仍用出牌席，行为一字不变。
 */
export type SeatPlayer = { id: number | string };

export function activeSeatForStage(
  phase: string,
  players: readonly SeatPlayer[],
  turnIndex: number,
  draftIndex: number,
): number | null {
  const index = phase === 'generalDraft' ? draftIndex : turnIndex;
  const player = players[index];
  return player ? Number(player.id) : null;
}
