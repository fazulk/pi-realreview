import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { colorEffort } from "./colors.ts";
import type { AgentRun } from "./run-agent.ts";

const KEY = "realreview";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

function elapsed(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m" + String(seconds % 60).padStart(2, "0") + "s";
}

/**
 * Animated progress panel above the editor: a spinner on whatever is running,
 * a green check when an agent finishes, a red cross when it fails.
 * Push agent runs into progress.runs; call stop() when the review is over.
 */
export function createProgress(ctx: ExtensionCommandContext, startedAt: number) {
  const runs: AgentRun[] = [];
  let stage = "reviewing";
  const timers = new Set<ReturnType<typeof setInterval>>();

  ctx.ui.setWidget(KEY, (tui, theme) => {
    const timer = setInterval(() => tui.requestRender(), FRAME_MS);
    timer.unref();
    timers.add(timer);

    return {
      invalidate() {},
      dispose() {
        clearInterval(timer);
        timers.delete(timer);
      },
      render(width: number) {
        const spinner = theme.fg("warning", SPINNER[Math.floor(Date.now() / FRAME_MS) % SPINNER.length]);
        const lines = [
          truncateToWidth(
            theme.fg("mdLink", theme.bold("realreview")) +
              " " +
              spinner +
              " " +
              theme.fg("syntaxVariable", stage) +
              theme.fg("dim", " · " + elapsed(Date.now() - startedAt)),
            width,
          ),
        ];
        for (const run of runs) {
          const mark = run.status === "done" ? theme.fg("success", "✓") : run.status === "failed" ? theme.fg("error", "✗") : spinner;
          const stats = elapsed((run.endedAt ?? Date.now()) - run.startedAt) + " · " + run.toolCalls + " tools · $" + run.cost.toFixed(2);
          const last = run.status === "running" && run.lastTool ? theme.fg("mdLink", " · " + run.lastTool) : "";
          const error = run.error ? " · " + run.error.split("\n")[0].slice(0, 80) : "";
          lines.push(
            truncateToWidth(
              "  " +
                mark +
                " " +
                theme.bold(colorEffort(run.name, run.level, theme)) +
                theme.fg("dim", "  " + stats) +
                last +
                (error ? theme.fg("error", error) : ""),
              width,
            ),
          );
        }
        return lines;
      },
    };
  });
  ctx.ui.setStatus(KEY, "realreview: " + stage);

  return {
    runs,
    setStage(next: string) {
      stage = next;
      ctx.ui.setStatus(KEY, "realreview: " + next);
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.clear();
      ctx.ui.setWidget(KEY, undefined);
      ctx.ui.setStatus(KEY, undefined);
    },
  };
}
