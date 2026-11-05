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
- passed, failed, or running CI checks;
- review decision;
- merge readiness.

The visible panel remains intentionally small. It does not display diffs, logs, issue bodies, or post-merge deployment timelines.

## Commands

| Command | Action |
| --- | --- |
| `/pr-refresh` | Refresh pull request data immediately. |
| `/pr-sidebar` | Show or hide the sidebar. |
| `/pr-sidebar-collapse` | Collapse or expand the panel. |
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

`/pr-open` runs `gh pr view --web` to open the selected pull request. The extension does not create, edit, review, merge, or close pull requests.

## Host compatibility

Gentle Shell currently exposes its fullscreen right rail through an experimental in-process compatibility contract. This extension participates in the shared footer stack so it can coexist with Status and other compatible sidebar packages. It does not replace the rail root.

When that rail is unavailable, Pi uses a passive right-side overlay on terminals at least 100 columns wide. Non-interactive, JSON, print, and RPC modes do not mount terminal UI.

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
| `src/sidebar.js` | Theme-aware panel and shared Gentle Shell rail adapter. |
| `src/extension.js` | Session lifecycle, refresh timer, commands, and cleanup. |
| `test/` | Collector, rendering, rail coexistence, and lifecycle tests. |

## Project memory

The repository pins its Engram identity in `.engram/config.json`. Project enrollment and cloud replication are development infrastructure; they are not required to install or use the extension.

## License

MIT © 2026 Onírico Sistemas.

## Built with Gentle AI

This project was built with [Gentle AI](https://github.com/Gentleman-Programming/gentle-ai).

<p align="left">
  <img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle AI" width="280">
</p>
