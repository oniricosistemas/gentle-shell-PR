import assert from "node:assert/strict";
import test from "node:test";

import { createPullRequestInspector } from "../src/inspector.js";

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

const detail = {
  repository: "oniricosistemas/gentle-shell-PR",
  error: undefined,
  loading: false,
  pullRequest: {
    number: 42,
    title: "Add pull request inspector",
    url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
    bodySummary: "A focused read-only window with tabs for the information that matters.",
    author: "lmsastre",
    labels: ["feature", "terminal-ui"],
    headBranch: "feat/pr-inspector",
    baseBranch: "main",
    isDraft: false,
    review: "approved",
    merge: "ready",
    state: "OPEN",
    additions: 84,
    deletions: 12,
    changedFiles: 3,
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-05T12:00:00Z",
    closedAt: undefined,
    mergedAt: undefined,
    checks: [
      { name: "test / node-22", status: "passed" },
      { name: "preview deployment", status: "pending" },
      { name: "security", status: "failed" },
    ],
    files: [
      { path: "src/inspector.js", additions: 52, deletions: 0 },
      { path: "src/extension.js", additions: 24, deletions: 8 },
      { path: "test/inspector.test.js", additions: 8, deletions: 4 },
    ],
  },
};

function plain(lines) {
  return lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
}

test("the inspector renders a theme-aware Overview without a diff viewer", () => {
  const theme = createTheme();
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme,
    initialState: detail,
  });

  const output = plain(inspector.render(96));

  assert.match(output, /PR #42 · Add pull request inspector/);
  assert.match(output, /Overview/);
  assert.match(output, /Checks/);
  assert.match(output, /Files/);
  assert.match(output, /feat\/pr-inspector → main/);
  assert.match(output, /Approved · Ready to merge/);
  assert.match(output, /3 files · \+84 −12/);
  assert.match(output, /focused read-only window/);
  assert.doesNotMatch(output, /patch|diff viewer/i);
  for (const token of ["accent", "border", "text", "muted", "success"]) {
    assert.ok(theme.calls.includes(token), `missing theme token ${token}`);
  }
});

test("the inspector renders the PR description with the injected Markdown renderer", () => {
  const calls = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    renderMarkdown(markdown, width) {
      calls.push({ markdown, width });
      return ["\u001b[1mSummary\u001b[22m", "• Done"];
    },
    initialState: {
      ...detail,
      pullRequest: { ...detail.pullRequest, bodySummary: "## Summary\n\n- **Done**" },
    },
  });

  const output = plain(inspector.render(96));

  assert.deepEqual(calls, [{ markdown: "## Summary\n\n- **Done**", width: 92 }]);
  assert.match(output, /Summary/);
  assert.match(output, /• Done/);
  assert.doesNotMatch(output, /##|\*\*Done\*\*/);
});

test("the inspector reports a Markdown renderer failure once and falls back to plain text", () => {
  const errors = [];
  const failure = new Error("renderer failed");
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    renderMarkdown() {
      throw failure;
    },
    onMarkdownError(error) {
      errors.push(error);
    },
    initialState: {
      ...detail,
      pullRequest: { ...detail.pullRequest, bodySummary: "## Summary\n\n- **Done**" },
    },
  });

  const firstOutput = plain(inspector.render(96));
  const secondOutput = plain(inspector.render(96));

  assert.match(firstOutput, /## Summary/);
  assert.match(firstOutput, /- \*\*Done\*\*/);
  assert.match(secondOutput, /## Summary/);
  assert.deepEqual(errors, [failure]);
});

test("the inspector switches between Checks and Files tabs with keyboard input", () => {
  const renders = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender: () => renders.push("render") },
    theme: createTheme(),
    initialState: detail,
  });

  inspector.handleInput("\u001b[C");
  assert.equal(inspector.getActiveTab(), "Checks");
  assert.match(plain(inspector.render(96)), /test \/ node-22/);
  assert.match(plain(inspector.render(96)), /preview deployment/);
  assert.match(plain(inspector.render(96)), /security/);

  inspector.handleInput("\t");
  assert.equal(inspector.getActiveTab(), "Files");
  const filesOutput = plain(inspector.render(96));
  assert.match(filesOutput, /src\/inspector\.js/);
  assert.match(filesOutput, /\+52 −0/);
  assert.doesNotMatch(filesOutput, /^[-+]{3}|@@/m);

  inspector.handleInput("\u001b[D");
  assert.equal(inspector.getActiveTab(), "Checks");
  assert.ok(renders.length >= 3);
});

test("the inspector closes with Escape and opens GitHub with o", () => {
  const events = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: detail,
    onClose: () => events.push("close"),
    onOpenGitHub: (pullRequest) => events.push(`open:${pullRequest.number}`),
  });

  inspector.handleInput("o");
  inspector.handleInput("\u001b");

  assert.deepEqual(events, ["open:42", "close"]);
});

test("the inspector prioritizes the configured cancel binding over local shortcuts", () => {
  const events = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    keybindings: {
      matches(data, action) {
        return action === "tui.select.cancel" && data === "\t";
      },
    },
    initialState: detail,
    onClose: () => events.push("close"),
  });

  inspector.handleInput("\t");

  assert.deepEqual(events, ["close"]);
  assert.equal(inspector.getActiveTab(), "Overview");
});

test("the inspector closes when the Esc footer action is clicked", () => {
  const events = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: detail,
    onClose: () => events.push("close"),
  });
  const lines = inspector.render(96).map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
  const y = lines.findIndex((line) => line.includes("Esc close"));
  const x = lines[y].indexOf("Esc close");

  const result = inspector.handleMouse?.({ type: "click", button: "left", x, y });

  assert.deepEqual(events, ["close"]);
  assert.deepEqual(result, { handled: true, render: false });
});

test("the inspector renders bounded loading and error states", () => {
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: { repository: "org/repo", loading: true, pullRequest: undefined, error: undefined },
  });
  assert.match(plain(inspector.render(80)), /Loading pull request details/);

  inspector.setState({ repository: "org/repo", loading: false, pullRequest: undefined, error: "Could not load pull request details" });
  assert.match(plain(inspector.render(80)), /Could not load pull request details/);
});
