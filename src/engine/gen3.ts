import { SPECIES, genderFromPid, type SpeciesName } from "./species";

export const GBA_FRAME_RATE = 16777216 / 280896;
export const FRAME_MS = 1000 / GBA_FRAME_RATE;
export const SID_SETUP_ADVANCES = 1500;

export function gbaFramesToMs(frames: number): number {
  return roundHalfToEven(frames * FRAME_MS);
}

export function eonAdvancePhaseMs(targetFrames: number, calibrationMs = 0, consoleName: ConsoleName = "Switch"): number {
  return consoleFramesToMs(targetFrames, consoleName) + calibrationMs;
}

export function eonAdvanceCalibrationMs(targetFrames: number, hitFrames: number, consoleName: ConsoleName = "Switch"): number {
  return consoleFramesToMs(targetFrames - hitFrames, consoleName);
}

export const NATURES = [
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash",
  "Calm", "Gentle", "Sassy", "Careful", "Quirky",
] as const;

export type Gender = "Male" | "Female";
export type ConsoleName = "Switch" | "Switch 2" | "Game Boy Advance" | "Game Boy Player" | "Nintendo DS" | "Nintendo 3DS";

export type SeedEntry = {
  initialSeed: number;
  seedTime: number;
};

export type GeneratedPokemon = {
  advance: number;
  pid: number;
  nature: string;
  natureIndex: number;
  gender?: Gender;
  ivs: [number, number, number, number, number, number];
  shiny: "none" | "star" | "square";
};

export type SearchTarget = GeneratedPokemon & SeedEntry & {
  seed: string;
  seedMs: number;
  consoleName: ConsoleName;
  overworldFrames: number;
  continueFrames: number;
  totalMs: number;
};

export type StatSnapshot = {
  level: number;
  stats: number[];
};

export type HitSearch = {
  seedRadius: number;
  minAdvances: number;
  maxAdvances: number;
};

export type HitResult = SearchTarget & {
  seedIndex: number;
};

export type TargetFilter = {
  shiny?: boolean;
  natures?: readonly string[];
  gender?: Gender;
  minIvs?: readonly number[];
  maxIvs?: readonly number[];
};

const SHINY_ONLY: TargetFilter = { shiny: true };

const NATURE_MODIFIERS: ReadonlyArray<ReadonlyArray<number>> = [
  [1, 1, 1, 1, 1], [1.1, .9, 1, 1, 1], [1.1, 1, 1, 1, .9], [1.1, 1, .9, 1, 1], [1.1, 1, 1, .9, 1],
  [.9, 1.1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1.1, 1, 1, .9], [1, 1.1, .9, 1, 1], [1, 1.1, 1, .9, 1],
  [.9, 1, 1, 1, 1.1], [1, .9, 1, 1, 1.1], [1, 1, 1, 1, 1], [1, 1, .9, 1, 1.1], [1, 1, 1, .9, 1.1],
  [.9, 1, 1.1, 1, 1], [1, .9, 1.1, 1, 1], [1, 1, 1.1, 1, .9], [1, 1, 1, 1, 1], [1, 1, 1.1, .9, 1],
  [.9, 1, 1, 1.1, 1], [1, .9, 1, 1.1, 1], [1, 1, 1, 1.1, .9], [1, 1, .9, 1.1, 1], [1, 1, 1, 1, 1],
];

export function nextSeed(seed: number): number {
  return (Math.imul(seed, 0x41c64e6d) + 0x6073) >>> 0;
}

export function advanceSeed(seed: number, advances: number): number {
  let current = seed >>> 0;
  for (let index = 0; index < advances; index += 1) current = nextSeed(current);
  return current;
}

export function hex(value: number, length = 4): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(length, "0");
}

const CONSOLE_TIMING: Record<ConsoleName, { frameRate: number; offsetMs: number }> = {
  "Game Boy Advance": { frameRate: GBA_FRAME_RATE, offsetMs: -260 },
  "Game Boy Player": { frameRate: GBA_FRAME_RATE, offsetMs: 200 },
  "Nintendo DS": { frameRate: 16756991 / 280896, offsetMs: 788 },
  "Nintendo 3DS": { frameRate: 16756991 / 280896, offsetMs: 1558 },
  Switch: { frameRate: GBA_FRAME_RATE, offsetMs: 0 },
  "Switch 2": { frameRate: GBA_FRAME_RATE, offsetMs: -750 },
};

export function isSwitchConsole(consoleName: ConsoleName): boolean {
  return consoleName === "Switch" || consoleName === "Switch 2";
}

function roundHalfToEven(value: number): number {
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  if (lower === upper) return lower;
  const lowerDistance = value - lower;
  const upperDistance = upper - value;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(value));
  if (Math.abs(lowerDistance - upperDistance) <= epsilon) return Math.abs(lower) % 2 === 0 ? lower : upper;
  return lowerDistance < upperDistance ? lower : upper;
}

export function consoleFramesToMs(frames: number, consoleName: ConsoleName): number {
  return roundHalfToEven((frames / CONSOLE_TIMING[consoleName].frameRate) * 1000);
}

export function seedTimeToMs(seedTime: number, consoleName: ConsoleName): number {
  const timing = CONSOLE_TIMING[consoleName];
  return Math.floor((seedTime / 16 / timing.frameRate) * 1000) + timing.offsetMs;
}

export function generateMethod1(
  stateAtAdvance: number,
  advance: number,
  trainerId: number,
  secretId: number,
  species: SpeciesName,
): GeneratedPokemon {
  let state = stateAtAdvance;
  state = nextSeed(state);
  const low = state >>> 16;
  state = nextSeed(state);
  const high = state >>> 16;
  const pid = (low | (high << 16)) >>> 0;

  state = nextSeed(state);
  const iv1 = state >>> 16;
  state = nextSeed(state);
  const iv2 = state >>> 16;
  const ivs: GeneratedPokemon["ivs"] = [
    iv1 & 31,
    (iv1 >>> 5) & 31,
    (iv1 >>> 10) & 31,
    (iv2 >>> 5) & 31,
    (iv2 >>> 10) & 31,
    iv2 & 31,
  ];

  const shinyXor = (trainerId ^ secretId ^ low ^ high) & 0xffff;
  const shiny = shinyXor === 0 ? "square" : shinyXor < 8 ? "star" : "none";
  const natureIndex = pid % 25;
  const gender = genderFromPid(species, pid);

  return {
    advance,
    pid,
    nature: NATURES[natureIndex],
    natureIndex,
    gender,
    ivs,
    shiny,
  };
}

export function calculateStats(species: SpeciesName, level: number, ivs: GeneratedPokemon["ivs"], natureIndex: number): number[] {
  const baseStats = SPECIES[species].baseStats;
  return baseStats.map((baseStat, index) => {
    const unmodified = Math.floor(((2 * baseStat + ivs[index]) * level) / 100);
    if (index === 0) return unmodified + level + 10;
    return Math.floor((unmodified + 5) * NATURE_MODIFIERS[natureIndex][index - 1]);
  });
}

export function generateSidAtAdvance(trainerId: number, advance: number): number {
  const state = advanceSeed(trainerId & 0xffff, advance);
  return nextSeed(state) >>> 16;
}

const LANGUAGE_OFFSETS: Record<string, number> = {
  English: 249,
  Japanese: 194,
  Italian: 236,
  French: 205,
  German: 208,
  Spanish: 202,
};

export function generateSidCandidates(
  trainerId: number,
  language: string,
  rivalNamed: boolean,
  count = 11,
): Array<{ advance: number; sid: number }> {
  const center = (SID_SETUP_ADVANCES + (LANGUAGE_OFFSETS[language] ?? LANGUAGE_OFFSETS.English)) * 2;
  const firstAdvance = center - 50;
  const nearbyAdvances = Array.from({ length: 101 }, (_, index) => firstAdvance + index);
  const enforceEnglishParity = language === "English";
  const wantedParity = rivalNamed ? center & 1 : (center + 1) & 1;
  const advances = nearbyAdvances
    .filter((advance) => !enforceEnglishParity || (advance & 1) === wantedParity)
    .slice(0, count);

  return advances.map((advance) => ({ advance, sid: generateSidAtAdvance(trainerId, advance) }));
}

function matchesFilter(generated: GeneratedPokemon, filter: TargetFilter): boolean {
  if (filter.shiny !== false && generated.shiny === "none") return false;
  if (filter.natures && !filter.natures.includes(generated.nature)) return false;
  if (filter.gender && generated.gender !== filter.gender) return false;
  if (filter.minIvs && generated.ivs.some((iv, index) => iv < (filter.minIvs![index] ?? 0))) return false;
  if (filter.maxIvs && generated.ivs.some((iv, index) => iv > (filter.maxIvs![index] ?? 31))) return false;
  return true;
}

export function searchTargets({
  seeds,
  targetSeedIndex,
  seedRadius,
  minAdvances,
  maxAdvances,
  overworldFrames,
  trainerId,
  secretId,
  species,
  consoleName,
  filter = SHINY_ONLY,
}: {
  seeds: SeedEntry[];
  targetSeedIndex: number;
  seedRadius: number;
  minAdvances: number;
  maxAdvances: number;
  overworldFrames: number;
  trainerId: number;
  secretId: number;
  species: SpeciesName;
  consoleName: ConsoleName;
  filter?: TargetFilter;
}): SearchTarget[] {
  const start = Math.max(0, targetSeedIndex - seedRadius);
  const end = Math.min(seeds.length - 1, targetSeedIndex + seedRadius);
  const shinyPrefilter = filter.shiny !== false;
  const results: SearchTarget[] = [];

  for (let seedIndex = start; seedIndex <= end; seedIndex += 1) {
    const seed = seeds[seedIndex];
    let state = advanceSeed(seed.initialSeed, minAdvances);
    for (let advance = minAdvances; advance <= maxAdvances; advance += 1) {
      let keep = true;
      if (shinyPrefilter) {
        let go = nextSeed(state);
        const low = go >>> 16;
        go = nextSeed(go);
        const high = go >>> 16;
        keep = ((trainerId ^ secretId ^ low ^ high) & 0xffff) < 8;
      }
      if (keep) {
        const generated = generateMethod1(state, advance, trainerId, secretId, species);
        const continueFrames = advance - overworldFrames * 2;
        if (continueFrames >= 0 && matchesFilter(generated, filter)) {
          const seedMs = seedTimeToMs(seed.seedTime, consoleName);
          results.push({
            ...generated,
            ...seed,
            seed: hex(seed.initialSeed),
            seedMs,
            consoleName,
            overworldFrames,
            continueFrames,
            totalMs: seedMs + ((continueFrames + overworldFrames) / CONSOLE_TIMING[consoleName].frameRate) * 1000,
          });
        }
      }
      state = nextSeed(state);
    }
  }

  return results.sort((a, b) => a.totalMs - b.totalMs || a.advance - b.advance);
}

function snapshotMatches(species: SpeciesName, generated: GeneratedPokemon, snapshots: StatSnapshot[]): boolean {
  return snapshots.every((snapshot) => {
    if (snapshot.stats.length !== 6 || snapshot.stats.some((stat) => !Number.isFinite(stat) || stat < 1)) return false;
    const expected = calculateStats(species, snapshot.level, generated.ivs, generated.natureIndex);
    return expected.every((stat, index) => stat === snapshot.stats[index]);
  });
}

export function searchHits({
  seeds,
  targetSeedIndex,
  target,
  search,
  trainerId,
  secretId,
  species,
  nature,
  gender,
  snapshots,
}: {
  seeds: SeedEntry[];
  targetSeedIndex: number;
  target: SearchTarget;
  search: HitSearch;
  trainerId: number;
  secretId: number;
  species: SpeciesName;
  nature: string;
  gender?: Gender;
  snapshots: StatSnapshot[];
}): HitResult[] {
  const { overworldFrames } = target;
  const startSeed = Math.max(0, targetSeedIndex - search.seedRadius);
  const endSeed = Math.min(seeds.length - 1, targetSeedIndex + search.seedRadius);
  const minAdvance = Math.max(0, search.minAdvances);
  const maxAdvance = Math.max(minAdvance, search.maxAdvances);
  const results: HitResult[] = [];

  for (let seedIndex = startSeed; seedIndex <= endSeed; seedIndex += 1) {
    const seed = seeds[seedIndex];
    let state = advanceSeed(seed.initialSeed, minAdvance);
    for (let advance = minAdvance; advance <= maxAdvance; advance += 1) {
      const generated = generateMethod1(state, advance, trainerId, secretId, species);
      if (generated.nature === nature && (!gender || generated.gender === gender) && snapshotMatches(species, generated, snapshots)) {
        const seedMs = seedTimeToMs(seed.seedTime, target.consoleName);
        const continueFrames = advance - overworldFrames * 2;
        results.push({
          ...generated,
          ...seed,
          seedIndex,
          seed: hex(seed.initialSeed),
          seedMs,
          consoleName: target.consoleName,
          overworldFrames,
          continueFrames,
          totalMs: seedMs + ((continueFrames + overworldFrames) / CONSOLE_TIMING[target.consoleName].frameRate) * 1000,
        });
      }
      state = nextSeed(state);
    }
  }

  return results.sort((a, b) => {
    const msPerFrame = 1000 / CONSOLE_TIMING[target.consoleName].frameRate;
    const aDistance = Math.abs(a.seedMs - target.seedMs) + Math.abs(a.advance - target.advance) * msPerFrame;
    const bDistance = Math.abs(b.seedMs - target.seedMs) + Math.abs(b.advance - target.advance) * msPerFrame;
    return aDistance - bDistance;
  });
}
