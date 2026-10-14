import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import * as path from "node:path";
import { AGENT_ENV, RUN_ID_ENV, sweepRunProcesses } from "./sweep.ts";

export interface AgentRun {
  label: string;
  /** What people see, such as "opus 5-5 high". The label is for file names. */
  name: string;
  model: string;
  level?: string;
  status: "running" | "done" | "failed";
  toolCalls: number;
  lastTool?: string;
  cost: number;
  startedAt: number;
  endedAt?: number;
  text: string;
  error?: string;
  /** Processes the agent started and left running, which were stopped when it finished. */
  leftovers: number;
}

interface AssistantMessage {
  role: string;
  content?: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
  usage?: { cost?: { total?: number } };
}

const TERM_GRACE_MS = 3000;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value) && value.role === "assistant";
}

function piInvocation(args: string[]) {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  if (/^(node|bun)(\.exe)?$/.test(execName)) return { command: "pi", args };
  return { command: process.execPath, args };
}

function textOf(message: AssistantMessage) {
  return (message.content ?? [])
    .filter(block => block.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("\n");
}

// Process groups of agents that are still running. A last-resort hook kills them if pi exits first.
const liveGroups = new Set<number>();
let exitHookInstalled = false;

function signalGroup(pgid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const pgid of liveGroups) signalGroup(pgid, "SIGKILL");
  });
}

/** Stops everything left in the agent's process group, politely first, then by force. */
async function reapGroup(pgid: number) {
  if (signalGroup(pgid, "SIGTERM")) {
    const deadline = Date.now() + TERM_GRACE_MS;
    while (Date.now() < deadline && groupAlive(pgid)) await sleep(100);
    if (groupAlive(pgid)) {
      signalGroup(pgid, "SIGKILL");
      const forced = Date.now() + 1000;
      while (Date.now() < forced && groupAlive(pgid)) await sleep(50);
    }
  }
  liveGroups.delete(pgid);
}

/**
 * Runs one isolated pi process on a prompt file. Everything it prints is
 * written to jsonlPath. The returned promise settles only after the agent and
 * every process it started in its group are gone.
 */
export function runPiAgent(options: {
  cwd: string;
  label: string;
  name: string;
  provider: string;
  modelId: string;
  level?: string;
  tools: string[];
  promptFile: string;
  jsonlPath: string;
  /** Stamped into the environment, with the label, so leftovers can be found later. */
  runId: string;
  signal: AbortSignal;
  onUpdate: (run: AgentRun) => void;
}): Promise<AgentRun> {
  const run: AgentRun = {
    label: options.label,
    name: options.name,
    model: options.modelId,
    level: options.level,
    status: "running",
    toolCalls: 0,
    cost: 0,
    startedAt: Date.now(),
    text: "",
    leftovers: 0,
  };

  const args = ["--provider", options.provider, "--model", options.modelId];
  if (options.level) args.push("--thinking", options.level);
  args.push(
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--no-extensions",
    "--no-mcp",
    "--no-approve",
    "--tools",
    options.tools.join(","),
    "@" + options.promptFile,
  );

  return new Promise(resolve => {
    const invocation = piInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: { ...process.env, [RUN_ID_ENV]: options.runId, [AGENT_ENV]: options.label },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const pgid = child.pid;
    if (pgid !== undefined) {
      liveGroups.add(pgid);
      installExitHook();
    }

    const jsonl = createWriteStream(options.jsonlPath);
    let buffer = "";
    let stderrTail = "";
    let lastStopReason: string | undefined;
    let lastError: string | undefined;
    let aborted = false;
    let finished = false;

    const stdoutEnded = new Promise<void>(done => {
      child.stdout.once("end", done);
      child.stdout.once("close", done);
    });

    const onAbort = () => {
      aborted = true;
      if (pgid === undefined) return;
      signalGroup(pgid, "SIGTERM");
      setTimeout(() => signalGroup(pgid, "SIGKILL"), TERM_GRACE_MS + 1000).unref();
    };
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(event)) return;

      if (event.type === "tool_execution_start") {
        run.toolCalls++;
        if (typeof event.toolName === "string") run.lastTool = event.toolName;
        options.onUpdate(run);
        return;
      }

      if (event.type === "message_end" && isAssistantMessage(event.message)) {
        const message = event.message;
        run.cost += message.usage?.cost?.total ?? 0;
        lastStopReason = message.stopReason;
        lastError = message.errorMessage;
        const text = textOf(message);
        if (text.trim()) run.text = text;
        options.onUpdate(run);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      jsonl.write(chunk);
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    const finish = async (exitCode: number | null, spawnError?: Error) => {
      if (finished) return;
      finished = true;
      options.signal.removeEventListener("abort", onAbort);
      if (buffer.trim()) handleLine(buffer);
      jsonl.end();
      // Whatever the agent started and left running (dev servers, watchers) goes now, before the
      // next stage starts, so a leftover server cannot hold a port the next agent needs.
      if (pgid !== undefined) await reapGroup(pgid);
      run.leftovers = await sweepRunProcesses(options.runId, options.label);
      run.endedAt = Date.now();

      if (aborted) run.error = "cancelled";
      else if (spawnError) run.error = spawnError.message;
      else if (exitCode !== 0) run.error = "pi exited with code " + exitCode + (stderrTail ? ": " + stderrTail.trim() : "");
      else if (lastStopReason === "error" || lastStopReason === "aborted") run.error = lastError ?? "model stopped with " + lastStopReason;
      else if (!run.text.trim()) run.error = "the agent produced no final answer";

      run.status = run.error ? "failed" : "done";
      options.onUpdate(run);
      resolve(run);
    };

    // "exit" fires when pi is gone. Unlike "close" it does not wait for a leftover
    // grandchild that still holds the output pipe open.
    child.once("exit", code => {
      void Promise.race([stdoutEnded, sleep(2000)]).then(() => finish(code));
    });
    child.once("error", error => {
      void finish(null, error);
    });
  });
}
