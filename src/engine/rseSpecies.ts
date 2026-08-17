import {
  MON_FEMALE,
  MON_GENDERLESS,
  MON_MALE,
  PERCENT_FEMALE_12_5,
  PERCENT_FEMALE_50,
  type SpeciesData,
} from "./species";

export type RseSpeciesName =
  | "Treecko" | "Torchic" | "Mudkip"
  | "Groudon" | "Kyogre" | "Rayquaza"
  | "Regirock" | "Regice" | "Registeel"
  | "Latias" | "Latios"
  | "Castform" | "Beldum"
  | "Lileep" | "Anorith"
  | "Kecleon" | "Voltorb" | "Electrode" | "Sudowoodo";

export const RSE_SPECIES: Record<RseSpeciesName, SpeciesData> = {
  Treecko: { baseStats: [40, 45, 35, 65, 55, 70], genderRatio: PERCENT_FEMALE_12_5 },
  Torchic: { baseStats: [45, 60, 40, 70, 50, 45], genderRatio: PERCENT_FEMALE_12_5 },
  Mudkip: { baseStats: [50, 70, 50, 50, 50, 40], genderRatio: PERCENT_FEMALE_12_5 },

  Groudon: { baseStats: [100, 150, 140, 100, 90, 90], genderRatio: MON_GENDERLESS },
  Kyogre: { baseStats: [100, 100, 90, 150, 140, 90], genderRatio: MON_GENDERLESS },
  Rayquaza: { baseStats: [105, 150, 90, 150, 90, 95], genderRatio: MON_GENDERLESS },

  Regirock: { baseStats: [80, 100, 200, 50, 100, 50], genderRatio: MON_GENDERLESS },
  Regice: { baseStats: [80, 50, 100, 100, 200, 50], genderRatio: MON_GENDERLESS },
  Registeel: { baseStats: [80, 75, 150, 75, 150, 50], genderRatio: MON_GENDERLESS },

  Latias: { baseStats: [80, 80, 90, 110, 130, 110], genderRatio: MON_FEMALE },
  Latios: { baseStats: [80, 90, 80, 130, 110, 110], genderRatio: MON_MALE },

  Castform: { baseStats: [70, 70, 70, 70, 70, 70], genderRatio: PERCENT_FEMALE_50 },
  Beldum: { baseStats: [40, 55, 80, 35, 60, 30], genderRatio: MON_GENDERLESS },

  Lileep: { baseStats: [66, 41, 77, 61, 87, 23], genderRatio: PERCENT_FEMALE_12_5 },
  Anorith: { baseStats: [45, 95, 50, 40, 50, 75], genderRatio: PERCENT_FEMALE_12_5 },

  Kecleon: { baseStats: [60, 90, 70, 60, 120, 40], genderRatio: PERCENT_FEMALE_50 },
  Voltorb: { baseStats: [40, 30, 50, 55, 55, 100], genderRatio: MON_GENDERLESS },
  Electrode: { baseStats: [60, 50, 70, 80, 80, 140], genderRatio: MON_GENDERLESS },
  Sudowoodo: { baseStats: [70, 100, 115, 30, 65, 30], genderRatio: PERCENT_FEMALE_50 },
};

export function isRseGenderless(species: RseSpeciesName): boolean {
  return RSE_SPECIES[species].genderRatio === MON_GENDERLESS;
}

export function rseGenderFromPid(species: RseSpeciesName, pid: number): "Male" | "Female" | undefined {
  const ratio = RSE_SPECIES[species].genderRatio;
  if (ratio === MON_GENDERLESS) return undefined;
  if (ratio === MON_MALE) return "Male";
  if (ratio === MON_FEMALE) return "Female";
  return ratio > (pid & 0xff) ? "Female" : "Male";
}

function natureMultipliers(natureIndex: number): [number, number, number, number, number] {
  const statIndex = [1, 2, 5, 3, 4];
  const raised = statIndex[Math.floor(natureIndex / 5)];
  const lowered = statIndex[natureIndex % 5];
  const multipliers: [number, number, number, number, number] = [1, 1, 1, 1, 1];
  if (raised === lowered) return multipliers;
  multipliers[raised - 1] = 1.1;
  multipliers[lowered - 1] = 0.9;
  return multipliers;
}

export function calculateRseStats(
  species: RseSpeciesName,
  level: number,
  ivs: readonly number[],
  natureIndex: number,
): number[] {
  const baseStats = RSE_SPECIES[species].baseStats;
  const multipliers = natureMultipliers(natureIndex);
  return baseStats.map((baseStat, index) => {
    const unmodified = Math.floor(((2 * baseStat + (ivs[index] ?? 0)) * level) / 100);
    if (index === 0) return unmodified + level + 10;
    return Math.floor((unmodified + 5) * multipliers[index - 1]);
  });
}
