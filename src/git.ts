import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

export async function repoRoot(cwd: string) {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export async function currentBranch(cwd: string) {
  return (await git(cwd, ["branch", "--show-current"])).trim() || "(detached HEAD)";
}

/** Changes whenever tracked files, the index, or the set of untracked files change. */
export async function treeFingerprint(cwd: string) {
  const [status, diff] = await Promise.all([git(cwd, ["status", "--porcelain"]), git(cwd, ["diff", "HEAD"])]);
  return createHash("sha256").update(status).update(diff).digest("hex");
}
