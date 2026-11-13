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
    reviewFeedback: true,
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
  assert.match(plain(inspector.render(96)), /1 passed · 1 running · 1 failed · feedback/);
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

test("the inspector exposes a Context tab with linked issues, review threads, and the failed check", () => {
  const state = {
    ...detail,
    pullRequest: {
      ...detail.pullRequest,
      context: {
        fetchedAt: "2026-11-12T15:08:00Z",
        linkedIssues: [{ number: 128, title: "Prevent open redirects", state: "OPEN", body: "Keep OAuth return URLs on the current origin.", labels: ["security"] }],
        reviewThreads: [{ path: "src/auth/callback.ts", line: 82, author: "marin", createdAt: "2026-11-12T14:50:00Z", outdated: false, excerpt: "Can we reject protocol-relative URLs here?" }],
        failedCheck: { name: "Security / callback-policy", summary: "FAIL rejects external return URLs\ninput: //outside.example", annotations: [{ message: "Protocol-relative URLs pass the leading-slash check", path: "src/auth/callback.ts", line: 82 }] },
      },
    },
  };
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: state,
  });

  inspector.setTab("Context");
  assert.equal(inspector.getActiveTab(), "Context");
  const lines = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");

  assert.match(lines, /\[Context\]/);
  assert.match(lines, /Fetched \d\d:\d\d · read-only/);
  assert.match(lines, /Linked issue/);
  assert.match(lines, /#128 · Prevent open redirects/);
  assert.match(lines, /Keep OAuth return URLs on the current origin/);
  assert.match(lines, /security · open · linked by PR/);
  assert.match(lines, /Review threads · 1 unresolved/);
  assert.match(lines, /@marin/);
  assert.match(lines, /Can we reject protocol-relative URLs here\?/);
  assert.match(lines, /src\/auth\/callback\.ts:82/);
  assert.match(lines, /Failed check · × Security \/ callback-policy/);
  assert.match(lines, /FAIL rejects external return URLs/);
  assert.match(lines, /Protocol-relative URLs pass the leading-slash check/);
});

test("the Context tab degrades gracefully without context or with empty sections", () => {
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: detail,
  });
  inspector.setTab("Context");
  let lines = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(lines, /Review context is unavailable/);

  const empty = {
    ...detail,
    pullRequest: { ...detail.pullRequest, context: { linkedIssues: [], reviewThreads: [], failedCheck: undefined } },
  };
  const emptyInspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: empty,
  });
  emptyInspector.setTab("Context");
  lines = emptyInspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(lines, /No linked issues/);
  assert.match(lines, /No unresolved review threads/);
  assert.match(lines, /No failed checks/);
});

test("key 4 selects the Context tab and Enter toggles the failed-check excerpt", () => {
  const state = {
    ...detail,
    pullRequest: {
      ...detail.pullRequest,
      context: {
        fetchedAt: "2026-11-12T15:08:00Z",
        linkedIssues: [],
        reviewThreads: [],
        failedCheck: {
          name: "Security",
          summary: Array.from({ length: 6 }, (_, index) => `log line ${index + 1}`).join("\n"),
          annotations: [],
        },
      },
    },
  };
  const renders = [];
  const inspector = createPullRequestInspector({
    tui: { requestRender: () => renders.push(1) },
    theme: createTheme(),
    initialState: state,
  });

  inspector.handleInput("4");
  assert.equal(inspector.getActiveTab(), "Context");
  const compact = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(compact, /log line 1/);
  assert.doesNotMatch(compact, /log line 6/);
  assert.match(compact, /Enter expand/);

  inspector.handleInput("\r");
  const expanded = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.match(expanded, /log line 6/);
  assert.match(expanded, /Enter collapse/);

  inspector.handleInput("\r");
  const collapsedAgain = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");
  assert.doesNotMatch(collapsedAgain, /log line 6/);
  assert.ok(renders.length >= 3);
});

test("the inspector exposes a Timeline tab with lifecycle events and workflow runs", () => {
  const state = {
    ...detail,
    pullRequest: {
      ...detail.pullRequest,
      timeline: {
        fetchedAt: "2026-11-12T15:08:00Z",
        openedAt: "2026-11-12T13:08:00Z",
        mergedAt: "2026-11-12T14:42:00Z",
        mergedBy: "lmsastre",
        events: [
          { kind: "review", state: "CHANGES_REQUESTED", at: "2026-11-12T13:26:00Z", author: "gentle-review" },
          { kind: "review", state: "APPROVED", at: "2026-11-12T14:38:00Z", author: "gentle-review" },
          { kind: "merged", at: "2026-11-12T14:42:00Z", author: "lmsastre", commit: "e9b42af111111111111111111111111111111111" },
        ],
        workflowRuns: [
          { name: "Deploy production", status: "in_progress", conclusion: undefined, startedAt: "2026-11-12T14:42:00Z", headSha: "e9b42af000000000000000000000000000000000" },
        ],
      },
    },
  };
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: state,
  });

  inspector.setTab("Timeline");
  assert.equal(inspector.getActiveTab(), "Timeline");
  const lines = inspector.render(60).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).join("\n");

  assert.match(lines, /\[Timeline\]/);
  assert.match(lines, /Opened 13:08/);
  assert.match(lines, /Changes requested · gentle-review · 13:26/);
  assert.match(lines, /Approved · gentle-review · 14:38/);
  assert.match(lines, /Merged into main · lmsastre · 14:42 · e9b42af/);
  assert.match(lines, /GitHub Actions · 1 run/);
  assert.match(lines, /◷ Deploy production · Running · 14:42/);
});

test("the Timeline tab degrades gracefully without timeline data", () => {
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: detail,
  });
  inspector.setTab("Timeline");
  assert.match(inspector.render(60).join("\n"), /Timeline is unavailable/);

  const empty = {
    ...detail,
    pullRequest: { ...detail.pullRequest, timeline: { fetchedAt: "2026-11-12T15:08:00Z", openedAt: "2026-11-12T13:08:00Z", mergedAt: undefined, mergedBy: "", events: [], workflowRuns: [] } },
  };
  const emptyInspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: empty,
  });
  emptyInspector.setTab("Timeline");
  const lines = emptyInspector.render(60).join("\n");
  assert.match(lines, /No timeline events yet/);
  assert.match(lines, /No workflow runs/);
});

test("key 5 selects the Timeline tab and a running deployment stays visible", () => {
  const state = {
    ...detail,
    pullRequest: {
      ...detail.pullRequest,
      timeline: {
        fetchedAt: "2026-11-12T15:08:00Z",
        openedAt: "2026-11-12T13:08:00Z",
        mergedAt: "2026-11-12T14:42:00Z",
        mergedBy: "lmsastre",
        events: [],
        workflowRuns: [{ name: "Deploy production", status: "in_progress", conclusion: undefined, startedAt: "2026-11-12T14:42:00Z", headSha: "a".repeat(40) }],
      },
    },
  };
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: state,
  });
  inspector.handleInput("5");
  assert.equal(inspector.getActiveTab(), "Timeline");
  const lines = inspector.render(60).join("\n");
  assert.match(lines, /Merged into main · lmsastre/);
  assert.match(lines, /Deploy production/);
});

test("clicking a tab title switches tabs and clicking the active one is a no-op", () => {
  const inspector = createPullRequestInspector({
    tui: { requestRender() {} },
    theme: createTheme(),
    initialState: detail,
  });

  const plainLines = () => inspector.render(96).map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""));
  const checksX = plainLines()[1].indexOf("Checks");
  assert.ok(checksX > 0, "the Checks label must be visible on the tabs row");

  const result = inspector.handleMouse({ type: "click", button: "left", x: checksX + 1, y: 1, width: 96, height: 20 });
  assert.deepEqual(result, { handled: true, render: true });
  assert.equal(inspector.getActiveTab(), "Checks");

  // Clicking the already-active tab keeps the tab without extra renders.
  const activeX = plainLines()[1].indexOf("Checks");
  assert.deepEqual(
    inspector.handleMouse({ type: "click", button: "left", x: activeX + 1, y: 1, width: 96, height: 20 }),
    { handled: true, render: false },
  );
  assert.equal(inspector.getActiveTab(), "Checks");

  // Clicks outside the tab row stay unhandled for the tabs themselves.
  assert.equal(inspector.handleMouse({ type: "click", button: "left", x: 3, y: 5, width: 96, height: 20 }), undefined);
  assert.equal(inspector.getActiveTab(), "Checks");
});
