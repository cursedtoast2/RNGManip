export const METRONOME_BEAT_COUNT = 6;
export const METRONOME_MAX_INTERVAL_MS = 500;
export const METRONOME_CUE_HZ = 720;
export const ACTION_CUE_HZ = 1760;
export const ACTION_CUE_DURATION_MS = 160;
export const PRACTICE_HIT_CUE_HZ = 660;
export const PRACTICE_HIT_CUE_DURATION_MS = 600;
export const PRACTICE_COUNTDOWN_MS = 3000;
export const PRACTICE_RESTART_GUARD_MS = 500;
export const DRUMROLL_TICK_HZ = 960;
export const DRUMROLL_TICK_DURATION_MS = 60;
export const DRUMROLL_TICK_OFFSETS_MS = [750, 250];
export const DRUMROLL_LONG_TICK_OFFSETS_MS = [1750, 1250, 750, 250];
export const PRESS_CLICK_HZ = 2400;
export const PRESS_CLICK_DURATION_MS = 30;
export const GLIDE_DURATION_MS = 1000;

export type PracticeJudgment = "early" | "target" | "late";
export type CueStyle = "standard" | "scale" | "glide" | "roll-target" | "roll-long" | "roll-silent";
export const CUE_STYLES: CueStyle[] = ["standard", "scale", "glide", "roll-target", "roll-long", "roll-silent"];
export type StyledCue = { atMs: number; kind: "beat" | "tick" | "action" | "glide"; beat: number | null; durationMs?: number };

export function getMetronomeCueFrequency(beat: number): number {
  return beat === METRONOME_BEAT_COUNT ? ACTION_CUE_HZ : METRONOME_CUE_HZ;
}

export function getCueFrequency(style: CueStyle, beat: number): number {
  if (style !== "scale" || beat >= METRONOME_BEAT_COUNT) return getMetronomeCueFrequency(beat);
  const ratio = ACTION_CUE_HZ / METRONOME_CUE_HZ;
  return METRONOME_CUE_HZ * Math.pow(ratio, (beat - 1) / (METRONOME_BEAT_COUNT - 1));
}

export function getMetronomeSchedule(phaseStartMs: number, durationMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return Array.from({ length: METRONOME_BEAT_COUNT }, () => phaseStartMs);
  }
  const phaseEnd = phaseStartMs + durationMs;
  return Array.from({ length: METRONOME_BEAT_COUNT }, (_, index) =>
    phaseEnd - METRONOME_MAX_INTERVAL_MS * (METRONOME_BEAT_COUNT - index - 1));
}

export function getCueSchedule(phaseStartMs: number, durationMs: number, style: CueStyle): StyledCue[] {
  const phaseEnd = phaseStartMs + durationMs;
  const audibleBeats = style === "roll-silent" || style === "glide" ? METRONOME_BEAT_COUNT - 2 : METRONOME_BEAT_COUNT - 1;
  const cues: StyledCue[] = getMetronomeSchedule(phaseStartMs, durationMs)
    .slice(0, audibleBeats)
    .map((atMs, index) => ({ atMs, kind: "beat", beat: index + 1 }));
  const tickOffsets = style === "roll-target" ? DRUMROLL_TICK_OFFSETS_MS : style === "roll-long" ? DRUMROLL_LONG_TICK_OFFSETS_MS : [];
  for (const offsetMs of tickOffsets) {
    cues.push({ atMs: phaseEnd - offsetMs, kind: "tick", beat: null });
  }
  if (style === "glide") {
    const glideStart = Math.max(phaseStartMs + 1, phaseEnd - GLIDE_DURATION_MS);
    cues.push({ atMs: glideStart, kind: "glide", beat: null, durationMs: phaseEnd - glideStart });
  }
  cues.push({ atMs: phaseEnd, kind: "action", beat: METRONOME_BEAT_COUNT });
  return cues.sort((a, b) => a.atMs - b.atMs);
}

export function getMedianTimingOffset(samplesMs: number[]): number | null {
  const samples = samplesMs.filter(Number.isFinite).sort((a, b) => a - b);
  if (samples.length === 0) return null;
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 === 0 ? (samples[middle - 1] + samples[middle]) / 2 : samples[middle];
}

export function judgePracticePress(deltaMs: number, targetFrameMs: number): PracticeJudgment {
  const halfFrameMs = Math.max(0, targetFrameMs) / 2;
  if (Math.abs(deltaMs) <= halfFrameMs) return "target";
  return deltaMs < 0 ? "early" : "late";
}

export function getPracticeFrameOffset(deltaMs: number, targetFrameMs: number): number {
  if (!Number.isFinite(deltaMs) || !Number.isFinite(targetFrameMs) || targetFrameMs <= 0) return 0;
  return Math.round(deltaMs / targetFrameMs);
}

export function getPracticeStreaks(judgments: PracticeJudgment[]): { current: number; best: number } {
  let run = 0;
  let best = 0;
  for (const judgment of judgments) {
    run = judgment === "target" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return { current: run, best };
}
