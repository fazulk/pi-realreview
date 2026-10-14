# pi-realreview

Multi-model code review for [pi](https://pi.dev). Several models review the same change on their own. A synthesizer model then checks their notes against the real code, drops false positives, merges duplicates, and writes the final review. A formatter model turns that review into an HTML report.

## Install

```bash
pi install npm:pi-realreview
```

Or from GitHub:

```bash
pi install git:github.com/fazulk/pi-realreview
```

## Usage

Run `/realreview` (or `/rr`) inside a git repository. Setup walks you through these steps:

1. **Scope**: your branch against a base branch, uncommitted changes, a single commit, or custom instructions.
2. **Reviewers**: pick one or more models and an effort level for each. They run in parallel and never see each other's notes.
3. **Synthesis**: the model that adjudicates the reviewers' notes.
4. **Formatter**: a cheap, fast model that structures the final review for the report. It is asked only once and then remembered.
5. **Instructions**: optional extra guidance for the reviewers.
6. **Confirm**.

Use ← and → to move between steps. Your earlier answers are kept.

The review runs in the background, so pi stays usable. When it finishes:

- The final review is posted to the chat. It becomes part of the conversation, so you can follow up with something like "fix R1".
- If there are findings, an HTML report opens in your browser. It shows the verdict, findings, the reconciliation table (every candidate raised, and whether it was retained, merged, rejected, or unproven), the checks that were run, the limitations, and each reviewer's original notes.
- In the report, click a candidate to jump to its finding or to the notes of the reviewer who raised it. Check rows and add notes to copy a Markdown summary.

### Commands

| Command                          | What it does                                       |
| -------------------------------- | -------------------------------------------------- |
| `/realreview` or `/rr`           | Start a review                                     |
| `/rr cancel`                     | Stop the running review and every agent it started |
| `/rr formatter`                  | Pick the formatter model from a menu               |
| `/rr formatter <model> [effort]` | Set the formatter model directly                   |

## How it works

- Every reviewer and the synthesizer run as separate `pi` subprocesses with read-only tools (`read`, `bash`, `grep`, `find`, `ls`). They are told never to modify the repository, and the report warns you if the working tree changed during the review.
- The exact diff under review is saved and hashed, so the report records what was reviewed.
- Run files (prompts, notes, transcripts, the report) are written to a `realreview-*` folder in your temp directory. Folders older than a week are cleaned up.
- The models you used recently and your formatter choice are stored in `realreview.json` in your pi agent directory.

## Requirements

- pi 1.2 or newer
- git
- Access to at least one model in pi. Mixing providers (for example Anthropic and OpenAI) gives the most independent reviews.

## Development

```bash
npm install
npm run check   # typecheck
npm run format  # prettier
pi -e ./        # try the local copy without installing it
```

## License

MIT
