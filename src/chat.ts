import { pathToFileURL } from "node:url";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Markdown } from "@earendil-works/pi-tui";
import { formatDuration, formatMoney } from "./format.ts";

export const RESULT_MESSAGE_TYPE = "realreview-result";

/** Draws the review in the transcript as terminal markdown. */
export function registerResultRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer(RESULT_MESSAGE_TYPE, (message, { outputPad }, theme) => {
    const text =
      typeof message.content === "string" ? message.content : message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n");
    const box = new Box(outputPad, 1, line => theme.bg("customMessageBg", line));
    box.addChild(new Markdown(text, 0, 0, getMarkdownTheme()));
    return box;
  });
}

/** The final review, then a short footer. The HTML link (when there is one) is last. */
export function buildChatMessage(options: {
  review: string;
  reportPath?: string;
  reviewersDone: number;
  reviewersTotal: number;
  cost: number;
  durationMs: number;
  treeChanged: boolean;
}) {
  const lines = [
    options.review.trim(),
    "",
    "---",
    "_" +
      options.reviewersDone +
      "/" +
      options.reviewersTotal +
      " reviewers finished · " +
      formatMoney(options.cost) +
      " · " +
      formatDuration(options.durationMs) +
      "_",
  ];
  if (options.treeChanged) lines.push("", "**Warning:** the working tree changed while the review ran. Check `git status`.");
  lines.push("");
  lines.push(options.reportPath ? "[Open the HTML report](" + pathToFileURL(options.reportPath).href + ")" : "No issues found, so no HTML report was made.");
  return lines.join("\n");
}
