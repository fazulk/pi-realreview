import type { ReviewScope } from "./scope.ts";

export const REVIEW_TOOLS = ["read", "bash", "grep", "find", "ls"];

export function reviewerPrompt(scope: ReviewScope, patchPath: string | undefined) {
  return [
    "You are one of several independent code reviewers working on the same change. Do not read any other reviewer's output.",
    "",
    "## Scope",
    scope.instructions,
    patchPath ? "\nThe exact diff under review is saved at " + patchPath + ". Read it with the read tool (in chunks if it is large)." : "",
    "",
    "## Ground rules",
    "- This is a READ-ONLY review. Never modify, stage, reset, commit, stash, or format files in the repository.",
    "- First read the repository's AGENTS.md (and any nested ones that apply to the changed files) and apply its rules.",
    "- Inspect the whole change, then trace the surrounding code: callers, data flow, API types and contracts, and existing tests.",
    "- Look for concrete defects the change introduces or exposes: regressions, wrong behavior, races, error handling, data loss, security problems, missing or misleading tests.",
    "- Trace every suspected bug to real callers and data before reporting it. Do not invent backend or library behavior. Do not report pre-existing defects the change does not touch, and do not report style preferences.",
    "- Only run tests if you need them to confirm a specific suspicion, and then only focused ones (one spec or file). No full suites, builds, linters, or formatters. Stop any process you start.",
    "- Keep only findings strong enough to justify changing the change. Reporting no findings is fine.",
    "",
    "## Report format (Markdown)",
    "1. Scope and verdict, briefly.",
    "2. Numbered findings. For each: priority (P1 broken for users, P2 should fix before merge, P3 minor), exact file and line range, a concrete reproducible scenario, why the change causes it, impact, evidence (the caller paths you checked), a suggested correction, and your confidence.",
    "3. Concerns you investigated and dismissed, with the evidence.",
    "4. Checks you actually ran, and the limits of your review.",
  ].join("\n");
}

export interface ReviewNotes {
  /** How this reviewer is named in the final review, such as "opus 5-5 high". */
  name: string;
  notesPath: string;
}

export function synthesisPrompt(scope: ReviewScope, patchPath: string | undefined, reviews: ReviewNotes[]) {
  return [
    "You are the final adjudicator of a code review. Independent reviewers have already reviewed the same change. Compare their notes, re-check them against the code, remove false positives and speculative findings, merge duplicates, and write the final review.",
    "",
    "## Scope",
    scope.instructions,
    patchPath ? "\nThe exact diff the reviewers saw is saved at " + patchPath + "." : "",
    "",
    "## Reviewer notes (read every file in full)",
    ...reviews.map(review => "- " + review.name + ": " + review.notesPath),
    "",
    "Refer to reviewers only by exactly these names (for example in the Raised by column), never by file name.",
    "",
    "## How to adjudicate",
    "- Re-trace every candidate finding against the real code and callers yourself. Do not decide by how many reviewers agree.",
    "- Concrete runtime evidence, such as a test or script that was actually run, outranks reasoning without evidence. If reviewers disagree on a fact and it can be settled, settle it: read the code, or run one focused test. Do not run full suites, builds, or linters.",
    "- Keep only evidence-backed findings that justify changing the change. Drop style-only concerns, pre-existing defects the change does not touch or expose, and speculation about behavior you cannot verify.",
    "- A real-looking concern that you cannot prove is not a finding. List it as Unproven in the reconciliation table.",
    "- READ-ONLY: never modify, stage, reset, commit, stash, or format files in the repository. Read the repository's AGENTS.md and apply it.",
    "",
    "## Output format",
    "Your final message must be exactly this Markdown structure, with these exact headings and no text before or after it:",
    "",
    "# Branch review",
    "## Verdict",
    'One short paragraph. Start with exactly one of: "Approve.", "Request changes.", or "Comment.", then the reasoning.',
    "## Findings",
    "### R1 [P1] Short title",
    "**Where:** path:line-range (list several if needed)",
    "**Impact:** what breaks, for whom",
    "**Evidence:** reproduction and the caller paths you checked",
    "**Fix direction:** what to change",
    "**Confidence:** high, medium or low, and why",
    "(Repeat with R2, R3, and so on. Use P1, P2 or P3. If there are no findings, write only: No actionable findings.)",
    "## Reconciliation",
    "A table with columns | Candidate | Raised by | Decision | Reasoning |. One row per candidate any reviewer raised. Decision is exactly one of: Retained, Merged, Rejected, Unproven. For Retained and Merged rows, the Reasoning must cite the finding id the candidate became, such as (R2).",
    "## Validation",
    "A bullet list of the checks that were actually run, by reviewers or by you, and their results. Do not claim checks nobody ran.",
    "## Limitations",
    "A bullet list of what was not verified.",
  ].join("\n");
}

export const EXTRACTION_SYSTEM = [
  "You convert a code review written in Markdown into JSON for a report template.",
  "Copy text verbatim from the review. Never summarize, rephrase, reorder, add, or drop content.",
  "Output ONLY one JSON object. No code fences and no commentary.",
  "",
  "Schema:",
  "{",
  '  "verdict": { "recommendation": "approve" | "request_changes" | "comment", "summary": string },',
  '  "findings": [ { "id": "R1", "severity": "P1" | "P2" | "P3", "title": string, "location": string, "body": string } ],',
  '  "reconciliation": [ { "candidate": string, "raisedBy": string, "decision": string, "reasoning": string } ],',
  '  "validation": [ string ],',
  '  "limitations": [ string ]',
  "}",
  "",
  "Rules:",
  '- verdict.summary is the Verdict paragraph without its leading "Approve."/"Request changes."/"Comment." word. recommendation follows that word.',
  '- One finding per "### R<n> [P<k>] title" heading, in the same order, with the same ids. title excludes the id and the [P<k>] tag.',
  '- location is the text after "**Where:**". body is the rest of that finding (Impact, Evidence, Fix direction, Confidence) as Markdown, copied verbatim.',
  "- One reconciliation entry per table row, in order. Keep inline Markdown (such as code spans) inside strings.",
  "- validation and limitations hold one string per bullet, without the leading bullet marker.",
  "- If the review says there are no actionable findings, findings is an empty array.",
].join("\n");
