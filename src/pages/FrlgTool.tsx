import { Check, ChevronDown, RefreshCcw, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  NATURES,
  SID_SETUP_ADVANCES,
  consoleFramesToMs,
  eonAdvanceCalibrationMs,
  eonAdvancePhaseMs,
  gbaFramesToMs,
  generateSidCandidates,
  isSwitchConsole,
  searchHits,
  searchTargets,
  type ConsoleName,
  type Gender,
  type HitResult,
  type SearchTarget,
  type SeedEntry,
} from "../engine/gen3";
import {
  encounterById,
  encounterCalibrationRadius,
  encountersForVersion,
  groupedEncounters,
  type Encounter,
  type GameVersion,
} from "../engine/encounters";
import { isGenderless } from "../engine/species";
import { loadSeedData } from "../engine/seedData";
import {
  PRACTICE_COUNTDOWN_MS,
  type CueStyle,
} from "../engine/timer";
import {
  GuidedTimer,
  createPrecisionAudioState,
  stopPrecisionAudio,
  type PrecisionAudioState,
  type TimerPhase,
} from "../components/PrecisionTimer";

type Game = GameVersion;
type Stage = "setup" | "target" | "attempt" | "result";
type SidMode = "known" | "new-save";

type Hunt = {
  game: Game;
  console: ConsoleName;
  language: string;
  sound: "Mono" | "Stereo";
  buttonMode: "L=A" | "Help" | "LR";
  seedButton: "A" | "Start" | "L";
  revision: "1.0" | "1.1";
  encounterId: string;
  trainerId: string;
  rivalNamed: boolean;
  sidMode: SidMode;
  secretId: string;
};

type TargetOption = SearchTarget;
type Calibration = { seed: number; continueMs: number };
type HitObservation = { openingDelta: number; continueDelta: number };
type ResultSnapshotDraft = { id: number; level: number; stats: string[] };
type ResultDraft = {
  targetKey: string;
  resultVersion: number;
  gender: Gender;
  snapshots: ResultSnapshotDraft[];
  matches: HitResult[] | null;
  selectedPossibleHitKey: string;
  seedRadius: number;
  minAdvances: number;
  maxAdvances: number;
};
type TargetSearchSettings = {
  natureFilter: string;
  genderFilter: "Any gender" | Gender;
  centerSeed: SeedEntry | null;
  seedRadius: number;
  minAdvances: number;
  maxAdvances: number;
  overworldFrames: number;
  showSearch: boolean;
};
type PersistedState = {
  stage: Stage;
  hunt: Hunt;
  targetSearch: TargetSearchSettings;
  selectedTarget: TargetOption | null;
  sidIndex: number;
  calibration: Calibration;
  observedNature: string;
  recentHits: HitObservation[];
  attempts: number;
  recording: boolean;
  resultVersion: number;
};

const DEFAULT_HUNT: Hunt = {
  game: "FireRed",
  console: "Switch",
  language: "English",
  sound: "Mono",
  buttonMode: "L=A",
  seedButton: "A",
  revision: "1.0",
  encounterId: "starter-bulbasaur",
  trainerId: "",
  rivalNamed: true,
  sidMode: "new-save",
  secretId: "",
};

const SID_MODES: ReadonlyArray<{ mode: SidMode; label: string }> = [
  { mode: "known", label: "I know it" },
  { mode: "new-save", label: "I’m making a new save" },
];

const DEFAULT_TARGET_SEARCH: TargetSearchSettings = {
  natureFilter: "Any nature",
  genderFilter: "Any gender",
  centerSeed: null,
  seedRadius: 20,
  minAdvances: 1000,
  maxAdvances: 5000,
  overworldFrames: 600,
  showSearch: false,
};

const DEFAULT_HIT_SEED_RADIUS = 20;
const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"] as const;
const CONSISTENCY_SAMPLE_SIZE = 3;
const CONSISTENCY_OPENING_MS = 50;
const CONSISTENCY_CONTINUE_FRAMES = 10;
const STORAGE_KEY = "rngmanip-hunt-v3";
const RESULT_DRAFT_STORAGE_KEY = "rngmanip-result-draft-v1";

function resolveEncounterId(savedId: unknown, legacyStarter: unknown, game: Game): string {
  const candidates = [savedId, typeof legacyStarter === "string" ? `starter-${legacyStarter.toLowerCase()}` : null];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    if (encounterById(candidate)?.versions.includes(game)) return candidate;
  }
  return DEFAULT_HUNT.encounterId;
}

function encounterForGame(encounterId: string, game: Game): string {
  const current = encounterById(encounterId);
  if (current?.versions.includes(game)) return encounterId;
  const counterpart = current && encountersForVersion(game).find((entry) => entry.species === current.species);
  return counterpart?.id ?? DEFAULT_HUNT.encounterId;
}

function currentEncounter(hunt: Hunt): Encounter {
  return encounterById(hunt.encounterId) ?? encounterById(DEFAULT_HUNT.encounterId)!;
}

function freshState(): PersistedState {
  return {
    stage: "setup",
    hunt: { ...DEFAULT_HUNT },
    targetSearch: { ...DEFAULT_TARGET_SEARCH },
    selectedTarget: null,
    sidIndex: 0,
    calibration: { seed: 0, continueMs: 0 },
    observedNature: NATURES[0],
    recentHits: [],
    attempts: 0,
    recording: false,
    resultVersion: 0,
  };
}

function loadPersistedState(): PersistedState {
  const fallback = freshState();
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return fallback;
    const saved = JSON.parse(value) as Partial<PersistedState>;
    const { starter: legacyStarter, knowsSid: _legacyKnowsSid, ...savedHunt } = (saved.hunt ?? {}) as Partial<Hunt> & { starter?: unknown; knowsSid?: unknown };
    const game: Game = savedHunt.game === "LeafGreen" ? "LeafGreen" : "FireRed";
    const sidMode: SidMode = savedHunt.sidMode === "known" ? "known" : "new-save";
    const hunt: Hunt = { ...fallback.hunt, ...savedHunt, game, encounterId: resolveEncounterId(savedHunt.encounterId, legacyStarter, game), sidMode };
    const savedSearch = saved.targetSearch;
    const targetSearch: TargetSearchSettings = {
      natureFilter: typeof savedSearch?.natureFilter === "string" ? savedSearch.natureFilter : DEFAULT_TARGET_SEARCH.natureFilter,
      genderFilter: savedSearch?.genderFilter === "Male" || savedSearch?.genderFilter === "Female" ? savedSearch.genderFilter : "Any gender",
      centerSeed: savedSearch?.centerSeed && Number.isFinite(savedSearch.centerSeed.initialSeed) && Number.isFinite(savedSearch.centerSeed.seedTime) ? savedSearch.centerSeed : null,
      seedRadius: Number.isFinite(savedSearch?.seedRadius) ? Math.max(0, Math.min(200, Math.round(savedSearch!.seedRadius))) : DEFAULT_TARGET_SEARCH.seedRadius,
      minAdvances: Number.isFinite(savedSearch?.minAdvances) ? Math.max(0, Math.min(100000, Math.round(savedSearch!.minAdvances))) : DEFAULT_TARGET_SEARCH.minAdvances,
      maxAdvances: Number.isFinite(savedSearch?.maxAdvances) ? Math.max(0, Math.min(100000, Math.round(savedSearch!.maxAdvances))) : DEFAULT_TARGET_SEARCH.maxAdvances,
      overworldFrames: Number.isFinite(savedSearch?.overworldFrames) ? Math.max(0, Math.min(10000, Math.round(savedSearch!.overworldFrames))) : DEFAULT_TARGET_SEARCH.overworldFrames,
      showSearch: Boolean(savedSearch?.showSearch),
    };
    const selectedTarget = saved.selectedTarget && Array.isArray(saved.selectedTarget.ivs) && saved.selectedTarget.ivs.length === 6
      ? {
          ...saved.selectedTarget,
          consoleName: saved.selectedTarget.consoleName ?? hunt.console,
          overworldFrames: Number.isFinite(saved.selectedTarget.overworldFrames)
            ? Math.max(0, Math.min(10000, Math.round(saved.selectedTarget.overworldFrames)))
            : isSwitchConsole(hunt.console) ? targetSearch.overworldFrames : 0,
        }
      : null;
    let stage: Stage = saved.stage === "target" || saved.stage === "attempt" || saved.stage === "result" ? saved.stage : "setup";
    if ((stage === "attempt" || stage === "result") && !selectedTarget) stage = "target";
    const savedCalibration = saved.calibration as (Partial<Calibration> & { continueFrames?: number }) | undefined;
    const legacyContinueFrames = Number.isFinite(savedCalibration?.continueFrames) ? savedCalibration!.continueFrames! : 0;
    const migratedContinueMs = selectedTarget
      ? consoleFramesToMs(selectedTarget.continueFrames + legacyContinueFrames, selectedTarget.consoleName) - consoleFramesToMs(selectedTarget.continueFrames, selectedTarget.consoleName)
      : gbaFramesToMs(legacyContinueFrames);
    return {
      stage,
      hunt,
      targetSearch,
      selectedTarget,
      sidIndex: Number.isInteger(saved.sidIndex) && saved.sidIndex! >= 0 ? saved.sidIndex! : 0,
      calibration: {
        seed: Number.isFinite(savedCalibration?.seed) ? savedCalibration!.seed! : 0,
        continueMs: Number.isFinite(savedCalibration?.continueMs) ? savedCalibration!.continueMs! : migratedContinueMs,
      },
      observedNature: typeof saved.observedNature === "string" && (NATURES as readonly string[]).includes(saved.observedNature) ? saved.observedNature : fallback.observedNature,
      recentHits: Array.isArray(saved.recentHits) ? saved.recentHits.filter((hit) => Number.isFinite(hit?.openingDelta) && Number.isFinite(hit?.continueDelta)).slice(-8) : [],
      attempts: Number.isInteger(saved.attempts) && saved.attempts! >= 0 ? saved.attempts! : 0,
      recording: Boolean(saved.recording && selectedTarget),
      resultVersion: Number.isInteger(saved.resultVersion) && saved.resultVersion! >= 0 ? saved.resultVersion! : 0,
    };
  } catch {
    return fallback;
  }
}

function FrlgTool({ cueStyle, onCueStyleChange }: { cueStyle: CueStyle; onCueStyleChange: (cueStyle: CueStyle) => void }) {
  const restored = useMemo(loadPersistedState, []);
  const precisionAudio = useRef<PrecisionAudioState>(createPrecisionAudioState());
  const [stage, setStage] = useState<Stage>(restored.stage);
  const [hunt, setHunt] = useState<Hunt>(restored.hunt);
  const [targetSearch, setTargetSearch] = useState<TargetSearchSettings>(restored.targetSearch);
  const [selectedTarget, setSelectedTarget] = useState<TargetOption | null>(restored.selectedTarget);
  const [sidIndex, setSidIndex] = useState(restored.sidIndex);
  const [calibration, setCalibration] = useState<Calibration>(restored.calibration);
  const [observedNature, setObservedNature] = useState(restored.observedNature);
  const [recentHits, setRecentHits] = useState<HitObservation[]>(restored.recentHits);
  const [attempts, setAttempts] = useState(restored.attempts);
  const [recording, setRecording] = useState(restored.recording);
  const [resultVersion, setResultVersion] = useState(restored.resultVersion);
  const [timerFocusRequest, setTimerFocusRequest] = useState(0);
  const [resultFocusRequest, setResultFocusRequest] = useState(0);
  const [seeds, setSeeds] = useState<SeedEntry[]>([]);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState("");

  const encounter = useMemo(() => currentEncounter(hunt), [hunt]);
  const trainerId = Number(hunt.trainerId);
  const trainerIdValid = hunt.trainerId !== "" && Number.isInteger(trainerId) && trainerId >= 0 && trainerId <= 65535;
  const secretIdNumber = Number(hunt.secretId);
  const setupComplete = trainerIdValid && (hunt.sidMode !== "known" || (hunt.secretId !== "" && Number.isInteger(secretIdNumber) && secretIdNumber >= 0 && secretIdNumber <= 65535));
  const sidCandidates = useMemo(() => {
    if (!trainerIdValid) return [];
    if (hunt.sidMode === "known") {
      const secretId = Number(hunt.secretId);
      return Number.isInteger(secretId) && secretId >= 0 && secretId <= 65535 ? [{ advance: -1, sid: secretId }] : [];
    }
    const candidateCount = hunt.language === "English" && !hunt.rivalNamed ? 50 : hunt.language === "English" ? 51 : 101;
    return generateSidCandidates(trainerId, hunt.language, hunt.rivalNamed, candidateCount);
  }, [hunt.language, hunt.rivalNamed, hunt.secretId, hunt.sidMode, trainerId, trainerIdValid]);
  const currentSid = sidCandidates[Math.min(sidIndex, Math.max(0, sidCandidates.length - 1))]?.sid ?? null;
  const targetSeedIndex = useMemo(() => {
    const guideSeed = seeds.findIndex((entry) => entry.initialSeed === 0xF492);
    if (guideSeed >= 0) return guideSeed;
    return Math.min(51, Math.max(0, seeds.length - 1));
  }, [seeds]);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    return () => stopPrecisionAudio(precisionAudio.current);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ stage, hunt, targetSearch, selectedTarget, sidIndex, calibration, observedNature, recentHits, attempts, recording, resultVersion } satisfies PersistedState));
    } catch {
    }
  }, [attempts, calibration, hunt, observedNature, recentHits, recording, resultVersion, selectedTarget, sidIndex, stage, targetSearch]);

  useEffect(() => {
    if (!trainerIdValid || stage === "setup") return;
    let active = true;
    setSeedLoading(true);
    setSeedError("");
    setSeeds([]);
    loadSeedData(hunt.game, hunt.language, hunt.console, {
      sound: hunt.sound,
      buttonMode: hunt.buttonMode,
      seedButton: hunt.seedButton,
      revision: hunt.revision,
    })
      .then((entries) => { if (active) setSeeds(entries); })
      .catch((error: unknown) => { if (active) setSeedError(error instanceof Error ? error.message : "Could not load the seed database."); })
      .finally(() => { if (active) setSeedLoading(false); });
    return () => { active = false; };
  }, [hunt.buttonMode, hunt.console, hunt.game, hunt.language, hunt.revision, hunt.seedButton, hunt.sound, stage, trainerIdValid]);

  useEffect(() => {
    if (sidIndex >= sidCandidates.length && sidCandidates.length > 0) setSidIndex(0);
  }, [sidCandidates.length, sidIndex]);

  const moveTo = (next: Stage) => {
    setStage(next);
  };

  return (
    <div className="tool-shell">
      <WorkflowNavigation
        current={stage}
        onSetup={() => moveTo("setup")}
        onTarget={() => moveTo("target")}
        onAttempt={() => { moveTo("attempt"); setTimerFocusRequest((request) => request + 1); }}
        onResult={() => { moveTo("result"); setResultFocusRequest((request) => request + 1); }}
      />
      <main className="tool-main">
          {stage === "setup" && (
            <SetupPage
              hunt={hunt}
              setHunt={(nextHunt) => {
                if (nextHunt.console !== hunt.console) {
                  setCalibration({ seed: 0, continueMs: 0 });
                  setRecentHits([]);
                  setAttempts(0);
                }
                setHunt({ ...nextHunt, encounterId: encounterForGame(nextHunt.encounterId, nextHunt.game) });
                setSelectedTarget(null);
                setRecording(false);
              }}
              trainerIdValid={trainerIdValid}
              cueStyle={cueStyle}
              onCueStyleChange={onCueStyleChange}
              audioState={precisionAudio.current}
              onContinue={() => moveTo("target")}
            />
          )}
          {stage === "target" && (
            <TargetPage
              hunt={hunt}
              encounter={encounter}
              setEncounterId={(encounterId) => { setHunt({ ...hunt, encounterId }); setSelectedTarget(null); setRecording(false); }}
              sidIndex={sidIndex}
              setSidIndex={(index) => { setSidIndex(index); setSelectedTarget(null); }}
              sidCandidates={sidCandidates}
              currentSid={currentSid}
              seeds={seeds}
              targetSeedIndex={targetSeedIndex}
              seedLoading={seedLoading}
              seedError={seedError}
              searchSettings={targetSearch}
              setSearchSettings={setTargetSearch}
              selectedTarget={selectedTarget}
              setSelectedTarget={setSelectedTarget}
              onBack={() => moveTo("setup")}
              onContinue={() => { if (selectedTarget) { setRecording(false); moveTo("attempt"); } }}
            />
          )}
          {selectedTarget && currentSid !== null && (
            <AttemptPage
              view={stage === "attempt" || stage === "result" ? stage : null}
              hunt={hunt}
              encounter={encounter}
              target={selectedTarget}
              seeds={seeds}
              seedError={seedError}
              targetSeedIndex={Math.max(0, seeds.findIndex((entry) => entry.initialSeed === selectedTarget.initialSeed && entry.seedTime === selectedTarget.seedTime))}
              currentSid={currentSid}
              canRejectSid={hunt.sidMode === "new-save" && sidIndex + 1 < sidCandidates.length}
              calibration={calibration}
              setCalibration={setCalibration}
              observedNature={observedNature}
              setObservedNature={setObservedNature}
              recentHits={recentHits}
              onHitRecorded={(observation) => setRecentHits((hits) => [...hits, observation].slice(-8))}
              attempts={attempts}
              setAttempts={setAttempts}
              recording={recording}
              setRecording={setRecording}
              resultVersion={resultVersion}
              setResultVersion={setResultVersion}
              focusRequest={timerFocusRequest}
              resultFocusRequest={resultFocusRequest}
              cueStyle={cueStyle}
              onCueStyleChange={onCueStyleChange}
              audioState={precisionAudio.current}
              timersActive
              onTimerFinished={() => { moveTo("result"); setResultFocusRequest((request) => request + 1); }}
              onResultConfirmed={() => moveTo("attempt")}
              onSidRejected={() => {
                setAttempts((value) => value + 1);
                if (sidIndex + 1 < sidCandidates.length) {
                  setSidIndex((value) => value + 1);
                  setSelectedTarget(null);
                  moveTo("target");
                }
              }}
            />
          )}
          {(stage === "attempt" || stage === "result") && (!selectedTarget || currentSid === null) && (
            <div className="tool-empty">
              <h1>{setupComplete ? "Choose a target first" : "Finish setup first"}</h1>
              <button className="button button-primary" onClick={() => moveTo(setupComplete ? "target" : "setup")}>{setupComplete ? "Choose a target" : "Back to setup"}</button>
            </div>
          )}
      </main>
    </div>
  );
}

function SidSetupTimer({ cueStyle, onCueStyleChange, audioState, active, durationMs, targetFrameMs }: { cueStyle: CueStyle; onCueStyleChange: (style: CueStyle) => void; audioState: PrecisionAudioState; active: boolean; durationMs: number; targetFrameMs: number }) {
  const [open, setOpen] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const huntPhases = useMemo<TimerPhase[]>(() => [{ label: `${SID_SETUP_ADVANCES.toLocaleString()} advances`, ms: durationMs }], [durationMs]);

  useEffect(() => {
    if (open) dialog.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = dialog.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && (activeElement === last || !panel.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (activeElement === first || activeElement === panel || !panel.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [close, open]);

  return (
    <div className="sid-setup-timer">
      <button ref={trigger} type="button" className="sid-timer-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span><b>1,500-advance setup timer</b><small>Run this while you create the save so its Secret ID lands on a known advance.</small></span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && createPortal(
        <div className="sid-timer-modal">
          <button type="button" className="sid-timer-scrim" tabIndex={-1} aria-label="Close the setup timer" onClick={close} />
          <div ref={dialog} className="sid-timer-dialog" role="dialog" aria-modal="true" aria-labelledby="sid-setup-timer-title" tabIndex={-1}>
            <div className="sid-timer-modal-head">
              <h2 id="sid-setup-timer-title">1,500-advance setup timer</h2>
              <button type="button" className="sid-timer-close" aria-label="Close the setup timer" onClick={close}><X aria-hidden="true" /></button>
            </div>
            <div className="sid-timer-panel">
              <div className="sid-timer-timer">
                <GuidedTimer
                  huntPhases={huntPhases}
                  practiceMs={PRACTICE_COUNTDOWN_MS}
                  targetFrameMs={targetFrameMs}
                  active={active && open}
                  focusRequest={0}
                  practiceMode={practiceMode}
                  onPracticeModeChange={setPracticeMode}
                  cueStyle={cueStyle}
                  onCueStyleChange={onCueStyleChange}
                  showHuntCueStyle
                  audioState={audioState}
                />
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function SeedInputSettings({ hunt, setHunt }: { hunt: Hunt; setHunt: (hunt: Hunt) => void }) {
  const showRevision = hunt.language === "Japanese" && hunt.game === "FireRed";
  const [expanded, setExpanded] = useState(() =>
    hunt.sound !== DEFAULT_HUNT.sound || hunt.buttonMode !== DEFAULT_HUNT.buttonMode || hunt.seedButton !== DEFAULT_HUNT.seedButton || (showRevision && hunt.revision !== DEFAULT_HUNT.revision));
  const update = <K extends keyof Hunt>(key: K, value: Hunt[K]) => setHunt({ ...hunt, [key]: value });
  const summary = [`${hunt.sound} sound`, `${hunt.buttonMode} buttons`, `Seed on ${hunt.seedButton}`, ...(showRevision ? [`Revision ${hunt.revision}`] : [])].join(" · ");

  return (
    <div className={`setup-disclosure ${expanded ? "expanded" : ""}`}>
      <button type="button" className="setup-disclosure-toggle" aria-expanded={expanded} aria-controls="setup-seed-input-panel" onClick={() => setExpanded((value) => !value)}>
        <span><b>Seed input settings</b><small>{summary}</small></span>
        <ChevronDown aria-hidden="true" />
      </button>
      {expanded && <div id="setup-seed-input-panel" className="setup-disclosure-panel setup-seed-options">
        <label><span>Sound</span><select aria-label="Sound" value={hunt.sound} onChange={(event) => update("sound", event.target.value as Hunt["sound"])}><option>Mono</option><option>Stereo</option></select></label>
        <label><span>Button mode</span><select aria-label="Button mode" value={hunt.buttonMode} onChange={(event) => { const buttonMode = event.target.value as Hunt["buttonMode"]; setHunt({ ...hunt, buttonMode, seedButton: hunt.seedButton === "L" && buttonMode !== "L=A" ? "A" : hunt.seedButton }); }}><option>L=A</option><option>Help</option><option>LR</option></select></label>
        <label><span>Seed button</span><select aria-label="Seed button" value={hunt.seedButton} onChange={(event) => update("seedButton", event.target.value as Hunt["seedButton"])}><option>A</option>{hunt.language !== "Japanese" && <option>Start</option>}{hunt.language !== "Japanese" && hunt.buttonMode === "L=A" && <option>L</option>}</select></label>
        {showRevision && <label><span>Revision</span><select aria-label="Game revision" value={hunt.revision} onChange={(event) => update("revision", event.target.value as Hunt["revision"])}><option>1.0</option><option>1.1</option></select></label>}
      </div>}
    </div>
  );
}

function SetupPage({ hunt, setHunt, trainerIdValid, cueStyle, onCueStyleChange, audioState, onContinue }: {
  hunt: Hunt;
  setHunt: (hunt: Hunt) => void;
  trainerIdValid: boolean;
  cueStyle: CueStyle;
  onCueStyleChange: (style: CueStyle) => void;
  audioState: PrecisionAudioState;
  onContinue: () => void;
}) {
  const update = <K extends keyof Hunt>(key: K, value: Hunt[K]) => setHunt({ ...hunt, [key]: value });
  const secretId = Number(hunt.secretId);
  const secretIdValid = hunt.sidMode !== "known" || (hunt.secretId !== "" && Number.isInteger(secretId) && secretId >= 0 && secretId <= 65535);
  const trainerIdError = hunt.trainerId !== "" && !trainerIdValid ? "Trainer ID must be a number from 0 to 65535." : "";
  const secretIdError = hunt.sidMode === "known" && hunt.secretId !== "" && !secretIdValid ? "Secret ID must be a number from 0 to 65535." : "";

  return (
    <section className="setup-screen">
      <div className="setup-scroll">
        <div className="setup-page">
          <h1>Set up your hunt</h1>
          <div className="setup-form" aria-label="Hunt setup">
            <section className="setup-step" aria-labelledby="setup-game-heading">
              <h2 id="setup-game-heading"><span className="setup-step-index" aria-hidden="true">1</span>Your game</h2>
              <div className="setup-fields">
                <div className="setup-row">
                  <div className="setup-row-label">Version</div>
                  <div className="setup-row-control setup-segments two">{(["FireRed", "LeafGreen"] as Game[]).map((game) => <button type="button" aria-pressed={hunt.game === game} className={hunt.game === game ? "selected" : ""} onClick={() => update("game", game)} key={game}><span>{game}</span></button>)}</div>
                </div>

                <div className="setup-row">
                  <div className="setup-row-label">Console</div>
                  <div className="setup-row-control">
                    <select aria-label="Game system" aria-describedby="setup-console-note" value={hunt.console} onChange={(event) => update("console", event.target.value as ConsoleName)}><option>Switch</option><option>Switch 2</option><option>Game Boy Advance</option><option>Game Boy Player</option><option value="Nintendo DS">Nintendo DS (GBA slot)</option><option value="Nintendo 3DS">Nintendo 3DS (open_agb_firm)</option></select>
                    <p className="setup-field-note" id="setup-console-note">Switching consoles resets the calibration saved from your past attempts.</p>
                  </div>
                </div>

                <div className="setup-row">
                  <div className="setup-row-label">Language</div>
                  <div className="setup-row-control">
                    <select aria-label="Game language" aria-describedby="setup-language-note" value={hunt.language} onChange={(event) => setHunt({ ...hunt, language: event.target.value, seedButton: event.target.value === "Japanese" ? "A" : hunt.seedButton })}><option>English</option><option>Japanese</option><option>French</option><option>German</option><option>Italian</option><option>Spanish</option></select>
                    <p className="setup-field-note" id="setup-language-note">Only English and Japanese have their own seed tables; others use the English table with a language-specific SID offset.</p>
                  </div>
                </div>

                {!isSwitchConsole(hunt.console) && <div className="setup-row">
                  <div className="setup-row-label">Seed input</div>
                  <div className="setup-row-control"><SeedInputSettings hunt={hunt} setHunt={setHunt} /></div>
                </div>}
              </div>
            </section>

            <section className="setup-step" aria-labelledby="setup-save-heading">
              <h2 id="setup-save-heading"><span className="setup-step-index" aria-hidden="true">2</span>Your save</h2>
              <div className="setup-fields">
                <div className="setup-row setup-trainer-id-row">
                  <div className="setup-row-label">Trainer ID</div>
                  <div className="setup-row-control">
                    <input className="setup-trainer-id-input" aria-label="Trainer ID" inputMode="numeric" maxLength={5} value={hunt.trainerId} onChange={(event) => update("trainerId", event.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(trainerIdError)} aria-describedby="setup-trainer-id-note" />
                    <p className="setup-field-note" id="setup-trainer-id-note">The five-digit ID on your Trainer Card, in the Pokédex menu.</p>
                    {trainerIdError && <p className="setup-field-error" role="alert">{trainerIdError}</p>}
                  </div>
                </div>

                <div className="setup-row setup-sid-row">
                  <div className="setup-row-label" id="setup-secret-id-label">Secret ID</div>
                  <div className="setup-row-control">
                    <div className="setup-segments two" role="group" aria-label="Secret ID setup">{SID_MODES.map(({ mode, label }) => <button type="button" key={mode} aria-pressed={hunt.sidMode === mode} className={hunt.sidMode === mode ? "selected" : ""} onClick={() => setHunt({ ...hunt, sidMode: mode })}>{label}</button>)}</div>

                    {hunt.sidMode === "known" && <div className="setup-secret-id-field"><input autoFocus inputMode="numeric" maxLength={5} value={hunt.secretId} onChange={(event) => update("secretId", event.target.value.replace(/\D/g, "").slice(0, 5))} aria-labelledby="setup-secret-id-label" aria-invalid={Boolean(secretIdError)} /></div>}
                    {secretIdError && <p className="setup-field-error" role="alert">{secretIdError}</p>}

                    {hunt.sidMode === "new-save" && <>
                      <p className="setup-field-note">These are the Secret IDs your save could have. You confirm which one is yours from the first hunt result.</p>
                      <div className="setup-subfield">
                        <p className="setup-sub-label" id="setup-rival-label">When this save was created, was the rival’s name typed in?</p>
                        <div className="setup-segments two" role="group" aria-labelledby="setup-rival-label">
                          <button type="button" aria-pressed={hunt.rivalNamed} className={hunt.rivalNamed ? "selected" : ""} onClick={() => update("rivalNamed", true)}>Yes, I typed a name</button>
                          <button type="button" aria-pressed={!hunt.rivalNamed} className={!hunt.rivalNamed ? "selected" : ""} onClick={() => update("rivalNamed", false)}>No, I picked a preset</button>
                        </div>
                      </div>
                    </>}

                    {hunt.sidMode === "new-save" && <SidSetupTimer cueStyle={cueStyle} onCueStyleChange={onCueStyleChange} audioState={audioState} active durationMs={consoleFramesToMs(SID_SETUP_ADVANCES, hunt.console)} targetFrameMs={consoleFramesToMs(1, hunt.console)} />}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <WizardFooter canBack={false} canNext={trainerIdValid && secretIdValid} onBack={() => undefined} onNext={onContinue} nextLabel="Choose a shiny Pokémon" />
    </section>
  );
}

function WorkflowNavigation({ current, onSetup, onTarget, onAttempt, onResult }: { current: Stage; onSetup: () => void; onTarget: () => void; onAttempt: () => void; onResult: () => void }) {
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    nav.current?.querySelector<HTMLButtonElement>("button.current")?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [current]);

  return <nav ref={nav} className="setup-nav" aria-label="Hunt navigation"><button type="button" className={current === "setup" ? "current" : ""} aria-current={current === "setup" ? "step" : undefined} onClick={onSetup}>Setup</button><button type="button" className={current === "target" ? "current" : ""} aria-current={current === "target" ? "step" : undefined} onClick={onTarget}>Shiny target</button><button type="button" className={current === "attempt" ? "current" : ""} aria-current={current === "attempt" ? "step" : undefined} onClick={onAttempt}>Timer</button><button type="button" className={current === "result" ? "current" : ""} aria-current={current === "result" ? "step" : undefined} onClick={onResult}>Results</button></nav>;
}

function WizardFooter({ canBack, canNext, showNext = true, onBack, onNext, nextLabel = "Next" }: { canBack: boolean; canNext: boolean; showNext?: boolean; onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return <footer className="fixed-actions wizard-actions">{canBack && <button type="button" className="button button-text" onClick={onBack}>Back</button>}{showNext && <button type="button" className="button button-primary" disabled={!canNext} onClick={onNext}>{nextLabel}</button>}</footer>;
}

function TargetPage({
  hunt,
  encounter,
  setEncounterId,
  sidIndex,
  setSidIndex,
  sidCandidates,
  currentSid,
  seeds,
  targetSeedIndex,
  seedLoading,
  seedError,
  searchSettings,
  setSearchSettings,
  selectedTarget,
  setSelectedTarget,
  onBack,
  onContinue,
}: {
  hunt: Hunt;
  encounter: Encounter;
  setEncounterId: (encounterId: string) => void;
  sidIndex: number;
  setSidIndex: (index: number) => void;
  sidCandidates: Array<{ advance: number; sid: number }>;
  currentSid: number | null;
  seeds: SeedEntry[];
  targetSeedIndex: number;
  seedLoading: boolean;
  seedError: string;
  searchSettings: TargetSearchSettings;
  setSearchSettings: (settings: TargetSearchSettings) => void;
  selectedTarget: TargetOption | null;
  setSelectedTarget: (target: TargetOption | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { natureFilter, genderFilter, centerSeed, seedRadius, minAdvances, maxAdvances, overworldFrames, showSearch } = searchSettings;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const switchConsole = isSwitchConsole(hunt.console);
  const genderless = isGenderless(encounter.species);
  const rowClasses = `${switchConsole ? "" : "retail"} ${genderless ? "genderless" : ""}`;
  const targetOverworldFrames = switchConsole ? overworldFrames : 0;
  const updateSearchSettings = (changes: Partial<TargetSearchSettings>) => setSearchSettings({ ...searchSettings, ...changes });
  const centerIndex = useMemo(() => {
    if (!centerSeed) return targetSeedIndex;
    const savedIndex = seeds.findIndex((seed) => seed.initialSeed === centerSeed.initialSeed && seed.seedTime === centerSeed.seedTime);
    return savedIndex >= 0 ? savedIndex : targetSeedIndex;
  }, [centerSeed, seeds, targetSeedIndex]);

  const targets = useMemo(() => {
    if (seeds.length === 0 || currentSid === null || !hunt.trainerId || minAdvances > maxAdvances) return [];
    return searchTargets({
      seeds,
      targetSeedIndex: Math.max(0, Math.min(seeds.length - 1, centerIndex)),
      seedRadius,
      minAdvances,
      maxAdvances,
      overworldFrames: targetOverworldFrames,
      trainerId: Number(hunt.trainerId),
      secretId: currentSid,
      species: encounter.species,
      consoleName: hunt.console,
    });
  }, [centerIndex, currentSid, encounter.species, hunt.console, hunt.trainerId, maxAdvances, minAdvances, targetOverworldFrames, seedRadius, seeds, targetSeedIndex]);

  useEffect(() => {
    if (!seedLoading && seeds.length > 0 && selectedTarget && !targets.some((target) => targetKey(target) === targetKey(selectedTarget))) setSelectedTarget(null);
  }, [seedLoading, seeds.length, selectedTarget, setSelectedTarget, targets]);

  const natureOptions = ["Any nature", ...Array.from(new Set(targets.map((target) => target.nature))).sort()];
  const visibleTargets = useMemo(() =>
    targets.filter((target) =>
      (natureFilter === "Any nature" || target.nature === natureFilter) &&
      (genderless || genderFilter === "Any gender" || target.gender === genderFilter)
    ), [genderFilter, genderless, natureFilter, targets]);

  const selectedKey = selectedTarget ? targetKey(selectedTarget) : "";

  return (
    <section className="target-screen">
      <div className="target-scroll-area">
      <header className="screen-heading"><div><h1>Choose your shiny {encounter.species}</h1></div></header>

      <div className="target-control-area"><div className={`target-tools ${filtersOpen ? "filters-open" : ""}`}>
        <label><span>Encounter</span><select aria-label="Encounter" value={encounter.id} onChange={(event) => setEncounterId(event.target.value)}>{groupedEncounters(hunt.game).map((group) => <optgroup key={group.group} label={group.group}>{group.encounters.map((option) => <option key={option.id} value={option.id}>{option.species}</option>)}</optgroup>)}</select></label>
        {hunt.sidMode === "new-save" && <label><span>Secret ID candidate</span><select aria-label="Secret ID candidate" value={sidIndex} onChange={(event) => setSidIndex(Number(event.target.value))}>{sidCandidates.map((candidate, candidateIndex) => <option key={candidate.advance} value={candidateIndex}>#{candidateIndex + 1} · SID {candidate.sid} · advance {candidate.advance}</option>)}</select></label>}

        <button type="button" className={`target-filters-toggle ${filtersOpen ? "active" : ""}`} aria-expanded={filtersOpen} aria-controls="target-filter-fields" onClick={() => setFiltersOpen((open) => !open)}>Filters</button>
        <div className="target-filter-fields" id="target-filter-fields">
          <label><span>Nature</span><select value={natureFilter} onChange={(event) => updateSearchSettings({ natureFilter: event.target.value })}>{natureOptions.map((nature) => <option key={nature}>{nature}</option>)}</select></label>
          {!genderless && <label><span>Gender</span><select value={genderFilter} onChange={(event) => updateSearchSettings({ genderFilter: event.target.value as TargetSearchSettings["genderFilter"] })}><option>Any gender</option><option>Male</option><option>Female</option></select></label>}
          <button type="button" className={`range-toggle ${showSearch ? "active" : ""}`} onClick={() => updateSearchSettings({ showSearch: !showSearch })}>Search range</button>
        </div>
      </div>

      {showSearch && <div className="target-search-controls">
        <label><span>Center seed</span><select value={Math.max(0, Math.min(seeds.length - 1, centerIndex))} disabled={seeds.length === 0} onChange={(event) => { updateSearchSettings({ centerSeed: seeds[Number(event.target.value)] ?? null }); setSelectedTarget(null); }}>{seeds.map((seed, seedIndex) => <option key={`${seed.initialSeed}-${seedIndex}`} value={seedIndex}>{seed.initialSeed.toString(16).toUpperCase().padStart(4, "0")}</option>)}</select></label>
        <RangeNumberInput label="Seeds ±" value={seedRadius} min={0} max={200} onCommit={(value) => { updateSearchSettings({ seedRadius: value }); setSelectedTarget(null); }} />
        <RangeNumberInput label="First advance" value={minAdvances} min={0} max={100000} onCommit={(value) => { updateSearchSettings({ minAdvances: value }); setSelectedTarget(null); }} />
        <RangeNumberInput label="Last advance" value={maxAdvances} min={0} max={100000} onCommit={(value) => { updateSearchSettings({ maxAdvances: value }); setSelectedTarget(null); }} />
        {switchConsole && <RangeNumberInput label="Overworld frames" value={overworldFrames} min={0} max={10000} onCommit={(value) => { updateSearchSettings({ overworldFrames: value }); setSelectedTarget(null); }} />}
      </div>}</div>

      <div className="target-table">
        <div className={`target-table-head ${rowClasses}`}><span /><span>Initial seed</span><span>Advance</span>{switchConsole && <span>Continue screen frames</span>}<span>PID</span><span>Nature</span>{!genderless && <span>Gender</span>}<span>IVs</span></div>
        <div className="target-table-body">
          {seedLoading && <div className="table-empty"><RefreshCcw className="spin" /> Loading targets…</div>}
          {seedError && <div className="table-empty">{seedError}</div>}
          {!seedLoading && !seedError && visibleTargets.map((target) => (
            <button type="button" className={`target-row ${rowClasses} ${selectedKey === targetKey(target) ? "selected" : ""}`} aria-pressed={selectedKey === targetKey(target)} key={targetKey(target)} onClick={() => setSelectedTarget(target)}>
              <span className="row-radio">{selectedKey === targetKey(target) && <Check />}</span>
              <RowCell label="Initial seed"><b>{target.seed}</b></RowCell>
              <RowCell label="Advance"><b>{target.advance.toLocaleString()}</b></RowCell>
              {switchConsole && <RowCell label="Continue frames"><b>{target.continueFrames.toLocaleString()}</b></RowCell>}
              <RowCell label="PID"><b>{target.pid.toString(16).toUpperCase().padStart(8, "0")}</b></RowCell>
              <RowCell label="Nature"><b>{target.nature}</b></RowCell>
              {!genderless && <RowCell label="Gender"><b>{target.gender}</b></RowCell>}
              <IvSpread ivs={target.ivs} />
            </button>
          ))}
          {!seedLoading && !seedError && visibleTargets.length === 0 && <div className="table-empty">{targets.length > 0 ? "No targets match those filters." : "No targets in this range. Open Search range to widen it."}</div>}
        </div>
      </div>
      </div>
      <WizardFooter canBack canNext={Boolean(selectedTarget)} onBack={onBack} onNext={onContinue} nextLabel="Use selected target" />
    </section>
  );
}

function RowCell({ label, children }: { label: string; children: ReactNode }) {
  return <span className="row-cell"><small className="cell-label" aria-hidden="true">{label}</small>{children}</span>;
}

function IvSpread({ ivs, className = "" }: { ivs: SearchTarget["ivs"]; className?: string }) {
  return (
    <div className={`iv-spread ${className}`} aria-label={`IVs: ${STAT_LABELS.map((label, index) => `${label} ${ivs[index]}`).join(", ")}`}>
      {STAT_LABELS.map((label, index) => <span key={label}><small>{label}</small><b>{ivs[index]}</b></span>)}
    </div>
  );
}

function targetKey(target: TargetOption): string {
  return `${target.consoleName}-${target.initialSeed}-${target.seedTime}-${target.advance}-${target.pid}-${target.overworldFrames}`;
}

function legacyTargetKey(target: TargetOption): string {
  return `${target.initialSeed}-${target.seedTime}-${target.advance}-${target.pid}`;
}

function hitResultKey(hit: HitResult): string {
  return `${targetKey(hit)}-${hit.seedIndex}`;
}

function RangeNumberInput({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return <label><span>{label}</span><input aria-label={label} type="number" min={min} max={max} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); } }} /></label>;
}

function encounterTimerPhases(target: TargetOption, encounter: Encounter, calibration: Calibration): TimerPhase[] {
  const consoleName = target.consoleName;
  const seedPhase = { label: "Initial seed", ms: target.seedMs + calibration.seed };
  if (!isSwitchConsole(consoleName)) {
    return [seedPhase, { label: "Target advance", ms: eonAdvancePhaseMs(target.continueFrames - encounter.frameOffset, calibration.continueMs, consoleName) }];
  }
  return [
    seedPhase,
    { label: "Continue screen", ms: eonAdvancePhaseMs(target.continueFrames, calibration.continueMs, consoleName) },
    { label: "Target advance", ms: eonAdvancePhaseMs(target.overworldFrames - encounter.frameOffset, 0, consoleName) },
  ];
}

function AttemptPage({
  view,
  hunt,
  encounter,
  target,
  seeds,
  seedError,
  targetSeedIndex,
  currentSid,
  canRejectSid,
  calibration,
  setCalibration,
  observedNature,
  setObservedNature,
  recentHits,
  onHitRecorded,
  attempts,
  setAttempts,
  recording,
  setRecording,
  resultVersion,
  setResultVersion,
  focusRequest,
  resultFocusRequest,
  cueStyle,
  onCueStyleChange,
  audioState,
  timersActive,
  onTimerFinished,
  onResultConfirmed,
  onSidRejected,
}: {
  view: "attempt" | "result" | null;
  hunt: Hunt;
  encounter: Encounter;
  target: TargetOption;
  seeds: SeedEntry[];
  seedError: string;
  targetSeedIndex: number;
  currentSid: number;
  canRejectSid: boolean;
  calibration: Calibration;
  setCalibration: (calibration: Calibration) => void;
  observedNature: string;
  setObservedNature: (nature: string) => void;
  recentHits: HitObservation[];
  onHitRecorded: (observation: HitObservation) => void;
  attempts: number;
  setAttempts: (attempts: number | ((value: number) => number)) => void;
  recording: boolean;
  setRecording: (recording: boolean) => void;
  resultVersion: number;
  setResultVersion: (version: number | ((value: number) => number)) => void;
  focusRequest: number;
  resultFocusRequest: number;
  cueStyle: CueStyle;
  onCueStyleChange: (cueStyle: CueStyle) => void;
  audioState: PrecisionAudioState;
  timersActive: boolean;
  onTimerFinished: () => void;
  onResultConfirmed: () => void;
  onSidRejected: () => void;
}) {
  const [practiceMode, setPracticeMode] = useState(false);
  const huntPhases = useMemo(() => encounterTimerPhases(target, encounter, calibration), [calibration, encounter, target]);
  const practiceMs = PRACTICE_COUNTDOWN_MS;

  const handleApply = (hitSeedMs: number, hitContinueFrames: number, apply: boolean) => {
    const openingDelta = target.seedMs - hitSeedMs;
    const continueDelta = target.continueFrames - hitContinueFrames;
    onHitRecorded({ openingDelta, continueDelta });
    if (apply) {
      const nextCalibration = {
        seed: calibration.seed + openingDelta,
        continueMs: calibration.continueMs + eonAdvanceCalibrationMs(target.continueFrames, hitContinueFrames, target.consoleName),
      };
      setCalibration(nextCalibration);
    }
    setAttempts((value) => value + 1);
    onResultConfirmed();
  };

  return (
    <>
      <section className="timer-screen attempt-view" hidden={view !== "attempt"}>
        {seedError && <p className="setup-field-error seed-error-note" role="alert">{seedError}</p>}
        <GuidedTimer
          key={`${targetKey(target)}-${attempts}`}
          huntPhases={huntPhases}
          practiceMs={practiceMs}
          targetFrameMs={consoleFramesToMs(1, target.consoleName)}
          active={view === "attempt" && timersActive}
          focusRequest={focusRequest}
          practiceMode={practiceMode}
          onPracticeModeChange={setPracticeMode}
          cueStyle={cueStyle}
          onCueStyleChange={onCueStyleChange}
          showHuntCueStyle
          audioState={audioState}
          onFinished={() => { setResultVersion((version) => version + 1); setRecording(true); onTimerFinished(); }}
        />
        <div className="timing-controls">
          <span className="timing-controls-label">Calibration</span>
          <AdjustmentControl label={isSwitchConsole(target.consoleName) ? "Title timer" : "Pre-timer"} unit="ms" value={calibration.seed} onChange={(seed) => setCalibration({ ...calibration, seed })} />
          <AdjustmentControl label={isSwitchConsole(target.consoleName) ? "Load save timer" : "Target frame timer"} unit="ms" value={calibration.continueMs} onChange={(continueMs) => setCalibration({ ...calibration, continueMs })} />
        </div>
      </section>
      {recording && <div className="result-workspace" hidden={view !== "result"}>
        <ResultEntry
          key={`${targetKey(target)}-${resultVersion}`}
          encounter={encounter}
          hunt={hunt}
          target={target}
          seeds={seeds}
          seedError={seedError}
          targetSeedIndex={targetSeedIndex}
          currentSid={currentSid}
          canRejectSid={canRejectSid}
          recentHits={recentHits}
          calibration={calibration}
          resultVersion={resultVersion}
          observedNature={observedNature}
          onObservedNatureChange={setObservedNature}
          active={view === "result"}
          focusRequest={resultFocusRequest}
          onApply={handleApply}
          onSidRejected={() => { onHitRecorded({ openingDelta: 0, continueDelta: 0 }); onSidRejected(); }}
        />
      </div>}
      {view === "result" && !recording && <div className="tool-empty"><h1>No result yet</h1></div>}
    </>
  );
}

function AdjustmentControl({ label, unit, value, onChange }: { label: string; unit: string; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    if (draft.trim() === "" || draft === "-") {
      setDraft(String(value));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const rounded = Math.round(parsed);
    setDraft(String(rounded));
    if (rounded !== value) onChange(rounded);
  };

  const updateDraft = (nextDraft: string) => {
    setDraft(nextDraft);
    if (nextDraft.trim() === "" || nextDraft === "-") return;
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) return;
    const rounded = Math.round(parsed);
    if (rounded !== value) onChange(rounded);
  };

  return (
    <label className="adjustment-control">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Decrease ${label.toLowerCase()} adjustment by 1 ${unit}`} onClick={() => onChange(value - 1)}>−</button>
        <span className="adjustment-input-wrap"><input type="number" step="1" aria-label={`${label} adjustment (${unit})`} value={draft} onChange={(event) => updateDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); } }} /><small>{unit}</small></span>
        <button type="button" aria-label={`Increase ${label.toLowerCase()} adjustment by 1 ${unit}`} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </label>
  );
}

function formatSignedMs(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0 ms";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString()} ms`;
}

function formatHitOffset(delta: number, unit: "ms", matchedLabel: string): string {
  if (delta === 0) return matchedLabel;
  return `${Math.abs(delta).toLocaleString()} ${unit} ${delta > 0 ? "early" : "late"}`;
}

function createResultDraft(target: TargetOption, encounter: Encounter, resultVersion: number): ResultDraft {
  const advanceRadius = encounterCalibrationRadius(encounter);
  return {
    targetKey: targetKey(target),
    resultVersion,
    gender: "Male",
    snapshots: [{ id: 0, level: encounter.level, stats: ["", "", "", "", "", ""] }],
    matches: null,
    selectedPossibleHitKey: "",
    seedRadius: DEFAULT_HIT_SEED_RADIUS,
    minAdvances: Math.max(0, target.advance - advanceRadius),
    maxAdvances: target.advance + advanceRadius,
  };
}

function loadResultDraft(target: TargetOption, encounter: Encounter, resultVersion: number): ResultDraft {
  const fallback = createResultDraft(target, encounter, resultVersion);
  try {
    const value = window.localStorage.getItem(RESULT_DRAFT_STORAGE_KEY);
    if (!value) return fallback;
    const saved = JSON.parse(value) as Partial<ResultDraft>;
    if ((saved.targetKey !== fallback.targetKey && saved.targetKey !== legacyTargetKey(target)) || saved.resultVersion !== resultVersion) return fallback;
    const snapshots = Array.isArray(saved.snapshots) ? saved.snapshots.map((snapshot, index) => ({
      id: Number.isInteger(snapshot?.id) ? snapshot.id : index,
      level: Number.isFinite(snapshot?.level) ? Math.max(1, Math.min(100, Math.round(snapshot.level))) : Math.min(100, encounter.level + index),
      stats: Array.isArray(snapshot?.stats) && snapshot.stats.length === 6
        ? snapshot.stats.map((stat) => String(stat).replace(/\D/g, "").slice(0, 3))
        : ["", "", "", "", "", ""],
    })) : fallback.snapshots;
    const matches = saved.matches === null
      ? null
      : Array.isArray(saved.matches)
        ? saved.matches
            .filter((match) => Number.isFinite(match?.advance) && Array.isArray(match?.ivs) && match.ivs.length === 6)
            .map((match) => ({
              ...match,
              consoleName: match.consoleName ?? target.consoleName,
              overworldFrames: Number.isFinite(match.overworldFrames) ? match.overworldFrames : target.overworldFrames,
            }))
        : null;
    return {
      ...fallback,
      gender: saved.gender === "Female" ? "Female" : "Male",
      snapshots: snapshots.length > 0 ? snapshots : fallback.snapshots,
      matches,
      selectedPossibleHitKey: typeof saved.selectedPossibleHitKey === "string" ? saved.selectedPossibleHitKey : "",
      seedRadius: Number.isFinite(saved.seedRadius) ? Math.max(0, Math.min(200, Math.round(saved.seedRadius!))) : fallback.seedRadius,
      minAdvances: Number.isFinite(saved.minAdvances) ? Math.max(0, Math.min(100000, Math.round(saved.minAdvances!))) : fallback.minAdvances,
      maxAdvances: Number.isFinite(saved.maxAdvances) ? Math.max(0, Math.min(100000, Math.round(saved.maxAdvances!))) : fallback.maxAdvances,
    };
  } catch {
    return fallback;
  }
}

export function ResultEntry({
  encounter,
  hunt,
  target,
  seeds,
  seedError = "",
  targetSeedIndex,
  currentSid,
  canRejectSid,
  recentHits = [],
  calibration = { seed: 0, continueMs: 0 },
  resultVersion = 0,
  observedNature,
  onObservedNatureChange = () => {},
  active = false,
  focusRequest = 0,
  onApply,
  onSidRejected,
}: {
  encounter: Encounter;
  hunt: Hunt;
  target: TargetOption;
  seeds: SeedEntry[];
  seedError?: string;
  targetSeedIndex: number;
  currentSid: number;
  canRejectSid: boolean;
  recentHits?: HitObservation[];
  calibration?: Calibration;
  resultVersion?: number;
  observedNature?: string;
  onObservedNatureChange?: (nature: string) => void;
  active?: boolean;
  focusRequest?: number;
  onApply: (hitSeedMs: number, hitContinueFrames: number, apply: boolean) => void;
  onSidRejected: () => void;
}) {
  const restoredDraft = useMemo(() => loadResultDraft(target, encounter, resultVersion), [encounter, resultVersion, target]);
  const [localNature, setLocalNature] = useState<string>(NATURES[0]);
  const nature = observedNature ?? localNature;
  const [natureDraft, setNatureDraft] = useState(nature);
  const [gender, setGender] = useState<Gender>(restoredDraft.gender);
  const [snapshots, setSnapshots] = useState<ResultSnapshotDraft[]>(restoredDraft.snapshots);
  const [matches, setMatches] = useState<HitResult[] | null>(restoredDraft.matches);
  const [selectedPossibleHitKey, setSelectedPossibleHitKey] = useState(restoredDraft.selectedPossibleHitKey);
  const [applyCalibration, setApplyCalibration] = useState(false);
  const [seedRadius, setSeedRadius] = useState(restoredDraft.seedRadius);
  const [minAdvances, setMinAdvances] = useState(restoredDraft.minAdvances);
  const [maxAdvances, setMaxAdvances] = useState(restoredDraft.maxAdvances);
  const switchConsole = isSwitchConsole(target.consoleName);
  const genderless = isGenderless(encounter.species);
  const rowClasses = `${switchConsole ? "" : "retail"} ${genderless ? "genderless" : ""}`;
  const natureSelectRef = useRef<HTMLSelectElement | null>(null);
  const statInputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);
  const natureInputMethod = useRef<"pointer" | "keyboard" | null>(null);
  const nextSnapshotId = useRef(Math.max(0, ...restoredDraft.snapshots.map((snapshot) => snapshot.id)) + 1);

  const focusStat = (snapshotIndex: number, statIndex: number) => {
    const element = statInputRefs.current[snapshotIndex]?.[statIndex];
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const commitNature = (nextNature: string) => {
    if (observedNature === undefined) setLocalNature(nextNature);
    onObservedNatureChange(nextNature);
    focusStat(0, 0);
  };

  const updateNatureDraft = (nextNature: string) => {
    setNatureDraft(nextNature);
    if (natureInputMethod.current === "pointer") commitNature(nextNature);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(RESULT_DRAFT_STORAGE_KEY, JSON.stringify({
        targetKey: targetKey(target), resultVersion, gender, snapshots, matches,
        selectedPossibleHitKey, seedRadius, minAdvances, maxAdvances,
      } satisfies ResultDraft));
    } catch {
    }
  }, [gender, matches, maxAdvances, minAdvances, resultVersion, seedRadius, selectedPossibleHitKey, snapshots, target]);

  useEffect(() => {
    if (active) {
      natureInputMethod.current = null;
      natureSelectRef.current?.focus({ preventScroll: true });
    }
  }, [active, focusRequest]);

  const updateStat = (snapshotIndex: number, statIndex: number, value: string, autoAdvance = true) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 3);
    const previousLength = snapshots[snapshotIndex].stats[statIndex].length;
    setSnapshots((rows) => rows.map((row, rowIndex) => rowIndex === snapshotIndex
      ? { ...row, stats: row.stats.map((stat, index) => index === statIndex ? cleaned : stat) }
      : row));
    if (autoAdvance && cleaned.length === 2 && previousLength < 2) focusStat(snapshotIndex, statIndex + 1);
  };
  const handleStatBackspace = (snapshotIndex: number, statIndex: number, value: string) => {
    if (value !== "") return false;
    const previousSnapshotIndex = statIndex === 0 ? snapshotIndex - 1 : snapshotIndex;
    const previousStatIndex = statIndex === 0 ? STAT_LABELS.length - 1 : statIndex - 1;
    if (previousSnapshotIndex < 0) return false;
    const previousValue = snapshots[previousSnapshotIndex].stats[previousStatIndex];
    updateStat(previousSnapshotIndex, previousStatIndex, previousValue.slice(0, -1), false);
    focusStat(previousSnapshotIndex, previousStatIndex);
    return true;
  };

  const addLevel = () => {
    const snapshotIndex = snapshots.length;
    const nextLevel = Math.min(100, snapshots[snapshots.length - 1].level + 1);
    setSnapshots((rows) => [...rows, { id: nextSnapshotId.current++, level: nextLevel, stats: ["", "", "", "", "", ""] }]);
    window.setTimeout(() => focusStat(snapshotIndex, 0), 0);
  };

  const removeLevel = (snapshotId: number) => {
    setSnapshots((rows) => rows.filter((row) => row.id !== snapshotId));
  };

  const entriesValid = snapshots.every((snapshot) => snapshot.level >= 1 && snapshot.level <= 100
    && snapshot.stats.every((stat) => stat !== "" && Number(stat) >= 1));
  const runSearch = () => {
    if (!entriesValid || seeds.length === 0) return;
    const exactSeedIndex = seeds.findIndex((seed) => seed.initialSeed === target.initialSeed && seed.seedTime === target.seedTime);
    const results = searchHits({
      seeds,
      targetSeedIndex: exactSeedIndex >= 0 ? exactSeedIndex : targetSeedIndex,
      target,
      search: { seedRadius, minAdvances, maxAdvances },
      trainerId: Number(hunt.trainerId),
      secretId: currentSid,
      species: encounter.species,
      nature: natureDraft,
      gender: genderless ? undefined : gender,
      snapshots: snapshots.map((snapshot) => ({ level: snapshot.level, stats: snapshot.stats.map(Number) })),
    });
    setSelectedPossibleHitKey("");
    setMatches(results);
  };

  const chosenMatch = matches?.length === 1 ? matches[0] : matches?.find((match) => hitResultKey(match) === selectedPossibleHitKey) ?? null;
  const exactTarget = chosenMatch ? targetKey(chosenMatch) === targetKey(target) : false;
  const openingDelta = chosenMatch ? target.seedMs - chosenMatch.seedMs : 0;
  const continueDelta = chosenMatch ? target.continueFrames - chosenMatch.continueFrames : 0;
  const stableTiming = chosenMatch ? isTimingConsistent([...recentHits, { openingDelta, continueDelta }]) : false;
  const loadSaveCorrectionMs = chosenMatch ? eonAdvanceCalibrationMs(target.continueFrames, chosenMatch.continueFrames, target.consoleName) : 0;

  useEffect(() => {
    setApplyCalibration(false);
  }, [chosenMatch ? hitResultKey(chosenMatch) : ""]);

  const useChosenMatch = () => {
    if (!chosenMatch) return;
    if (exactTarget && hunt.sidMode === "new-save") {
      if (canRejectSid) onSidRejected();
      return;
    }
    onApply(chosenMatch.seedMs, chosenMatch.continueFrames, applyCalibration);
  };
  const confirmationLabel = exactTarget && hunt.sidMode === "new-save" ? "Try next Secret ID" : "Next attempt";

  return (
    <section className="result-screen">
      <header className="screen-heading result-heading"><h1>What did you get?</h1>{matches !== null && <span>{matches.length} {matches.length === 1 ? "match" : "matches"}</span>}</header>

      <div className="result-inputs">
        <label><span>Nature</span><select ref={natureSelectRef} value={natureDraft} onPointerDown={() => { natureInputMethod.current = "pointer"; }} onChange={(event) => updateNatureDraft(event.target.value)} onKeyDown={(event) => { natureInputMethod.current = "keyboard"; if (event.key === "Enter") { event.preventDefault(); commitNature(natureDraft); } }} onBlur={() => { if (natureDraft !== nature) commitNature(natureDraft); natureInputMethod.current = null; }}>{NATURES.map((item) => <option key={item}>{item}</option>)}</select></label>
        {!genderless && <label><span>Gender</span><div className="small-segments"><button type="button" aria-label="Male" className={gender === "Male" ? "selected" : ""} onClick={() => setGender("Male")}>Male</button><button type="button" aria-label="Female" className={gender === "Female" ? "selected" : ""} onClick={() => setGender("Female")}>Female</button></div></label>}
        <div className="result-observations">
          {snapshots.map((snapshot, snapshotIndex) => <div className="result-observation-row" key={snapshot.id}>
            <RangeNumberInput label="Level" value={snapshot.level} min={1} max={100} onCommit={(level) => setSnapshots((rows) => rows.map((row) => row.id === snapshot.id ? { ...row, level } : row))} />
            <div className="result-stats">{STAT_LABELS.map((label, statIndex) => <label key={label}><span>{label}</span><input ref={(element) => { if (!statInputRefs.current[snapshotIndex]) statInputRefs.current[snapshotIndex] = []; statInputRefs.current[snapshotIndex][statIndex] = element; }} aria-label={`Level ${snapshot.level} ${label}`} value={snapshot.stats[statIndex]} maxLength={3} inputMode="numeric" onChange={(event) => updateStat(snapshotIndex, statIndex, event.target.value)} onKeyDown={(event) => { if (event.key === "Backspace" && handleStatBackspace(snapshotIndex, statIndex, snapshot.stats[statIndex])) event.preventDefault(); }} /></label>)}</div>
            <div className="level-row-actions">
              {snapshotIndex > 0 && <button type="button" className="remove-level" aria-label={`Remove level ${snapshot.level}`} onClick={() => removeLevel(snapshot.id)}>Remove</button>}
              {snapshotIndex === snapshots.length - 1 && matches !== null && matches.length > 1 && <button type="button" className="add-level" onClick={addLevel}>+ Add level</button>}
            </div>
          </div>)}
        </div>
        <div className="match-range"><RangeNumberInput label="Seeds ±" value={seedRadius} min={0} max={200} onCommit={setSeedRadius} /><RangeNumberInput label="First advance" value={minAdvances} min={0} max={100000} onCommit={setMinAdvances} /><RangeNumberInput label="Last advance" value={maxAdvances} min={0} max={100000} onCommit={setMaxAdvances} /></div>
        <div className="result-search-actions">
          <button type="button" className="button button-secondary result-search" disabled={!entriesValid || seeds.length === 0} onClick={runSearch}>{matches === null ? "Find Pokémon" : "Search again"}</button>
          {seedError && <p className="setup-field-error seed-error-note" role="alert">{seedError}</p>}
        </div>
      </div>

      <div className="result-body">
        {matches !== null && matches.length === 0 && <div className="result-status"><b>No match in this range.</b><span>Check the values or widen the seed and advance ranges.</span></div>}
        {matches !== null && matches.length > 0 && <div className="hit-table" aria-label={matches.length === 1 ? "Identified hit" : "Possible hits"}>
          <div className={`hit-table-head ${rowClasses}`}><span /><span>Seed</span><span>Advance</span>{switchConsole && <span>Continue screen frames</span>}<span>PID</span><span>Nature</span>{!genderless && <span>Gender</span>}</div>
          <div className="hit-table-body">{matches.map((match, matchIndex) => {
            const matchKey = hitResultKey(match);
            const selected = matches.length === 1 || selectedPossibleHitKey === matchKey;
            const manuallySelected = matches.length > 1 && selectedPossibleHitKey === matchKey;
            return <Fragment key={matchKey}>
              <button type="button" className={`hit-row ${rowClasses} ${manuallySelected ? "selected" : ""}`} aria-pressed={selected} onClick={() => setSelectedPossibleHitKey(matchKey)}><span className={`row-radio ${selected ? "chosen" : ""}`}>{selected ? <Check /> : matchIndex + 1}</span><RowCell label="Seed"><b>{match.seed}</b></RowCell><RowCell label="Advance"><b>{match.advance.toLocaleString()}</b></RowCell>{switchConsole && <RowCell label="Continue frames"><b>{match.continueFrames.toLocaleString()}</b></RowCell>}<RowCell label="PID"><b>{match.pid.toString(16).toUpperCase().padStart(8, "0")}</b></RowCell><RowCell label="Nature"><b>{match.nature}</b></RowCell>{!genderless && <RowCell label="Gender"><b>{match.gender}</b></RowCell>}<IvSpread ivs={match.ivs} /></button>
              {selected && <div className="hit-calibration">
                <div className="hit-calibration-values">
                  <span>Calibration</span>
                  <div><small>{switchConsole ? "Initial seed (Title)" : "Initial seed (Pre-timer)"}</small><b>{formatHitOffset(openingDelta, "ms", "Seed matched")}</b><span>{formatSignedMs(calibration.seed)} → {formatSignedMs(calibration.seed + openingDelta)}</span></div>
                  <div><small>{switchConsole ? "Advance (load save)" : "Advance (target frame)"}</small><b>{formatHitOffset(loadSaveCorrectionMs, "ms", "Advance matched")}</b><span>{formatSignedMs(calibration.continueMs)} → {formatSignedMs(calibration.continueMs + loadSaveCorrectionMs)}</span></div>
                </div>
                {stableTiming && !applyCalibration && <span className="timing-recommendation">Recent hits are on track.</span>}
                <div className="hit-calibration-actions">
                  <label className="auto-apply-control"><input type="checkbox" checked={applyCalibration} onChange={(event) => setApplyCalibration(event.target.checked)} /> Apply correction</label>
                  <button type="button" className="button button-primary result-confirm" disabled={exactTarget && hunt.sidMode === "new-save" && !canRejectSid} onClick={useChosenMatch}>{confirmationLabel}</button>
                </div>
              </div>}
            </Fragment>;
          })}</div>
        </div>}
      </div>

    </section>
  );
}

function isTimingConsistent(hits: HitObservation[]): boolean {
  const sample = hits.slice(-CONSISTENCY_SAMPLE_SIZE);
  return sample.length === CONSISTENCY_SAMPLE_SIZE && sample.every((hit) =>
    Math.abs(hit.openingDelta) <= CONSISTENCY_OPENING_MS && Math.abs(hit.continueDelta) <= CONSISTENCY_CONTINUE_FRAMES
  );
}

export default FrlgTool;
