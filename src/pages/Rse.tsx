import { Check, ChevronDown } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GuidedTimer,
  createPrecisionAudioState,
  formatDuration,
  stopPrecisionAudio,
  type PrecisionAudioState,
  type TimerPhase,
} from "../components/PrecisionTimer";
import { NATURES, consoleFramesToMs, type ConsoleName, type Gender } from "../engine/gen3";
import {
  rseAdvanceToMs,
  rseCalibrationMs,
  rseHasFixedSeed,
  rseInitialSeed,
  searchRseHits,
  searchRseTargets,
  type RseBattery,
  type RseHitResult,
  type RseTarget,
  type RseVersion,
  type RsRtcDateTime,
} from "../engine/rse";
import {
  groupedRseEncounters,
  rseEncounterById,
  rseEncounterCalibrationRadius,
  rseEncountersForVersion,
  type RseEncounter,
} from "../engine/rseEncounters";
import {
  RSE_SID_FALLBACK_NOTES,
  RSE_SID_GUIDANCE,
  emeraldSidCandidates,
  rsIdCandidates,
  sidCandidatesFromShiny,
  type RseIdState,
} from "../engine/rseSid";
import { isRseGenderless } from "../engine/rseSpecies";
import { CUE_STYLES, PRACTICE_COUNTDOWN_MS, type CueStyle } from "../engine/timer";

type Stage = "setup" | "target" | "attempt" | "result";

const RSE_CONSOLES: ReadonlyArray<{ value: ConsoleName; label: string }> = [
  { value: "Game Boy Advance", label: "Game Boy Advance" },
  { value: "Game Boy Player", label: "Game Boy Player" },
  { value: "Nintendo DS", label: "Nintendo DS (GBA slot)" },
  { value: "Nintendo 3DS", label: "Nintendo 3DS (open_agb_firm)" },
];

const RSE_VERSIONS: readonly RseVersion[] = ["Ruby", "Sapphire", "Emerald"];
const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"] as const;
const CONSISTENCY_SAMPLE_SIZE = 3;
const CONSISTENCY_ADVANCE_FRAMES = 10;
const STORAGE_KEY = "rngmanip-rse-hunt-v1";
const RESULT_DRAFT_STORAGE_KEY = "rngmanip-rse-result-draft-v1";
const MAX_ADVANCE = 200000;

type Hunt = {
  version: RseVersion;
  console: ConsoleName;
  battery: RseBattery;
  datetime: string;
  encounterId: string;
  trainerId: string;
  secretId: string;
};

type HitObservation = { advanceDelta: number };

type TargetSearchSettings = {
  natureFilter: string;
  genderFilter: "Any gender" | Gender;
  minAdvances: number;
  maxAdvances: number;
  showSearch: boolean;
};

type PersistedState = {
  stage: Stage;
  hunt: Hunt;
  targetSearch: TargetSearchSettings;
  selectedTarget: RseTarget | null;
  calibrationMs: number;
  cueStyle: CueStyle;
  observedNature: string;
  recentHits: HitObservation[];
  attempts: number;
  recording: boolean;
  resultVersion: number;
};

const DEFAULT_HUNT: Hunt = {
  version: "Emerald",
  console: "Game Boy Advance",
  battery: "dry",
  datetime: "",
  encounterId: "rse-starter-treecko",
  trainerId: "",
  secretId: "",
};

const DEFAULT_TARGET_SEARCH: TargetSearchSettings = {
  natureFilter: "Any nature",
  genderFilter: "Any gender",
  minAdvances: 600,
  maxAdvances: 100000,
  showSearch: false,
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value as number))) : fallback;
}

function parseRtcDateTime(value: string): RsRtcDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const rtc: RsRtcDateTime = {
    year,
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (year < 2000 || year > 2099) return null;
  return rtc;
}

function encounterForVersion(encounterId: string, version: RseVersion): string {
  const current = rseEncounterById(encounterId);
  if (current?.versions.includes(version)) return encounterId;
  const available = rseEncountersForVersion(version);
  const counterpart = current && available.find((entry) => entry.species === current.species);
  return counterpart?.id ?? available[0]?.id ?? DEFAULT_HUNT.encounterId;
}

function currentEncounter(hunt: Hunt): RseEncounter {
  return rseEncounterById(hunt.encounterId) ?? rseEncounterById(encounterForVersion(hunt.encounterId, hunt.version))!;
}

function freshState(): PersistedState {
  return {
    stage: "setup",
    hunt: { ...DEFAULT_HUNT },
    targetSearch: { ...DEFAULT_TARGET_SEARCH },
    selectedTarget: null,
    calibrationMs: 0,
    cueStyle: "standard",
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
    const savedHunt = (saved.hunt ?? {}) as Partial<Hunt>;
    const version: RseVersion = RSE_VERSIONS.includes(savedHunt.version as RseVersion) ? savedHunt.version as RseVersion : fallback.hunt.version;
    const consoleName = RSE_CONSOLES.some((entry) => entry.value === savedHunt.console) ? savedHunt.console as ConsoleName : fallback.hunt.console;
    const hunt: Hunt = {
      ...fallback.hunt,
      ...savedHunt,
      version,
      console: consoleName,
      battery: savedHunt.battery === "live" ? "live" : "dry",
      datetime: typeof savedHunt.datetime === "string" ? savedHunt.datetime : "",
      encounterId: encounterForVersion(typeof savedHunt.encounterId === "string" ? savedHunt.encounterId : fallback.hunt.encounterId, version),
      trainerId: typeof savedHunt.trainerId === "string" ? savedHunt.trainerId : "",
      secretId: typeof savedHunt.secretId === "string" ? savedHunt.secretId : "",
    };
    const savedSearch = saved.targetSearch;
    const targetSearch: TargetSearchSettings = {
      natureFilter: typeof savedSearch?.natureFilter === "string" ? savedSearch.natureFilter : DEFAULT_TARGET_SEARCH.natureFilter,
      genderFilter: savedSearch?.genderFilter === "Male" || savedSearch?.genderFilter === "Female" ? savedSearch.genderFilter : "Any gender",
      minAdvances: clampNumber(savedSearch?.minAdvances, 0, MAX_ADVANCE, DEFAULT_TARGET_SEARCH.minAdvances),
      maxAdvances: clampNumber(savedSearch?.maxAdvances, 0, MAX_ADVANCE, DEFAULT_TARGET_SEARCH.maxAdvances),
      showSearch: Boolean(savedSearch?.showSearch),
    };
    const selectedTarget = saved.selectedTarget
      && Array.isArray(saved.selectedTarget.ivs) && saved.selectedTarget.ivs.length === 6
      && Number.isFinite(saved.selectedTarget.advance)
      ? { ...saved.selectedTarget, consoleName: saved.selectedTarget.consoleName ?? hunt.console }
      : null;
    let stage: Stage = saved.stage === "target" || saved.stage === "attempt" || saved.stage === "result" ? saved.stage : "setup";
    if ((stage === "attempt" || stage === "result") && !selectedTarget) stage = "target";
    return {
      stage,
      hunt,
      targetSearch,
      selectedTarget,
      calibrationMs: Number.isFinite(saved.calibrationMs) ? Math.round(saved.calibrationMs!) : 0,
      cueStyle: saved.cueStyle !== undefined && (CUE_STYLES as readonly string[]).includes(saved.cueStyle) ? saved.cueStyle : fallback.cueStyle,
      observedNature: typeof saved.observedNature === "string" && (NATURES as readonly string[]).includes(saved.observedNature) ? saved.observedNature : fallback.observedNature,
      recentHits: Array.isArray(saved.recentHits) ? saved.recentHits.filter((hit) => Number.isFinite(hit?.advanceDelta)).slice(-8) : [],
      attempts: Number.isInteger(saved.attempts) && saved.attempts! >= 0 ? saved.attempts! : 0,
      recording: Boolean(saved.recording && selectedTarget),
      resultVersion: Number.isInteger(saved.resultVersion) && saved.resultVersion! >= 0 ? saved.resultVersion! : 0,
    };
  } catch {
    return fallback;
  }
}

export default function Rse() {
  const restored = useMemo(loadPersistedState, []);
  const precisionAudio = useRef<PrecisionAudioState>(createPrecisionAudioState());
  const [stage, setStage] = useState<Stage>(restored.stage);
  const [hunt, setHunt] = useState<Hunt>(restored.hunt);
  const [targetSearch, setTargetSearch] = useState<TargetSearchSettings>(restored.targetSearch);
  const [selectedTarget, setSelectedTarget] = useState<RseTarget | null>(restored.selectedTarget);
  const [calibrationMs, setCalibrationMs] = useState(restored.calibrationMs);
  const [cueStyle, setCueStyle] = useState<CueStyle>(restored.cueStyle);
  const [observedNature, setObservedNature] = useState(restored.observedNature);
  const [recentHits, setRecentHits] = useState<HitObservation[]>(restored.recentHits);
  const [attempts, setAttempts] = useState(restored.attempts);
  const [recording, setRecording] = useState(restored.recording);
  const [resultVersion, setResultVersion] = useState(restored.resultVersion);
  const [timerFocusRequest, setTimerFocusRequest] = useState(0);
  const [resultFocusRequest, setResultFocusRequest] = useState(0);

  const encounter = useMemo(() => currentEncounter(hunt), [hunt]);
  const trainerId = Number(hunt.trainerId);
  const trainerIdValid = hunt.trainerId !== "" && Number.isInteger(trainerId) && trainerId >= 0 && trainerId <= 65535;
  const secretId = Number(hunt.secretId);
  const secretIdValid = hunt.secretId !== "" && Number.isInteger(secretId) && secretId >= 0 && secretId <= 65535;
  const rtc = useMemo(() => parseRtcDateTime(hunt.datetime), [hunt.datetime]);
  const initialSeed = useMemo(() => {
    try {
      return rseInitialSeed({ version: hunt.version, battery: hunt.battery, datetime: rtc ?? undefined });
    } catch {
      return null;
    }
  }, [hunt.battery, hunt.version, rtc]);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    const audio = precisionAudio.current;
    return () => stopPrecisionAudio(audio);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        stage, hunt, targetSearch, selectedTarget, calibrationMs, cueStyle, observedNature, recentHits, attempts, recording, resultVersion,
      } satisfies PersistedState));
    } catch {
    }
  }, [attempts, calibrationMs, cueStyle, hunt, observedNature, recentHits, recording, resultVersion, selectedTarget, stage, targetSearch]);

  const moveTo = (next: Stage) => setStage(next);
  const setupComplete = trainerIdValid && secretIdValid && initialSeed !== null;

  return (
    <div className="tool-shell">
      <nav className="setup-nav" aria-label="Hunt navigation">
        {([["setup", "Setup"], ["target", "Shiny target"], ["attempt", "Timer"], ["result", "Results"]] as Array<[Stage, string]>).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={stage === value ? "current" : ""}
            aria-current={stage === value ? "step" : undefined}
            onClick={() => {
              moveTo(value);
              if (value === "attempt") setTimerFocusRequest((request) => request + 1);
              if (value === "result") setResultFocusRequest((request) => request + 1);
            }}
          >{label}</button>
        ))}
      </nav>
      <main className="tool-main">
        {stage === "setup" && (
          <SetupPage
            hunt={hunt}
            setHunt={(nextHunt) => {
              if (nextHunt.console !== hunt.console) {
                setCalibrationMs(0);
                setRecentHits([]);
                setAttempts(0);
              }
              setHunt({ ...nextHunt, encounterId: encounterForVersion(nextHunt.encounterId, nextHunt.version) });
              setSelectedTarget(null);
              setRecording(false);
            }}
            initialSeed={initialSeed}
            trainerIdValid={trainerIdValid}
            secretIdValid={secretIdValid}
            canContinue={setupComplete}
            onContinue={() => moveTo("target")}
          />
        )}
        {stage === "target" && (
          <TargetPage
            hunt={hunt}
            encounter={encounter}
            initialSeed={initialSeed}
            trainerId={trainerId}
            secretId={secretId}
            ready={setupComplete}
            setEncounterId={(encounterId) => { setHunt({ ...hunt, encounterId }); setSelectedTarget(null); setRecording(false); }}
            searchSettings={targetSearch}
            setSearchSettings={setTargetSearch}
            selectedTarget={selectedTarget}
            setSelectedTarget={setSelectedTarget}
            onBack={() => moveTo("setup")}
            onContinue={() => { if (selectedTarget) { setRecording(false); moveTo("attempt"); } }}
          />
        )}
        {selectedTarget && setupComplete && (
          <AttemptPage
            view={stage === "attempt" || stage === "result" ? stage : null}
            encounter={encounter}
            target={selectedTarget}
            initialSeed={initialSeed}
            trainerId={trainerId}
            secretId={secretId}
            calibrationMs={calibrationMs}
            setCalibrationMs={setCalibrationMs}
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
            onCueStyleChange={setCueStyle}
            audioState={precisionAudio.current}
            onTimerFinished={() => { moveTo("result"); setResultFocusRequest((request) => request + 1); }}
            onResultConfirmed={() => { moveTo("attempt"); setTimerFocusRequest((request) => request + 1); }}
          />
        )}
        {(stage === "attempt" || stage === "result") && (!selectedTarget || !setupComplete) && (
          <div className="tool-empty">
            <h1>{setupComplete ? "Choose a target first" : "Finish setup first"}</h1>
            <button className="button button-primary" onClick={() => moveTo(setupComplete ? "target" : "setup")}>{setupComplete ? "Choose a target" : "Back to setup"}</button>
          </div>
        )}
      </main>
    </div>
  );
}

function SetupPage({ hunt, setHunt, initialSeed, trainerIdValid, secretIdValid, canContinue, onContinue }: {
  hunt: Hunt;
  setHunt: (hunt: Hunt) => void;
  initialSeed: number | null;
  trainerIdValid: boolean;
  secretIdValid: boolean;
  canContinue: boolean;
  onContinue: () => void;
}) {
  const update = <K extends keyof Hunt>(key: K, value: Hunt[K]) => setHunt({ ...hunt, [key]: value });
  const isEmerald = hunt.version === "Emerald";
  const liveBattery = !isEmerald && hunt.battery === "live";
  const trainerIdError = hunt.trainerId !== "" && !trainerIdValid ? "Trainer ID must be a number from 0 to 65535." : "";
  const secretIdError = hunt.secretId !== "" && !secretIdValid ? "Secret ID must be a number from 0 to 65535." : "";
  const seedNote = isEmerald
    ? "Emerald never seeds its RNG at boot."
    : hunt.battery === "dry"
      ? "A dry battery makes the clock read 2000-01-01 00:00 on every boot."
      : "With a working battery the seed comes from the cartridge's real-time clock. Seconds are ignored.";

  return (
    <section className="setup-screen">
      <div className="setup-scroll">
        <div className="setup-page">
          <h1>Set up your hunt</h1>
          <div className="setup-form" aria-label="Hunt setup">
            <section className="setup-step" aria-labelledby="rse-setup-game-heading">
              <h2 id="rse-setup-game-heading"><span className="setup-step-index" aria-hidden="true">1</span>Your game</h2>
              <div className="setup-fields">
                <div className="setup-row">
                  <div className="setup-row-label">Version</div>
                  <div className="setup-row-control setup-segments three">
                    {RSE_VERSIONS.map((version) => (
                      <button type="button" key={version} aria-pressed={hunt.version === version} className={hunt.version === version ? "selected" : ""} onClick={() => update("version", version)}>{version}</button>
                    ))}
                  </div>
                </div>

                <div className="setup-row">
                  <div className="setup-row-label">Console</div>
                  <div className="setup-row-control">
                    <select aria-label="Game system" aria-describedby="rse-setup-console-note" value={hunt.console} onChange={(event) => update("console", event.target.value as ConsoleName)}>
                      {RSE_CONSOLES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                    </select>
                    <p className="setup-field-note" id="rse-setup-console-note">Switching consoles resets the calibration saved from your past attempts.</p>
                  </div>
                </div>

                <div className="setup-row">
                  <div className="setup-row-label">Initial seed</div>
                  <div className="setup-row-control">
                    {!isEmerald && (
                      <div className="setup-segments two" role="group" aria-label="Cartridge battery state">
                        <button type="button" aria-pressed={hunt.battery === "dry"} className={hunt.battery === "dry" ? "selected" : ""} onClick={() => update("battery", "dry")}>Dry battery</button>
                        <button type="button" aria-pressed={hunt.battery === "live"} className={hunt.battery === "live" ? "selected" : ""} onClick={() => update("battery", "live")}>Working battery</button>
                      </div>
                    )}
                    {liveBattery && (
                      <label className="setup-secret-id-field rse-datetime-field">
                        <span>Cartridge clock at reset</span>
                        <input type="datetime-local" aria-label="Cartridge clock at reset" value={hunt.datetime} onChange={(event) => update("datetime", event.target.value)} aria-invalid={hunt.datetime !== "" && initialSeed === null} />
                      </label>
                    )}
                    <p className="setup-field-note">{seedNote}</p>
                    {initialSeed === null
                      ? <p className="setup-field-error" role="alert">Enter a clock reading between 2000 and 2099 to compute the seed.</p>
                      : <p className="rse-seed-readout">Initial seed <b className="mono">{initialSeed.toString(16).toUpperCase().padStart(4, "0")}</b>{rseHasFixedSeed({ version: hunt.version, battery: hunt.battery }) ? " · fixed on every reset" : " · derived from the clock reading"}</p>}
                  </div>
                </div>
              </div>
            </section>

            <section className="setup-step" aria-labelledby="rse-setup-save-heading">
              <h2 id="rse-setup-save-heading"><span className="setup-step-index" aria-hidden="true">2</span>Your save</h2>
              <div className="setup-fields">
                <div className="setup-row setup-trainer-id-row">
                  <div className="setup-row-label">Trainer ID</div>
                  <div className="setup-row-control">
                    <input className="setup-trainer-id-input" aria-label="Trainer ID" inputMode="numeric" maxLength={5} value={hunt.trainerId} onChange={(event) => update("trainerId", event.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(trainerIdError)} aria-describedby="rse-setup-trainer-id-note" />
                    <p className="setup-field-note" id="rse-setup-trainer-id-note">The five-digit ID on your Trainer Card, in the Pokédex menu.</p>
                    {trainerIdError && <p className="setup-field-error" role="alert">{trainerIdError}</p>}
                  </div>
                </div>

                <div className="setup-row setup-sid-row">
                  <div className="setup-row-label">Secret ID</div>
                  <div className="setup-row-control">
                    <label className="setup-secret-id-field rse-sid-field">
                      <input aria-label="Secret ID" inputMode="numeric" maxLength={5} value={hunt.secretId} onChange={(event) => update("secretId", event.target.value.replace(/\D/g, "").slice(0, 5))} aria-invalid={Boolean(secretIdError)} />
                    </label>
                    {secretIdError && <p className="setup-field-error" role="alert">{secretIdError}</p>}
                    <SidHelper hunt={hunt} initialSeed={initialSeed} onPickSid={(sid) => update("secretId", String(sid))} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <WizardFooter canBack={false} canNext={canContinue} onBack={() => undefined} onNext={onContinue} nextLabel="Choose a shiny Pokémon" />
    </section>
  );
}

function SidHelper({ hunt, initialSeed, onPickSid }: { hunt: Hunt; initialSeed: number | null; onPickSid: (sid: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [shinyPid, setShinyPid] = useState("");
  const guidance = RSE_SID_GUIDANCE[hunt.version];
  const trainerId = Number(hunt.trainerId);
  const trainerIdValid = hunt.trainerId !== "" && Number.isInteger(trainerId) && trainerId >= 0 && trainerId <= 65535;
  const isEmerald = hunt.version === "Emerald";

  const shinyCandidates = useMemo(() => {
    const pid = Number.parseInt(shinyPid, 16);
    if (!trainerIdValid || !Number.isFinite(pid) || shinyPid.length !== 8) return [];
    return sidCandidatesFromShiny(trainerId, pid >>> 0);
  }, [shinyPid, trainerId, trainerIdValid]);

  const candidates = useMemo<RseIdState[]>(() => {
    if (!trainerIdValid) return [];
    if (isEmerald) {
      if (shinyCandidates.length === 0) return [];
      return emeraldSidCandidates(trainerId, { sids: shinyCandidates });
    }
    if (initialSeed === null) return [];
    return rsIdCandidates(initialSeed, trainerId, { minAdvances: 0, maxAdvances: 50000, limit: 32 });
  }, [initialSeed, isEmerald, shinyCandidates, trainerId, trainerIdValid]);

  return (
    <div className={`setup-disclosure rse-sid-helper ${expanded ? "expanded" : ""}`}>
      <button type="button" className="setup-disclosure-toggle" aria-expanded={expanded} aria-controls="rse-sid-helper-panel" onClick={() => setExpanded((value) => !value)}>
        <span><b>Don’t know your Secret ID?</b><small>{guidance.headline}</small></span>
        <ChevronDown aria-hidden="true" />
      </button>
      {expanded && <div id="rse-sid-helper-panel" className="setup-disclosure-panel rse-sid-panel">
        <ProseBlock text={guidance.detail} />

        <div className="rse-sid-candidates">
          <h3>{isEmerald ? "Advances after the naming screen" : "Secret IDs this boot seed can produce"}</h3>
          {!trainerIdValid && <p className="setup-field-note">Enter your Trainer ID above to list candidates.</p>}
          {trainerIdValid && isEmerald && shinyCandidates.length === 0 && <p className="setup-field-note">The advance spans thousands of frames, so there is nothing short to list. Enter a shiny’s PID below to narrow it to a handful, or read the Secret ID out of a save dump with the tools noted below.</p>}
          {trainerIdValid && isEmerald && shinyCandidates.length > 0 && candidates.length === 0 && <p className="setup-field-note">No advance in the searched window produces a Secret ID for that PID. It may belong to a different Trainer ID.</p>}
          {trainerIdValid && !isEmerald && candidates.length === 0 && initialSeed !== null && <p className="setup-field-note">No advance in the searched window produces that Trainer ID.</p>}
          {candidates.length > 0 && <div className="rse-candidate-list">
            {candidates.map((candidate) => (
              <button type="button" key={candidate.advance} className={Number(hunt.secretId) === candidate.sid && hunt.secretId !== "" ? "selected" : ""} onClick={() => onPickSid(candidate.sid)}>
                <span><small>Advance</small><b>{candidate.advance.toLocaleString()}</b></span>
                <span><small>SID</small><b>{candidate.sid}</b></span>
                <span><small>TSV</small><b>{candidate.tsv}</b></span>
              </button>
            ))}
          </div>}
        </div>

        <div className="rse-sid-candidates">
          <h3>Secret IDs from a shiny you caught</h3>
          <label className="rse-pid-field">
            <span>Shiny Pokémon PID (8 hex digits)</span>
            <input aria-label="Shiny Pokémon PID" inputMode="text" maxLength={8} placeholder="e.g. 560B9CE3" value={shinyPid} onChange={(event) => setShinyPid(event.target.value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 8))} />
          </label>
          {shinyCandidates.length > 0 && <div className="rse-candidate-list compact">
            {shinyCandidates.map((sid) => (
              <button type="button" key={sid} className={Number(hunt.secretId) === sid && hunt.secretId !== "" ? "selected" : ""} onClick={() => onPickSid(sid)}>
                <span><small>SID</small><b>{sid}</b></span>
              </button>
            ))}
          </div>}
        </div>

        <ProseBlock text={RSE_SID_FALLBACK_NOTES} className="rse-sid-fallback" />
      </div>}
    </div>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/\[([^\]]+)\]\(([^)]+)\)/g);
  return <>{parts.map((part, index) => {
    if (index % 3 === 2) return null;
    if (index % 3 === 1) return <a key={index} href={parts[index + 1]} target="_blank" rel="noreferrer noopener">{part}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

function ProseBlock({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`rse-prose ${className}`}>
      {text.split("\n").filter((line) => line.trim() !== "").map((line, index) => (
        <p key={index}>{line.split(/\*\*(.+?)\*\*/g).map((part, partIndex) => partIndex % 2 === 1 ? <b key={partIndex}>{part}</b> : <LinkedText key={partIndex} text={part} />)}</p>
      ))}
    </div>
  );
}

function TargetPage({ hunt, encounter, initialSeed, trainerId, secretId, ready, setEncounterId, searchSettings, setSearchSettings, selectedTarget, setSelectedTarget, onBack, onContinue }: {
  hunt: Hunt;
  encounter: RseEncounter;
  initialSeed: number | null;
  trainerId: number;
  secretId: number;
  ready: boolean;
  setEncounterId: (encounterId: string) => void;
  searchSettings: TargetSearchSettings;
  setSearchSettings: (settings: TargetSearchSettings) => void;
  selectedTarget: RseTarget | null;
  setSelectedTarget: (target: RseTarget | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { natureFilter, genderFilter, minAdvances, maxAdvances, showSearch } = searchSettings;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const genderless = isRseGenderless(encounter.species);
  const rowClasses = genderless ? "genderless" : "";
  const updateSearchSettings = (changes: Partial<TargetSearchSettings>) => setSearchSettings({ ...searchSettings, ...changes });

  const targets = useMemo(() => {
    if (!ready || initialSeed === null || minAdvances > maxAdvances) return [];
    return searchRseTargets({
      initialSeed,
      minAdvances,
      maxAdvances,
      trainerId,
      secretId,
      species: encounter.species,
      consoleName: hunt.console,
    });
  }, [encounter.species, hunt.console, initialSeed, maxAdvances, minAdvances, ready, secretId, trainerId]);

  useEffect(() => {
    if (selectedTarget && !targets.some((target) => targetKey(target) === targetKey(selectedTarget))) setSelectedTarget(null);
  }, [selectedTarget, setSelectedTarget, targets]);

  const natureOptions = ["Any nature", ...Array.from(new Set(targets.map((target) => target.nature))).sort()];
  const visibleTargets = useMemo(() => targets.filter((target) =>
    (natureFilter === "Any nature" || target.nature === natureFilter)
    && (genderless || genderFilter === "Any gender" || target.gender === genderFilter)
  ), [genderFilter, genderless, natureFilter, targets]);

  const selectedKey = selectedTarget ? targetKey(selectedTarget) : "";

  return (
    <section className="target-screen">
      <header className="screen-heading">
        <div>
          <h1>Choose your shiny {encounter.species}</h1>
          <p>Level {encounter.level} · {encounter.location} · {visibleTargets.length} available in this search</p>
        </div>
      </header>

      <div className="target-control-area">
        <div className={`target-tools ${filtersOpen ? "filters-open" : ""}`}>
          <label>
            <span>Encounter</span>
            <select aria-label="Encounter" value={encounter.id} onChange={(event) => setEncounterId(event.target.value)}>
              {groupedRseEncounters(hunt.version).map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.encounters.map((option) => <option key={option.id} value={option.id}>{option.species} · Lv {option.level}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <button type="button" className={`target-filters-toggle ${filtersOpen ? "active" : ""}`} aria-expanded={filtersOpen} aria-controls="rse-target-filter-fields" onClick={() => setFiltersOpen((open) => !open)}>Filters</button>
          <div className="target-filter-fields" id="rse-target-filter-fields">
            <label><span>Nature</span><select value={natureFilter} onChange={(event) => updateSearchSettings({ natureFilter: event.target.value })}>{natureOptions.map((nature) => <option key={nature}>{nature}</option>)}</select></label>
            {!genderless && <label><span>Gender</span><select value={genderFilter} onChange={(event) => updateSearchSettings({ genderFilter: event.target.value as TargetSearchSettings["genderFilter"] })}><option>Any gender</option><option>Male</option><option>Female</option></select></label>}
            <button type="button" className={`range-toggle ${showSearch ? "active" : ""}`} onClick={() => updateSearchSettings({ showSearch: !showSearch })}>Search range</button>
          </div>
        </div>

        {showSearch && <div className="target-search-controls rse-search-controls">
          <RangeNumberInput label="First advance" value={minAdvances} min={0} max={MAX_ADVANCE} onCommit={(value) => { updateSearchSettings({ minAdvances: value }); setSelectedTarget(null); }} />
          <RangeNumberInput label="Last advance" value={maxAdvances} min={0} max={MAX_ADVANCE} onCommit={(value) => { updateSearchSettings({ maxAdvances: value }); setSelectedTarget(null); }} />
        </div>}

        {encounter.note && <p className="rse-encounter-note">{encounter.note}</p>}
      </div>

      <div className="target-table">
        <div className={`target-table-head rse-table-head ${rowClasses}`}>
          <span /><span>Advance</span><span>Wait from boot</span><span>PID</span><span>Nature</span>{!genderless && <span>Gender</span>}<span>IVs</span>
        </div>
        <div className="target-table-body">
          {!ready && <div className="table-empty">Finish setup to search for targets.</div>}
          {ready && visibleTargets.map((target) => (
            <button type="button" className={`target-row rse-row ${rowClasses} ${selectedKey === targetKey(target) ? "selected" : ""}`} aria-pressed={selectedKey === targetKey(target)} key={targetKey(target)} onClick={() => setSelectedTarget(target)}>
              <span className="row-radio">{selectedKey === targetKey(target) && <Check />}</span>
              <RowCell label="Advance"><b>{target.advance.toLocaleString()}</b></RowCell>
              <RowCell label="Wait from boot"><b className="mono">{formatDuration(targetWaitMs(target, encounter))}</b></RowCell>
              <RowCell label="PID"><b className="mono">{target.pid.toString(16).toUpperCase().padStart(8, "0")}</b></RowCell>
              <RowCell label="Nature"><b>{target.nature}</b></RowCell>
              {!genderless && <RowCell label="Gender"><b>{target.gender}</b></RowCell>}
              <IvSpread ivs={target.ivs} />
            </button>
          ))}
          {ready && visibleTargets.length === 0 && <div className="table-empty">{targets.length > 0 ? "No targets match those filters." : "No targets in this range. Open Search range to widen it."}</div>}
        </div>
      </div>
      <WizardFooter canBack canNext={Boolean(selectedTarget)} onBack={onBack} onNext={onContinue} nextLabel="Use selected target" />
    </section>
  );
}

function targetWaitMs(target: RseTarget, encounter: RseEncounter): number {
  return rseAdvanceToMs(target.advance - encounter.frameOffset, target.consoleName);
}

function huntPhases(target: RseTarget, encounter: RseEncounter, calibrationMs: number): TimerPhase[] {
  return [{ label: "Target advance", ms: targetWaitMs(target, encounter) + calibrationMs }];
}

function AttemptPage({
  view, encounter, target, initialSeed, trainerId, secretId, calibrationMs, setCalibrationMs,
  observedNature, setObservedNature, recentHits, onHitRecorded, attempts, setAttempts, recording, setRecording,
  resultVersion, setResultVersion, focusRequest, resultFocusRequest, cueStyle, onCueStyleChange,
  audioState, onTimerFinished, onResultConfirmed,
}: {
  view: "attempt" | "result" | null;
  encounter: RseEncounter;
  target: RseTarget;
  initialSeed: number | null;
  trainerId: number;
  secretId: number;
  calibrationMs: number;
  setCalibrationMs: (ms: number) => void;
  observedNature: string;
  setObservedNature: (nature: string) => void;
  recentHits: HitObservation[];
  onHitRecorded: (observation: HitObservation) => void;
  attempts: number;
  setAttempts: (value: number | ((current: number) => number)) => void;
  recording: boolean;
  setRecording: (recording: boolean) => void;
  resultVersion: number;
  setResultVersion: (value: number | ((current: number) => number)) => void;
  focusRequest: number;
  resultFocusRequest: number;
  cueStyle: CueStyle;
  onCueStyleChange: (cueStyle: CueStyle) => void;
  audioState: PrecisionAudioState;
  onTimerFinished: () => void;
  onResultConfirmed: () => void;
}) {
  const [practiceMode, setPracticeMode] = useState(false);
  const phases = useMemo(() => huntPhases(target, encounter, calibrationMs), [calibrationMs, encounter, target]);
  const practiceMs = PRACTICE_COUNTDOWN_MS;

  const handleApply = (hitAdvance: number, apply: boolean) => {
    onHitRecorded({ advanceDelta: target.advance - hitAdvance });
    if (apply) setCalibrationMs(calibrationMs + rseCalibrationMs(target.advance, hitAdvance, target.consoleName));
    setAttempts((value) => value + 1);
    onResultConfirmed();
  };

  return (
    <>
      <section className="timer-screen attempt-view" hidden={view !== "attempt"}>
        <GuidedTimer
          key={`${targetKey(target)}-${attempts}`}
          huntPhases={phases}
          practiceMs={practiceMs}
          targetFrameMs={consoleFramesToMs(1, target.consoleName)}
          active={view === "attempt"}
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
          <AdjustmentControl label="Target frame timer" unit="ms" step={100} value={calibrationMs} onChange={setCalibrationMs} />
        </div>
      </section>
      {recording && initialSeed !== null && <div className="result-workspace" hidden={view !== "result"}>
        <ResultEntry
          key={`${targetKey(target)}-${resultVersion}`}
          encounter={encounter}
          target={target}
          initialSeed={initialSeed}
          trainerId={trainerId}
          secretId={secretId}
          calibrationMs={calibrationMs}
          recentHits={recentHits}
          resultVersion={resultVersion}
          observedNature={observedNature}
          onObservedNatureChange={setObservedNature}
          active={view === "result"}
          focusRequest={resultFocusRequest}
          onApply={handleApply}
        />
      </div>}
      {view === "result" && !recording && <div className="tool-empty"><h1>No result yet</h1></div>}
    </>
  );
}

type ResultSnapshotDraft = { id: number; level: number; stats: string[] };
type ResultDraft = {
  targetKey: string;
  resultVersion: number;
  gender: Gender;
  snapshots: ResultSnapshotDraft[];
  matches: RseHitResult[] | null;
  selectedHitKey: string;
  minAdvances: number;
  maxAdvances: number;
};

function createResultDraft(target: RseTarget, encounter: RseEncounter, resultVersion: number): ResultDraft {
  const radius = rseEncounterCalibrationRadius(encounter);
  return {
    targetKey: targetKey(target),
    resultVersion,
    gender: "Male",
    snapshots: [{ id: 0, level: encounter.level, stats: ["", "", "", "", "", ""] }],
    matches: null,
    selectedHitKey: "",
    minAdvances: Math.max(0, target.advance - radius),
    maxAdvances: target.advance + radius,
  };
}

function loadResultDraft(target: RseTarget, encounter: RseEncounter, resultVersion: number): ResultDraft {
  const fallback = createResultDraft(target, encounter, resultVersion);
  try {
    const value = window.localStorage.getItem(RESULT_DRAFT_STORAGE_KEY);
    if (!value) return fallback;
    const saved = JSON.parse(value) as Partial<ResultDraft>;
    if (saved.targetKey !== fallback.targetKey || saved.resultVersion !== resultVersion) return fallback;
    const snapshots = Array.isArray(saved.snapshots) ? saved.snapshots.map((snapshot, index) => ({
      id: Number.isInteger(snapshot?.id) ? snapshot.id : index,
      level: clampNumber(snapshot?.level, 1, 100, Math.min(100, encounter.level + index)),
      stats: Array.isArray(snapshot?.stats) && snapshot.stats.length === 6
        ? snapshot.stats.map((stat) => String(stat).replace(/\D/g, "").slice(0, 3))
        : ["", "", "", "", "", ""],
    })) : fallback.snapshots;
    return {
      ...fallback,
      gender: saved.gender === "Female" ? "Female" : "Male",
      snapshots: snapshots.length > 0 ? snapshots : fallback.snapshots,
      matches: Array.isArray(saved.matches)
        ? saved.matches.filter((match) => Number.isFinite(match?.advance) && Array.isArray(match?.ivs) && match.ivs.length === 6)
        : null,
      selectedHitKey: typeof saved.selectedHitKey === "string" ? saved.selectedHitKey : "",
      minAdvances: clampNumber(saved.minAdvances, 0, MAX_ADVANCE, fallback.minAdvances),
      maxAdvances: clampNumber(saved.maxAdvances, 0, MAX_ADVANCE, fallback.maxAdvances),
    };
  } catch {
    return fallback;
  }
}

function ResultEntry({ encounter, target, initialSeed, trainerId, secretId, calibrationMs, recentHits, resultVersion, observedNature, onObservedNatureChange, active, focusRequest, onApply }: {
  encounter: RseEncounter;
  target: RseTarget;
  initialSeed: number;
  trainerId: number;
  secretId: number;
  calibrationMs: number;
  recentHits: HitObservation[];
  resultVersion: number;
  observedNature: string;
  onObservedNatureChange: (nature: string) => void;
  active: boolean;
  focusRequest: number;
  onApply: (hitAdvance: number, apply: boolean) => void;
}) {
  const restoredDraft = useMemo(() => loadResultDraft(target, encounter, resultVersion), [encounter, resultVersion, target]);
  const [natureDraft, setNatureDraft] = useState(observedNature);
  const [gender, setGender] = useState<Gender>(restoredDraft.gender);
  const [snapshots, setSnapshots] = useState<ResultSnapshotDraft[]>(restoredDraft.snapshots);
  const [matches, setMatches] = useState<RseHitResult[] | null>(restoredDraft.matches);
  const [selectedHitKey, setSelectedHitKey] = useState(restoredDraft.selectedHitKey);
  const [applyCalibration, setApplyCalibration] = useState(false);
  const [minAdvances, setMinAdvances] = useState(restoredDraft.minAdvances);
  const [maxAdvances, setMaxAdvances] = useState(restoredDraft.maxAdvances);
  const genderless = isRseGenderless(encounter.species);
  const rowClasses = genderless ? "genderless" : "";
  const natureSelectRef = useRef<HTMLSelectElement | null>(null);
  const statInputRefs = useRef<Array<Array<HTMLInputElement | null>>>([]);
  const natureInputMethod = useRef<"pointer" | "keyboard" | null>(null);
  const nextSnapshotId = useRef(Math.max(0, ...restoredDraft.snapshots.map((snapshot) => snapshot.id)) + 1);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESULT_DRAFT_STORAGE_KEY, JSON.stringify({
        targetKey: targetKey(target), resultVersion, gender, snapshots, matches, selectedHitKey, minAdvances, maxAdvances,
      } satisfies ResultDraft));
    } catch {
    }
  }, [gender, matches, maxAdvances, minAdvances, resultVersion, selectedHitKey, snapshots, target]);

  useEffect(() => {
    if (active) {
      natureInputMethod.current = null;
      natureSelectRef.current?.focus({ preventScroll: true });
    }
  }, [active, focusRequest]);

  const focusStat = (snapshotIndex: number, statIndex: number) => {
    const element = statInputRefs.current[snapshotIndex]?.[statIndex];
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  const commitNature = (nextNature: string) => {
    onObservedNatureChange(nextNature);
    focusStat(0, 0);
  };

  const updateNatureDraft = (nextNature: string) => {
    setNatureDraft(nextNature);
    if (natureInputMethod.current === "pointer") commitNature(nextNature);
  };

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
    updateStat(previousSnapshotIndex, previousStatIndex, snapshots[previousSnapshotIndex].stats[previousStatIndex].slice(0, -1), false);
    focusStat(previousSnapshotIndex, previousStatIndex);
    return true;
  };

  const addLevel = () => {
    const snapshotIndex = snapshots.length;
    const nextLevel = Math.min(100, snapshots[snapshots.length - 1].level + 1);
    setSnapshots((rows) => [...rows, { id: nextSnapshotId.current++, level: nextLevel, stats: ["", "", "", "", "", ""] }]);
    window.setTimeout(() => focusStat(snapshotIndex, 0), 0);
  };

  const entriesValid = snapshots.every((snapshot) => snapshot.level >= 1 && snapshot.level <= 100 && snapshot.stats.every((stat) => stat !== "" && Number(stat) >= 1));

  const runSearch = () => {
    if (!entriesValid) return;
    const results = searchRseHits({
      initialSeed,
      target,
      minAdvances,
      maxAdvances,
      trainerId,
      secretId,
      species: encounter.species,
      nature: natureDraft,
      gender: genderless ? undefined : gender,
      snapshots: snapshots.map((snapshot) => ({ level: snapshot.level, stats: snapshot.stats.map(Number) })),
    });
    setSelectedHitKey("");
    setMatches(results);
  };

  const chosenMatch = matches?.length === 1 ? matches[0] : matches?.find((match) => hitKey(match) === selectedHitKey) ?? null;
  const advanceDelta = chosenMatch ? target.advance - chosenMatch.advance : 0;
  const stableTiming = chosenMatch ? isTimingConsistent([...recentHits, { advanceDelta }]) : false;
  const targetFrameCorrectionMs = chosenMatch ? rseCalibrationMs(target.advance, chosenMatch.advance, target.consoleName) : 0;

  useEffect(() => {
    setApplyCalibration(false);
  }, [chosenMatch ? hitKey(chosenMatch) : ""]);

  return (
    <section className="result-screen">
      <header className="screen-heading result-heading">
        <h1>What did you get?</h1>
        {matches !== null && <span>{matches.length} {matches.length === 1 ? "match" : "matches"}</span>}
      </header>

      <div className="result-inputs">
        <label><span>Nature</span><select ref={natureSelectRef} value={natureDraft} onPointerDown={() => { natureInputMethod.current = "pointer"; }} onChange={(event) => updateNatureDraft(event.target.value)} onKeyDown={(event) => { natureInputMethod.current = "keyboard"; if (event.key === "Enter") { event.preventDefault(); commitNature(natureDraft); } }} onBlur={() => { if (natureDraft !== observedNature) commitNature(natureDraft); natureInputMethod.current = null; }}>{NATURES.map((item) => <option key={item}>{item}</option>)}</select></label>
        {!genderless && <label><span>Gender</span><div className="small-segments"><button type="button" aria-label="Male" className={gender === "Male" ? "selected" : ""} onClick={() => setGender("Male")}>Male</button><button type="button" aria-label="Female" className={gender === "Female" ? "selected" : ""} onClick={() => setGender("Female")}>Female</button></div></label>}
        <div className="result-observations">
          {snapshots.map((snapshot, snapshotIndex) => <div className="result-observation-row" key={snapshot.id}>
            <RangeNumberInput label="Level" value={snapshot.level} min={1} max={100} onCommit={(level) => setSnapshots((rows) => rows.map((row) => row.id === snapshot.id ? { ...row, level } : row))} />
            <div className="result-stats">{STAT_LABELS.map((label, statIndex) => <label key={label}>
              <span>{label}</span>
              <input
                ref={(element) => { if (!statInputRefs.current[snapshotIndex]) statInputRefs.current[snapshotIndex] = []; statInputRefs.current[snapshotIndex][statIndex] = element; }}
                aria-label={`Level ${snapshot.level} ${label}`}
                value={snapshot.stats[statIndex]}
                maxLength={3}
                inputMode="numeric"
                onChange={(event) => updateStat(snapshotIndex, statIndex, event.target.value)}
                onKeyDown={(event) => { if (event.key === "Backspace" && handleStatBackspace(snapshotIndex, statIndex, snapshot.stats[statIndex])) event.preventDefault(); }}
              />
            </label>)}</div>
            <div className="level-row-actions">
              {snapshotIndex > 0 && <button type="button" className="remove-level" aria-label={`Remove level ${snapshot.level}`} onClick={() => setSnapshots((rows) => rows.filter((row) => row.id !== snapshot.id))}>Remove</button>}
              {snapshotIndex === snapshots.length - 1 && matches !== null && matches.length > 1 && <button type="button" className="add-level" onClick={addLevel}>+ Add level</button>}
            </div>
          </div>)}
        </div>
        <div className="match-range">
          <RangeNumberInput label="First advance" value={minAdvances} min={0} max={MAX_ADVANCE} onCommit={setMinAdvances} />
          <RangeNumberInput label="Last advance" value={maxAdvances} min={0} max={MAX_ADVANCE} onCommit={setMaxAdvances} />
        </div>
        <div className="result-search-actions">
          <button type="button" className="button button-secondary result-search" disabled={!entriesValid} onClick={runSearch}>{matches === null ? "Find Pokémon" : "Search again"}</button>
        </div>
      </div>

      <div className="result-body">
        {matches !== null && matches.length === 0 && <div className="result-status"><b>No match in this range.</b><span>Check the values or widen the advance range.</span></div>}
        {matches !== null && matches.length > 0 && <div className="hit-table" aria-label={matches.length === 1 ? "Identified hit" : "Possible hits"}>
          <div className={`hit-table-head rse-hit-head ${rowClasses}`}><span /><span>Advance</span><span>PID</span><span>Nature</span>{!genderless && <span>Gender</span>}</div>
          <div className="hit-table-body">{matches.map((match, matchIndex) => {
            const matchKey = hitKey(match);
            const selected = matches.length === 1 || selectedHitKey === matchKey;
            const manuallySelected = matches.length > 1 && selectedHitKey === matchKey;
            return <Fragment key={matchKey}>
              <button type="button" className={`hit-row rse-hit-row ${rowClasses} ${manuallySelected ? "selected" : ""}`} aria-pressed={selected} onClick={() => setSelectedHitKey(matchKey)}>
                <span className={`row-radio ${selected ? "chosen" : ""}`}>{selected ? <Check /> : matchIndex + 1}</span>
                <RowCell label="Advance"><b>{match.advance.toLocaleString()}</b></RowCell>
                <RowCell label="PID"><b className="mono">{match.pid.toString(16).toUpperCase().padStart(8, "0")}</b></RowCell>
                <RowCell label="Nature"><b>{match.nature}</b></RowCell>
                {!genderless && <RowCell label="Gender"><b>{match.gender}</b></RowCell>}
                <IvSpread ivs={match.ivs} />
              </button>
              {selected && <div className="hit-calibration rse-hit-calibration">
                <div className="hit-calibration-values">
                  <span>Calibration</span>
                  <div><small>Advance (Target Frame)</small><b>{formatHitOffset(targetFrameCorrectionMs, "ms", "Advance matched")}</b><span>{formatSignedMs(calibrationMs)} → {formatSignedMs(calibrationMs + targetFrameCorrectionMs)}</span></div>
                </div>
                {stableTiming && !applyCalibration && <span className="timing-recommendation">Recent hits are on track.</span>}
                <div className="hit-calibration-actions">
                  <label className="auto-apply-control"><input type="checkbox" checked={applyCalibration} onChange={(event) => setApplyCalibration(event.target.checked)} /> Apply correction</label>
                  <button type="button" className="button button-primary result-confirm" disabled={!chosenMatch} onClick={() => { if (chosenMatch) onApply(chosenMatch.advance, applyCalibration); }}>Next attempt</button>
                </div>
              </div>}
            </Fragment>;
          })}</div>
        </div>}
      </div>
    </section>
  );
}

function targetKey(target: RseTarget): string {
  return `${target.consoleName}-${target.initialSeed}-${target.advance}-${target.pid}`;
}

function hitKey(hit: RseHitResult): string {
  return `${hit.advance}-${hit.pid}`;
}

function formatHitOffset(delta: number, unit: "ms", matchedLabel: string): string {
  if (delta === 0) return matchedLabel;
  return `${Math.abs(delta).toLocaleString()} ${unit} ${delta > 0 ? "early" : "late"}`;
}

function isTimingConsistent(hits: HitObservation[]): boolean {
  const sample = hits.slice(-CONSISTENCY_SAMPLE_SIZE);
  return sample.length === CONSISTENCY_SAMPLE_SIZE
    && sample.every((hit) => Math.abs(hit.advanceDelta) <= CONSISTENCY_ADVANCE_FRAMES);
}

function formatSignedMs(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0 ms";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString()} ms`;
}

function RowCell({ label, children }: { label: string; children: ReactNode }) {
  return <span className="row-cell"><small className="cell-label" aria-hidden="true">{label}</small>{children}</span>;
}

function IvSpread({ ivs }: { ivs: readonly number[] }) {
  return (
    <div className="iv-spread" aria-label={`IVs: ${STAT_LABELS.map((label, index) => `${label} ${ivs[index]}`).join(", ")}`}>
      {STAT_LABELS.map((label, index) => <span key={label}><small>{label}</small><b>{ivs[index]}</b></span>)}
    </div>
  );
}

function WizardFooter({ canBack, canNext, onBack, onNext, nextLabel = "Next" }: { canBack: boolean; canNext: boolean; onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <footer className="fixed-actions wizard-actions">
      {canBack && <button type="button" className="button button-text" onClick={onBack}>Back</button>}
      <button type="button" className="button button-primary" disabled={!canNext} onClick={onNext}>{nextLabel}</button>
    </footer>
  );
}

function RangeNumberInput({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }, [draft, max, min, onCommit, value]);

  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); } }}
      />
    </label>
  );
}

function AdjustmentControl({ label, unit, value, step = 1, onChange }: { label: string; unit: string; value: number; step?: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

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
        <button type="button" aria-label={`Decrease ${label.toLowerCase()} adjustment by ${step} ${unit}`} onClick={() => onChange(value - step)}>−</button>
        <span className="adjustment-input-wrap">
          <input
            type="number"
            step={step}
            aria-label={`${label} adjustment (${unit})`}
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            onBlur={() => { const parsed = Number(draft); setDraft(String(Number.isFinite(parsed) && draft.trim() !== "" ? Math.round(parsed) : value)); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(String(value)); event.currentTarget.blur(); } }}
          />
          <small>{unit}</small>
        </span>
        <button type="button" aria-label={`Increase ${label.toLowerCase()} adjustment by ${step} ${unit}`} onClick={() => onChange(value + step)}>+</button>
      </div>
    </label>
  );
}
