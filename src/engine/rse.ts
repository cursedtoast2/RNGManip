import {
  advanceSeed,
  consoleFramesToMs,
  generateMethod1,
  hex,
  nextSeed,
  type ConsoleName,
  type GeneratedPokemon,
  type Gender,
  type StatSnapshot,
  type TargetFilter,
} from "./gen3";
import { calculateRseStats, rseGenderFromPid, type RseSpeciesName } from "./rseSpecies";

export type RseVersion = "Ruby" | "Sapphire" | "Emerald";

export type RseBattery = "live" | "dry";

export const EMERALD_INITIAL_SEED = 0x0000;

export const RS_DRY_BATTERY_SEED = 0x05a0;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRtcLeapYear(rtcYear: number): boolean {
  return (rtcYear % 4 === 0 && rtcYear % 100 !== 0) || rtcYear % 400 === 0;
}

export function rsDayCount(rtcYear: number, month: number, day: number): number {
  let dayCount = 0;
  for (let index = rtcYear - 1; index > 0; index -= 1) {
    dayCount += 365;
    if (isRtcLeapYear(index)) dayCount += 1;
  }
  for (let index = 0; index < month - 1; index += 1) dayCount += DAYS_IN_MONTH[index];
  if (month > 2 && isRtcLeapYear(rtcYear)) dayCount += 1;
  return (dayCount + day) & 0xffff;
}

function toBcd(value: number): number {
  return Math.floor(value / 10) * 16 + (value % 10);
}

export type RsRtcDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function rsMinuteCount({ year, month, day, hour, minute }: RsRtcDateTime): number {
  const dayCount = rsDayCount(year - 2000, month, day);
  return (1440 * dayCount + 60 * toBcd(hour) + toBcd(minute)) >>> 0;
}

export function rsLiveBatterySeed(datetime: RsRtcDateTime): number {
  const minuteCount = rsMinuteCount(datetime);
  return (((minuteCount >>> 16) ^ (minuteCount & 0xffff)) & 0xffff) >>> 0;
}

export type RseSeedOptions = {
  version: RseVersion;
  battery?: RseBattery;
  datetime?: RsRtcDateTime;
};

export function rseInitialSeed({ version, battery = "dry", datetime }: RseSeedOptions): number {
  if (version === "Emerald") return EMERALD_INITIAL_SEED;
  if (battery === "dry") return RS_DRY_BATTERY_SEED;
  if (!datetime) throw new Error("Ruby/Sapphire with a live battery needs an RTC date and time to compute the initial seed.");
  return rsLiveBatterySeed(datetime);
}

export function rseHasFixedSeed({ version, battery = "dry" }: Pick<RseSeedOptions, "version" | "battery">): boolean {
  return version === "Emerald" || battery === "dry";
}

export function rseAdvanceToMs(advance: number, consoleName: ConsoleName): number {
  return consoleFramesToMs(advance, consoleName);
}

const GENDERLESS_PROXY = "Mewtwo" as const;

export type RsePokemon = GeneratedPokemon;

export function generateRseMethod1(
  stateAtAdvance: number,
  advance: number,
  trainerId: number,
  secretId: number,
  species: RseSpeciesName,
): RsePokemon {
  const generated = generateMethod1(stateAtAdvance, advance, trainerId, secretId, GENDERLESS_PROXY);
  return { ...generated, gender: rseGenderFromPid(species, generated.pid) };
}

export type RseTarget = RsePokemon & {
  initialSeed: number;
  seed: string;
  consoleName: ConsoleName;
  targetMs: number;
};

function matchesRseFilter(generated: RsePokemon, filter: RseTargetFilter): boolean {
  if (filter.shiny !== false && generated.shiny === "none") return false;
  if (filter.natures && !filter.natures.includes(generated.nature)) return false;
  if (filter.gender && generated.gender !== filter.gender) return false;
  if (filter.minIvs && generated.ivs.some((iv, index) => iv < (filter.minIvs![index] ?? 0))) return false;
  if (filter.maxIvs && generated.ivs.some((iv, index) => iv > (filter.maxIvs![index] ?? 31))) return false;
  return true;
}

export type RseTargetFilter = TargetFilter;

const SHINY_ONLY: RseTargetFilter = { shiny: true };

export type RseTargetSearch = {
  initialSeed: number;
  minAdvances: number;
  maxAdvances: number;
  trainerId: number;
  secretId: number;
  species: RseSpeciesName;
  consoleName: ConsoleName;
  filter?: RseTargetFilter;
  limit?: number;
};

export function searchRseTargets({
  initialSeed,
  minAdvances,
  maxAdvances,
  trainerId,
  secretId,
  species,
  consoleName,
  filter = SHINY_ONLY,
  limit = 500,
}: RseTargetSearch): RseTarget[] {
  const first = Math.max(0, Math.floor(minAdvances));
  const last = Math.max(first, Math.floor(maxAdvances));
  const shinyPrefilter = filter.shiny !== false;
  const results: RseTarget[] = [];

  let state = advanceSeed(initialSeed, first);
  for (let advance = first; advance <= last && results.length < limit; advance += 1) {
    let keep = true;
    if (shinyPrefilter) {
      let peek = nextSeed(state);
      const low = peek >>> 16;
      peek = nextSeed(peek);
      const high = peek >>> 16;
      keep = ((trainerId ^ secretId ^ low ^ high) & 0xffff) < 8;
    }
    if (keep) {
      const generated = generateRseMethod1(state, advance, trainerId, secretId, species);
      if (matchesRseFilter(generated, filter)) {
        results.push({
          ...generated,
          initialSeed,
          seed: hex(initialSeed),
          consoleName,
          targetMs: rseAdvanceToMs(advance, consoleName),
        });
      }
    }
    state = nextSeed(state);
  }

  return results;
}

function rseSnapshotMatches(species: RseSpeciesName, generated: RsePokemon, snapshots: readonly StatSnapshot[]): boolean {
  return snapshots.every((snapshot) => {
    if (snapshot.stats.length !== 6 || snapshot.stats.some((stat) => !Number.isFinite(stat) || stat < 1)) return false;
    const expected = calculateRseStats(species, snapshot.level, generated.ivs, generated.natureIndex);
    return expected.every((stat, index) => stat === snapshot.stats[index]);
  });
}

export type RseHitSearch = {
  initialSeed: number;
  target: RseTarget;
  minAdvances: number;
  maxAdvances: number;
  trainerId: number;
  secretId: number;
  species: RseSpeciesName;
  nature: string;
  gender?: Gender;
  snapshots: readonly StatSnapshot[];
};

export type RseHitResult = RseTarget & {
  advanceDelta: number;
};

export function searchRseHits({
  initialSeed,
  target,
  minAdvances,
  maxAdvances,
  trainerId,
  secretId,
  species,
  nature,
  gender,
  snapshots,
}: RseHitSearch): RseHitResult[] {
  const first = Math.max(0, Math.floor(minAdvances));
  const last = Math.max(first, Math.floor(maxAdvances));
  const results: RseHitResult[] = [];

  let state = advanceSeed(initialSeed, first);
  for (let advance = first; advance <= last; advance += 1) {
    const generated = generateRseMethod1(state, advance, trainerId, secretId, species);
    if (
      generated.nature === nature
      && (!gender || generated.gender === gender)
      && rseSnapshotMatches(species, generated, snapshots)
    ) {
      results.push({
        ...generated,
        initialSeed,
        seed: hex(initialSeed),
        consoleName: target.consoleName,
        targetMs: rseAdvanceToMs(advance, target.consoleName),
        advanceDelta: advance - target.advance,
      });
    }
    state = nextSeed(state);
  }

  return results.sort((a, b) => Math.abs(a.advanceDelta) - Math.abs(b.advanceDelta) || a.advance - b.advance);
}

export function rseCalibrationMs(targetAdvance: number, hitAdvance: number, consoleName: ConsoleName): number {
  return consoleFramesToMs(targetAdvance - hitAdvance, consoleName);
}
