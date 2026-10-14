import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const MAX_VISIBLE = 12;

/**
 * How a setup screen ended. "back" and "forward" come from the left and right arrows.
 * "cancel" is esc. The caller decides whether that aborts setup or backs out one screen.
 */
export type Nav<T> = { kind: "done"; value: T } | { kind: "back" } | { kind: "forward" } | { kind: "cancel" };

export interface NavKeys {
  /** Left arrow goes back. */
  back?: boolean;
  /** Right arrow goes forward. Only offered when the screen already has an answer. */
  forward?: boolean;
  /** What esc does, for the hint line. Default "cancel". */
  esc?: "cancel" | "back";
}

/** The hint line shared by every setup screen. */
export function navHint(parts: string[], nav: NavKeys) {
  return [...parts, ...(nav.back ? ["← back"] : []), ...(nav.forward ? ["→ next"] : []), "esc " + (nav.esc ?? "cancel")].join(" · ");
}

export interface MenuOptions extends NavKeys {
  /** Show a type-to-filter box. Default true. Turn it off for short menus. */
  filter?: boolean;
  /** The part of an option that typing is matched against. Default: all of it. */
  searchText?: (option: string) => string;
  /** A blank line is drawn wherever the group number changes between neighbours. */
  group?: (option: string) => number;
  /** Extra lines shown under the title. */
  details?: string[] | ((theme: Theme) => string[]);
  /** Colours an unselected row. The selected row is always accent. */
  style?: (option: string, theme: Theme) => string;
  /** Where this screen sits in setup, such as "2/6 Reviewers". */
  step?: string;
  /** The option selected when the menu opens. */
  initial?: string;
}

/**
 * Every menu in realreview. A vertical list where Up on the first row jumps to the last
 * and Down on the last jumps to the first, with optional filtering and grouping.
 */
export function filterSelect(ctx: ExtensionCommandContext, title: string, options: string[], menu: MenuOptions = {}) {
  const filtering = menu.filter ?? true;
  const searchText = menu.searchText ?? ((option: string) => option);

  return ctx.ui.custom<Nav<string>>((tui, theme, _keybindings, done) => {
    const input = new Input({ prompt: "Filter: ", placeholder: "type to narrow the list", placeholderStyle: text => theme.fg("dim", text) });
    const border = new DynamicBorder(text => theme.fg("accent", text));
    let visible = options;
    let selected = 0;
    let top = 0;

    const move = (to: number) => {
      selected = to;
      if (selected < top) top = selected;
      if (selected >= top + MAX_VISIBLE) top = selected - MAX_VISIBLE + 1;
    };
    if (menu.initial !== undefined) move(Math.max(0, options.indexOf(menu.initial)));

    return {
      get focused() {
        return input.focused;
      },
      set focused(value: boolean) {
        input.focused = value;
      },
      invalidate() {
        border.invalidate();
        input.invalidate();
      },
      render(width: number) {
        const count = filtering ? theme.fg("dim", "  " + visible.length + "/" + options.length) : "";
        const stepTag = menu.step ? theme.fg("muted", "[" + menu.step + "] ") : "";
        const lines = [...border.render(width), truncateToWidth(stepTag + theme.fg("accent", theme.bold(title)) + count, width)];
        const details = typeof menu.details === "function" ? menu.details(theme) : (menu.details ?? []);
        for (const detail of details) lines.push(truncateToWidth(detail, width));
        if (filtering) lines.push(...input.render(width));
        if (visible.length === 0) lines.push(theme.fg("warning", "  No matches"));

        const shown = visible.slice(top, top + MAX_VISIBLE);
        shown.forEach((option, index) => {
          if (index > 0 && menu.group && menu.group(option) !== menu.group(shown[index - 1])) lines.push("");
          const text = top + index === selected ? theme.fg("accent", "→ " + option) : "  " + (menu.style ? menu.style(option, theme) : option);
          lines.push(truncateToWidth(text, width));
        });
        if (visible.length > MAX_VISIBLE) lines.push(theme.fg("dim", "  (" + (selected + 1) + "/" + visible.length + ")"));

        const hint = navHint([...(filtering ? ["type to filter"] : []), "↑↓ navigate (wraps)", "enter select"], menu);
        lines.push(truncateToWidth(theme.fg("dim", hint), width), ...border.render(width));
        return lines;
      },
      handleInput(data: string) {
        const count = visible.length;
        // While there is filter text, left and right move the cursor in it instead.
        const arrowsNavigate = !filtering || input.getValue() === "";
        if (arrowsNavigate && menu.back && matchesKey(data, Key.left)) {
          done({ kind: "back" });
        } else if (arrowsNavigate && menu.forward && matchesKey(data, Key.right)) {
          done({ kind: "forward" });
        } else if (matchesKey(data, Key.up)) {
          if (count) move((selected - 1 + count) % count);
        } else if (matchesKey(data, Key.down)) {
          if (count) move((selected + 1) % count);
        } else if (matchesKey(data, Key.pageUp)) {
          move(Math.max(0, selected - MAX_VISIBLE));
        } else if (matchesKey(data, Key.pageDown)) {
          if (count) move(Math.min(count - 1, selected + MAX_VISIBLE));
        } else if (matchesKey(data, Key.enter)) {
          if (count) done({ kind: "done", value: visible[selected] });
        } else if (matchesKey(data, Key.escape)) {
          done({ kind: "cancel" });
        } else if (filtering) {
          const before = input.getValue();
          input.handleInput(data);
          const query = input.getValue();
          if (query !== before) {
            visible = query.trim() ? fuzzyFilter(options, query, option => searchText(option)) : options;
            selected = 0;
            top = 0;
          }
        }
        tui.requestRender();
      },
    };
  });
}
