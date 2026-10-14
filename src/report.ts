const SEVERITIES = ["P1", "P2", "P3"] as const;
const RECOMMENDATIONS = ["approve", "request_changes", "comment"] as const;

type Severity = (typeof SEVERITIES)[number];
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface ReportData {
  verdict: { recommendation: Recommendation; summary: string };
  findings: { id: string; severity: Severity; title: string; location: string; body: string }[];
  reconciliation: { candidate: string; raisedBy: string; decision: string; reasoning: string }[];
  validation: string[];
  limitations: string[];
}

export interface ReviewerMeta {
  label: string;
  model: string;
  level?: string;
  status: "done" | "failed";
  durationMs: number;
  toolCalls: number;
  cost: number;
  error?: string;
  notes?: string;
}

export interface ReportMeta {
  scopeLabel: string;
  repo: string;
  generatedAt: string;
  durationMs: number;
  patchSha?: string;
  reviewers: ReviewerMeta[];
  synthesizer: { model: string; level?: string; cost: number };
  formatter: { model: string; cost: number };
  treeChanged: boolean;
  totalCost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripFence(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Returns the report, or a short description of what is wrong with the JSON. */
export function parseReport(raw: string, markdown: string): ReportData | string {
  let data: unknown;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    return "the output was not valid JSON";
  }
  if (!isRecord(data)) return "the top level must be a JSON object";
  const verdict = data.verdict;
  if (!isRecord(verdict)) return "missing the verdict object";

  const recommendation = RECOMMENDATIONS.find(item => item === verdict.recommendation);
  const summary = verdict.summary;
  if (!recommendation || typeof summary !== "string") return "verdict needs a valid recommendation and a summary string";

  if (!Array.isArray(data.findings)) return "findings must be an array";
  const findings: ReportData["findings"] = [];
  for (const item of data.findings) {
    if (!isRecord(item)) return "every finding must be an object";
    const severity = SEVERITIES.find(level => level === item.severity);
    if (!severity || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.body !== "string") {
      return "every finding needs id, severity (P1, P2 or P3), title and body strings";
    }
    findings.push({ id: item.id, severity, title: item.title, location: typeof item.location === "string" ? item.location : "", body: item.body });
  }

  const expectedIds = [...markdown.matchAll(/^###\s+(R\d+)\b/gm)].map(match => match[1]);
  if (expectedIds.join(",") !== findings.map(finding => finding.id).join(",")) {
    return "finding ids must be exactly, in order: " + (expectedIds.join(", ") || "(none)");
  }

  if (!Array.isArray(data.reconciliation)) return "reconciliation must be an array";
  const reconciliation: ReportData["reconciliation"] = [];
  for (const item of data.reconciliation) {
    if (!isRecord(item)) return "every reconciliation row must be an object";
    const { candidate, raisedBy, decision, reasoning } = item;
    if (typeof candidate !== "string" || typeof raisedBy !== "string" || typeof decision !== "string" || typeof reasoning !== "string") {
      return "every reconciliation row needs candidate, raisedBy, decision and reasoning strings";
    }
    reconciliation.push({ candidate, raisedBy, decision, reasoning });
  }

  return {
    verdict: { recommendation, summary },
    findings,
    reconciliation,
    validation: stringList(data.validation),
    limitations: stringList(data.limitations),
  };
}

/** Asks the formatter model to extract the structure, retrying once with the validation error. */
export async function extractReport(markdown: string, complete: (user: string) => Promise<string>): Promise<ReportData | undefined> {
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = problem ? markdown + "\n\n---\nYour previous JSON was rejected: " + problem + ". Output the corrected JSON only." : markdown;
    try {
      const parsed = parseReport(await complete(user), markdown);
      if (typeof parsed !== "string") return parsed;
      problem = parsed;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  return undefined;
}

/**
 * A review with no "### R<n>" finding headings and no "Request changes" verdict has nothing
 * to fix. Checked on the synthesizer's markdown, so it needs no model call.
 */
export function isCleanReview(markdown: string) {
  const hasFindings = /^###\s+R\d+\b/m.test(markdown);
  const requestsChanges = /^##\s+Verdict\s*\n+\s*\**\s*Request changes/im.test(markdown);
  return !hasFindings && !requestsChanges;
}
