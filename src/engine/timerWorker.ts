/// <reference lib="webworker" />

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const SPIN_WAIT_MS = 4;
const REFRESH_INTERVAL_MS = 8;

let running = false;
let runToken = 0;

function now(): number {
  return performance.timeOrigin + performance.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}

async function waitUntil(timestamp: number, token: number): Promise<void> {
  while (running && token === runToken) {
    const remaining = timestamp - now();
    if (remaining <= 0) return;
    if (remaining > SPIN_WAIT_MS) {
      await sleep(Math.min(REFRESH_INTERVAL_MS, remaining - SPIN_WAIT_MS));
      continue;
    }
    while (running && token === runToken && now() < timestamp) {
    }
    return;
  }
}

async function run(phaseDurations: number[], absoluteStart: number, token: number): Promise<void> {
  let phaseStart = absoluteStart;

  for (let phase = 0; phase < phaseDurations.length && running && token === runToken; phase += 1) {
    const duration = phaseDurations[phase];
    const phaseEnd = phaseStart + duration;
    let nextUiUpdate = now();

    while (running && token === runToken && now() < phaseEnd) {
      await waitUntil(Math.min(nextUiUpdate, phaseEnd), token);
      if (!running || token !== runToken) return;

      const timestamp = now();
      if (timestamp >= nextUiUpdate) {
        workerScope.postMessage({ type: "tick", remaining: Math.max(0, phaseEnd - timestamp) });
        nextUiUpdate = timestamp + REFRESH_INTERVAL_MS;
      }
    }

    if (!running || token !== runToken) return;
    workerScope.postMessage({ type: "tick", remaining: 0 });
    if (phase + 1 < phaseDurations.length) workerScope.postMessage({ type: "phase", phase: phase + 1 });
    phaseStart = phaseEnd;
  }

  if (running && token === runToken) {
    running = false;
    workerScope.postMessage({ type: "finished" });
  }
}

workerScope.onmessage = (event: MessageEvent<{ type: "start" | "stop"; phaseDurations?: number[]; absoluteStart?: number }>) => {
  if (event.data.type === "stop") {
    running = false;
    runToken += 1;
  } else if (event.data.phaseDurations && event.data.absoluteStart !== undefined) {
    running = true;
    runToken += 1;
    void run(event.data.phaseDurations, event.data.absoluteStart, runToken);
  }
};
