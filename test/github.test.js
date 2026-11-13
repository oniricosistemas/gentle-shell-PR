import assert from "node:assert/strict";
import test from "node:test";

import * as github from "../src/github.js";

import {
  collectPullRequests,
  normalizePullRequest,
  parseGitHubRemote,
} from "../src/github.js";

const detailPayload = {
  number: 42, title: "Inspector", url: "https://github.com/org/repo/pull/42",
  body: "Overview\nsummary", author: { login: "octocat" }, labels: [{ name: "feature" }],
  headRefName: "feat/inspector", baseRefName: "main", isDraft: true,
  reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", state: "OPEN",
  latestReviews: [{ state: "COMMENTED" }],
  additions: 12, deletions: 3, changedFiles: 1,
  createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
  closedAt: null, mergedAt: null,
  statusCheckRollup: [{ name: "test", conclusion: "SUCCESS", status: "COMPLETED" }],
  files: [{ path: "src/github.js", additions: 12, deletions: 3, patch: "must not escape" }],
};

async function collectDetail(payload = detailPayload) {
  return github.collectPullRequestDetail({ cwd: "/workspace/project", repository: "org/repo", number: 42,
    execute: async () => ({ exitCode: 0, stdout: JSON.stringify(payload), stderr: "" }) });
}

test("detail collector executes exactly one bounded read-only metadata request", async () => {
  const calls = [];
  const result = await github.collectPullRequestDetail({
    cwd: "/workspace/project", repository: "org/repo", number: 42,
    execute: async (...args) => {
      calls.push(args);
      return { exitCode: 0, stdout: JSON.stringify(detailPayload), stderr: "" };
    },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(calls, [["gh", ["pr", "view", "42", "--repo", "org/repo", "--json",
    "number,title,url,body,author,labels,headRefName,baseRefName,isDraft,reviewDecision,mergeStateStatus,state,additions,deletions,changedFiles,createdAt,updatedAt,closedAt,mergedAt,statusCheckRollup,latestReviews,files"],
  { cwd: "/workspace/project", timeoutMs: 15_000 }]]);
});

test("detail collector normalizes Overview, Checks and Files without patch data", async () => {
  assert.deepEqual(await collectDetail(), {
    repository: "org/repo", error: undefined,
    pullRequest: {
      number: 42, title: "Inspector", url: "https://github.com/org/repo/pull/42",
      bodySummary: "Overview\nsummary", author: "octocat", labels: ["feature"],
      headBranch: "feat/inspector", baseBranch: "main", isDraft: true,
      review: "waiting", reviewFeedback: true, merge: "blocked", state: "OPEN",
      additions: 12, deletions: 3, changedFiles: 1,
      createdAt: detailPayload.createdAt, updatedAt: detailPayload.updatedAt,
      closedAt: undefined, mergedAt: undefined,
      checks: [{ name: "test", status: "passed" }],
      files: [{ path: "src/github.js", additions: 12, deletions: 3 }],
    },
  });
});

test("detail collector preserves safe Markdown and removes HTML comments", async () => {
  const { pullRequest } = await collectDetail({
    ...detailPayload,
    body: "<!-- revix:summary:start -->\n## Summary\n\n- **Done**\n- `verified`\n<!-- revix:summary:end -->",
  });

  assert.equal(pullRequest.bodySummary, "## Summary\n\n- **Done**\n- `verified`");
});

test("detail collector sanitizes display text but preserves branch identity", async () => {
  const unsafe = "\u001b[31mvisible\u001b[0m\u202e\ntext";
  const { pullRequest } = await collectDetail({ ...detailPayload,
    title: unsafe, body: unsafe, url: unsafe, author: { login: unsafe }, labels: [{ name: unsafe }],
    headRefName: unsafe, baseRefName: unsafe,
    statusCheckRollup: [{ name: unsafe }], files: [{ path: unsafe }],
  });
  for (const value of [pullRequest.title, pullRequest.url, pullRequest.author,
    ...pullRequest.labels, pullRequest.checks[0].name, pullRequest.files[0].path]) {
    assert.equal(value, "visible text");
  }
  assert.equal(pullRequest.bodySummary, "visible\ntext");
  assert.equal(pullRequest.headBranch, unsafe);
  assert.equal(pullRequest.baseBranch, unsafe);
});

test("detail collector classifies individual checks consistently with the sidebar", async () => {
  const rows = [
    ...["SUCCESS", "NEUTRAL", "SKIPPED", "FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "UNKNOWN"].map(conclusion => ({ conclusion, status: "COMPLETED" })),
    ...["SUCCESS", "ERROR", "FAILURE", "PENDING"].map(state => ({ state, context: "legacy" })),
    { status: "IN_PROGRESS", name: "running" }, {}, null,
  ];
  const { pullRequest } = await collectDetail({ ...detailPayload, statusCheckRollup: rows });
  assert.equal(pullRequest.checks.length, rows.length - 1);
  rows.filter(Boolean).forEach((row, index) => {
    const counts = normalizePullRequest({ statusCheckRollup: [row] }).checks;
    assert.equal(pullRequest.checks[index].status, ["passed", "failed", "pending"].find(status => counts[status] === 1));
  });
  assert.equal(pullRequest.checks[10].name, "legacy");
});

test("detail collector bounds summaries and metadata rows and handles absent metadata", async () => {
  const { pullRequest } = await collectDetail({ ...detailPayload, body: "x".repeat(5000),
    statusCheckRollup: Array(150).fill({ name: "x".repeat(600) }),
    files: Array(400).fill({ path: "file", additions: -1, deletions: "oops" }),
    labels: Array(150).fill({ name: "label" }), additions: -1, deletions: "oops",
  });
  assert.equal(pullRequest.bodySummary.length, 4000);
  assert.equal(pullRequest.checks.length, 100);
  assert.equal(pullRequest.checks[0].name.length, 500);
  assert.equal(pullRequest.files.length, 300);
  assert.equal(pullRequest.labels.length, 100);
  assert.deepEqual(pullRequest.files[0], { path: "file", additions: 0, deletions: 0 });
  assert.equal(pullRequest.additions, 0);
  assert.equal(pullRequest.deletions, 0);
  const empty = (await collectDetail({ number: 42 })).pullRequest;
  assert.deepEqual(empty.checks, []);
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.labels, []);
});

test("detail collector returns bounded command failure states without leaking stderr", async () => {
  for (const execute of [async () => ({ exitCode: 1, stdout: "secret", stderr: "unsafe\u001b[31m" }),
    async () => { throw new Error("private command detail"); }]) {
    assert.deepEqual(await github.collectPullRequestDetail({ repository: "org/repo", number: 42, execute }), {
      repository: "org/repo", pullRequest: undefined, error: "Could not load pull request details",
    });
  }
});

test("detail collector rejects invalid JSON and non-object payloads explicitly", async () => {
  for (const stdout of ["not json", "null", "[]", "42"]) {
    assert.deepEqual(await github.collectPullRequestDetail({ repository: "org/repo", number: 42,
      execute: async () => ({ exitCode: 0, stdout, stderr: "" }) }), {
      repository: "org/repo", pullRequest: undefined, error: "GitHub returned invalid pull request detail data",
    });
  }
});

test("parseGitHubRemote accepts HTTPS and SSH GitHub origins", () => {
  assert.equal(parseGitHubRemote("https://github.com/oniricosistemas/gentle-shell-PR.git"), "oniricosistemas/gentle-shell-PR");
  assert.equal(parseGitHubRemote("git@github.com:oniricosistemas/gentle-shell-PR.git"), "oniricosistemas/gentle-shell-PR");
  assert.equal(parseGitHubRemote("https://gitlab.com/oniricosistemas/gentle-shell-PR.git"), undefined);
});

test("normalizePullRequest derives bounded CI, review, and merge facts", () => {
  const normalized = normalizePullRequest({
    number: 42,
    title: "\u001b[31mAdd PR sidebar\u001b[0m\u202e",
    url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
    headRefName: "feat/sidebar",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: "APPROVED",
    latestReviews: [{ state: "COMMENTED" }],
    mergeStateStatus: "CLEAN",
    updatedAt: "2026-11-05T12:00:00Z",
    statusCheckRollup: [
      { __typename: "CheckRun", conclusion: "SUCCESS", status: "COMPLETED" },
      { __typename: "CheckRun", conclusion: "FAILURE", status: "COMPLETED" },
      { __typename: "StatusContext", state: "PENDING" },
    ],
  });

  assert.deepEqual(normalized, {
    number: 42,
    title: "Add PR sidebar",
    url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
    headBranch: "feat/sidebar",
    baseBranch: "main",
    isDraft: false,
    review: "approved",
    reviewFeedback: true,
    merge: "ready",
    checks: { passed: 1, failed: 1, pending: 1, total: 3 },
    updatedAt: "2026-11-05T12:00:00Z",
  });
});

test("collectPullRequests uses read-only git and gh commands and prioritizes the current branch", async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "git" && args[0] === "remote") {
      return { stdout: "git@github.com:oniricosistemas/gentle-shell-PR.git\n", stderr: "", exitCode: 0 };
    }
    if (command === "git" && args[0] === "branch") {
      return { stdout: "feat/sidebar\n", stderr: "", exitCode: 0 };
    }
    return {
      stdout: JSON.stringify([
        {
          number: 40,
          title: "Other PR",
          url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/40",
          headRefName: "feat/other",
          baseRefName: "main",
          isDraft: true,
          reviewDecision: "",
          mergeStateStatus: "BLOCKED",
          updatedAt: "2026-11-05T11:00:00Z",
          statusCheckRollup: [],
        },
        {
          number: 42,
          title: "Current PR",
          url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
          headRefName: "feat/sidebar",
          baseRefName: "main",
          isDraft: false,
          reviewDecision: "REVIEW_REQUIRED",
          mergeStateStatus: "DIRTY",
          updatedAt: "2026-11-05T12:00:00Z",
          statusCheckRollup: [],
        },
      ]),
      stderr: "",
      exitCode: 0,
    };
  };

  const result = await collectPullRequests({ cwd: "/workspace/project", execute, limit: 5 });

  assert.equal(result.repository, "oniricosistemas/gentle-shell-PR");
  assert.equal(result.branch, "feat/sidebar");
  assert.deepEqual(result.pullRequests.map((pr) => pr.number), [42, 40]);
  assert.deepEqual(calls, [
    {
      command: "git",
      args: ["remote", "get-url", "origin"],
      cwd: "/workspace/project",
    },
    {
      command: "git",
      args: ["branch", "--show-current"],
      cwd: "/workspace/project",
    },
    {
      command: "gh",
      args: [
        "pr",
        "list",
        "--repo",
        "oniricosistemas/gentle-shell-PR",
        "--state",
        "open",
        "--limit",
        "5",
        "--json",
        "number,title,url,headRefName,baseRefName,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,latestReviews,updatedAt",
      ],
      cwd: "/workspace/project",
    },
  ]);
});

test("collectPullRequests returns an explicit unavailable state without a GitHub origin", async () => {
  const execute = async () => ({ stdout: "https://example.com/local/repo.git\n", stderr: "", exitCode: 0 });

  const result = await collectPullRequests({ cwd: "/workspace/project", execute });

  assert.deepEqual(result, {
    repository: undefined,
    branch: undefined,
    pullRequests: [],
    error: "No GitHub origin found",
  });
});

test("context collector runs one GraphQL query and check-run requests only when a check failed", async () => {
  const graphqlPayload = {
    data: {
      repository: {
        pullRequest: {
          closingIssuesReferences: { nodes: [{ number: 128, title: "Prevent open redirects", state: "OPEN", bodyText: "Keep OAuth return URLs on the current origin.", labels: { nodes: [{ name: "security" }] } }] },
          reviewThreads: { nodes: [
            { isResolved: false, isOutdated: false, path: "src/auth/callback.ts", line: 82, comments: { nodes: [{ author: { login: "marin" }, body: "Can we reject protocol-relative URLs here?", createdAt: "2026-11-12T14:50:00Z" }] } },
            { isResolved: true, isOutdated: false, path: "src/other.ts", line: 1, comments: { nodes: [{ author: { login: "someone" }, body: "resolved thread must not appear", createdAt: "2026-11-12T14:00:00Z" }] } },
          ] },
          statusCheckRollup: { contexts: { nodes: [
            { id: "CR_1", name: "check", conclusion: "SUCCESS" },
            { id: "CR_2", name: "Security / callback-policy", conclusion: "FAILURE" },
          ] } },
        },
      },
    },
  };
  const calls = [];
  const result = await github.collectPullRequestContext({
    cwd: "/workspace/project", repository: "org/repo", number: 47,
    execute: async (command, args, options) => {
      calls.push([command, args, options]);
      if (args[1] === "graphql") return { exitCode: 0, stdout: JSON.stringify(graphqlPayload), stderr: "" };
      if (args.includes("repos/org/repo/check-runs/CR_2")) {
        return { exitCode: 0, stdout: JSON.stringify({ name: "Security / callback-policy", output: { title: "1 failure", summary: "FAIL rejects external return URLs\ninput: //outside.example" } }), stderr: "" };
      }
      if (args.includes("repos/org/repo/check-runs/CR_2/annotations")) {
        return { exitCode: 0, stdout: JSON.stringify([{ message: "Protocol-relative URLs pass the leading-slash check", path: "src/auth/callback.ts", start_line: 82 }]), stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected" };
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(result.repository, "org/repo");
  assert.match(result.context.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1][0], "api");
  assert.equal(calls[0][1][1], "graphql");
  assert.equal(calls[0][1][2], "-f");
  assert.match(calls[0][1][3], /^query=/);
  assert.deepEqual(calls[1][1], ["api", "repos/org/repo/check-runs/CR_2", "--repo", "org/repo"]);
  assert.deepEqual(calls[2][1], ["api", "repos/org/repo/check-runs/CR_2/annotations", "--repo", "org/repo"]);

  const { fetchedAt, ...context } = result.context;
  assert.match(fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(context, {
    linkedIssues: [{ number: 128, title: "Prevent open redirects", state: "OPEN", body: "Keep OAuth return URLs on the current origin.", labels: ["security"] }],
    reviewThreads: [{ path: "src/auth/callback.ts", line: 82, author: "marin", createdAt: "2026-11-12T14:50:00Z", outdated: false, excerpt: "Can we reject protocol-relative URLs here?" }],
    failedCheck: {
      name: "Security / callback-policy",
      summary: "FAIL rejects external return URLs\ninput: //outside.example",
      annotations: [{ message: "Protocol-relative URLs pass the leading-slash check", path: "src/auth/callback.ts", line: 82 }],
    },
  });
});

test("context collector bounds threads, issues, annotations, and summary", async () => {
  const threads = Array.from({ length: 12 }, (_, index) => ({
    isResolved: false, isOutdated: false, path: `src/file${index}.ts`, line: index,
    comments: { nodes: [{ author: { login: `user${index}` }, body: `x`.repeat(400), createdAt: "2026-11-12T14:50:00Z" }] },
  }));
  const graphqlPayload = {
    data: {
      repository: {
        pullRequest: {
          closingIssuesReferences: { nodes: Array.from({ length: 5 }, (_, index) => ({ number: index, title: "t".repeat(300), state: "OPEN", bodyText: "b".repeat(400), labels: { nodes: [{ name: "l" }] } })) },
          reviewThreads: { nodes: threads },
          statusCheckRollup: { contexts: { nodes: [{ id: "CR_9", name: "n".repeat(300), conclusion: "FAILURE" }] } },
        },
      },
    },
  };
  const result = await github.collectPullRequestContext({
    cwd: "/workspace/project", repository: "org/repo", number: 1,
    execute: async (_command, args) => {
      if (args[1] === "graphql") return { exitCode: 0, stdout: JSON.stringify(graphqlPayload), stderr: "" };
      if (args[1].endsWith("/annotations")) {
        return { exitCode: 0, stdout: JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ message: "m".repeat(300), path: `p${index}`, start_line: index }))), stderr: "" };
      }
      return { exitCode: 0, stdout: JSON.stringify({ name: "n".repeat(300), output: { title: "t", summary: "s".repeat(2000) } }), stderr: "" };
    },
  });

  assert.equal(result.error, undefined);
  assert.equal(result.context.linkedIssues.length, 3);
  assert.equal(result.context.linkedIssues[0].title.length, 200);
  assert.equal(result.context.linkedIssues[0].body.length, 200);
  assert.equal(result.context.reviewThreads.length, 8);
  assert.equal(result.context.reviewThreads[0].excerpt.length, 200);
  assert.equal(result.context.failedCheck.annotations.length, 10);
  assert.equal(result.context.failedCheck.annotations[0].message.length, 200);
  assert.equal(result.context.failedCheck.summary.length <= 1000, true);
});

test("context collector degrades gracefully when GraphQL or check data fails", async () => {
  const failing = async () => ({ exitCode: 1, stdout: "", stderr: "boom" });
  assert.deepEqual(
    await github.collectPullRequestContext({ cwd: "/w", repository: "org/repo", number: 5, execute: failing }),
    { repository: "org/repo", error: "Could not load pull request context", context: undefined },
  );

  const badJson = async (_command, args) => args[1] === "graphql"
    ? { exitCode: 0, stdout: "not json", stderr: "" }
    : { exitCode: 0, stdout: "", stderr: "" };
  assert.deepEqual(
    await github.collectPullRequestContext({ cwd: "/w", repository: "org/repo", number: 5, execute: badJson }),
    { repository: "org/repo", error: "GitHub returned invalid pull request context data", context: undefined },
  );

  // Check-run details failing does not break the rest of the context.
  const graphqlPayload = {
    data: {
      repository: {
        pullRequest: {
          closingIssuesReferences: { nodes: [] },
          reviewThreads: { nodes: [] },
          statusCheckRollup: { contexts: { nodes: [{ id: "CR_X", name: "Security", conclusion: "FAILURE" }] } },
        },
      },
    },
  };
  const result = await github.collectPullRequestContext({
    cwd: "/w", repository: "org/repo", number: 7,
    execute: async (_command, args) => args[1] === "graphql"
      ? { exitCode: 0, stdout: JSON.stringify(graphqlPayload), stderr: "" }
      : { exitCode: 1, stdout: "", stderr: "boom" },
  });
  assert.equal(result.error, undefined);
  const { fetchedAt, ...context } = result.context;
  assert.match(fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(context, {
    linkedIssues: [],
    reviewThreads: [],
    failedCheck: { name: "Security", summary: undefined, annotations: [] },
  });
});
