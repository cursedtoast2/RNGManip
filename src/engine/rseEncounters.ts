import type { EncounterTrigger } from "./encounters";
import type { RseVersion } from "./rse";
import type { RseSpeciesName } from "./rseSpecies";

export type { RseVersion };

export type RseEncounterGroup = "Starters" | "Legendaries" | "Stationary" | "Gifts" | "Fossils";

export type RseEncounter = {
  id: string;
  species: RseSpeciesName;
  level: number;
  group: RseEncounterGroup;
  location: string;
  versions: readonly RseVersion[];
  trigger: EncounterTrigger;
  frameOffset: number;
  calibrationRadiusFrames?: number;

  note?: string;
};

const NARROW_CALIBRATION = 100;
const WIDE_CALIBRATION = 300;

export function rseEncounterCalibrationRadius(encounter: RseEncounter): number {
  return encounter.calibrationRadiusFrames ?? (encounter.trigger === "a-press" ? NARROW_CALIBRATION : WIDE_CALIBRATION);
}

const ALL: readonly RseVersion[] = ["Ruby", "Sapphire", "Emerald"];
const RUBY: readonly RseVersion[] = ["Ruby"];
const SAPPHIRE: readonly RseVersion[] = ["Sapphire"];
const EMERALD: readonly RseVersion[] = ["Emerald"];

export const RSE_ENCOUNTER_GROUPS: readonly RseEncounterGroup[] = [
  "Starters", "Legendaries", "Stationary", "Gifts", "Fossils",
];

export const RSE_ENCOUNTERS: readonly RseEncounter[] = [

  { id: "rse-starter-treecko", species: "Treecko", level: 5, group: "Starters", location: "Route 101 (Prof. Birch's bag)", versions: ALL, trigger: "confirm-prompt", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },
  { id: "rse-starter-torchic", species: "Torchic", level: 5, group: "Starters", location: "Route 101 (Prof. Birch's bag)", versions: ALL, trigger: "confirm-prompt", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },
  { id: "rse-starter-mudkip", species: "Mudkip", level: 5, group: "Starters", location: "Route 101 (Prof. Birch's bag)", versions: ALL, trigger: "confirm-prompt", frameOffset: 0, calibrationRadiusFrames: NARROW_CALIBRATION },

  { id: "rse-groudon-cave-of-origin", species: "Groudon", level: 45, group: "Legendaries", location: "Cave of Origin B4F", versions: RUBY, trigger: "a-press", frameOffset: 0 },
  { id: "rse-kyogre-cave-of-origin", species: "Kyogre", level: 45, group: "Legendaries", location: "Cave of Origin B4F", versions: SAPPHIRE, trigger: "a-press", frameOffset: 0 },
  { id: "rse-groudon-terra-cave", species: "Groudon", level: 70, group: "Legendaries", location: "Terra Cave (post-game)", versions: EMERALD, trigger: "a-press", frameOffset: 0, note: "Terra Cave relocates between Routes 114/115/116/118 each time the weather shifts." },
  { id: "rse-kyogre-marine-cave", species: "Kyogre", level: 70, group: "Legendaries", location: "Marine Cave (post-game)", versions: EMERALD, trigger: "a-press", frameOffset: 0, note: "Marine Cave relocates between Routes 105/125/127/129 each time the weather shifts." },
  { id: "rse-rayquaza-sky-pillar", species: "Rayquaza", level: 70, group: "Legendaries", location: "Sky Pillar summit", versions: ALL, trigger: "a-press", frameOffset: 0, note: "Reachable during the main story in Emerald, and after the Hall of Fame in Ruby and Sapphire." },

  { id: "rse-regirock", species: "Regirock", level: 40, group: "Legendaries", location: "Desert Ruins (Route 111)", versions: ALL, trigger: "a-press", frameOffset: 0 },
  { id: "rse-regice", species: "Regice", level: 40, group: "Legendaries", location: "Island Cave (Route 105)", versions: ALL, trigger: "a-press", frameOffset: 0 },
  { id: "rse-registeel", species: "Registeel", level: 40, group: "Legendaries", location: "Ancient Tomb (Route 120)", versions: ALL, trigger: "a-press", frameOffset: 0 },

  { id: "rse-latias-southern-island", species: "Latias", level: 50, group: "Legendaries", location: "Southern Island (Eon Ticket)", versions: ["Ruby", "Emerald"], trigger: "a-press", frameOffset: 0, note: "Eon Ticket event item. In Emerald this Latias appears only if Latios is your roamer." },
  { id: "rse-latios-southern-island", species: "Latios", level: 50, group: "Legendaries", location: "Southern Island (Eon Ticket)", versions: ["Sapphire", "Emerald"], trigger: "a-press", frameOffset: 0, note: "Eon Ticket event item. In Emerald this Latios appears only if Latias is your roamer." },

  { id: "rse-voltorb-new-mauville", species: "Voltorb", level: 25, group: "Stationary", location: "New Mauville (fake item balls)", versions: ALL, trigger: "a-press", frameOffset: 0, note: "Three identical Voltorb disguised as items." },
  { id: "rse-electrode-magma-hideout", species: "Electrode", level: 30, group: "Stationary", location: "Team Magma Hideout, Lilycove (Maxie's room)", versions: RUBY, trigger: "a-press", frameOffset: 0, note: "Two identical Electrode disguised as items." },
  { id: "rse-electrode-aqua-hideout", species: "Electrode", level: 30, group: "Stationary", location: "Team Aqua Hideout, Lilycove (Archie's room)", versions: ["Sapphire", "Emerald"], trigger: "a-press", frameOffset: 0, note: "Two identical Electrode disguised as items." },
  { id: "rse-kecleon-route-119", species: "Kecleon", level: 30, group: "Stationary", location: "Route 119 (Devon Scope)", versions: ALL, trigger: "a-press", frameOffset: 0, note: "Two invisible Kecleon on this route." },
  { id: "rse-kecleon-route-120", species: "Kecleon", level: 30, group: "Stationary", location: "Route 120 (Devon Scope)", versions: ALL, trigger: "a-press", frameOffset: 0, note: "Five invisible Kecleon, plus the mandatory story Kecleon blocking the bridge." },
  { id: "rse-sudowoodo-battle-frontier", species: "Sudowoodo", level: 40, group: "Stationary", location: "Battle Frontier, southeast (Wailmer Pail)", versions: EMERALD, trigger: "confirm-prompt", frameOffset: 0, note: "Triggered by using the Wailmer Pail from the bag." },

  { id: "rse-castform-weather-institute", species: "Castform", level: 25, group: "Gifts", location: "Weather Institute (Route 119)", versions: ALL, trigger: "dialogue", frameOffset: 0 },
  { id: "rse-beldum-stevens-house", species: "Beldum", level: 5, group: "Gifts", location: "Steven's house, Mossdeep City", versions: ALL, trigger: "a-press", frameOffset: 0, note: "Taken from the Poké Ball on the table after entering the Hall of Fame." },

  { id: "rse-fossil-lileep", species: "Lileep", level: 20, group: "Fossils", location: "Devon Corporation 2F, Rustboro City (Root Fossil)", versions: ALL, trigger: "dialogue", frameOffset: 0, note: "Only one fossil is revived per playthrough; in Emerald the other turns up later in the Desert Underpass." },
  { id: "rse-fossil-anorith", species: "Anorith", level: 20, group: "Fossils", location: "Devon Corporation 2F, Rustboro City (Claw Fossil)", versions: ALL, trigger: "dialogue", frameOffset: 0, note: "Only one fossil is revived per playthrough; in Emerald the other turns up later in the Desert Underpass." },
];

export function rseEncountersForVersion(version: RseVersion): RseEncounter[] {
  return RSE_ENCOUNTERS.filter((encounter) => encounter.versions.includes(version));
}

export function rseEncounterById(id: string): RseEncounter | undefined {
  return RSE_ENCOUNTERS.find((encounter) => encounter.id === id);
}

export function groupedRseEncounters(version: RseVersion): Array<{ group: RseEncounterGroup; encounters: RseEncounter[] }> {
  const available = rseEncountersForVersion(version);
  return RSE_ENCOUNTER_GROUPS
    .map((group) => ({ group, encounters: available.filter((encounter) => encounter.group === group) }))
    .filter((entry) => entry.encounters.length > 0);
}
