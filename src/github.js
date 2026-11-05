import { execFile } from "node:child_process";

const PR_FIELDS = [
  "number",
  "title",
  "url",
  "headRefName",
  "baseRefName",
  "isDraft",
  "reviewDecision",
  "mergeStateStatus",
  "statusCheckRollup",
  "updatedAt",
].join(",");

const PASSED_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAILED_CONCLUSIONS = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "FAILURE",
  "STARTUP_FAILURE",
  "STALE",
  "TIMED_OUT",
]);

export function parseGitHubRemote(remote) {
  if (typeof remote !== "string") return undefined;
  const value = remote.trim();
  const match = value.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function normalizeReview(decision) {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  if (decision === "REVIEW_REQUIRED") return "waiting";
  return "none";
}

function normalizeMerge(state) {
  if (["CLEAN", "HAS_HOOKS", "UNSTABLE"].includes(state)) return "ready";
  if (state === "DIRTY") return "conflicting";
  if (state === "BLOCKED") return "blocked";
  if (state === "BEHIND") return "behind";
  return "unknown";
}

function normalizeChecks(rollup) {
  const checks = { passed: 0, failed: 0, pending: 0, total: 0 };
  if (!Array.isArray(rollup)) return checks;

  for (const item of rollup) {
    if (!item || typeof item !== "object") continue;
    checks.total += 1;
    const conclusion = typeof item.conclusion === "string" ? item.conclusion : undefined;
    const state = typeof item.state === "string" ? item.state : undefined;
    const status = typeof item.status === "string" ? item.status : undefined;

    if (PASSED_CONCLUSIONS.has(conclusion) || state === "SUCCESS") {
      checks.passed += 1;
    } else if (FAILED_CONCLUSIONS.has(conclusion) || ["ERROR", "FAILURE"].includes(state)) {
      checks.failed += 1;
    } else if (status !== "COMPLETED" || state === "PENDING" || !conclusion) {
      checks.pending += 1;
    } else {
      checks.pending += 1;
    }
  }

  return checks;
}

export function normalizePullRequest(pr) {
  return {
    number: Number(pr.number),
    title: typeof pr.title === "string" ? pr.title : "Untitled pull request",
    url: typeof pr.url === "string" ? pr.url : "",
    headBranch: typeof pr.headRefName === "string" ? pr.headRefName : "unknown",
    baseBranch: typeof pr.baseRefName === "string" ? pr.baseRefName : "unknown",
    isDraft: pr.isDraft === true,
    review: normalizeReview(pr.reviewDecision),
    merge: normalizeMerge(pr.mergeStateStatus),
    checks: normalizeChecks(pr.statusCheckRollup),
    updatedAt: typeof pr.updatedAt === "string" ? pr.updatedAt : undefined,
  };
}

export function executeFile(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeoutMs ?? 15_000,
      windowsHide: true,
    }, (error, stdout = "", stderr = "") => {
      resolve({
        stdout,
        stderr,
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      });
    });
  });
}

export async function collectPullRequests({ cwd, execute = executeFile, limit = 5 }) {
  const remoteResult = await execute("git", ["remote", "get-url", "origin"], { cwd });
  const repository = remoteResult.exitCode === 0 ? parseGitHubRemote(remoteResult.stdout) : undefined;
  if (!repository) {
    return {
      repository: undefined,
      branch: undefined,
      pullRequests: [],
      error: "No GitHub origin found",
    };
  }

  const branchResult = await execute("git", ["branch", "--show-current"], { cwd });
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined;
  const boundedLimit = Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 5));
  const prResult = await execute("gh", [
    "pr",
    "list",
    "--repo",
    repository,
    "--state",
    "open",
    "--limit",
    String(boundedLimit),
    "--json",
    PR_FIELDS,
  ], { cwd });

  if (prResult.exitCode !== 0) {
    return {
      repository,
      branch,
      pullRequests: [],
      error: "Could not load pull requests",
    };
  }

  let payload;
  try {
    payload = JSON.parse(prResult.stdout);
  } catch {
    return {
      repository,
      branch,
      pullRequests: [],
      error: "GitHub returned invalid pull request data",
    };
  }

  const pullRequests = Array.isArray(payload) ? payload.map(normalizePullRequest) : [];
  pullRequests.sort((left, right) => {
    const leftCurrent = left.headBranch === branch ? 1 : 0;
    const rightCurrent = right.headBranch === branch ? 1 : 0;
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
    return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  });

  return { repository, branch, pullRequests, error: undefined };
}
