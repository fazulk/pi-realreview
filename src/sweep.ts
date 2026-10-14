import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RUN_ID_ENV = "REALREVIEW_RUN_ID";
export const AGENT_ENV = "REALREVIEW_AGENT";

function hasToken(line: string, token: string) {
  return line.endsWith(token) || line.includes(token + " ");
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * Finds every process that inherited this run's marker, even ones that left their
 * process group (setsid, nohup, daemons, pi's own detached shell commands), and stops them.
 * Pass an agent label to sweep only that agent. Returns how many leftovers it stopped.
 *
 * Limit: macOS hides the environment of Apple system binaries (such as /bin/sleep),
 * so those cannot be matched. Dev servers, node, python and browsers can.
 */
export async function sweepRunProcesses(runId: string, agent?: string) {
  if (process.platform === "win32") return 0;

  let listing: string;
  try {
    const flags = process.platform === "darwin" ? "-axwwE" : "-axwwe";
    listing = (await execFileAsync("ps", [flags, "-o", "pid=,command="], { maxBuffer: 128 * 1024 * 1024 })).stdout;
  } catch {
    return 0;
  }

  const markers = [RUN_ID_ENV + "=" + runId, ...(agent ? [AGENT_ENV + "=" + agent] : [])];
  const pids = listing
    .split("\n")
    .filter(line => markers.every(marker => hasToken(line, marker)))
    .map(line => Number.parseInt(line.trim(), 10))
    .filter(pid => Number.isInteger(pid) && pid !== process.pid && pid !== process.ppid);
  if (pids.length === 0) return 0;

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && pids.some(isAlive)) await sleep(100);
  for (const pid of pids.filter(isAlive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return pids.length;
}
