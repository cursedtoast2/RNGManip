export type SpeciesName =
  | "Bulbasaur" | "Charmander" | "Squirtle"
  | "Abra" | "Clefairy" | "Scyther" | "Pinsir" | "Dratini" | "Porygon"
  | "Hypno" | "Electrode" | "Hitmonlee" | "Hitmonchan" | "Eevee" | "Lapras"
  | "Magikarp" | "Omanyte" | "Kabuto" | "Aerodactyl" | "Snorlax"
  | "Articuno" | "Zapdos" | "Moltres" | "Mewtwo";

export type BaseStats = [number, number, number, number, number, number];

export const MON_MALE = 0x00;
export const MON_FEMALE = 0xfe;
export const MON_GENDERLESS = 0xff;

export const PERCENT_FEMALE_12_5 = 31;
export const PERCENT_FEMALE_25 = 63;
export const PERCENT_FEMALE_50 = 127;
export const PERCENT_FEMALE_75 = 191;

export type SpeciesData = {
  baseStats: BaseStats;
  genderRatio: number;
};

export const SPECIES: Record<SpeciesName, SpeciesData> = {
  Bulbasaur: { baseStats: [45, 49, 49, 65, 65, 45], genderRatio: PERCENT_FEMALE_12_5 },
  Charmander: { baseStats: [39, 52, 43, 60, 50, 65], genderRatio: PERCENT_FEMALE_12_5 },
  Squirtle: { baseStats: [44, 48, 65, 50, 64, 43], genderRatio: PERCENT_FEMALE_12_5 },
  Abra: { baseStats: [25, 20, 15, 105, 55, 90], genderRatio: PERCENT_FEMALE_25 },
  Clefairy: { baseStats: [70, 45, 48, 60, 65, 35], genderRatio: PERCENT_FEMALE_75 },
  Scyther: { baseStats: [70, 110, 80, 55, 80, 105], genderRatio: PERCENT_FEMALE_50 },
  Pinsir: { baseStats: [65, 125, 100, 55, 70, 85], genderRatio: PERCENT_FEMALE_50 },
  Dratini: { baseStats: [41, 64, 45, 50, 50, 50], genderRatio: PERCENT_FEMALE_50 },
  Porygon: { baseStats: [65, 60, 70, 85, 75, 40], genderRatio: MON_GENDERLESS },
  Hypno: { baseStats: [85, 73, 70, 73, 115, 67], genderRatio: PERCENT_FEMALE_50 },
  Electrode: { baseStats: [60, 50, 70, 80, 80, 140], genderRatio: MON_GENDERLESS },
  Hitmonlee: { baseStats: [50, 120, 53, 35, 110, 87], genderRatio: MON_MALE },
  Hitmonchan: { baseStats: [50, 105, 79, 35, 110, 76], genderRatio: MON_MALE },
  Eevee: { baseStats: [55, 55, 50, 45, 65, 55], genderRatio: PERCENT_FEMALE_12_5 },
  Lapras: { baseStats: [130, 85, 80, 85, 95, 60], genderRatio: PERCENT_FEMALE_50 },
  Magikarp: { baseStats: [20, 10, 55, 15, 20, 80], genderRatio: PERCENT_FEMALE_50 },
  Omanyte: { baseStats: [35, 40, 100, 90, 55, 35], genderRatio: PERCENT_FEMALE_12_5 },
  Kabuto: { baseStats: [30, 80, 90, 55, 45, 55], genderRatio: PERCENT_FEMALE_12_5 },
  Aerodactyl: { baseStats: [80, 105, 65, 60, 75, 130], genderRatio: PERCENT_FEMALE_12_5 },
  Snorlax: { baseStats: [160, 110, 65, 65, 110, 30], genderRatio: PERCENT_FEMALE_12_5 },
  Articuno: { baseStats: [90, 85, 100, 95, 125, 85], genderRatio: MON_GENDERLESS },
  Zapdos: { baseStats: [90, 90, 85, 125, 90, 100], genderRatio: MON_GENDERLESS },
  Moltres: { baseStats: [90, 100, 90, 125, 85, 90], genderRatio: MON_GENDERLESS },
  Mewtwo: { baseStats: [106, 110, 90, 154, 90, 130], genderRatio: MON_GENDERLESS },
};

export function isGenderless(species: SpeciesName): boolean {
  return SPECIES[species].genderRatio === MON_GENDERLESS;
}

export function genderFromPid(species: SpeciesName, pid: number): "Male" | "Female" | undefined {
  const ratio = SPECIES[species].genderRatio;
  if (ratio === MON_GENDERLESS) return undefined;
  if (ratio === MON_MALE) return "Male";
  if (ratio === MON_FEMALE) return "Female";
  return ratio > (pid & 0xff) ? "Female" : "Male";
}
