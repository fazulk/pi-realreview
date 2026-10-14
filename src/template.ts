import type { Recommendation, ReportData, ReportMeta } from "./report.ts";
import { formatDuration, formatMoney } from "./format.ts";
import { escapeHtml, renderInline, renderMarkdown } from "./markdown.ts";

const CSS = `:root { --ink:#172330; --muted:#657386; --paper:#fff; --bg:#f3f5f7; --line:#dde3e9; --accent:#2452a1; --danger:#ac3c2f; --warn:#9a691e; --ok:#2f7a4f; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; scroll-padding-top:28px; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
a { color:var(--accent); text-underline-offset:3px; }
.shell { max-width:1280px; margin:auto; padding:48px 40px 64px; }
.eyebrow { color:var(--accent); font-size:11px; font-weight:750; letter-spacing:.13em; text-transform:uppercase; }
h1 { margin:8px 0; font-size:clamp(26px,4vw,38px); line-height:1.15; letter-spacing:-.03em; }
.subtitle { margin:10px 0 24px; color:var(--muted); overflow-wrap:anywhere; }
.verdict-tag { display:inline-block; padding:3px 10px; border-radius:6px; font-size:12px; font-weight:700; margin-right:8px; }
.verdict-tag.approve { background:#e3f3ea; color:var(--ok); }
.verdict-tag.request_changes { background:#fbe9e6; color:var(--danger); }
.verdict-tag.comment { background:#eaf0fa; color:var(--accent); }
.stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:20px 0 28px; }
.stat { padding:15px 18px; background:var(--paper); border:1px solid var(--line); border-radius:10px; }
.stat strong { display:block; font-size:22px; line-height:1.3; letter-spacing:-.02em; }
.stat span { font-size:12px; color:var(--muted); }
.layout { display:grid; grid-template-columns:200px minmax(0,1fr); gap:28px; align-items:start; }
nav { position:sticky; top:26px; }
nav a { display:block; padding:7px 10px; font-size:12px; color:var(--muted); text-decoration:none; border-left:2px solid transparent; }
nav a:hover { border-left-color:var(--accent); background:#e9eef6; color:var(--accent); }
main { min-width:0; }
.section { background:var(--paper); border:1px solid var(--line); border-radius:12px; margin:0 0 18px; padding:26px 30px; }
.section > h2 { margin:0 0 16px; font-size:21px; letter-spacing:-.02em; }
h3 { font-size:17px; line-height:1.45; margin:0 0 10px; }
h4,h5,h6 { margin:18px 0 6px; font-size:14px; }
p { margin:10px 0; }
ul,ol { padding-left:22px; }
li { margin:5px 0; }
li.l1 { margin-left:18px; } li.l2 { margin-left:36px; } li.l3 { margin-left:54px; }
code { font:.85em ui-monospace,SFMono-Regular,Consolas,monospace; background:#f0f3f6; border:1px solid #e7ebf0; padding:.1em .3em; border-radius:4px; overflow-wrap:anywhere; }
pre { padding:16px; overflow:auto; background:#f4f6f8; border:1px solid var(--line); border-radius:7px; }
pre code { border:0; background:none; padding:0; }
blockquote { margin:14px 0; padding:2px 16px; border-left:3px solid var(--accent); background:#f6f8fc; color:#41526b; }
.finding { border-top:1px solid var(--line); padding:22px 0 4px; margin-top:20px; }
.finding:first-of-type { border-top:0; padding-top:0; margin-top:0; }
.loc { margin:4px 0 10px; font-size:13px; color:var(--muted); }
.badge { display:inline-block; font-size:11px; font-weight:750; letter-spacing:.04em; padding:3px 7px; margin-right:8px; border-radius:5px; vertical-align:2px; border:1px solid; }
.badge.P1 { background:#fbe9e6; color:var(--danger); border-color:#f2d4ce; }
.badge.P2 { background:#fbf2e2; color:var(--warn); border-color:#efdfbf; }
.badge.P3 { background:#eaf0fa; color:var(--accent); border-color:#d4dff1; }
.fid { color:var(--muted); font-weight:600; margin-right:6px; }
.pill { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; }
.pill.retained,.pill.done { background:#e3f3ea; color:var(--ok); }
.pill.merged { background:#eaf0fa; color:var(--accent); }
.pill.rejected,.pill.failed { background:#fbe9e6; color:var(--danger); }
.pill.unproven { background:#fbf2e2; color:var(--warn); }
.table-wrap { overflow-x:auto; }
table { border-collapse:collapse; width:100%; font-size:12.5px; line-height:1.6; }
th { background:#f4f6f8; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.03em; text-align:left; }
td,th { padding:11px 12px; vertical-align:top; border-bottom:1px solid var(--line); }
.muted { color:var(--muted); font-size:13px; }
details { margin:12px 0; padding:12px 16px; border:1px solid var(--line); border-radius:8px; }
summary { cursor:pointer; font-weight:600; }
.notes { margin-top:14px; font-size:13px; }
.back { float:right; font-size:12px; font-weight:500; text-decoration:none; }
@keyframes rr-flash { from { background:#fff1bf; } to { background:transparent; } }
.finding:target, details:target, tr:target > td { animation:rr-flash 1.8s ease-out; }
.banner { padding:12px 16px; margin:0 0 18px; border:1px solid #efdfbf; background:#fbf2e2; color:var(--warn); border-radius:8px; font-size:13px; }
footer { border-top:1px solid var(--line); margin-top:22px; padding-top:18px; font-size:12px; color:var(--muted); }
th.pick,td.pick { width:34px; padding-right:0; }
td.pick input { width:16px; height:16px; margin:3px 0 0; cursor:pointer; accent-color:var(--accent); }
tr.picked td { background:#f6f8fc; }
textarea.note { display:block; width:100%; min-height:54px; margin-top:8px; padding:6px 8px; font:inherit; font-size:12.5px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:6px; resize:vertical; }
textarea.note:focus { outline:2px solid #c9d7ef; border-color:var(--accent); }
textarea.note:disabled { background:#f7f8fa; color:var(--muted); cursor:not-allowed; }
body.has-tray .shell { padding-bottom:110px; }
.tray { position:fixed; left:50%; bottom:16px; z-index:10; transform:translateX(-50%); width:min(1200px,calc(100% - 32px)); display:flex; align-items:center; gap:14px; padding:10px 12px 10px 16px; background:var(--ink); color:#fff; border-radius:10px; box-shadow:0 10px 28px rgba(23,35,48,.28); font-size:13px; }
.tray-count { font-weight:700; white-space:nowrap; }
.tray-list { flex:1; min-width:0; display:flex; gap:6px; overflow-x:auto; }
.tray-list:empty::before { content:"Check reconciliation rows to collect them"; color:rgba(255,255,255,.6); }
.tray-list a { max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:2px 9px; font-size:12px; color:#fff; text-decoration:none; background:rgba(255,255,255,.13); border-radius:999px; }
.tray-list a:hover { background:rgba(255,255,255,.24); }
.tray-status { color:#9fd8b5; white-space:nowrap; }
.tray button { padding:7px 14px; font:inherit; font-weight:700; color:var(--ink); background:#fff; border:0; border-radius:7px; cursor:pointer; white-space:nowrap; }
.tray button:disabled { opacity:.45; cursor:default; }
@media (max-width:900px) { .shell{padding:26px 18px} .layout{display:block} nav{position:static;display:flex;flex-wrap:wrap;margin-bottom:16px} .stats{grid-template-columns:repeat(2,1fr)} .section{padding:22px 20px} }
@media print { body{background:#fff} nav,.tray,.pick,textarea.note:disabled{display:none} .layout{display:block} .section{border:0;padding:10px 0} .finding{break-inside:avoid} }
`;

/** Collects checked reconciliation rows (with notes) and copies them as Markdown. Data comes from #rr-data. */
const SELECTION_SCRIPT = `(function () {
  var data = JSON.parse(document.getElementById("rr-data").textContent);
  var tray = document.getElementById("rr-tray");
  var count = tray.querySelector(".tray-count");
  var list = tray.querySelector(".tray-list");
  var status = tray.querySelector(".tray-status");
  var button = tray.querySelector("button");
  var rows = Array.prototype.slice.call(document.querySelectorAll("tr[data-rec]"));
  var statusTimer;

  function picked() {
    return rows.filter(function (row) { return row.querySelector("input").checked; });
  }

  function update() {
    var selected = picked();
    count.textContent = selected.length + " selected";
    list.replaceChildren.apply(list, selected.map(function (row) {
      var link = document.createElement("a");
      var text = data.rows[Number(row.dataset.rec)].candidate.replace(/\`/g, "");
      link.href = "#" + row.id;
      link.title = text;
      link.textContent = text;
      return link;
    }));
    button.disabled = selected.length === 0;
  }

  function indent(text) {
    return text.trim().split("\\n").join("\\n   ");
  }

  function toMarkdown() {
    var lines = ["## Selected review items (" + data.repo + " · " + data.scope + ")", ""];
    picked().forEach(function (row, index) {
      var item = data.rows[Number(row.dataset.rec)];
      var note = row.querySelector("textarea").value.trim();
      lines.push((index + 1) + ". **" + item.candidate + "** — " + item.decision + " (raised by " + item.raisedBy + ")");
      lines.push("   Reasoning: " + indent(item.reasoning));
      if (note) lines.push("   Note: " + indent(note));
    });
    return lines.join("\\n") + "\\n";
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  }

  function flash(message) {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { status.textContent = ""; }, 2000);
  }

  rows.forEach(function (row) {
    var box = row.querySelector("input");
    var note = row.querySelector("textarea");
    box.addEventListener("change", function () {
      note.disabled = !box.checked;
      row.classList.toggle("picked", box.checked);
      if (box.checked) note.focus();
      update();
    });
  });

  button.addEventListener("click", function () {
    var text = toMarkdown();
    var write = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
    write
      .catch(function () { fallbackCopy(text); })
      .then(function () { flash("Copied " + picked().length); })
      .catch(function () { flash("Copy failed"); });
  });

  update();
})();`;

/** Opens a collapsed reviewer-notes block when a link points at it, so the jump lands on visible content. */
const NAV_SCRIPT = `(function () {
  function reveal(id) {
    var target = id && document.getElementById(decodeURIComponent(id));
    if (target && target.tagName === "DETAILS") target.open = true;
  }
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest('a[href^="#"]');
    if (link) reveal(link.getAttribute("href").slice(1));
  });
  reveal(location.hash.slice(1));
})();`;

const VERDICT_LABEL: Record<Recommendation, string> = {
  approve: "Approve",
  request_changes: "Request changes",
  comment: "Comment",
};

function decisionClass(decision: string) {
  const word = decision.toLowerCase();
  if (word.startsWith("retain")) return "retained";
  if (word.startsWith("merge")) return "merged";
  if (word.startsWith("reject")) return "rejected";
  return "unproven";
}

function section(id: string, title: string, body: string) {
  return '<section class="section" id="' + id + '"><h2>' + title + "</h2>" + body + "</section>";
}

function bulletList(items: string[], empty: string) {
  if (items.length === 0) return '<p class="muted">' + empty + "</p>";
  return "<ul>" + items.map(item => "<li>" + renderInline(item) + "</li>").join("") + "</ul>";
}

function reviewersSection(meta: ReportMeta) {
  const rows = meta.reviewers
    .map(
      reviewer =>
        "<tr><td>" +
        escapeHtml(reviewer.label) +
        "</td><td><code>" +
        escapeHtml(reviewer.model) +
        "</code></td><td>" +
        escapeHtml(reviewer.level ?? "-") +
        '</td><td><span class="pill ' +
        reviewer.status +
        '">' +
        reviewer.status +
        "</span></td><td>" +
        reviewer.toolCalls +
        "</td><td>" +
        formatDuration(reviewer.durationMs) +
        "</td><td>" +
        formatMoney(reviewer.cost) +
        "</td></tr>",
    )
    .join("");
  const table =
    '<div class="table-wrap"><table><thead><tr><th>Reviewer</th><th>Model</th><th>Effort</th><th>Status</th><th>Tool calls</th><th>Time</th><th>Cost</th></tr></thead><tbody>' +
    rows +
    "</tbody></table></div>";

  const pipeline =
    '<p class="muted">Synthesis: <code>' +
    escapeHtml(meta.synthesizer.model) +
    "</code>" +
    (meta.synthesizer.level ? " (" + escapeHtml(meta.synthesizer.level) + ")" : "") +
    ", " +
    formatMoney(meta.synthesizer.cost) +
    ". Formatter: <code>" +
    escapeHtml(meta.formatter.model) +
    "</code>, " +
    formatMoney(meta.formatter.cost) +
    ".</p>";

  const notes = meta.reviewers
    .map((reviewer, index) => {
      const content = reviewer.notes ? renderMarkdown(reviewer.notes, 4) : '<p class="muted">' + escapeHtml(reviewer.error ?? "No notes.") + "</p>";
      return (
        '<details id="' +
        notesId(index) +
        '"><summary>' +
        escapeHtml(reviewer.label) +
        ' · original notes</summary><div class="notes">' +
        content +
        "</div></details>"
      );
    })
    .join("");

  return table + pipeline + '<p class="muted">The original notes are unfiltered. They are superseded by the adjudicated findings above.</p>' + notes;
}

function notesId(reviewerIndex: number) {
  return "notes-" + (reviewerIndex + 1);
}

function recId(rowIndex: number) {
  return "rec-" + (rowIndex + 1);
}

/** The finding a Retained or Merged row became, read from the "R<n>" id its reasoning cites. */
function rowFinding(row: ReportData["reconciliation"][number], findingIds: Set<string>) {
  if (!["retained", "merged"].includes(decisionClass(row.decision))) return undefined;
  return (row.decision + " " + row.reasoning).match(/\bR\d+\b/g)?.find(id => findingIds.has(id));
}

/** Splits "Raised by" text into reviewer names (by index into meta.reviewers) and the text between them. */
function splitRaisedBy(raisedBy: string, reviewers: ReportMeta["reviewers"]) {
  // Longest first, so "opus high" is not matched as "opus" when both exist.
  const labels = reviewers.map((reviewer, index) => ({ label: reviewer.label.toLowerCase(), index })).sort((a, b) => b.label.length - a.label.length);
  const lower = raisedBy.toLowerCase();
  const parts: ({ text: string } | { text: string; reviewer: number })[] = [];
  let plain = "";
  for (let at = 0; at < raisedBy.length;) {
    const match = labels.find(item => item.label && lower.startsWith(item.label, at));
    if (!match) {
      plain += raisedBy[at++];
      continue;
    }
    if (plain) parts.push({ text: plain });
    plain = "";
    parts.push({
      text: raisedBy.slice(at, at + match.label.length),
      reviewer: match.index,
    });
    at += match.label.length;
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

function findingsSection(report: ReportData) {
  if (report.findings.length === 0) return '<p class="muted">No actionable findings.</p>';
  const findingIds = new Set(report.findings.map(finding => finding.id));
  const sourceRow = new Map<string, number>();
  report.reconciliation.forEach((row, index) => {
    const id = rowFinding(row, findingIds);
    if (id && !sourceRow.has(id)) sourceRow.set(id, index);
  });
  return report.findings
    .map(finding => {
      const row = sourceRow.get(finding.id);
      const back = row === undefined ? "" : '<a class="back" href="#' + recId(row) + '">↩ Reconciliation</a>';
      return (
        '<article class="finding" id="' +
        escapeHtml(finding.id) +
        '"><h3>' +
        back +
        '<span class="badge ' +
        finding.severity +
        '">' +
        finding.severity +
        '</span><span class="fid">' +
        escapeHtml(finding.id) +
        "</span>" +
        renderInline(finding.title) +
        "</h3>" +
        (finding.location ? '<p class="loc">' + renderInline(finding.location) + "</p>" : "") +
        renderMarkdown(finding.body, 4) +
        "</article>"
      );
    })
    .join("");
}

/**
 * Each candidate links to its details: the finding it became, or else the original notes of the
 * first reviewer who raised it. Each reviewer name in "Raised by" links to that reviewer's notes.
 */
function reconciliationSection(report: ReportData, reviewers: ReportMeta["reviewers"]) {
  if (report.reconciliation.length === 0) return '<p class="muted">No candidates were reconciled.</p>';
  const findingIds = new Set(report.findings.map(finding => finding.id));
  const rows = report.reconciliation
    .map((row, index) => {
      const raisedBy = splitRaisedBy(row.raisedBy, reviewers);
      const firstReviewer = raisedBy.find(part => "reviewer" in part);
      const finding = rowFinding(row, findingIds);
      const target = finding ?? (firstReviewer && "reviewer" in firstReviewer ? notesId(firstReviewer.reviewer) : undefined);
      const title = finding ? "Jump to " + finding : "Jump to " + (firstReviewer?.text ?? "") + "'s notes";
      const candidate = target
        ? '<a href="#' + escapeHtml(target) + '" title="' + escapeHtml(title) + '">' + renderInline(row.candidate) + "</a>"
        : renderInline(row.candidate);
      const raisedByHtml = raisedBy
        .map(part => ("reviewer" in part ? '<a href="#' + notesId(part.reviewer) + '">' + escapeHtml(part.text) + "</a>" : renderInline(part.text)))
        .join("");
      return (
        '<tr id="' +
        recId(index) +
        '" data-rec="' +
        index +
        '"><td class="pick"><input type="checkbox" aria-label="Select ' +
        escapeHtml(row.candidate) +
        '"></td><td>' +
        candidate +
        "</td><td>" +
        raisedByHtml +
        '</td><td><span class="pill ' +
        decisionClass(row.decision) +
        '">' +
        escapeHtml(row.decision) +
        "</span></td><td>" +
        renderInline(row.reasoning) +
        '<textarea class="note" disabled placeholder="Check the row to add a note" aria-label="Note for ' +
        escapeHtml(row.candidate) +
        '"></textarea></td></tr>'
      );
    })
    .join("");
  return (
    '<div class="table-wrap"><table><thead><tr><th class="pick"></th><th>Candidate</th><th>Raised by</th><th>Decision</th><th>Reasoning</th></tr></thead><tbody>' +
    rows +
    "</tbody></table></div>"
  );
}

/** The fixed tray, the row data it copies, and the script that wires them up. Empty when nothing can be selected. */
function selectionTray(meta: ReportMeta, report: ReportData | undefined) {
  if (!report || report.reconciliation.length === 0) return "";
  const data = {
    repo: meta.repo,
    scope: meta.scopeLabel,
    rows: report.reconciliation,
  };
  // Escaping "<" keeps "</script>" inside a string from closing the tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    '<div class="tray" id="rr-tray" role="region" aria-label="Selected reconciliation items"><span class="tray-count"></span>' +
    '<div class="tray-list"></div><span class="tray-status" aria-live="polite"></span><button type="button">Copy selected</button></div>' +
    '<script type="application/json" id="rr-data">' +
    json +
    "</script><script>" +
    SELECTION_SCRIPT +
    "</script>"
  );
}

function countBySeverity(report: ReportData) {
  const counts = (["P1", "P2", "P3"] as const).map(level => ({
    level,
    count: report.findings.filter(finding => finding.severity === level).length,
  }));
  return (
    counts
      .filter(item => item.count > 0)
      .map(item => item.count + " " + item.level)
      .join(" · ") || "none"
  );
}

/** Renders the whole report. markdown is used as the body when structured extraction failed. */
export function renderReportHtml(meta: ReportMeta, report: ReportData | undefined, markdown: string) {
  const reviewersOk = meta.reviewers.filter(reviewer => reviewer.status === "done").length;
  const sections: { id: string; title: string; html: string }[] = report
    ? [
        {
          id: "verdict",
          title: "Verdict",
          html:
            '<p><span class="verdict-tag ' +
            report.verdict.recommendation +
            '">' +
            VERDICT_LABEL[report.verdict.recommendation] +
            "</span>" +
            renderInline(report.verdict.summary) +
            "</p>",
        },
        { id: "findings", title: "Findings", html: findingsSection(report) },
        {
          id: "reconciliation",
          title: "Reconciliation",
          html: reconciliationSection(report, meta.reviewers),
        },
        {
          id: "validation",
          title: "Validation",
          html: bulletList(report.validation, "No checks were reported."),
        },
        {
          id: "limitations",
          title: "Limitations",
          html: bulletList(report.limitations, "None reported."),
        },
      ]
    : [
        {
          id: "review",
          title: "Review",
          html: '<div class="banner">Structured extraction failed, so the synthesizer output is shown as written.</div>' + renderMarkdown(markdown, 3),
        },
      ];
  sections.push({
    id: "reviewers",
    title: "Reviewers",
    html: reviewersSection(meta),
  });

  const statFindings = report ? report.findings.length + " finding" + (report.findings.length === 1 ? "" : "s") : "n/a";
  const statDetail = report ? countBySeverity(report) : "extraction failed";
  const tray = selectionTray(meta, report);

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Code review · " +
      escapeHtml(meta.scopeLabel) +
      "</title><style>" +
      CSS +
      "</style></head><body" +
      (tray ? ' class="has-tray"' : "") +
      '><div class="shell"><header>',
    '<div class="eyebrow">realreview</div><h1>' + escapeHtml(meta.scopeLabel) + "</h1>",
    '<p class="subtitle">' + escapeHtml(meta.repo) + " · " + escapeHtml(meta.generatedAt) + "</p>",
    '<div class="stats">',
    '<div class="stat"><strong>' + statFindings + "</strong><span>" + escapeHtml(statDetail) + "</span></div>",
    '<div class="stat"><strong>' + reviewersOk + " / " + meta.reviewers.length + "</strong><span>reviewers finished</span></div>",
    '<div class="stat"><strong>' + formatMoney(meta.totalCost) + "</strong><span>total model cost</span></div>",
    '<div class="stat"><strong>' + formatDuration(meta.durationMs) + "</strong><span>wall time</span></div>",
    "</div></header>",
    '<div class="layout"><nav>' + sections.map(item => '<a href="#' + item.id + '">' + item.title + "</a>").join("") + "</nav><main>",
    sections.map(item => section(item.id, item.title, item.html)).join("\n"),
    "</main></div><footer>",
    "<p>" +
      (meta.treeChanged ? "Warning: the working tree changed while the review ran. Check git status." : "Review only. The working tree was not changed.") +
      "</p>",
    meta.patchSha ? "<p>Reviewed diff SHA-256: <code>" + meta.patchSha + "</code></p>" : "",
    "</footer></div>" + tray + "<script>" + NAV_SCRIPT + "</script></body></html>",
  ].join("\n");
}
