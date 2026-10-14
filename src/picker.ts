import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { levelColor } from "./colors.ts";
import { filterSelect, navHint } from "./filter-select.ts";
import type { Nav, NavKeys } from "./filter-select.ts";
import type { RememberedChoice } from "./memory.ts";

export interface ModelChoice {
  model: Model<Api>;
  /** Undefined for models without reasoning support. */
  level?: ModelThinkingLevel;
}

export function describeChoice(choice: ModelChoice) {
  return choice.model.id + (choice.level ? " " + choice.level : "");
}

/** "claude-opus-5-5" at high effort becomes "opus 5-5 high". */
export function shortName(choice: ModelChoice) {
  const id = choice.model.id.replace(/^claude-/, "").replace(/^([a-z]+)-(\d)/, "$1 $2");
  return id + (choice.level ? " " + choice.level : "");
}

/** Short names, numbered "(1)", "(2)" only where the same model and effort appear more than once. */
export function displayNames(choices: ModelChoice[]) {
  const base = choices.map(shortName);
  const seen = new Map<string, number>();
  return base.map(name => {
    if (base.filter(other => other === name).length === 1) return name;
    const number = (seen.get(name) ?? 0) + 1;
    seen.set(name, number);
    return name + " (" + number + ")";
  });
}

export function toRemembered(choice: ModelChoice): RememberedChoice {
  return { provider: choice.model.provider, id: choice.model.id, level: choice.level };
}

const USED_BEFORE = "  (used before)";

/** Effort levels from least to most. Lists always follow this order. */
const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function isSameModel(model: Model<Api>, remembered: RememberedChoice) {
  return model.provider === remembered.provider && model.id === remembered.id;
}

function modelLabel(model: Model<Api>) {
  return model.id + " [" + model.provider + "]";
}

function styleModel(option: string, theme: Theme) {
  const used = option.endsWith(USED_BEFORE);
  const text = used ? option.slice(0, -USED_BEFORE.length) : option;
  const provider = text.match(/ \[[^\]]+\]$/)?.[0] ?? "";
  return text.slice(0, text.length - provider.length) + theme.fg("dim", provider) + (used ? theme.fg("success", USED_BEFORE) : "");
}

interface PickOptions extends NavKeys {
  preferred?: RegExp;
  recent: RememberedChoice[];
  step?: string;
  /** The earlier answer, selected when the screen opens. */
  initial?: ModelChoice;
}

async function pickModel(ctx: ExtensionCommandContext, title: string, options: PickOptions, initial?: Model<Api>) {
  const { recent, preferred } = options;
  // Models you used before come first, most recent first, as their own group. Then the rest.
  const rank = (model: Model<Api>) => {
    const recentIndex = recent.findIndex(item => isSameModel(model, item));
    if (recentIndex !== -1) return recentIndex;
    return recent.length + (preferred?.test(model.id) ? 0 : 1);
  };
  const models = [...ctx.modelRegistry.getAvailable()].sort((a, b) => rank(a) - rank(b) || byName(a.provider, b.provider) || byName(a.id, b.id));
  const labelOf = (model: Model<Api>) => modelLabel(model) + (recent.some(item => isSameModel(model, item)) ? USED_BEFORE : "");
  const byLabel = new Map(models.map(model => [labelOf(model), model]));
  const result = await filterSelect(ctx, title, [...byLabel.keys()], {
    searchText: option => option.replace(USED_BEFORE, ""),
    group: option => (option.endsWith(USED_BEFORE) ? 0 : 1),
    style: styleModel,
    step: options.step,
    initial: initial && labelOf(initial),
    back: options.back,
    forward: options.forward,
    esc: options.esc,
  });
  if (result.kind !== "done") return result;
  return { kind: "done" as const, value: byLabel.get(result.value) };
}

/** Resolves undefined when the user backs out to the model list. */
async function pickLevel(ctx: ExtensionCommandContext, title: string, model: Model<Api>, options: PickOptions) {
  if (!model.reasoning) return { level: undefined };
  const levels = getSupportedThinkingLevels(model);
  if (levels.length === 0) return { level: undefined };
  // Always least to most effort. The one you used last time is tagged, not moved.
  const remembered = options.recent.find(item => isSameModel(model, item))?.level;
  const position = (level: string) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length);
  const sorted = [...levels].sort((a, b) => position(a) - position(b));
  const labels = sorted.map(level => (level === remembered ? level + USED_BEFORE : level));
  const initial = options.initial?.model === model ? options.initial.level : remembered;
  const result = await filterSelect(ctx, title + ": effort for " + model.id, labels, {
    filter: false,
    step: options.step,
    initial: labels[sorted.findIndex(level => level === initial)],
    back: true,
    esc: "back",
    style: (option, theme) => {
      const level = option.replace(USED_BEFORE, "");
      return theme.fg(levelColor(level), level) + (option.endsWith(USED_BEFORE) ? theme.fg("muted", USED_BEFORE) : "");
    },
  });
  if (result.kind !== "done") return undefined;
  return { level: sorted.find((_, index) => labels[index] === result.value) };
}

/** Model, then effort. Backing out of the effort screen returns to the model list. */
export async function pickChoice(ctx: ExtensionCommandContext, title: string, options: PickOptions): Promise<Nav<ModelChoice>> {
  let model = options.initial?.model;
  while (true) {
    const picked = await pickModel(ctx, title, options, model);
    if (picked.kind !== "done") return picked;
    if (!picked.value) continue;
    model = picked.value;

    const effort = await pickLevel(ctx, title, model, options);
    if (effort) return { kind: "done", value: { model, level: effort.level } };
  }
}

type Row = { kind: "reviewer"; index: number } | { kind: "add" } | { kind: "done" };

/**
 * One reviewer per line. Reviewers can be removed here (d, backspace or delete).
 * The reviewers array is edited in place.
 */
function editReviewers(ctx: ExtensionCommandContext, reviewers: ModelChoice[], step: string | undefined, back: boolean) {
  return ctx.ui.custom<Nav<"add" | "done">>((tui, theme, _keybindings, done) => {
    const border = new DynamicBorder(text => theme.fg("accent", text));
    const rows = () => {
      const result: Row[] = reviewers.map((_, index) => ({ kind: "reviewer", index }));
      result.push({ kind: "add" });
      if (reviewers.length > 0) result.push({ kind: "done" });
      return result;
    };
    // Start on "Add a reviewer", which sits right after the reviewers.
    let selected = reviewers.length;

    const label = (row: Row) => {
      if (row.kind === "add") return "+ Add a reviewer";
      if (row.kind === "done") return "✓ Done (" + reviewers.length + " reviewer" + (reviewers.length === 1 ? "" : "s") + ")";
      const choice = reviewers[row.index];
      const effort = choice.level ? theme.fg("dim", " · ") + theme.fg(levelColor(choice.level), choice.level) : "";
      return String(row.index + 1).padStart(2) + ".  " + choice.model.id + theme.fg("dim", " [" + choice.model.provider + "]") + effort;
    };

    return {
      invalidate() {
        border.invalidate();
      },
      render(width: number) {
        const current = rows();
        const lines = [
          ...border.render(width),
          (step ? theme.fg("muted", "[" + step + "] ") : "") + theme.fg("accent", theme.bold("Reviewers (" + reviewers.length + ")")),
          "",
        ];
        if (reviewers.length === 0) lines.push(theme.fg("muted", "  Add at least one reviewer."), "");
        current.forEach((row, index) => {
          const text = label(row);
          lines.push(truncateToWidth(index === selected ? theme.fg("accent", "→ " + text) : "  " + text, width));
        });
        const hint = navHint(["↑↓ navigate", "enter select", "d / backspace remove reviewer"], { back, forward: reviewers.length > 0 });
        lines.push("", truncateToWidth(theme.fg("dim", hint), width), ...border.render(width));
        return lines;
      },
      handleInput(data: string) {
        const current = rows();
        const row = current[selected];
        if (matchesKey(data, Key.up)) selected = (selected - 1 + current.length) % current.length;
        else if (matchesKey(data, Key.down)) selected = (selected + 1) % current.length;
        else if (matchesKey(data, Key.escape)) done({ kind: "cancel" });
        else if (back && matchesKey(data, Key.left)) done({ kind: "back" });
        else if (reviewers.length > 0 && matchesKey(data, Key.right)) done({ kind: "forward" });
        else if (matchesKey(data, Key.enter)) {
          if (row.kind === "add") done({ kind: "done", value: "add" });
          else if (row.kind === "done") done({ kind: "done", value: "done" });
        } else if (row.kind === "reviewer" && (matchesKey(data, "d") || matchesKey(data, Key.backspace) || matchesKey(data, Key.delete))) {
          reviewers.splice(row.index, 1);
          selected = Math.min(selected, rows().length - 1);
        }
        tui.requestRender();
      },
    };
  });
}

/**
 * Edits the reviewers array in place, so going back to this step keeps the list.
 * Backing out of adding a reviewer returns to the list.
 */
export async function pickReviewers(
  ctx: ExtensionCommandContext,
  reviewers: ModelChoice[],
  options: { recent: RememberedChoice[]; step?: string; back: boolean },
): Promise<Nav<ModelChoice[]>> {
  while (true) {
    const action = await editReviewers(ctx, reviewers, options.step, options.back);
    if (action.kind !== "done") return action;
    if (action.value === "done") return { kind: "done", value: reviewers };

    const choice = await pickChoice(ctx, "Reviewer " + (reviewers.length + 1), { recent: options.recent, step: options.step, back: true, esc: "back" });
    if (choice.kind === "done") reviewers.push(choice.value);
  }
}
