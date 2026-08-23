import { formatPracticeFrames, getMedianTimingOffset, getPracticeFrameOffset, judgePracticePress, type PracticeJudgment } from "./timer";

export type AttemptTool = "frlg" | "rse";
export type AttemptPress = { key: string; label: string; lateMs: number; frameMs: number };
export type AttemptRecord = { at: number; label: string; applied: boolean; presses: AttemptPress[] };
export type AttemptTrend = { key: string; label: string; frames: number; judgment: PracticeJudgment; samples: number };

export const ATTEMPT_HISTORY_LIMIT = 20;
const STORAGE_KEY = "rngmanip-attempt-history-v1";

type StoredHistory = Partial<Record<AttemptTool, AttemptRecord[]>>;

const listeners = new Set<() => void>();

function validPress(press: unknown): press is AttemptPress {
  const value = press as Partial<AttemptPress> | null;
  return Boolean(value) && typeof value!.key === "string" && typeof value!.label === "string"
    && Number.isFinite(value!.lateMs) && Number.isFinite(value!.frameMs) && value!.frameMs! > 0;
}

function validRecord(record: unknown): record is AttemptRecord {
  const value = record as Partial<AttemptRecord> | null;
  return Boolean(value) && Number.isFinite(value!.at) && typeof value!.label === "string"
    && Array.isArray(value!.presses) && value!.presses.every(validPress);
}

export function pushAttempt(history: AttemptRecord[], record: AttemptRecord): AttemptRecord[] {
  return [record, ...history].slice(0, ATTEMPT_HISTORY_LIMIT);
}

function readStore(): StoredHistory {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return {};
    const saved = JSON.parse(value) as StoredHistory;
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoredHistory): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
  }
  for (const listener of listeners) listener();
}

export function loadAttemptHistory(tool: AttemptTool): AttemptRecord[] {
  const saved = readStore()[tool];
  return Array.isArray(saved) ? saved.filter(validRecord).slice(0, ATTEMPT_HISTORY_LIMIT) : [];
}

export function recordAttempt(tool: AttemptTool, record: AttemptRecord): void {
  const store = readStore();
  writeStore({ ...store, [tool]: pushAttempt(loadAttemptHistory(tool), record) });
}

export function clearAttemptHistory(tool: AttemptTool): void {
  const store = readStore();
  writeStore({ ...store, [tool]: [] });
}

export function subscribeAttemptHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function formatAttemptPress(press: AttemptPress): string {
  return formatPracticeFrames(press.lateMs, press.frameMs);
}

export function attemptPressJudgment(press: AttemptPress): PracticeJudgment {
  return judgePracticePress(press.lateMs, press.frameMs);
}

export function summarizeAttempts(records: AttemptRecord[]): AttemptTrend[] {
  const order: string[] = [];
  const groups = new Map<string, { label: string; offsets: number[] }>();
  for (const record of records) {
    for (const press of record.presses) {
      let group = groups.get(press.key);
      if (!group) {
        group = { label: press.label, offsets: [] };
        groups.set(press.key, group);
        order.push(press.key);
      }
      group.offsets.push(getPracticeFrameOffset(press.lateMs, press.frameMs));
    }
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    const median = getMedianTimingOffset(group.offsets) ?? 0;
    const frames = Math.sign(median) * Math.round(Math.abs(median));
    return {
      key,
      label: group.label,
      frames,
      judgment: frames === 0 ? "target" : frames > 0 ? "late" : "early",
      samples: group.offsets.length,
    };
  });
}

export function formatTrendFrames(frames: number): string {
  if (frames === 0) return "lands on target";
  const magnitude = Math.abs(frames);
  return `trends ${frames > 0 ? "+" : "−"}${magnitude.toLocaleString()} frame${magnitude === 1 ? "" : "s"} ${frames > 0 ? "late" : "early"}`;
}

export function formatAttemptTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
