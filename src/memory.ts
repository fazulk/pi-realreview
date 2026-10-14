import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface RememberedChoice {
  provider: string;
  id: string;
  /** The effort used the last time, if any. */
  level?: string;
}

export interface Memory {
  /** Every model you have started a review with, most recent first. */
  history: RememberedChoice[];
  /** The model that structures the report. Asked once, then never again. */
  formatter?: RememberedChoice;
}

const MAX_HISTORY = 15;

export function memoryFile(agentDir: string) {
  return path.join(agentDir, "realreview.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toChoice(value: unknown): RememberedChoice | undefined {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
  return { provider: value.provider, id: value.id, level: typeof value.level === "string" ? value.level : undefined };
}

/** A missing or damaged file just means nothing is remembered yet. */
export async function loadMemory(file: string): Promise<Memory> {
  try {
    const data: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isRecord(data)) return { history: [] };
    return {
      history: Array.isArray(data.history) ? data.history.flatMap(item => toChoice(item) ?? []) : [],
      formatter: toChoice(data.formatter),
    };
  } catch {
    return { history: [] };
  }
}

async function write(file: string, memory: Memory) {
  try {
    await fs.writeFile(file, JSON.stringify({ history: memory.history.slice(0, MAX_HISTORY), formatter: memory.formatter }, null, 2) + "\n");
  } catch {
    // Remembering is a convenience. Never fail a review over it.
  }
}

/** Puts the models just used at the front. Each model appears once, with its latest effort. */
export async function rememberUsed(file: string, memory: Memory, used: RememberedChoice[]) {
  const seen = new Set<string>();
  memory.history = [...used, ...memory.history].filter(choice => {
    const key = choice.provider + "/" + choice.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await write(file, memory);
}

export async function rememberFormatter(file: string, memory: Memory, formatter: RememberedChoice) {
  memory.formatter = formatter;
  await write(file, memory);
}
