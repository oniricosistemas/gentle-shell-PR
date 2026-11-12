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

test("the shared rail wrapper composes card groups and offsets grouped participants", () => {
  const original = {
    render: () => ["▾ CHANGES", "  clean", "▾ INTEGRATIONS", "  Engram OK", "  /gentle:panel"],
    invalidate() {},
    digest: () => "footer",
    cardGroups: () => ({ groups: [{ start: 0, end: 2 }, { start: 2, end: 4 }], loose: [4] }),
  };
  const grouped = {
    render: () => ["", "▾ Pull requests · 1", "#42 Add PR sidebar"],
    invalidate() {},
    digest: () => "prs",
    cardGroups: () => ({ groups: [{ start: 1, end: 3 }] }),
  };
  const plain = { render: () => ["▾ FUTURE", "  future row"], invalidate() {}, digest: () => "future" };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", original]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender() {} };

  const first = attachGentleShellRailPanel(tui, plain, plain, grouped);
  const second = attachGentleShellRailPanel(tui, plain, plain, plain);
  assert.ok(first);
  assert.ok(second);

  const wrapper = terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer");
  assert.deepEqual(wrapper.render(40), [
    "▾ CHANGES",
    "  clean",
    "▾ INTEGRATIONS",
    "  Engram OK",
    "  /gentle:panel",
    "",
    "▾ Pull requests · 1",
    "#42 Add PR sidebar",
    "▾ FUTURE",
    "  future row",
  ]);
  const composed = wrapper.cardGroups?.(40);
  assert.deepEqual(composed, {
    groups: [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 6, end: 8 },
      { start: 8, end: 10 },
    ],
    loose: [4],
  });
  assert.equal(
    composed.groups.every(({ start, end }) => start > 5 || end <= 5),
    true,
    "no composed group may claim the participant's tinted spacer row",
  );

  first.setVisible(false);
  assert.deepEqual(wrapper.render(40), [
    "▾ CHANGES",
    "  clean",
    "▾ INTEGRATIONS",
    "  Engram OK",
    "  /gentle:panel",
    "▾ FUTURE",
    "  future row",
  ]);
  assert.deepEqual(wrapper.cardGroups?.(40), {
    groups: [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 5, end: 7 },
    ],
    loose: [4],
  });

  first.dispose();
  second.dispose();
  assert.equal(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer"), original);
});

test("the rail selects the grouped participant on carded hosts and the panel variant on 4.6 surfaces", () => {
  const framed = { render: () => ["framed"], invalidate() {}, digest: () => "framed" };
  const panelVariant = { render: () => ["panel-rows"], invalidate() {}, digest: () => "panel" };
  const groupedVariant = { render: () => ["", "grouped-rows"], invalidate() {}, digest: () => "grouped", cardGroups: () => ({ groups: [{ start: 1, end: 2 }] }) };

  const cardedTerminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", {
        render: () => ["footer"],
        invalidate() {},
        cardGroups: () => ({ groups: [{ start: 0, end: 1 }] }),
      }]]),
    },
  };
  const carded = attachGentleShellRailPanel(
    { mode: "fullscreen", terminal: cardedTerminal, requestRender() {} },
    framed,
    panelVariant,
    groupedVariant,
  );
  assert.ok(carded);
  assert.deepEqual(cardedTerminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["footer", "", "grouped-rows"]);
  carded.dispose();

  const panelTerminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", { render: () => ["footer"], invalidate() {}, digest: () => "footer", surface: "panel" }]]),
    },
  };
  const panelAttached = attachGentleShellRailPanel(
    { mode: "fullscreen", terminal: panelTerminal, requestRender() {} },
    framed,
    panelVariant,
    groupedVariant,
  );
  assert.ok(panelAttached);
  assert.deepEqual(panelTerminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["footer", "panel-rows"]);
  panelAttached.dispose();

  const legacyTerminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", { render: () => ["footer"], invalidate() {}, digest: () => "footer" }]]),
    },
  };
  const legacy = attachGentleShellRailPanel(
    { mode: "fullscreen", terminal: legacyTerminal, requestRender() {} },
    framed,
    panelVariant,
    groupedVariant,
  );
  assert.ok(legacy);
  assert.deepEqual(legacyTerminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer").render(40), ["footer", "framed"]);
  legacy.dispose();
});

test("the grouped panel section keeps its spacer outside the card group and shifts mouse rows", () => {
  const opened = [];
  const panel = createPullRequestPanel({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: loadedState,
    layout: "rail",
    onOpenPullRequest: (pullRequest) => opened.push(pullRequest),
  });
  const grouped = panel.createGroupedPanelSection();
  const lines = grouped.render(42);
  assert.equal(lines[0], "");
  const plain = lines.slice(1).map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
  // Rail layout mounts collapsed by default: the header shows the collapsed marker.
  assert.match(plain[0], /▸ Pull requests · 1/);

  assert.deepEqual(grouped.cardGroups?.(42), { groups: [{ start: 1, end: lines.length }] });

  // Clicking the header row (grouped y 1) toggles collapse; the spacer is inert.
  assert.equal(grouped.handleMouse({ type: "click", button: "left", x: 0, y: 0 }), undefined);
  assert.deepEqual(grouped.handleMouse({ type: "click", button: "left", x: 0, y: 1 }), { handled: true, render: true });
  assert.equal(panel.isCollapsed(), false);

  const expanded = grouped.render(42);
  assert.match(expanded[1].replace(/\u001b\[[0-9;]*m/g, ""), /▾ Pull requests · 1/);
  assert.deepEqual(grouped.cardGroups?.(42), { groups: [{ start: 1, end: expanded.length }] });
  assert.deepEqual(grouped.handleMouse({ type: "click", button: "left", x: 0, y: 3 }), { handled: true, render: false });
  assert.equal(opened[0], loadedState.pullRequests[0]);
});

test("the shared rail wrapper degrades digest failures and ignores out-of-bounds mouse rows", () => {
  const original = {
    render: () => ["status"],
    invalidate() {},
    digest() { throw new Error("digest failure"); },
  };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", original]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender() {} };
  const handle = attachGentleShellRailPanel(tui, { render: () => ["prs"], invalidate() {}, digest: () => "prs" });
  assert.ok(handle);

  const wrapper = terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer");
  assert.deepEqual(JSON.parse(wrapper.digest()), ["", 1, ["prs"]]);
  assert.equal(wrapper.handleMouse({ type: "click", button: "left", x: 0, y: -1, width: 40, height: 2 }), undefined);
  assert.equal(wrapper.handleMouse({ type: "click", button: "left", x: 0, y: 5, width: 40, height: 2 }), undefined);
  assert.equal(typeof handle.isMounted(), "boolean");
  assert.equal(handle.isMounted(), true);

  handle.dispose();
  assert.equal(terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer"), original);
});
