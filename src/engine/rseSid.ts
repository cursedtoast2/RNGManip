import { advanceSeed, generateSidAtAdvance, nextSeed } from "./gen3";
import type { RseVersion } from "./rse";

export type RseIdState = {
  advance: number;
  tid: number;
  sid: number;
  tsv: number;
};

export function rsIdCandidates(
  initialSeed: number,
  knownTid: number,
  { minAdvances = 0, maxAdvances = 10000, limit = 32 }: { minAdvances?: number; maxAdvances?: number; limit?: number } = {},
): RseIdState[] {
  const first = Math.max(0, Math.floor(minAdvances));
  const last = Math.max(first, Math.floor(maxAdvances));
  const wanted = knownTid & 0xffff;
  const results: RseIdState[] = [];

  let state = advanceSeed(initialSeed, first);
  for (let advance = first; advance <= last && results.length < limit; advance += 1) {
    const afterSid = nextSeed(state);
    const afterTid = nextSeed(afterSid);
    if (afterTid >>> 16 === wanted) {
      const sid = afterSid >>> 16;
      results.push({ advance, tid: wanted, sid, tsv: (wanted ^ sid) >>> 3 });
    }
    state = nextSeed(state);
  }

  return results;
}

export function emeraldSidAtAdvance(trainerId: number, advance: number): number {
  return generateSidAtAdvance(trainerId, advance);
}

export const EMERALD_SID_MIN_ADVANCE = 0;

export const EMERALD_SID_MAX_ADVANCE = 5000;

export function emeraldSidCandidates(
  trainerId: number,
  {
    minAdvances = EMERALD_SID_MIN_ADVANCE,
    maxAdvances = EMERALD_SID_MAX_ADVANCE,
    sids,
  }: { minAdvances?: number; maxAdvances?: number; sids?: readonly number[] } = {},
): RseIdState[] {
  const tid = trainerId & 0xffff;
  const first = Math.max(0, Math.floor(minAdvances));
  const last = Math.max(first, Math.floor(maxAdvances));
  const wanted = sids && sids.length > 0 ? new Set(sids.map((sid) => sid & 0xffff)) : null;
  const results: RseIdState[] = [];
  for (let advance = first; advance <= last; advance += 1) {
    const sid = emeraldSidAtAdvance(tid, advance);
    if (wanted && !wanted.has(sid)) continue;
    results.push({ advance, tid, sid, tsv: (tid ^ sid) >>> 3 });
  }
  return results;
}

export function sidCandidatesFromShiny(trainerId: number, pid: number): number[] {
  const psv = ((pid >>> 16) ^ (pid & 0xffff)) & 0xffff;
  const base = (trainerId ^ psv) & 0xffff;
  return Array.from({ length: 8 }, (_, k) => (base ^ k) & 0xffff);
}

export type RseSidGuidance = {
  headline: string;
  detail: string;
};

function bootSeedGuidance(version: "Ruby" | "Sapphire"): RseSidGuidance {
  return {
    headline: "Derived from the boot seed.",
    detail: [
      `${version} generates the Trainer ID and Secret ID together from the seed the cartridge booted with.`,
      "1. Set the battery state or the clock reading above so the boot seed is known.",
      "2. Enter your Trainer ID. The list below shows every advance that produces it, with the Secret ID that came with it.",
      "3. If more than one candidate is left, save before an encounter and hunt a shiny with each candidate in turn. The one that lands is yours.",
    ].join("\n"),
  };
}

export const RSE_SID_GUIDANCE: Record<RseVersion, RseSidGuidance> = {
  Ruby: bootSeedGuidance("Ruby"),
  Sapphire: bootSeedGuidance("Sapphire"),
  Emerald: {
    headline: "Derived from your Trainer ID.",
    detail: [
      "Emerald seeds its RNG from the hardware timer when you leave the naming screen and stores that same value as your Trainer ID. The Secret ID is drawn later, once Birch's speech finishes, and the RNG advances once per frame in between.",
      "1. Enter your Trainer ID.",
      "2. The advance is however many frames Birch's remaining text took, so it usually lands several hundred to a few thousand advances in.",
      "3. That is far too many candidates to try one by one. Narrow it with a shiny you already own, using the PID box below, or read the Secret ID straight out of a save dump.",
    ].join("\n"),
  },
};

export const RSE_SID_FALLBACK_NOTES = [
  "**Dump the save.** [PKHeX](https://github.com/kwsch/PKHeX) or [PocketHeX](https://github.com/cursedtoast2/PocketHeX) reads the Secret ID straight out of a GBA save dump.",
  "**Use a shiny you caught.** Shininess is `(TID ^ SID ^ PID-high ^ PID-low) < 8`, so one shiny of your own narrows the Secret ID to eight values. Transfer it to a later generation to read its PID without dumping the GBA save, then enter the PID above.",
].join("\n\n");
