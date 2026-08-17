import type { SpeciesName } from "./species";

export type GameVersion = "FireRed" | "LeafGreen";

export type EncounterGroup = "Starters" | "Legendaries" | "Stationary" | "Gifts" | "Fossils" | "Game Corner";

export type EncounterTrigger = "a-press" | "dialogue" | "confirm-prompt";

export type Encounter = {
  id: string;
  species: SpeciesName;
  level: number;
  group: EncounterGroup;
  location: string;
  versions: readonly GameVersion[];
  trigger: EncounterTrigger;
  frameOffset: number;
  calibrationRadiusFrames?: number;
};

const NARROW_CALIBRATION = 100;
const WIDE_CALIBRATION = 300;

export function encounterCalibrationRadius(encounter: Encounter): number {
  return encounter.calibrationRadiusFrames ?? (encounter.trigger === "a-press" ? NARROW_CALIBRATION : WIDE_CALIBRATION);
}

const BOTH: readonly GameVersion[] = ["FireRed", "LeafGreen"];

export const ENCOUNTER_GROUPS: readonly EncounterGroup[] = [
  "Starters", "Legendaries", "Stationary", "Gifts", "Fossils", "Game Corner",
];

export const ENCOUNTERS: readonly Encounter[] = [
  { id: "starter-bulbasaur", species: "Bulbasaur", level: 5, group: "Starters", location: "Oak's Lab", versions: BOTH, trigger: "dialogue", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },
  { id: "starter-charmander", species: "Charmander", level: 5, group: "Starters", location: "Oak's Lab", versions: BOTH, trigger: "dialogue", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },
  { id: "starter-squirtle", species: "Squirtle", level: 5, group: "Starters", location: "Oak's Lab", versions: BOTH, trigger: "dialogue", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },

  { id: "mewtwo", species: "Mewtwo", level: 70, group: "Legendaries", location: "Cerulean Cave B1F", versions: BOTH, trigger: "a-press", frameOffset: 0 },
  { id: "articuno", species: "Articuno", level: 50, group: "Legendaries", location: "Seafoam Islands B4F", versions: BOTH, trigger: "a-press", frameOffset: 0 },
  { id: "zapdos", species: "Zapdos", level: 50, group: "Legendaries", location: "Power Plant", versions: BOTH, trigger: "a-press", frameOffset: 0 },
  { id: "moltres", species: "Moltres", level: 50, group: "Legendaries", location: "Mt. Ember summit", versions: BOTH, trigger: "a-press", frameOffset: 0 },

  { id: "snorlax-route-12", species: "Snorlax", level: 30, group: "Stationary", location: "Route 12", versions: BOTH, trigger: "dialogue", frameOffset: 0 },
  { id: "snorlax-route-16", species: "Snorlax", level: 30, group: "Stationary", location: "Route 16", versions: BOTH, trigger: "dialogue", frameOffset: 0 },
  { id: "electrode-power-plant", species: "Electrode", level: 34, group: "Stationary", location: "Power Plant (either Electrode)", versions: BOTH, trigger: "a-press", frameOffset: 0 },
  { id: "hypno-berry-forest", species: "Hypno", level: 30, group: "Stationary", location: "Berry Forest (Three Island)", versions: BOTH, trigger: "dialogue", frameOffset: 0 },

  { id: "eevee", species: "Eevee", level: 25, group: "Gifts", location: "Celadon Condominiums roof room", versions: BOTH, trigger: "a-press", frameOffset: 0 },
  { id: "lapras", species: "Lapras", level: 25, group: "Gifts", location: "Silph Co. 7F", versions: BOTH, trigger: "dialogue", frameOffset: 0 },
  { id: "hitmonlee", species: "Hitmonlee", level: 25, group: "Gifts", location: "Saffron Fighting Dojo", versions: BOTH, trigger: "confirm-prompt", frameOffset: 0 },
  { id: "hitmonchan", species: "Hitmonchan", level: 25, group: "Gifts", location: "Saffron Fighting Dojo", versions: BOTH, trigger: "confirm-prompt", frameOffset: 0 },
  { id: "magikarp", species: "Magikarp", level: 5, group: "Gifts", location: "Route 4 Pokémon Center salesman", versions: BOTH, trigger: "confirm-prompt", frameOffset: 0 },

  { id: "fossil-omanyte", species: "Omanyte", level: 5, group: "Fossils", location: "Cinnabar Pokémon Lab (Helix Fossil)", versions: BOTH, trigger: "dialogue", frameOffset: 0 },
  { id: "fossil-kabuto", species: "Kabuto", level: 5, group: "Fossils", location: "Cinnabar Pokémon Lab (Dome Fossil)", versions: BOTH, trigger: "dialogue", frameOffset: 0 },
  { id: "fossil-aerodactyl", species: "Aerodactyl", level: 5, group: "Fossils", location: "Cinnabar Pokémon Lab (Old Amber)", versions: BOTH, trigger: "dialogue", frameOffset: 0 },

  { id: "game-corner-abra-fr", species: "Abra", level: 9, group: "Game Corner", location: "Celadon Game Corner prize room (180 coins)", versions: ["FireRed"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-abra-lg", species: "Abra", level: 7, group: "Game Corner", location: "Celadon Game Corner prize room (120 coins)", versions: ["LeafGreen"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-clefairy-fr", species: "Clefairy", level: 8, group: "Game Corner", location: "Celadon Game Corner prize room (500 coins)", versions: ["FireRed"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-clefairy-lg", species: "Clefairy", level: 12, group: "Game Corner", location: "Celadon Game Corner prize room (750 coins)", versions: ["LeafGreen"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-dratini-fr", species: "Dratini", level: 18, group: "Game Corner", location: "Celadon Game Corner prize room (2,800 coins)", versions: ["FireRed"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-dratini-lg", species: "Dratini", level: 24, group: "Game Corner", location: "Celadon Game Corner prize room (4,600 coins)", versions: ["LeafGreen"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-scyther", species: "Scyther", level: 25, group: "Game Corner", location: "Celadon Game Corner prize room (5,500 coins)", versions: ["FireRed"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-pinsir", species: "Pinsir", level: 18, group: "Game Corner", location: "Celadon Game Corner prize room (2,500 coins)", versions: ["LeafGreen"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-porygon-fr", species: "Porygon", level: 26, group: "Game Corner", location: "Celadon Game Corner prize room (9,999 coins)", versions: ["FireRed"], trigger: "confirm-prompt", frameOffset: 0 },
  { id: "game-corner-porygon-lg", species: "Porygon", level: 18, group: "Game Corner", location: "Celadon Game Corner prize room (6,500 coins)", versions: ["LeafGreen"], trigger: "confirm-prompt", frameOffset: 0 },
];

export function encountersForVersion(version: GameVersion): Encounter[] {
  return ENCOUNTERS.filter((encounter) => encounter.versions.includes(version));
}

export function encounterById(id: string): Encounter | undefined {
  return ENCOUNTERS.find((encounter) => encounter.id === id);
}

export function groupedEncounters(version: GameVersion): Array<{ group: EncounterGroup; encounters: Encounter[] }> {
  return ENCOUNTER_GROUPS
    .map((group) => ({ group, encounters: encountersForVersion(version).filter((encounter) => encounter.group === group) }))
    .filter((entry) => entry.encounters.length > 0);
}
