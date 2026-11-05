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
  const ui = {
    custom(factory, options) {
      const component = factory(tui, theme, {}, () => {});
      this.component = component;
      this.options = options;
      options.onHandle?.({ setHidden(value) { ui.overlayHidden = value; } });
      return new Promise(() => {});
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
