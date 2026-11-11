import assert from "node:assert/strict";
import test from "node:test";

import {
  GENTLE_SHELL_SIDEBAR_STATE,
  attachGentleShellRailPanel,
  createPullRequestPanel,
  detectGentleShellRailLayout,
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

test("the panel keeps passed CI green unless review feedback needs attention", () => {
  const passedPullRequest = {
    ...loadedState.pullRequests[0],
    checks: { passed: 2, failed: 0, pending: 0, total: 2 },
  };
  const passedPanel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: { ...loadedState, pullRequests: [passedPullRequest] },
  });
  const passedOutput = passedPanel.render(42).join("\n");
  assert.match(passedOutput, /CI 2\/2 passed/);
  assert.doesNotMatch(passedOutput, /feedback/);

  const theme = createTheme();
  const feedbackPanel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme,
    initialState: {
      ...loadedState,
      pullRequests: [{ ...passedPullRequest, reviewFeedback: true }],
    },
  });

  assert.match(feedbackPanel.render(42).join("\n"), /CI 2\/2 passed · feedback/);
  assert.ok(theme.calls.includes("warning"));
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

test("detectGentleShellRailLayout returns legacy when the new rail slots are absent", () => {
  assert.equal(detectGentleShellRailLayout({}), "legacy");
  assert.equal(detectGentleShellRailLayout({ terminal: {} }), "legacy");
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      parts: new Map([["footer", { render() {} }]]),
    },
  };
  assert.equal(detectGentleShellRailLayout({ terminal }), "legacy");
});

test("detectGentleShellRailLayout returns rail when statusbar or header slots exist", () => {
  const withStatusbar = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      parts: new Map([["footer", {}], ["statusbar", {}]]),
    },
  };
  assert.equal(detectGentleShellRailLayout({ terminal: withStatusbar }), "rail");
  const withHeader = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      parts: new Map([["footer", {}], ["header", {}]]),
    },
  };
  assert.equal(detectGentleShellRailLayout({ terminal: withHeader }), "rail");
});

test("legacy layout renders the bordered card expanded by default", () => {
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "legacy",
  });
  assert.equal(panel.isCollapsed(), false);
  const lines = panel.render(42);
  const plain = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(plain, /╭─ ▼ Pull requests · 1/);
  assert.match(plain, /│ #42 Add PR sidebar/);
  assert.match(plain, /╰/);
  assert.equal(lines.every((line) => line.replace(/\u001b\[[0-9;]*m/g, "").length <= 42), true);
});

test("rail layout renders a borderless collapsed row by default", () => {
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "rail",
  });
  assert.equal(panel.isCollapsed(), true);
  const lines = panel.render(42);
  const plain = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(plain, /▸ Pull requests · 1/);
  assert.doesNotMatch(plain, /#42/);
  assert.doesNotMatch(plain, /[╭╯│]/);
  assert.equal(lines.every((line) => line.replace(/\u001b\[[0-9;]*m/g, "").length <= 42), true);
});

test("rail layout expands and collapses by clicking the header", () => {
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "rail",
  });
  assert.equal(panel.isCollapsed(), true);
  panel.render(42);
  assert.deepEqual(panel.handleMouse({ type: "click", button: "left", x: 0, y: 0 }), { handled: true, render: true });
  assert.equal(panel.isCollapsed(), false);
  const lines = panel.render(42);
  const plain = lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(plain, /▾ Pull requests · 1/);
  assert.match(plain, /#42 Add PR sidebar/);
  assert.doesNotMatch(plain, /[╭╯│]/);
});

test("rail layout opens a pull request when its title row is clicked", () => {
  const opened = [];
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "rail",
    onOpenPullRequest: (pullRequest) => opened.push(pullRequest),
  });
  panel.render(42);
  panel.handleMouse({ type: "click", button: "left", x: 0, y: 0 });
  panel.render(42);
  assert.deepEqual(panel.handleMouse({ type: "click", button: "left", x: 0, y: 2 }), { handled: true, render: false });
  assert.equal(opened[0], loadedState.pullRequests[0]);
});

test("the shared rail wrapper forwards optional native footer properties", () => {
  const original = {
    render: () => ["status"],
    invalidate() {},
    digest: () => "status",
    surface: "panel",
    summary() { return this === original ? "Ready" : "Unbound"; },
    open() { return this === original; },
    alert: 2,
    spend: "1m",
  };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", original]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender() {} };
  const panel = { render: () => ["prs"], invalidate() {}, digest: () => "prs" };

  attachGentleShellRailPanel(tui, panel);
  const wrapper = terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer");
  assert.equal(wrapper.surface, "panel");
  assert.equal(wrapper.summary(), "Ready");
  assert.equal(wrapper.open(), true);
  assert.equal(wrapper.alert, 2);
  assert.equal(wrapper.spend, "1m");
  assert.equal("header" in wrapper, false);
  assert.equal("statusbar" in wrapper, false);
  assert.deepEqual(wrapper.render(40), ["status", "prs"]);

  const legacyTerminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      parts: new Map([["footer", { render: () => ["legacy"], invalidate() {}, digest: () => "legacy" }]]),
    },
  };
  attachGentleShellRailPanel({ mode: "fullscreen", terminal: legacyTerminal, requestRender() {} }, panel);
  const legacyWrapper = legacyTerminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer");
  assert.equal("surface" in legacyWrapper, false);
  assert.equal("summary" in legacyWrapper, false);
});

test("createPullRequestPanel reports its initial collapsed state", () => {
  const legacyChanges = [];
  const railChanges = [];
  createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "legacy",
    onCollapsedChange: (collapsed) => legacyChanges.push(collapsed),
  });
  assert.deepEqual(legacyChanges, [false]);

  createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "rail",
    onCollapsedChange: (collapsed) => railChanges.push(collapsed),
  });
  assert.deepEqual(railChanges, [true]);
});
