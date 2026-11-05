import assert from "node:assert/strict";
import test from "node:test";

import { collectPullRequests, normalizePullRequest } from "../src/github.js";
import { createPrSidebarExtension } from "../src/extension.js";
import { createPullRequestPanel } from "../src/sidebar.js";

test("unsafe pull request titles become single-line terminal-safe text", () => {
  const cases = [
    ["A\u001b[31mB\u001b[0mC", "ABC"],
    ["A\u001b]52;c;payload\u0007B", "AB"],
    ["A\r\nB\tC\u2028D\u2029E", "A B C D E"],
    ["A\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069B", "AB"],
    ["Fix café 🐛", "Fix café 🐛"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizePullRequest({ title: input }).title, expected);
  }
});

test("ST-terminated OSC sequences preserve visible title text", () => {
  const input = "A\u001b]8;;https://example.com\u001b\\B\u001b]8;;\u001b\\C";
  assert.equal(normalizePullRequest({ title: input }).title, "ABC");
});

async function unsafeBranchFixture() {
  const branch = "feat/\u202eunsafe";
  return collectPullRequests({
    cwd: ".",
    execute: async (command, args) => ({
      exitCode: 0,
      stderr: "",
      stdout: args[0] === "remote"
        ? "https://github.com/org/repo.git\n"
        : command === "git"
          ? `${branch}\n`
          : JSON.stringify([
              { number: 2, title: "Other", headRefName: "other", baseRefName: "main", updatedAt: "2026-11-06" },
              { number: 1, title: "Current", headRefName: branch, baseRefName: "main", updatedAt: "2026-11-05" },
            ]),
    }),
  });
}

test("sanitizing rendered branches preserves current pull request priority", async () => {
  assert.deepEqual((await unsafeBranchFixture()).pullRequests.map((pr) => pr.number), [1, 2]);
});

test("checked-out and pull request branches are safe in the panel", async () => {
  const panel = createPullRequestPanel({
    initialState: await unsafeBranchFixture(),
    tui: { requestRender() {} },
    theme: { fg: (_token, text) => text, bold: (text) => text },
  });

  assert.doesNotMatch(panel.render(100).join("\n"), /\u202e/);
});

test("pr-open matches raw branch identity even when another pull request is first", async () => {
  const state = await unsafeBranchFixture();
  const handlers = new Map();
  const commands = new Map();
  const calls = [];
  const context = {
    mode: "tui",
    hasUI: true,
    cwd: ".",
    ui: { setStatus() {}, notify() {} },
  };

  createPrSidebarExtension({
    collect: async () => ({ ...state, pullRequests: [...state.pullRequests].reverse() }),
    execute: async (...args) => {
      calls.push(args);
      return { exitCode: 0 };
    },
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  })({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });

  await handlers.get("session_start")({}, context);
  try {
    await commands.get("pr-open").handler("", context);
    assert.deepEqual(calls, [
      ["gh", ["pr", "view", "1", "--repo", "org/repo", "--web"], { cwd: "." }],
    ]);
  } finally {
    handlers.get("session_shutdown")();
  }
});
