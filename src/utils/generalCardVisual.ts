import { allGenerals, factionColors, type Faction, type General } from '../data/generals';

/**
 * Returns the original/source faction of a general.
 */
export function getOriginalFaction(general: General): Faction {
  return allGenerals.find(g => g.id === general.id)?.faction ?? general.faction;
}

/**
 * General card visual:
 * - Normal cards keep the existing single faction face.
 * - Cross-faction cards only split the OUTER BORDER vertically.
 * - The card face/background remains unchanged.
 */
export function getGeneralCardVisual(
  general: General,
  ownerFaction: Faction | null | undefined,
  inner: string | null | undefined = 'rgba(0,0,0,0.40)'
) {
  const face = inner ?? 'rgba(0,0,0,0.40)';
  const effectiveFaction = general.faction;
  const sourceFaction = getOriginalFaction(general);
  const lowerFaction = effectiveFaction !== sourceFaction ? effectiveFaction : sourceFaction;
  const generalColor = factionColors[lowerFaction] ?? '#d97706';

  if (!ownerFaction || ownerFaction === lowerFaction) {
    return {
      borderColor: `${generalColor}66`,
      background: `linear-gradient(180deg, ${generalColor}18 0%, ${face} 100%)`,
    };
  }

  const ownerColor = factionColors[ownerFaction] ?? '#d97706';
  const faceBackground = `linear-gradient(180deg, ${generalColor}18 0%, ${face} 100%)`;

  return {
    border: '2px solid',
    borderColor: 'transparent',
    borderImage: `linear-gradient(180deg, ${ownerColor} 0%, ${ownerColor} 50%, ${generalColor} 50%, ${generalColor} 100%) 1`,
    background: faceBackground,
  };
}
