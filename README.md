# gentle-shell-PR

A compact, read-only pull request sidebar for [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell) and Pi.

It keeps the GitHub pull requests for the current repository visible beside the agent without sending their data to the model. The panel follows the active terminal theme and shares Gentle Shell's existing fullscreen rail with Status, ODD tasks, agents, and other compatible extensions.

## Quick path

### Requirements

- Node.js 20 or later.
- Gentle Shell or Pi with extension UI support.
- [GitHub CLI](https://cli.github.com/) available as `gh` and authenticated with `gh auth login`.
- A GitHub repository whose remote is named `origin`.

### Install in Gentle Shell

```sh
gentle-shell install git:github.com/oniricosistemas/gentle-shell-PR
```

Restart or reload Gentle Shell after installation.

### Install in Pi

```sh
pi install git:github.com/oniricosistemas/gentle-shell-PR
```

### Update an existing installation

Update only this extension in Gentle Shell:

```sh
gentle-shell update git:github.com/oniricosistemas/gentle-shell-PR
```

Or update every package installed in Gentle Shell:

```sh
gentle-shell update --extensions
```

For a direct Pi installation, use the equivalent Pi command:

```sh
pi update git:github.com/oniricosistemas/gentle-shell-PR
```

Restart or reload Gentle Shell/Pi after the update. Because the installation source is an unpinned Git repository, the update command reconciles the local checkout with the newest revision of its default branch.

For one local development run:

```sh
pi -e .
```

## What it shows

The sidebar lists up to five open pull requests from the current repository, prioritizing the pull request whose head branch matches the current Git branch.

Each entry contains:

- pull request number and title;
- head and base branches;
- draft state;
- passed, failed, or running CI checks, with a separate feedback marker when the latest GitHub review contains comments or requests changes;
- review decision;
- merge readiness.

The visible panel remains intentionally small. It does not display diffs, logs, issue bodies, or post-merge deployment timelines.

### PR Inspector

Click a pull request title in the sidebar or run `/pr-focus` to open a focused, capturing inspector. It loads detailed metadata only while the inspector is opened and returns focus to the editor when closed with `Esc`.

The v0.2 inspector contains three tabs:

- **Overview** — branches, review and merge state, author, labels, a theme-aware Markdown description, and change totals;
- **Checks** — individual checks classified as passed, failed, or pending; a successful run remains passed, while review feedback is called out separately in yellow;
- **Files** — changed paths and addition/deletion totals only.

The v0.3 inspector adds a fourth tab:

- **Context** — read-only review context for faster diagnosis: linked issues pulled from the pull request's closing references, unresolved review threads with their `file:line` location, and the failed check with a bounded, sanitized excerpt and annotations. Press `Enter` on that tab to expand or collapse the failed-check excerpt. All context is local-only; a collection failure degrades to an unavailable tab without affecting the loaded details.

The v0.4 inspector adds a fifth tab:

- **Timeline** — the pull request's story on one read-only line per entry: lifecycle events (reviews, merge, closed/ready/draft transitions) and GitHub Actions runs associated with the pull request's head or merge commit, including deployments that keep running after the merge. A merged pull request always shows its merge row even when the bounded event list is empty. Timeline is local-only and degrades like the Context tab.

Files intentionally does not render patches or a second diff viewer because Gentle Shell already provides that workflow. Use `←`/`→` or `Tab` to change tabs, `1`–`5` to jump to a tab, `j`/`k` to scroll, `Enter` to expand the failed-check excerpt on the Context tab, `o` to open GitHub, and `Esc` to close the inspector.

## Commands

| Command | Action |
| --- | --- |
| `/pr-inbox` | Open the v0.5 cross-repository command center: sibling repositories, their open pull requests, and local attention filters (`f` owner, `a` attention, `Esc` close). Filters are pure local views and never change repository state. |
| `/pr-refresh` | Refresh pull request data immediately. |
| `/pr-sidebar` | Show or hide the sidebar. |
| `/pr-sidebar-collapse` | Collapse or expand the panel. |
| `/pr-focus` | Open the current branch pull request in the focused inspector. |
| `/pr-open` | Open the current branch pull request in the browser. |

When visible, the extension refreshes every 60 seconds. Hiding it pauses automatic refreshes until it is shown again.

## Theme behavior

The extension does not define its own palette. It receives the active Pi/Gentle Shell theme from the TUI and renders with semantic theme tokens:

- `accent` for the title;
- `border` for the frame;
- `text` and `muted` for ordinary information;
- `success`, `warning`, and `error` for pull request states.

Changing the active theme therefore changes the sidebar with the rest of the interface.

## Privacy, tokens, and GitHub access

The extension makes no model calls and adds no pull request data to the model context. Keeping the sidebar open does not consume LLM tokens.

It executes only these repository and GitHub reads during refresh:

```text
git remote get-url origin
git branch --show-current
gh pr list --state open --json ...
```

Opening the inspector performs one additional bounded metadata read:

```text
gh pr view <number> --repo <owner/repository> --json ...
```

The request includes pull request facts, check results, and changed-file metadata, but never patch or diff fields. `/pr-open` and `o` run `gh pr view --web` to open the selected pull request. The extension does not create, edit, review, merge, or close pull requests.

## Host compatibility

Gentle Shell currently exposes its fullscreen right rail through an experimental in-process compatibility contract. This extension participates in the shared footer stack so it can coexist with Status and other compatible sidebar packages. It does not replace the rail root.

The extension detects the host layout capability instead of parsing a version string: when the rail exposes `statusbar` or `header` slots (Gentle Shell 4.6+), it switches to a borderless, dense, collapsible row that fits the Integrations panel. In that mode the section defaults to a single collapsed header (`▸ Pull requests · N`) and expands to the same pull-request details on click. On older hosts without those slots, it keeps the original standalone bordered card and expanded-by-default behavior.

On current Gentle Shell builds whose tinted rail draws independent cards per participant, the shared rail wrapper forwards the host's optional `cardGroups(width)` contract and composes it with each visible participant: carded rails (which also declare `surface: "panel"`) receive a grouped section that renders one leading spacer outside its declared card group and a native rail title in accent without bold emphasis, so the host draws its own gap between cards instead of merging every section into one nested card; 4.6 panel hosts without card groups keep the plain borderless rows; and any participant without its own group metadata is composed as a single group spanning its rows.

When the rail is unavailable, Pi uses a passive right-side overlay on terminals at least 100 columns wide. Non-interactive, JSON, print, and RPC modes do not mount terminal UI.

## Development

```sh
npm test
npm run check
npm run pack:check
```

The implementation is dependency-free. Pi provides the coding-agent and TUI packages declared as peer dependencies.

| Path | Responsibility |
| --- | --- |
| `extensions/pr-sidebar.js` | Pi package entry point. |
| `src/github.js` | Read-only Git and GitHub collection and normalization. |
| `src/sidebar.js` | Theme-aware panel, title hit regions, and shared Gentle Shell rail adapter. |
| `src/inspector.js` | Focused Overview, Checks, and Files inspector component. |
| `src/extension.js` | Session lifecycle, lazy detail loading, commands, and cleanup. |
| `test/` | Collector, inspector, rendering, rail coexistence, and lifecycle tests. |

## Project memory

The repository pins its Engram identity in `.engram/config.json`. Project enrollment and cloud replication are development infrastructure; they are not required to install or use the extension.

## License

MIT © 2026 Onírico Sistemas.

## Built with Gentle AI

This project was built with [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai).

<p align="left">
  <img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle AI" width="280">
</p>
