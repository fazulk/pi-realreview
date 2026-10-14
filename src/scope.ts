import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { filterSelect } from "./filter-select.ts";
import type { Nav } from "./filter-select.ts";
import { currentBranch, git } from "./git.ts";

export interface ReviewScope {
  label: string;
  /** What the reviewers are asked to review, in plain words. */
  instructions: string;
  /** Exact diff under review. Absent for custom instructions. */
  patch?: string;
  /** The preset menu entry this came from, selected again if the user comes back. */
  preset: string;
  /** What the user typed for custom instructions, offered again if they come back. */
  request?: string;
}

const BASE_BRANCH = "Review against a base branch (PR style)";
const UNCOMMITTED = "Review uncommitted changes";
const COMMIT = "Review a commit";
const CUSTOM = "Custom review instructions";

const PREFERRED_BASES = ["main", "origin/main", "master", "origin/master", "develop", "origin/develop"];

function baseRank(ref: string) {
  const index = PREFERRED_BASES.indexOf(ref);
  return index === -1 ? PREFERRED_BASES.length : index;
}

/** The first step. Backing out of a sub-screen, or a preset with nothing to review, returns to the preset menu. */
export async function pickScope(ctx: ExtensionCommandContext, step: string, previous?: ReviewScope): Promise<Nav<ReviewScope>> {
  let preset = previous?.preset;
  while (true) {
    const picked = await filterSelect(ctx, "Select a review preset", [BASE_BRANCH, UNCOMMITTED, COMMIT, CUSTOM], {
      filter: false,
      step,
      initial: preset,
      forward: previous !== undefined,
    });
    if (picked.kind !== "done") return picked;
    preset = picked.value;

    const scope = await resolveScope(ctx, preset, step, previous);
    if (scope) return { kind: "done", value: scope };
  }
}

async function resolveScope(ctx: ExtensionCommandContext, preset: string, step: string, previous?: ReviewScope): Promise<ReviewScope | undefined> {
  const cwd = ctx.cwd;

  if (preset === BASE_BRANCH) {
    const branch = await currentBranch(cwd);
    const refs = (await git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]))
      .split("\n")
      .map(ref => ref.trim())
      .filter(ref => ref && !ref.endsWith("/HEAD") && ref !== branch)
      .sort((a, b) => baseRank(a) - baseRank(b) || a.localeCompare(b, undefined, { numeric: true }));
    const picked = await filterSelect(ctx, "Base branch to compare " + branch + " against", refs, { step, back: true, esc: "back" });
    if (picked.kind !== "done") return undefined;
    const base = picked.value;

    const patch = await git(cwd, ["diff", base + "...HEAD"]);
    if (!patch.trim()) {
      ctx.ui.notify("No committed changes on " + branch + " compared with " + base, "warning");
      return undefined;
    }
    return {
      preset,
      label: branch + " against " + base,
      instructions:
        "Review the committed changes on branch " +
        branch +
        " compared with " +
        base +
        " (git diff " +
        base +
        "...HEAD). " +
        "Uncommitted working-tree changes are out of scope unless they are needed to understand the diff.",
      patch,
    };
  }

  if (preset === UNCOMMITTED) {
    const patch = await git(cwd, ["diff", "HEAD"]);
    const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
    if (!patch.trim() && untracked.length === 0) {
      ctx.ui.notify("There are no uncommitted changes", "warning");
      return undefined;
    }
    const untrackedNote = untracked.length
      ? "\n\nUntracked files are not in the diff. Read them directly:\n" + untracked.map(file => "- " + file).join("\n")
      : "";
    return {
      preset,
      label: "Uncommitted changes",
      instructions: "Review all uncommitted changes: staged and unstaged edits to tracked files (git diff HEAD) plus untracked files." + untrackedNote,
      patch,
    };
  }

  if (preset === COMMIT) {
    const log = (await git(cwd, ["log", "-n", "40", "--format=%h %s (%an, %ar)"])).split("\n").filter(Boolean);
    const result = await filterSelect(ctx, "Commit to review", log, { step, back: true, esc: "back" });
    if (result.kind !== "done") return undefined;
    const picked = result.value;
    const sha = picked.split(" ")[0];
    return {
      preset,
      label: "Commit " + picked,
      instructions: "Review the single commit " + sha + " (git show " + sha + ").",
      patch: await git(cwd, ["show", "--format=fuller", sha]),
    };
  }

  // Esc in the editor, or submitting it empty, returns to the preset menu.
  const text = (await ctx.ui.editor("Review instructions (esc to go back)", previous?.request ?? ""))?.trim();
  if (!text) return undefined;
  return {
    preset,
    request: text,
    label: "Custom review",
    instructions: "Follow these review instructions from the user. Use git to find the relevant changes.\n\n" + text,
  };
}
