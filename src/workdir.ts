import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const MARKER = ".realreview";
const PREFIX = "realreview-";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Removes report folders this extension created more than a week ago. */
async function pruneOldRuns() {
  const root = os.tmpdir();
  for (const name of await fs.readdir(root).catch(() => [])) {
    if (!name.startsWith(PREFIX)) continue;
    const folder = path.join(root, name);
    try {
      const marker = await fs.stat(path.join(folder, MARKER));
      if (Date.now() - marker.mtimeMs > MAX_AGE_MS) await fs.rm(folder, { recursive: true, force: true });
    } catch {
      // not ours, or already gone
    }
  }
}

export async function createRunDir() {
  await pruneOldRuns();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX));
  await fs.writeFile(path.join(dir, MARKER), "");
  return dir;
}
