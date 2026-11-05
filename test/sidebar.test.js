import assert from "node:assert/strict";
import test from "node:test";

import {
  GENTLE_SHELL_SIDEBAR_STATE,
  attachGentleShellRailPanel,
  createPullRequestPanel,
} from "../src/sidebar.js";

function createTheme() {
  const calls = [];
  return {
    calls,
    fg(token, text) {
      calls.push(token);
      return `\u001b[3${calls.length % 8}m${text}\u001b[0m`;
    },
    bold(text) {
      return `\u001b[1m${text}\u001b[22m`;
    },
  };
}

const loadedState = {
  repository: "oniricosistemas/gentle-shell-PR",
  branch: "feat/sidebar",
  pullRequests: [
    {
      number: 42,
      title: "Add PR sidebar",
      url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
      headBranch: "feat/sidebar",
      baseBranch: "main",
      isDraft: false,
      review: "approved",
      merge: "ready",
      checks: { passed: 3, failed: 0, pending: 1, total: 4 },
      updatedAt: "2026-11-05T12:00:00Z",
    },
  ],
  error: undefined,
};

test("the panel renders pull request facts with semantic colors from the active theme", () => {
  const theme = createTheme();
  const renders = [];
  const panel = createPullRequestPanel({
    tui: { requestRender: () => renders.push("render") },
    theme,
    initialState: loadedState,
  });

  const lines = panel.render(42);
  const output = lines.join("\n");

  assert.match(output, /Pull requests/);
  assert.match(output, /#42 Add PR sidebar/);
  assert.match(output, /CI 3\/4 · 1 running/);
  assert.match(output, /Approved · Ready to merge/);
  assert.ok(theme.calls.includes("accent"));
  assert.ok(theme.calls.includes("success"));
  assert.ok(theme.calls.includes("warning"));
  assert.ok(theme.calls.includes("border"));
  assert.equal(lines.every((line) => line.replace(/\u001b\[[0-9;]*m/g, "").length <= 42), true);

  panel.setState({ ...loadedState, error: "Could not load pull requests", pullRequests: [] });
  assert.equal(renders.length, 1);
  assert.match(panel.render(42).join("\n"), /Could not load pull requests/);
  assert.ok(theme.calls.includes("error"));
});

test("clicking a pull request title opens its focused inspector", () => {
  const opened = [];
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    onOpenPullRequest: (pullRequest) => opened.push(pullRequest),
  });

  panel.render(42);
  assert.deepEqual(panel.handleMouse({ type: "click", button: "left", x: 4, y: 2 }), { handled: true, render: false });
  assert.equal(opened[0], loadedState.pullRequests[0]);
  assert.equal(panel.isCollapsed(), false);
});

test("the panel has a compact collapsed state", () => {
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
  });

  panel.setCollapsed(true);
  const output = panel.render(42).join("\n");

  assert.match(output, /Pull requests · 1/);
  assert.doesNotMatch(output, /Add PR sidebar/);
  assert.equal(panel.isCollapsed(), true);
});

test("the shared rail preserves remaining participants regardless of disposal order", () => {
  const original = { render: () => ["status"], invalidate() {}, digest: () => "status" };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", original]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender() {} };
  const first = { render: () => ["first"], invalidate() {}, digest: () => "first" };
  const second = { render: () => ["second"], invalidate() {}, digest: () => "second" };

  const firstHandle = attachGentleShellRailPanel(tui, first);
  const secondHandle = attachGentleShellRailPanel(tui, second);
  assert.deepEqual(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["status", "first", "second"]);

  firstHandle.dispose();
  assert.deepEqual(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["status", "second"]);

  secondHandle.dispose();
  assert.equal(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer"), original);
});

test("the rail participant mounts into Gentle Shell and restores the original footer", () => {
  const renders = [];
  const original = {
    render: () => ["status"],
    invalidate() {},
    digest: () => "status-v1",
  };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", original]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender: () => renders.push("render") };
  const mouseEvents = [];
  const panel = {
    render: () => ["pull requests"],
    invalidate() {},
    digest: () => "prs-v1",
    handleMouse(event) {
      mouseEvents.push(event);
      return { handled: true, render: true };
    },
  };

  const handle = attachGentleShellRailPanel(tui, panel);

  assert.ok(handle);
  assert.deepEqual(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["status", "pull requests"]);
  assert.equal(handle.isActive(), true);
  const wrapper = terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer");
  assert.deepEqual(wrapper.handleMouse({ type: "click", button: "left", x: 2, y: 1, width: 40, height: 2 }), { handled: true, render: true });
  assert.equal(mouseEvents[0].y, 0);

  handle.setVisible(false);
  assert.deepEqual(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["status"]);

  handle.dispose();
  assert.equal(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer"), original);
  assert.ok(renders.length >= 2);
});
