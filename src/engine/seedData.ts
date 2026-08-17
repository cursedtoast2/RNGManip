import { isSwitchConsole, type ConsoleName, type SeedEntry } from "./gen3";

export type RetailSeedSettings = {
  sound: "Mono" | "Stereo";
  buttonMode: "L=A" | "Help" | "LR";
  seedButton: "A" | "Start" | "L";
  revision: "1.0" | "1.1";
};

const cache = new Map<string, Promise<SeedEntry[]>>();

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readCString(bytes: Uint8Array, start: number): { value: string; end: number } {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { value: new TextDecoder().decode(bytes.slice(start, end)), end: end + 1 };
}

export function parseSwitchSeedData(buffer: ArrayBuffer, settingKey = "mono_h_a"): SeedEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let pointer = 0;
  const timeCount = readU32(view, pointer);
  pointer += 4;
  const seedTimes: number[] = [];
  for (let index = 0; index < timeCount; index += 1) {
    seedTimes.push(readU16(view, pointer));
    pointer += 2;
  }

  while (pointer < bytes.length) {
    const key = readCString(bytes, pointer);
    pointer = key.end;
    const entryCount = readU32(view, pointer);
    pointer += 4;
    const entries: SeedEntry[] = [];
    let previousSeed = -1;
    for (let index = 0; index < entryCount; index += 1) {
      const initialSeed = readU16(view, pointer);
      const invalid = bytes[pointer + 2] !== 0;
      pointer += 3;
      if (!invalid && initialSeed !== previousSeed) {
        entries.push({ initialSeed, seedTime: seedTimes[index] + 5737 });
        previousSeed = initialSeed;
      }
    }
    if (key.value === settingKey) return entries;
  }
  return [];
}

export function parseRetailSeedData(buffer: ArrayBuffer, settingKey = "mono_a_a"): SeedEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let pointer = 0;

  while (pointer < bytes.length) {
    const key = readCString(bytes, pointer);
    pointer = key.end;
    const startingFrame = readU16(view, pointer);
    pointer += 2;
    const frameSize = bytes[pointer];
    pointer += 1;
    const entryCount = readU32(view, pointer);
    pointer += 4;
    const entries: SeedEntry[] = [];
    let previousSeed = -1;
    for (let index = 0; index < entryCount; index += 1) {
      const initialSeed = readU16(view, pointer);
      const invalid = bytes[pointer + 2] !== 0;
      pointer += 3;
      if (key.value === settingKey && !invalid && initialSeed !== previousSeed) {
        entries.push({ initialSeed, seedTime: (startingFrame + Math.floor(index / frameSize)) * 16 });
        previousSeed = initialSeed;
      }
    }
    if (key.value === settingKey) return entries;
  }
  return [];
}

function retailSettingKey(settings: RetailSeedSettings): string {
  const buttonMode = settings.buttonMode === "L=A" ? "a" : settings.buttonMode === "Help" ? "h" : "r";
  return `${settings.sound.toLowerCase()}_${buttonMode}_${settings.seedButton.toLowerCase()}`;
}

export function loadSeedData(
  game: "FireRed" | "LeafGreen",
  language: string,
  consoleName: ConsoleName,
  settings: RetailSeedSettings,
): Promise<SeedEntry[]> {
  const prefix = game === "FireRed" ? "fr" : "lg";
  const switchConsole = isSwitchConsole(consoleName);
  const locale = language === "Japanese" ? "jpn" : "eng";
  const filename = switchConsole
    ? `${prefix}_${locale}_nx.bin`
    : language === "Japanese" && game === "FireRed"
      ? `fr_jpn_${settings.revision.replace(".", "_")}.bin`
      : `${prefix}_${locale}.bin`;
  const settingKey = switchConsole ? "mono_h_a" : retailSettingKey(settings);
  const path = `${import.meta.env.BASE_URL}generated/${filename}`;
  const cacheKey = `${path}#${settingKey}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, fetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load seed data (${response.status})`);
      const buffer = await response.arrayBuffer();
      const entries = switchConsole ? parseSwitchSeedData(buffer, settingKey) : parseRetailSeedData(buffer, settingKey);
      if (entries.length === 0) throw new Error("The selected game/settings have no known seed data.");
      return entries;
    }).catch((error: unknown) => {
      cache.delete(cacheKey);
      throw error;
    }));
  }
  return cache.get(cacheKey)!;
}
