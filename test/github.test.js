import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPullRequests,
  normalizePullRequest,
  parseGitHubRemote,
} from "../src/github.js";

test("parseGitHubRemote accepts HTTPS and SSH GitHub origins", () => {
  assert.equal(parseGitHubRemote("https://github.com/oniricosistemas/gentle-shell-PR.git"), "oniricosistemas/gentle-shell-PR");
  assert.equal(parseGitHubRemote("git@github.com:oniricosistemas/gentle-shell-PR.git"), "oniricosistemas/gentle-shell-PR");
  assert.equal(parseGitHubRemote("https://gitlab.com/oniricosistemas/gentle-shell-PR.git"), undefined);
});

test("normalizePullRequest derives bounded CI, review, and merge facts", () => {
  const normalized = normalizePullRequest({
    number: 42,
    title: "Add PR sidebar",
    url: "https://github.com/oniricosistemas/gentle-shell-PR/pull/42",
    headRefName: "feat/sidebar",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: "APPROVED",
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
        "number,title,url,headRefName,baseRefName,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,updatedAt",
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
