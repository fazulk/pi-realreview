export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline markdown: code spans, bold, italic, https links. Everything else is escaped. */
export function renderInline(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, index) => {
      if (index % 2 === 1) return "<code>" + escapeHtml(part.slice(1, -1)) + "</code>";
      return escapeHtml(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:])/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
    })
    .join("");
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|?\s*$/;

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next: string | undefined) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    LIST_ITEM.test(line) ||
    line.trimStart().startsWith(">") ||
    (line.trim().startsWith("|") && next !== undefined && TABLE_SEPARATOR.test(next))
  );
}

/** Small, safe markdown renderer. headingBase is the h-level of a top-level "#". */
export function renderMarkdown(markdown: string, headingBase = 3) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      html.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(6, headingBase + heading[1].length - 1);
      html.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
      i++;
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      html.push(
        '<div class="table-wrap"><table><thead><tr>' +
          header.map(cell => "<th>" + renderInline(cell) + "</th>").join("") +
          "</tr></thead><tbody>" +
          rows.map(row => "<tr>" + row.map(cell => "<td>" + renderInline(cell) + "</td>").join("") + "</tr>").join("") +
          "</tbody></table></div>",
      );
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push("<blockquote>" + renderInline(quote.join(" ")) + "</blockquote>");
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = /\d/.test(line.match(LIST_ITEM)?.[2] ?? "");
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length) {
        const item = lines[i].match(LIST_ITEM);
        if (item) {
          items.push({ depth: Math.min(3, Math.floor(item[1].length / 2)), text: item[3] });
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += " " + lines[i].trim();
        } else {
          break;
        }
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push("<" + tag + ">" + items.map(item => '<li class="l' + item.depth + '">' + renderInline(item.text) + "</li>").join("") + "</" + tag + ">");
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !(paragraph.length && startsBlock(lines[i], lines[i + 1]))) {
      paragraph.push(lines[i++].trim());
    }
    html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
  }

  return html.join("\n");
}
