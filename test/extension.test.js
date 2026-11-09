import assert from "node:assert/strict";
import test from "node:test";

import { GENTLE_SHELL_SIDEBAR_STATE } from "../src/sidebar.js";
import { createPrSidebarExtension } from "../src/extension.js";

function createHarness() {
  const handlers = new Map();
  const commands = new Map();
  const notifications = [];
  const statuses = [];
  const renders = [];
  const originalFooter = { render: () => ["status"], invalidate() {}, digest: () => "status" };
  const terminal = {
    [GENTLE_SHELL_SIDEBAR_STATE]: {
      active: true,
      ownsHost: () => true,
      parts: new Map([["footer", originalFooter]]),
    },
  };
  const tui = { mode: "fullscreen", terminal, requestRender: () => renders.push("render") };
  const themeTokens = [];
  const theme = {
    fg(token, text) {
      themeTokens.push(token);
      return text;
    },
    bold: (text) => text,
  };
  const keybindings = {
    matches(data, action) {
      return action === "tui.select.cancel" && ["\u001b", "\u001b[27u", "\u0003"].includes(data);
    },
  };
  const customs = [];
  const ui = {
    customs,
    custom(factory, options) {
      let resolveCustom;
      const promise = new Promise((resolve) => { resolveCustom = resolve; });
      const entry = { component: undefined, options, closed: false, promise };
      const done = () => {
        entry.closed = true;
        resolveCustom();
      };
      const component = factory(tui, theme, keybindings, done);
      entry.component = component;
      customs.push(entry);
      this.component = component;
      this.options = options;
      options.onHandle?.({ setHidden(value) { ui.overlayHidden = value; } });
      return promise;
    },
    notify(message, level) {
      notifications.push({ message, level });
    },
    setStatus(key, value) {
      statuses.push({ key, value });
    },
  };
  const context = { mode: "tui", hasUI: true, cwd: "/workspace/project", ui };
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };
  return { pi, handlers, commands, context, ui, terminal, originalFooter, notifications, statuses, renders, themeTokens };
}

const result = {
  repository: "oniricosistemas/gentle-shell-PR",
  branch: "feat/sidebar",
  pullRequests: [],
  error: undefined,
};

test("the extension mounts a passive theme-aware sidebar and refreshes on command", async () => {
  const harness = createHarness();
  const calls = [];
  const intervals = [];
  createPrSidebarExtension({
    collect: async (options) => {
      calls.push(options);
      return result;
    },
    setIntervalFn(callback, delay) {
      intervals.push({ callback, delay });
      return 7;
    },
    clearIntervalFn() {},
  })(harness.pi);

  await harness.handlers.get("session_start")({}, harness.context);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/workspace/project");
  assert.equal(intervals[0].delay, 60_000);
  assert.equal(harness.ui.options.overlay, true);
  assert.equal(harness.ui.options.overlayOptions.nonCapturing, true);
  assert.match(harness.ui.component.render(42).join("\n"), /Pull requests/);
  assert.ok(harness.themeTokens.includes("accent"));

  await harness.commands.get("pr-refresh").handler("", harness.context);
  assert.equal(calls.length, 2);
  assert.deepEqual(harness.notifications.at(-1), { message: "Pull requests refreshed", level: "info" });
});

test("pr-focus opens a capturing inspector and loads Overview, Checks and Files metadata", async () => {
  const harness = createHarness();
  const focusedResult = {
    repository: "oniricosistemas/gentle-shell-PR",
    branch: "feat/sidebar",
    pullRequests: [{
      number: 42, title: "Add PR sidebar", url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
      headBranch: "feat/sidebar", baseBranch: "main", isDraft: false, review: "approved", merge: "ready",
      checks: { passed: 1, failed: 0, pending: 0, total: 1 }, updatedAt: "2026-11-05T12:00:00Z",
    }],
    error: undefined,
  };
  const detailCalls = [];
  createPrSidebarExtension({
    collect: async () => focusedResult,
    collectDetail: async (options) => {
      detailCalls.push(options);
      return {
        repository: focusedResult.repository,
        error: undefined,
        pullRequest: {
          ...focusedResult.pullRequests[0], bodySummary: "## Focused detail", author: "octocat", labels: [],
          state: "OPEN", additions: 10, deletions: 2, changedFiles: 1, checks: [{ name: "test", status: "passed" }],
          files: [{ path: "src/extension.js", additions: 10, deletions: 2 }],
        },
      };
    },
    renderMarkdown: () => ["Rendered Markdown detail"],
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  })(harness.pi);

  await harness.handlers.get("session_start")({}, harness.context);
  await harness.commands.get("pr-focus").handler("", harness.context);

  assert.equal(harness.ui.customs.length, 2);
  assert.deepEqual(detailCalls, [{ cwd: "/workspace/project", repository: focusedResult.repository, number: 42 }]);
  const inspector = harness.ui.customs[1];
  assert.equal(inspector.options.overlay, true);
  assert.equal(inspector.options.overlayOptions.width, "85%");
  assert.equal(inspector.options.overlayOptions.maxHeight, "85%");
  assert.notEqual(inspector.options.overlayOptions.nonCapturing, true);
  assert.match(inspector.component.render(96).join("\n"), /Rendered Markdown detail/);
  inspector.component.handleInput("\u001b[27u");
  await inspector.promise;
  assert.equal(inspector.closed, true);
});

test("the extension stays inactive outside interactive TUI mode", async () => {
  const harness = createHarness();
  harness.context.mode = "rpc";
  let collected = false;
  createPrSidebarExtension({
    collect: async () => {
      collected = true;
      return result;
    },
  })(harness.pi);

  await harness.handlers.get("session_start")({}, harness.context);

  assert.equal(collected, false);
  assert.equal(harness.ui.component, undefined);
});

test("the extension cleans up the rail and timer on session shutdown", async () => {
  const harness = createHarness();
  const cleared = [];
  createPrSidebarExtension({
    collect: async () => result,
    setIntervalFn: () => 13,
    clearIntervalFn: (id) => cleared.push(id),
  })(harness.pi);

  await harness.handlers.get("session_start")({}, harness.context);
  harness.handlers.get("session_shutdown")({}, harness.context);

  assert.deepEqual(cleared, [13]);
  assert.equal(harness.terminal[GENTLE_SHELL_SIDEBAR_STATE].parts.get("footer"), harness.originalFooter);
  assert.deepEqual(harness.statuses.at(-1), { key: "gentle-shell-pr", value: undefined });
});
