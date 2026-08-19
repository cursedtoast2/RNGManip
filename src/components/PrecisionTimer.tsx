import { ChevronDown, Gamepad2, Settings2, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  ACTION_CUE_DURATION_MS,
  ACTION_CUE_HZ,
  CUE_STYLES,
  DRUMROLL_TICK_DURATION_MS,
  DRUMROLL_TICK_HZ,
  PRACTICE_HIT_CUE_DURATION_MS,
  PRACTICE_HIT_CUE_HZ,
  PRACTICE_RESTART_GUARD_MS,
  PRESS_CLICK_DURATION_MS,
  PRESS_CLICK_HZ,
  getCueSchedule,
  getMedianTimingOffset,
  getMetronomeCueFrequency,
  getPracticeFrameOffset,
  getPracticeStreaks,
  judgePracticePress,
  type CueStyle,
  type PracticeJudgment,
} from "../engine/timer";

export type PrecisionAudioState = {
  context: AudioContext | null;
  keepAliveOscillator: OscillatorNode | null;
  keepAliveGain: GainNode | null;
  streamDestination: MediaStreamAudioDestinationNode | null;
  mediaElement: HTMLAudioElement | null;
  scheduledCues: Set<OscillatorNode>;
};

export function createPrecisionAudioState(): PrecisionAudioState {
  return { context: null, keepAliveOscillator: null, keepAliveGain: null, streamDestination: null, mediaElement: null, scheduledCues: new Set() };
}

function ensurePrecisionAudio(state: PrecisionAudioState): AudioContext | null {
  if (state.context) return state.context;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  state.context = new AudioContextClass();
  state.streamDestination = state.context.createMediaStreamDestination();
  state.mediaElement = new Audio();
  state.mediaElement.srcObject = state.streamDestination.stream;
  return state.context;
}

export async function preparePrecisionAudio(state: PrecisionAudioState): Promise<void> {
  const context = ensurePrecisionAudio(state);
  if (!context) return;
  if ("audioSession" in navigator) (navigator.audioSession as { type: string }).type = "playback";
  if (context.state === "suspended") await context.resume();
  if (!state.keepAliveOscillator) {
    state.keepAliveOscillator = context.createOscillator();
    state.keepAliveGain = context.createGain();
    state.keepAliveGain.gain.value = 1e-5;
    state.keepAliveOscillator.connect(state.keepAliveGain);
    if (state.streamDestination) state.keepAliveGain.connect(state.streamDestination);
    state.keepAliveGain.connect(context.destination);
    state.keepAliveOscillator.start();
  }
  try {
    await state.mediaElement?.play();
  } catch {
  }
}

export function stopPrecisionAudio(state: PrecisionAudioState): void {
  for (const oscillator of state.scheduledCues) {
    try {
      oscillator.stop();
    } catch {
    }
    oscillator.disconnect();
  }
  state.scheduledCues.clear();
  state.keepAliveOscillator?.stop();
  state.keepAliveOscillator?.disconnect();
  state.keepAliveGain?.disconnect();
  state.keepAliveOscillator = null;
  state.keepAliveGain = null;
  if (state.mediaElement) {
    state.mediaElement.pause();
    state.mediaElement.currentTime = 0;
  }
}

function schedulePrecisionCue(state: PrecisionAudioState, beat: number, when: number): void {
  const context = ensurePrecisionAudio(state);
  if (!context || context.state !== "running") return;
  const actionCue = beat === 6;
  const durationSeconds = actionCue ? ACTION_CUE_DURATION_MS / 1000 : 0.13;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = actionCue ? ACTION_CUE_HZ : getMetronomeCueFrequency(beat);
  gain.gain.setValueAtTime(actionCue ? 0.17 : 0.11, when);
  if (actionCue) {
    gain.gain.setValueAtTime(0.17, when + Math.max(0, durationSeconds - 0.008));
    gain.gain.exponentialRampToValueAtTime(0.001, when + durationSeconds);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
  }
  oscillator.connect(gain).connect(context.destination);
  state.scheduledCues.add(oscillator);
  oscillator.onended = () => {
    state.scheduledCues.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(when);
  oscillator.stop(when + durationSeconds);
}

function scheduleDrumrollTick(state: PrecisionAudioState, when: number): void {
  const context = ensurePrecisionAudio(state);
  if (!context || context.state !== "running") return;
  const durationSeconds = DRUMROLL_TICK_DURATION_MS / 1000;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = DRUMROLL_TICK_HZ;
  gain.gain.setValueAtTime(0.07, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + durationSeconds);
  oscillator.connect(gain).connect(context.destination);
  state.scheduledCues.add(oscillator);
  oscillator.onended = () => {
    state.scheduledCues.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(when);
  oscillator.stop(when + durationSeconds);
}

export function schedulePrecisionRun(state: PrecisionAudioState, phaseDurations: number[], absoluteStart: number, cueStyle: CueStyle): void {
  const context = ensurePrecisionAudio(state);
  if (!context || context.state !== "running") return;
  const performanceNow = performance.timeOrigin + performance.now();
  const audioNow = context.currentTime;
  let phaseStart = absoluteStart;

  for (const duration of phaseDurations) {
    for (const cue of getCueSchedule(phaseStart, duration, cueStyle)) {
      if (cue.atMs <= phaseStart || cue.atMs <= performanceNow) continue;
      const when = audioNow + (cue.atMs - performanceNow) / 1000;
      if (cue.kind === "tick") scheduleDrumrollTick(state, when);
      else schedulePrecisionCue(state, cue.beat!, when);
    }
    phaseStart += duration;
  }
}

function playPressClick(state: PrecisionAudioState): void {
  const context = ensurePrecisionAudio(state);
  if (!context || context.state !== "running") return;
  const startedAt = context.currentTime;
  const durationSeconds = PRESS_CLICK_DURATION_MS / 1000;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = PRESS_CLICK_HZ;
  gain.gain.setValueAtTime(0.2, startedAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startedAt + durationSeconds);
  oscillator.connect(gain).connect(context.destination);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(startedAt);
  oscillator.stop(startedAt + durationSeconds);
}

function playPracticeHitCue(state: PrecisionAudioState, delaySeconds = 0): void {
  const context = ensurePrecisionAudio(state);
  if (!context || context.state !== "running") return;
  const startedAt = context.currentTime + delaySeconds;
  const staggerSeconds = 0.14;
  const totalSeconds = PRACTICE_HIT_CUE_DURATION_MS / 1000;
  const noteDurationSeconds = totalSeconds - staggerSeconds * 2;
  const frequencies = [PRACTICE_HIT_CUE_HZ, PRACTICE_HIT_CUE_HZ * 1.25, PRACTICE_HIT_CUE_HZ * 1.5];

  frequencies.forEach((frequency, index) => {
    const noteStartedAt = startedAt + staggerSeconds * index;
    const noteStoppedAt = noteStartedAt + noteDurationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, noteStartedAt);
    gain.gain.exponentialRampToValueAtTime(0.12, noteStartedAt + 0.012);
    gain.gain.setValueAtTime(0.1, noteStoppedAt - 0.09);
    gain.gain.exponentialRampToValueAtTime(0.001, noteStoppedAt);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(noteStartedAt);
    oscillator.stop(noteStoppedAt);
  });
}

type WakeLockSentinelLike = { release: () => Promise<void> };
export type ScreenWakeLock = { sentinel: WakeLockSentinelLike | null; wanted: boolean };

export function createScreenWakeLock(): ScreenWakeLock {
  return { sentinel: null, wanted: false };
}

export function requestScreenWakeLock(state: ScreenWakeLock): void {
  state.wanted = true;
  if (state.sentinel || typeof navigator === "undefined") return;
  const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
  if (!wakeLock) return;
  wakeLock.request("screen").then((sentinel) => {
    state.sentinel = sentinel;
    if (!state.wanted) releaseScreenWakeLock(state);
  }).catch(() => {
  });
}

export function releaseScreenWakeLock(state: ScreenWakeLock): void {
  state.wanted = false;
  const sentinel = state.sentinel;
  state.sentinel = null;
  void sentinel?.release().catch(() => {
  });
}

const GAMEPAD_PRESS_REFRACTORY_MS = 250;
const GAMEPAD_FACE_BUTTON_INDEXES = [0, 1, 2, 3];

function isFaceButtonDown(pad: Gamepad): boolean {
  return GAMEPAD_FACE_BUTTON_INDEXES.some((index) => {
    const button = pad.buttons[index];
    if (!button?.pressed) return false;
    return Number.isFinite(button.value) ? button.value >= 0.5 : true;
  });
}

export function getInputEventAbsoluteTime(event: { timeStamp: number }): number {
  if (!Number.isFinite(event.timeStamp) || event.timeStamp <= 0) return performance.timeOrigin + performance.now();
  return event.timeStamp >= performance.timeOrigin ? event.timeStamp : performance.timeOrigin + event.timeStamp;
}

export function resolveTimerStartTime(requestedStartAt?: number): number {
  const currentTime = performance.timeOrigin + performance.now();
  if (!Number.isFinite(requestedStartAt) || Math.abs(currentTime - requestedStartAt!) > 1000) return currentTime;
  return Math.min(requestedStartAt!, currentTime);
}

export function useGamepadPress(active: boolean, onPress: (pressedAt: number) => void): void {
  const onPressRef = useRef(onPress);
  useEffect(() => { onPressRef.current = onPress; }, [onPress]);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    const faceButtonDown = new Map<number, boolean>();
    const pendingPressAt = new Map<number, number>();
    let lastAcceptedAt = 0;
    const poll = () => {
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const down = isFaceButtonDown(pad);
        const wasDown = faceButtonDown.get(pad.index);
        faceButtonDown.set(pad.index, down);
        if (wasDown === undefined) continue;

        const pendingAt = pendingPressAt.get(pad.index);
        if (pendingAt !== undefined) {
          pendingPressAt.delete(pad.index);
          const acceptedAt = performance.timeOrigin + performance.now();
          if (down && acceptedAt - lastAcceptedAt >= GAMEPAD_PRESS_REFRACTORY_MS) {
            lastAcceptedAt = acceptedAt;
            onPressRef.current(pendingAt);
          }
          continue;
        }

        if (!down || wasDown) continue;
        const detectedAt = performance.timeOrigin + performance.now();
        if (detectedAt - lastAcceptedAt < GAMEPAD_PRESS_REFRACTORY_MS) continue;
        pendingPressAt.set(pad.index, Number.isFinite(pad.timestamp) && pad.timestamp > 0
          ? (pad.timestamp >= performance.timeOrigin ? pad.timestamp : performance.timeOrigin + pad.timestamp)
          : detectedAt);
      }
    };
    poll();
    const intervalId = window.setInterval(poll, 4);
    return () => window.clearInterval(intervalId);
  }, [active]);
}

export function TimerInputLegend() {
  return (
    <div className="input-legend" role="img" aria-label="Start and stop with Space or any controller face button">
      <span className="input-legend-chip keyboard" aria-hidden="true">Space</span>
      <span className="input-legend-chip" aria-hidden="true"><Gamepad2 aria-hidden="true" />A/B/X/Y</span>
    </div>
  );
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const milliseconds = Math.floor(safe % 1000);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

const CUE_STYLE_LABELS: Record<CueStyle, string> = {
  standard: "Classic beat",
  "roll-target": "Drumroll",
  "roll-long": "Full roll",
  "roll-silent": "Silent finish",
};

export function CueStyleSelector({ value, disabled = false, label, onChange }: {
  value: CueStyle;
  disabled?: boolean;
  label: string;
  onChange: (style: CueStyle) => void;
}) {
  return (
    <div className="cue-style-selector" role="group" aria-label={label}>
      {CUE_STYLES.map((style) => <button type="button" aria-pressed={value === style} disabled={disabled} onClick={() => onChange(style)} key={style}>{CUE_STYLE_LABELS[style]}</button>)}
    </div>
  );
}

export type TimerPhase = { label: string; ms: number };
export type PracticeFeedback = { phase: number; deltaMs: number; judgment: PracticeJudgment };

function formatPracticeFeedback(feedback: PracticeFeedback): string {
  if (feedback.judgment === "target") return "Target window";
  return `${Math.round(Math.abs(feedback.deltaMs)).toLocaleString()} ms ${feedback.judgment}`;
}

function formatPracticeBias(deltaMs: number): string {
  const rounded = Math.round(deltaMs);
  if (rounded === 0) return "On time";
  return `${Math.abs(rounded).toLocaleString()} ms ${rounded < 0 ? "early" : "late"}`;
}

function formatSignedNumber(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString()}`;
}

function PracticeSupport({ history, targetFrameMs }: {
  history: PracticeFeedback[];
  targetFrameMs: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = history.at(-1) ?? null;
  const frameOffset = latest ? getPracticeFrameOffset(latest.deltaMs, targetFrameMs) : null;
  const deltas = history.map((feedback) => feedback.deltaMs);
  const medianMs = getMedianTimingOffset(deltas);
  const streaks = getPracticeStreaks(history.map((feedback) => feedback.judgment));
  const successCount = history.filter((feedback) => feedback.judgment === "target").length;

  return (
    <div className={`practice-support ${expanded ? "expanded" : ""}`} data-timer-control>
      <button type="button" className="practice-stats-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>Practice stats<ChevronDown aria-hidden="true" /></button>
      {expanded && <div className={`practice-frame-details ${latest ? `practice-${latest.judgment}` : ""}`} aria-live="polite">
        <span><small>Last frame</small><b>{frameOffset === null ? "—" : frameOffset === 0 ? "Target (0)" : formatSignedNumber(frameOffset)}</b></span>
        <span><small>Median</small><b>{medianMs === null ? "—" : formatPracticeBias(medianMs)}</b></span>
        <span><small>Streak</small><b>{streaks.current} · best {streaks.best}</b></span>
        <span><small>Exact</small><b>{successCount}/{history.length}</b></span>
      </div>}
    </div>
  );
}

const TAP_ANYWHERE_STORAGE_KEY = "rngmanip-tap-anywhere-v1";
const TAP_ANYWHERE_QUERY = "(pointer: coarse)";

function loadTapAnywhere(): boolean {
  try {
    const stored = window.localStorage.getItem(TAP_ANYWHERE_STORAGE_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(TAP_ANYWHERE_QUERY).matches;
}

let tapAnywhereValue: boolean | null = null;
const tapAnywhereListeners = new Set<() => void>();

function getTapAnywhere(): boolean {
  if (tapAnywhereValue === null) tapAnywhereValue = loadTapAnywhere();
  return tapAnywhereValue;
}

function setTapAnywhere(value: boolean): void {
  if (getTapAnywhere() === value) return;
  tapAnywhereValue = value;
  try {
    window.localStorage.setItem(TAP_ANYWHERE_STORAGE_KEY, value ? "on" : "off");
  } catch {
  }
  for (const listener of tapAnywhereListeners) listener();
}

function subscribeTapAnywhere(listener: () => void): () => void {
  tapAnywhereListeners.add(listener);
  return () => { tapAnywhereListeners.delete(listener); };
}

function useTapAnywhere(): boolean {
  return useSyncExternalStore(subscribeTapAnywhere, getTapAnywhere, () => false);
}

function isTimerControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, input, select, textarea, a, [data-timer-control]") !== null;
}

export function GuidedTimer({ huntPhases, practiceMs, targetFrameMs, active, focusRequest, practiceMode, onPracticeModeChange, cueStyle, onCueStyleChange, showHuntCueStyle = false, audioState, onStarted, onFinished }: {
  huntPhases: TimerPhase[];
  practiceMs: number;
  targetFrameMs: number;
  active: boolean;
  focusRequest: number;
  practiceMode: boolean;
  onPracticeModeChange: (practiceMode: boolean) => void;
  cueStyle: CueStyle;
  onCueStyleChange: (cueStyle: CueStyle) => void;
  showHuntCueStyle?: boolean;
  audioState: PrecisionAudioState;
  onStarted?: () => void;
  onFinished?: () => void;
}) {
  const practicePhases = useMemo(() => [{ label: "Practice", ms: practiceMs }], [practiceMs]);
  const phaseModel = practiceMode ? practicePhases : huntPhases;
  const phases = useMemo(() => phaseModel.map((phase) => phase.ms), [phaseModel]);
  const runPhases = useMemo(() => phases.map((duration) => Math.max(1, duration)), [phases]);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(phases[0]);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [beepStep, setBeepStep] = useState(0);
  const [practiceFeedback, setPracticeFeedback] = useState<PracticeFeedback | null>(null);
  const [practiceMissed, setPracticeMissed] = useState(false);
  const [practiceHistory, setPracticeHistory] = useState<PracticeFeedback[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const tapAnywhere = useTapAnywhere();
  const timerWorker = useRef<Worker | null>(null);
  const timerSurface = useRef<HTMLDivElement | null>(null);
  const options = useRef<HTMLDivElement | null>(null);
  const finishTimeout = useRef<number | null>(null);
  const onStartedRef = useRef(onStarted);
  const onFinishedRef = useRef(onFinished);
  const runningRef = useRef(false);
  const commandToken = useRef(0);
  const phaseDeadlines = useRef<number[]>([]);
  const practiceRestartAllowedAt = useRef(0);
  const suppressSurfaceClick = useRef(false);
  const wakeLock = useRef<ScreenWakeLock>(createScreenWakeLock());
  const activePhases = useRef<number[]>(runPhases);
  const practiceModeRef = useRef(practiceMode);

  useEffect(() => { practiceModeRef.current = practiceMode; }, [practiceMode]);
  useEffect(() => { onStartedRef.current = onStarted; }, [onStarted]);
  useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);
  useEffect(() => {
    if (active) timerSurface.current?.focus({ preventScroll: true });
  }, [active, focusRequest, practiceMode]);
  useEffect(() => {
    if (!runningRef.current) setRemaining(phases[0]);
  }, [phases]);
  useEffect(() => {
    if (!runningRef.current) {
      setPracticeFeedback(null);
      setPracticeHistory([]);
      setPracticeMissed(false);
    }
  }, [cueStyle]);
  useEffect(() => {
    if (!optionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!options.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOptionsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [optionsOpen]);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    const worker = new Worker(new URL("../engine/timerWorker.ts", import.meta.url), { type: "module" });
    timerWorker.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; phase?: number; beat?: number; remaining?: number }>) => {
      if (!runningRef.current) return;
      if (event.data.type === "beat" && event.data.beat !== undefined) {
        flushSync(() => setBeepStep(event.data.beat!));
      } else if (event.data.type === "tick" && event.data.remaining !== undefined) {
        setRemaining(event.data.remaining);
      } else if (event.data.type === "phase" && event.data.phase !== undefined) {
        setPhaseIndex(event.data.phase);
        setRemaining(activePhases.current[event.data.phase] ?? 0);
        setBeepStep(0);
      } else if (event.data.type === "finished") {
        if (practiceModeRef.current) {
          setRemaining(0);
          finishTimeout.current = window.setTimeout(() => {
            finishTimeout.current = null;
            if (!runningRef.current) return;
            runningRef.current = false;
            stopPrecisionAudio(audioState);
            releaseScreenWakeLock(wakeLock.current);
            practiceRestartAllowedAt.current = performance.timeOrigin + performance.now() + PRACTICE_RESTART_GUARD_MS;
            setPracticeMissed(true);
            setRunning(false);
            setBeepStep(6);
          }, 1000);
        } else {
          runningRef.current = false;
          setRunning(false);
          releaseScreenWakeLock(wakeLock.current);
          finishTimeout.current = window.setTimeout(() => {
            finishTimeout.current = null;
            stopPrecisionAudio(audioState);
            onFinishedRef.current?.();
          }, 450);
        }
      }
    };
    return () => {
      commandToken.current += 1;
      runningRef.current = false;
      worker.onmessage = null;
      worker.postMessage({ type: "stop" });
      worker.terminate();
      stopPrecisionAudio(audioState);
      releaseScreenWakeLock(wakeLock.current);
      timerWorker.current = null;
    };
  }, [audioState]);

  const stop = useCallback(() => {
    commandToken.current += 1;
    runningRef.current = false;
    timerWorker.current?.postMessage({ type: "stop" });
    stopPrecisionAudio(audioState);
    releaseScreenWakeLock(wakeLock.current);
    if (finishTimeout.current !== null) window.clearTimeout(finishTimeout.current);
    finishTimeout.current = null;
    setRunning(false);
    setPhaseIndex(0);
    setRemaining(phases[0]);
    setBeepStep(0);
    setPracticeFeedback(null);
    setPracticeMissed(false);
    phaseDeadlines.current = [];
    practiceRestartAllowedAt.current = 0;
  }, [audioState, phases]);

  const start = useCallback(async (requestedStartAt?: number) => {
    setOptionsOpen(false);
    const token = commandToken.current + 1;
    commandToken.current = token;
    runningRef.current = true;
    onStartedRef.current?.();
    activePhases.current = runPhases;
    setPhaseIndex(0);
    setRemaining(phases[0]);
    setBeepStep(0);
    setPracticeFeedback(null);
    setPracticeMissed(false);
    phaseDeadlines.current = [];
    if (finishTimeout.current !== null) window.clearTimeout(finishTimeout.current);
    finishTimeout.current = null;
    setRunning(true);
    requestScreenWakeLock(wakeLock.current);
    timerWorker.current?.postMessage({ type: "stop" });
    stopPrecisionAudio(audioState);
    await preparePrecisionAudio(audioState);
    if (token !== commandToken.current || !runningRef.current) return;
    const absoluteStart = resolveTimerStartTime(requestedStartAt);
    let deadline = absoluteStart;
    phaseDeadlines.current = runPhases.map((duration) => {
      deadline += duration;
      return deadline;
    });
    schedulePrecisionRun(audioState, runPhases, absoluteStart, cueStyle);
    timerWorker.current?.postMessage({
      type: "start",
      phaseDurations: runPhases,
      absoluteStart,
    });
  }, [audioState, cueStyle, phases, practiceMode, runPhases]);

  const recordPracticePress = useCallback((pressedAt: number) => {
    const deadline = phaseDeadlines.current[0];
    if (deadline === undefined) return;

    playPressClick(audioState);
    const deltaMs = pressedAt - deadline;
    const feedback = {
      phase: 0,
      deltaMs,
      judgment: judgePracticePress(deltaMs, targetFrameMs),
    } satisfies PracticeFeedback;
    setPracticeFeedback(feedback);
    setPracticeMissed(false);
    setPracticeHistory((history) => [...history, feedback]);
    practiceRestartAllowedAt.current = pressedAt + PRACTICE_RESTART_GUARD_MS;

    if (finishTimeout.current !== null) window.clearTimeout(finishTimeout.current);
    finishTimeout.current = null;
    commandToken.current += 1;
    runningRef.current = false;
    releaseScreenWakeLock(wakeLock.current);
    timerWorker.current?.postMessage({ type: "stop" });
    stopPrecisionAudio(audioState);
    if (feedback.judgment === "target") playPracticeHitCue(audioState);
    setRunning(false);
    setPhaseIndex(0);
    setRemaining(0);
    setBeepStep(6);
  }, [audioState, targetFrameMs]);

  const startFromInput = useCallback((pressedAt = performance.timeOrigin + performance.now()) => {
    if (practiceMode && pressedAt < practiceRestartAllowedAt.current) return;
    void start(pressedAt);
  }, [practiceMode, start]);

  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);

  useEffect(() => {
    const handleSpace = (event: KeyboardEvent) => {
      if (!active || event.code !== "Space" || event.repeat) return;
      const element = event.target as HTMLElement | null;
      if (element?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "A", "BUTTON"].includes(element?.tagName ?? "")) return;
      event.preventDefault();
      if (runningRef.current && practiceMode) recordPracticePress(getInputEventAbsoluteTime(event));
      else if (runningRef.current) stop();
      else startFromInput(getInputEventAbsoluteTime(event));
    };
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [active, practiceMode, recordPracticePress, startFromInput, stop]);

  const handleGamepadPress = useCallback((pressedAt: number) => {
    if (runningRef.current && practiceMode) recordPracticePress(pressedAt);
    else if (runningRef.current) stop();
    else startFromInput(pressedAt);
  }, [practiceMode, recordPracticePress, startFromInput, stop]);
  useGamepadPress(active, handleGamepadPress);

  useEffect(() => () => {
    if (finishTimeout.current !== null) window.clearTimeout(finishTimeout.current);
    releaseScreenWakeLock(wakeLock.current);
  }, []);

  const showPracticeJudgment = practiceMode && !running && practiceFeedback !== null;
  const showMissedPractice = practiceMode && !running && practiceMissed;
  const display = showPracticeJudgment
    ? formatPracticeFeedback(practiceFeedback)
    : showMissedPractice ? "No press recorded" : formatDuration(remaining);
  const surfaceAction = running ? (practiceMode ? "record" : "stop") : "start";
  const surfaceHint = tapAnywhere
    ? `Click or tap anywhere to ${surfaceAction}`
    : `Press Space or a controller button to ${surfaceAction}`;
  const selectMode = (nextPracticeMode: boolean) => {
    if (nextPracticeMode === practiceMode) return;
    setOptionsOpen(false);
    stop();
    practiceRestartAllowedAt.current = 0;
    onPracticeModeChange(nextPracticeMode);
  };
  const handleSurfaceClick = () => {
    if (!tapAnywhere) return;
    if (suppressSurfaceClick.current) {
      suppressSurfaceClick.current = false;
      return;
    }
    if (runningRef.current && practiceMode) recordPracticePress(performance.timeOrigin + performance.now());
    else if (runningRef.current) stop();
    else startFromInput();
  };

  return (
    <div
      ref={timerSurface}
      className={`guided-timer ${running ? "running" : ""} ${practiceMode ? "practice" : ""} ${tapAnywhere ? "tap-anywhere" : ""}`}
      tabIndex={-1}
      onPointerDown={(event) => {
        if (!tapAnywhere || isTimerControl(event.target) || !runningRef.current || !practiceMode) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        suppressSurfaceClick.current = true;
        window.setTimeout(() => { suppressSurfaceClick.current = false; }, 750);
        recordPracticePress(getInputEventAbsoluteTime(event.nativeEvent));
      }}
      onClick={(event) => {
        if (isTimerControl(event.target)) return;
        handleSurfaceClick();
      }}
    >
      <div className="timer-toolbar" data-timer-control>
        <div className="timer-mode-switch" role="group" aria-label="Timer mode">
          <button type="button" className={!practiceMode ? "active" : ""} aria-pressed={!practiceMode} disabled={running} onClick={() => selectMode(false)}>Hunt timer</button>
          <button type="button" className={practiceMode ? "active" : ""} aria-pressed={practiceMode} disabled={running} onClick={() => selectMode(true)}>Practice timer</button>
        </div>
        <button
          type="button"
          className={`timer-tap-toggle ${tapAnywhere ? "active" : ""}`}
          aria-pressed={tapAnywhere}
          aria-label={`Tap anywhere to start or stop: ${tapAnywhere ? "on" : "off"}`}
          title="Tap anywhere to start or stop"
          disabled={running}
          onClick={() => setTapAnywhere(!tapAnywhere)}
        ><Smartphone aria-hidden="true" /></button>
        {(practiceMode || showHuntCueStyle) && <div className="timer-options" ref={options}>
          <button type="button" className="timer-options-trigger" aria-label={`Timer options. Cue style: ${CUE_STYLE_LABELS[cueStyle]}`} aria-expanded={optionsOpen} disabled={running} onClick={() => setOptionsOpen((open) => !open)}><Settings2 aria-hidden="true" /><span>Options</span></button>
          {optionsOpen && <div className="timer-options-popover" role="dialog" aria-label="Timer options">
            <span className="timer-options-label">Cue style</span>
            <CueStyleSelector value={cueStyle} label="Timer cue style" onChange={(nextStyle) => { onCueStyleChange(nextStyle); setOptionsOpen(false); }} />
          </div>}
        </div>}
      </div>
      <div className="timer-stage">
        {!practiceMode && <div className="timer-phase" aria-live="polite">{phaseModel[phaseIndex]?.label}</div>}
        <div className={`timer-numbers ${showPracticeJudgment ? `practice-${practiceFeedback.judgment}` : showMissedPractice ? "practice-missed" : ""}`} aria-live="polite">{display}</div>
        <div className="timer-beats" aria-label="Action timer beat"><span className={`${beepStep >= 6 ? "heard" : ""} action-beat`}>Press</span></div>
      </div>
      <div className="timer-surface-hint">{surfaceHint}</div>
      {practiceMode && <PracticeSupport history={practiceHistory} targetFrameMs={targetFrameMs} />}
      <TimerInputLegend />
    </div>
  );
}
