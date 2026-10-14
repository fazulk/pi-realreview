import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * Effort reads like a thermometer: green, cyan, yellow, red.
 * Purple is left out on purpose, it is the colour of the selector.
 */
export function levelColor(level: string) {
  if (level === "off" || level === "minimal" || level === "low") return "success";
  if (level === "medium") return "syntaxVariable";
  if (level === "high") return "warning";
  return "error";
}

/** Colours the effort word inside a name like "opus 5-5 high (2)". */
export function colorEffort(name: string, level: string | undefined, theme: Theme) {
  const at = level ? name.indexOf(" " + level) : -1;
  if (!level || at === -1) return name;
  const end = at + 1 + level.length;
  return name.slice(0, at + 1) + theme.fg(levelColor(level), level) + name.slice(end);
}
