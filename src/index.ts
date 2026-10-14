import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { repoRoot, treeFingerprint } from "./git.ts";
import { buildChatMessage, registerResultRenderer, RESULT_MESSAGE_TYPE } from "./chat.ts";
import { filterSelect } from "./filter-select.ts";
import type { Nav, NavKeys } from "./filter-select.ts";
import { loadMemory, memoryFile, rememberFormatter, rememberUsed } from "./memory.ts";
import type { Memory } from "./memory.ts";
import { describeChoice, displayNames, pickChoice, pickReviewers, shortName, toRemembered } from "./picker.ts";
import type { ModelChoice } from "./picker.ts";
import { EXTRACTION_SYSTEM, REVIEW_TOOLS, reviewerPrompt, synthesisPrompt } from "./prompts.ts";
import type { ReviewNotes } from "./prompts.ts";
import { extractReport, isCleanReview } from "./report.ts";
import type { ReviewerMeta } from "./report.ts";
import { runPiAgent } from "./run-agent.ts";
import type { AgentRun } from "./run-agent.ts";
import { createProgress } from "./progress.ts";
import { pickScope } from "./scope.ts";
import { sweepRunProcesses } from "./sweep.ts";
import type { ReviewScope } from "./scope.ts";
import { renderReportHtml } from "./template.ts";
import { createRunDir } from "./workdir.ts";

interface ReviewSetup {
  scope: ReviewScope;
  reviewers: ModelChoice[];
  synthesizer: ModelChoice;
  formatter: ModelChoice;
}

function openInBrowser(file: string) {
  const open = (command: string, args: string[], onFail?: () => void) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => onFail?.());
    child.on("close", code => {
      if (code !== 0) onFail?.();
    });
    child.unref();
  };
  if (process.platform === "darwin") open("open", [file]);
  else if (process.platform === "win32") open("cmd", ["/c", "start", "", file]);
  else open("xdg-open", [file]);
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resolves "/rr formatter <model> [effort]" to a model, or explains why it cannot. */
function setFormatterFromArgs(ctx: ExtensionCommandContext, query: string, effort?: string): ModelChoice | undefined {
  const models = ctx.modelRegistry.getAvailable();
  const needle = query.toLowerCase();
  const exact = models.filter(model => model.id.toLowerCase() === needle || (model.provider + "/" + model.id).toLowerCase() === needle);
  const matches = exact.length ? exact : models.filter(model => (model.provider + "/" + model.id).toLowerCase().includes(needle));
  if (matches.length !== 1) {
    const hint = matches.length
      ? "matches several: " +
        matches
          .slice(0, 6)
          .map(model => model.id)
          .join(", ")
      : "matches no available model";
    ctx.ui.notify('"' + query + '" ' + hint, "error");
    return undefined;
  }

  const model = matches[0];
  const levels = model.reasoning ? getSupportedThinkingLevels(model) : [];
  if (!effort) return { model, level: levels.includes("off") ? "off" : levels[0] };
  const level = levels.find(item => item === effort);
  if (!level) {
    ctx.ui.notify(model.id + ' does not support effort "' + effort + '"' + (levels.length ? " (try: " + levels.join(", ") + ")" : ""), "error");
    return undefined;
  }
  return { model, level };
}

/** The saved formatter, if it is still available. */
function savedFormatter(ctx: ExtensionCommandContext, memory: Memory): ModelChoice | undefined {
  const saved = memory.formatter;
  const model = saved && ctx.modelRegistry.find(saved.provider, saved.id);
  if (!saved || !model) return undefined;
  const level = model.reasoning ? getSupportedThinkingLevels(model).find(item => item === saved.level) : undefined;
  return { model, level };
}

function pickFormatter(ctx: ExtensionCommandContext, memory: Memory, nav: NavKeys & { step?: string; initial?: ModelChoice } = {}) {
  return pickChoice(ctx, "Formatter model (structures the final review for the HTML report). Asked once.", {
    preferred: /haiku/i,
    recent: memory.formatter ? [memory.formatter] : [],
    ...nav,
  });
}

/** Where setup goes after a screen: the next step, the previous one, or nowhere. */
type Move = "next" | "back" | "cancel";

/** Turns a screen result into a move, saving the answer if there is one. Forward is only offered when an answer exists. */
async function settle<T>(result: Nav<T>, save: (value: T) => void | Promise<void>): Promise<Move> {
  if (result.kind === "done") {
    await save(result.value);
    return "next";
  }
  return result.kind === "forward" ? "next" : result.kind;
}

/**
 * Setup is a list of steps. Left goes back a step and right goes forward to a step already answered,
 * keeping every answer. Esc on a step cancels setup. Esc inside a step (the editor, an effort list,
 * a branch list) backs out to that step's first screen.
 */
async function askSetup(ctx: ExtensionCommandContext): Promise<ReviewSetup | undefined> {
  const file = memoryFile(getAgentDir());
  const memory = await loadMemory(file);
  const saved = savedFormatter(ctx, memory);

  let scope: ReviewScope | undefined;
  const reviewers: ModelChoice[] = [];
  let synthesizer: ModelChoice | undefined;
  let formatter = saved;
  /** Undefined until answered. An empty string means no additional instructions. */
  let extra: string | undefined;

  const finalScope = (picked: ReviewScope) =>
    extra ? { ...picked, instructions: picked.instructions + "\n\nAdditional instructions from the user: " + extra } : picked;
  const yesNoStyle = (option: string, theme: Theme) => theme.fg(option === "Yes" ? "success" : "error", option);

  const askInstructions = async (step: string, back: boolean): Promise<Move> => {
    while (true) {
      const answer = await filterSelect(ctx, "Add additional instructions?", ["No", "Yes"], {
        filter: false,
        step,
        back,
        forward: extra !== undefined,
        initial: extra ? "Yes" : "No",
        style: yesNoStyle,
      });
      if (answer.kind !== "done") return settle(answer, () => {});
      if (answer.value === "No") {
        extra = "";
        return "next";
      }
      // Esc returns to the Yes/No question.
      const text = await ctx.ui.editor("Additional instructions for the reviewers (esc to go back)", extra ?? "");
      if (text === undefined) continue;
      extra = text.trim();
      return "next";
    }
  };

  const confirm = async (step: string, back: boolean): Promise<Move> => {
    if (!scope || !synthesizer || !formatter) return "back";
    const choices = { scope, synthesizer, formatter };
    const details = (theme: Theme) => {
      const row = (label: string, value: string) => theme.fg("muted", label.padEnd(26)) + value;
      return [
        row("Scope", theme.fg("accent", choices.scope.label)),
        row("Reviewers", reviewers.map(describeChoice).join(", ")),
        row("Synthesis", describeChoice(choices.synthesizer)),
        row("Formatter", describeChoice(choices.formatter)),
        row("Additional instructions", extra ? theme.fg("success", "added") : theme.fg("dim", "none")),
        "",
      ];
    };
    const go = await filterSelect(ctx, "Start review?", ["Yes", "No"], { filter: false, step, back, details, style: yesNoStyle });
    if (go.kind === "back") return "back";
    return go.kind === "done" && go.value === "Yes" ? "next" : "cancel";
  };

  type Step = { name: string; run: (step: string, back: boolean) => Promise<Move> };
  const steps: Step[] = [
    { name: "Scope", run: async step => settle(await pickScope(ctx, step, scope), value => void (scope = value)) },
    { name: "Reviewers", run: async (step, back) => settle(await pickReviewers(ctx, reviewers, { recent: memory.history, step, back }), () => {}) },
    {
      name: "Synthesis",
      run: async (step, back) =>
        settle(
          await pickChoice(ctx, "Synthesis model (compares the notes and removes false positives)", {
            recent: memory.history,
            step,
            back,
            initial: synthesizer,
            forward: synthesizer !== undefined,
          }),
          value => void (synthesizer = value),
        ),
    },
    // Only asked the first time. Saved as soon as it is picked.
    ...(saved
      ? []
      : [
          {
            name: "Formatter",
            run: async (step: string, back: boolean) =>
              settle(await pickFormatter(ctx, memory, { step, back, initial: formatter, forward: formatter !== undefined }), async value => {
                formatter = value;
                await rememberFormatter(file, memory, toRemembered(value));
              }),
          },
        ]),
    { name: "Instructions", run: askInstructions },
    { name: "Confirm", run: confirm },
  ];

  let index = 0;
  while (index < steps.length) {
    const { name, run } = steps[index];
    const move = await run(index + 1 + "/" + steps.length + " " + name, index > 0);
    if (move === "cancel") return undefined;
    index = move === "next" ? index + 1 : Math.max(0, index - 1);
  }
  if (!scope || !synthesizer || !formatter) return undefined;

  // The formatter has its own setting, so it stays out of the used-before list.
  await rememberUsed(file, memory, [...reviewers, synthesizer].map(toRemembered));

  return { scope: finalScope(scope), reviewers, synthesizer, formatter };
}

export default function realreview(pi: ExtensionAPI) {
  let active: { controller: AbortController; done: Promise<void> } | undefined;

  registerResultRenderer(pi);
  // Added to the transcript without starting a turn. It also becomes part of the model's context,
  // so you can follow up with "fix R1".
  const post = (content: string) => pi.sendMessage({ customType: RESULT_MESSAGE_TYPE, content, display: true }, { triggerTurn: false });

  // Stop every agent and wait (briefly) for their processes to be gone before pi exits.
  pi.on("session_shutdown", async () => {
    if (!active) return;
    active.controller.abort();
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 10_000).unref());
    await Promise.race([active.done, timeout]);
  });

  const reviewCommand = {
    description: "Review code with several models, filter false positives, and open an HTML report",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim() === "cancel") {
        if (active) active.controller.abort();
        else ctx.ui.notify("No review is running", "info");
        return;
      }
      const [command, ...rest] = args.trim().split(/\s+/);
      if (command === "formatter") {
        const file = memoryFile(getAgentDir());
        const memory = await loadMemory(file);
        // With arguments, set it directly: /rr formatter <model> [effort]. Without, pick from a menu.
        const picked = !rest.length && ctx.mode === "tui" ? await pickFormatter(ctx, memory, { initial: savedFormatter(ctx, memory) }) : undefined;
        const chosen = rest.length ? setFormatterFromArgs(ctx, rest[0], rest[1]) : picked?.kind === "done" ? picked.value : undefined;
        if (chosen) {
          await rememberFormatter(file, memory, toRemembered(chosen));
          ctx.ui.notify("Formatter set to " + describeChoice(chosen), "info");
        }
        return;
      }
      if (active) {
        ctx.ui.notify("A review is already running. Use /realreview cancel to stop it.", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/realreview needs the interactive terminal UI", "error");
        return;
      }

      let setup: ReviewSetup | undefined;
      try {
        await repoRoot(ctx.cwd);
        setup = await askSetup(ctx);
      } catch (error) {
        ctx.ui.notify("/realreview: " + (error instanceof Error ? error.message : String(error)), "error");
        return;
      }
      if (!setup) return;

      const controller = new AbortController();
      // Run in the background so pi stays usable while the review runs.
      const done = runReview(ctx, setup, controller.signal, post)
        .catch(error => {
          const message = controller.signal.aborted ? "Review cancelled" : "Review failed: " + (error instanceof Error ? error.message : String(error));
          ctx.ui.notify(message, controller.signal.aborted ? "warning" : "error");
        })
        .finally(() => {
          active = undefined;
        });
      active = { controller, done };
    },
  };
  pi.registerCommand("realreview", reviewCommand);
  pi.registerCommand("rr", reviewCommand);
}

async function runReview(ctx: ExtensionCommandContext, setup: ReviewSetup, outerSignal: AbortSignal, post: (content: string) => void) {
  const startedAt = Date.now();
  const cwd = ctx.cwd;
  const root = await repoRoot(cwd);
  const dir = await createRunDir();
  const runId = path.basename(dir);

  // Every agent shares this signal. The finally block aborts it, so nothing outlives the review.
  const runController = new AbortController();
  const signal = runController.signal;
  const forwardAbort = () => runController.abort();
  if (outerSignal.aborted) forwardAbort();
  else outerSignal.addEventListener("abort", forwardAbort, { once: true });
  const launched: Promise<AgentRun>[] = [];

  const treeBefore = await treeFingerprint(cwd);

  const patchPath = setup.scope.patch ? path.join(dir, "reviewed.diff") : undefined;
  if (patchPath && setup.scope.patch) await fs.writeFile(patchPath, setup.scope.patch);
  const patchSha = setup.scope.patch ? createHash("sha256").update(setup.scope.patch).digest("hex") : undefined;

  const progress = createProgress(ctx, startedAt);
  const runs = progress.runs;

  const launch = async (label: string, name: string, choice: ModelChoice, prompt: string) => {
    const promptFile = path.join(dir, label + ".prompt.md");
    await fs.writeFile(promptFile, prompt);
    const placeholder: AgentRun = {
      label,
      name,
      model: choice.model.id,
      level: choice.level,
      status: "running",
      toolCalls: 0,
      cost: 0,
      startedAt: Date.now(),
      text: "",
      leftovers: 0,
    };
    runs.push(placeholder);
    const index = runs.length - 1;
    const pending = runPiAgent({
      cwd,
      label,
      name,
      provider: choice.model.provider,
      modelId: choice.model.id,
      level: choice.level,
      tools: REVIEW_TOOLS,
      promptFile,
      jsonlPath: path.join(dir, label + ".jsonl"),
      runId,
      signal,
      onUpdate: run => {
        runs[index] = run;
      },
    });
    launched.push(pending);
    const result = await pending;
    runs[index] = result;
    return result;
  };

  try {
    // 1. Independent reviewers, in parallel.
    const reviewPrompt = reviewerPrompt(setup.scope, patchPath);
    const reviewerLabels = setup.reviewers.map((choice, index) => "reviewer-" + (index + 1) + "-" + slug(choice.model.id));
    const reviewerNames = displayNames(setup.reviewers);
    const reviewerRuns = await Promise.all(setup.reviewers.map((choice, index) => launch(reviewerLabels[index], reviewerNames[index], choice, reviewPrompt)));
    if (signal.aborted) throw new Error("cancelled");

    const successful = reviewerRuns.filter(run => run.status === "done");
    if (successful.length === 0) throw new Error("every reviewer failed: " + reviewerRuns.map(run => run.name + ": " + run.error).join("; "));

    const notes: ReviewNotes[] = [];
    for (const run of successful) {
      const notesPath = path.join(dir, run.label + ".md");
      await fs.writeFile(notesPath, run.text);
      notes.push({ name: run.name, notesPath });
    }

    // 2. Synthesis: compare notes, re-check against the code, drop false positives.
    progress.setStage("synthesizing");
    const synthesis = await launch(
      "synthesis-" + slug(setup.synthesizer.model.id),
      "synthesis · " + shortName(setup.synthesizer),
      setup.synthesizer,
      synthesisPrompt(setup.scope, patchPath, notes),
    );
    if (synthesis.status === "failed") throw new Error("synthesis failed: " + synthesis.error);
    await fs.writeFile(path.join(dir, "final-review.md"), synthesis.text);

    const treeChanged = treeBefore !== (await treeFingerprint(cwd));
    const reviewers: ReviewerMeta[] = reviewerRuns.map(run => ({
      label: run.name,
      model: run.model,
      level: run.level,
      status: run.status === "done" ? "done" : "failed",
      durationMs: (run.endedAt ?? Date.now()) - run.startedAt,
      toolCalls: run.toolCalls,
      cost: run.cost,
      error: run.error,
      notes: run.status === "done" ? run.text : undefined,
    }));
    const reviewerCost = reviewerRuns.reduce((sum, run) => sum + run.cost, 0);
    let formatterCost = 0;
    let reportPath: string | undefined;
    let structured = true;

    // 3. A clean review gets no HTML. Otherwise the formatter model extracts the structure
    // and the extension renders the report.
    const clean = isCleanReview(synthesis.text);
    if (!clean) {
      progress.setStage("building report");
      const complete = async (user: string) => {
        const { model, level } = setup.formatter;
        const stream = ctx.modelRegistry.streamSimple(
          model,
          { systemPrompt: EXTRACTION_SYSTEM, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
          { signal, reasoning: level && level !== "off" ? level : undefined, maxTokens: Math.min(model.maxTokens, 32000) },
        );
        const message = await stream.result();
        formatterCost += message.usage?.cost?.total ?? 0;
        if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(message.errorMessage ?? message.stopReason);
        return message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
      };
      const report = await extractReport(synthesis.text, complete);
      structured = report !== undefined;

      const html = renderReportHtml(
        {
          scopeLabel: setup.scope.label,
          repo: root,
          generatedAt: new Date().toLocaleString(),
          durationMs: Date.now() - startedAt,
          patchSha,
          reviewers,
          synthesizer: { model: synthesis.model, level: synthesis.level, cost: synthesis.cost },
          formatter: { model: setup.formatter.model.id, cost: formatterCost },
          treeChanged,
          totalCost: reviewerCost + synthesis.cost + formatterCost,
        },
        report,
        synthesis.text,
      );
      reportPath = path.join(dir, "index.html");
      await fs.writeFile(reportPath, html);
      openInBrowser(reportPath);
    }

    post(
      buildChatMessage({
        review: synthesis.text,
        reportPath,
        reviewersDone: successful.length,
        reviewersTotal: reviewerRuns.length,
        cost: reviewerCost + synthesis.cost + formatterCost,
        durationMs: Date.now() - startedAt,
        treeChanged,
      }),
    );

    const failed = reviewerRuns.length - successful.length;
    ctx.ui.notify(
      (clean ? "Review clean: no issues found" : "Review ready: " + reportPath) +
        (failed ? " (" + failed + " reviewer" + (failed > 1 ? "s" : "") + " failed)" : "") +
        (structured ? "" : " (unstructured fallback)"),
      "info",
    );
  } finally {
    progress.stop();
    outerSignal.removeEventListener("abort", forwardAbort);
    // Stop any agent still running (for example after one failed), wait until each one's
    // process group is gone, then sweep for anything that escaped its group.
    runController.abort();
    await Promise.allSettled(launched);
    const leftovers = runs.reduce((total, run) => total + run.leftovers, 0) + (await sweepRunProcesses(runId));
    if (leftovers > 0)
      ctx.ui.notify("realreview stopped " + leftovers + " leftover process" + (leftovers === 1 ? "" : "es") + " started by the reviewers", "info");
  }
}
