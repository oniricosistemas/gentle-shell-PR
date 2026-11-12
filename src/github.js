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
  "latestReviews",
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
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;
const UNSAFE_TERMINAL_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function cleanExternalText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(ANSI_PATTERN, "")
    .replace(UNSAFE_TERMINAL_CONTROLS, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function hasReviewFeedback(reviews) {
  if (!Array.isArray(reviews)) return false;
  return reviews.some((review) => review && ["COMMENTED", "CHANGES_REQUESTED"].includes(review.state));
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
    title: cleanExternalText(pr.title) || "Untitled pull request",
    url: typeof pr.url === "string" ? pr.url : "",
    headBranch: typeof pr.headRefName === "string" ? pr.headRefName : "unknown",
    baseBranch: typeof pr.baseRefName === "string" ? pr.baseRefName : "unknown",
    isDraft: pr.isDraft === true,
    review: normalizeReview(pr.reviewDecision),
    reviewFeedback: hasReviewFeedback(pr.latestReviews),
    merge: normalizeMerge(pr.mergeStateStatus),
    checks: normalizeChecks(pr.statusCheckRollup),
    updatedAt: typeof pr.updatedAt === "string" ? pr.updatedAt : undefined,
  };
}

const PR_DETAIL_FIELDS = [
  "number", "title", "url", "body", "author", "labels", "headRefName", "baseRefName",
  "isDraft", "reviewDecision", "mergeStateStatus", "state", "additions", "deletions",
  "changedFiles", "createdAt", "updatedAt", "closedAt", "mergedAt", "statusCheckRollup", "latestReviews", "files",
].join(",");

function detailText(value, limit = 500) {
  return cleanExternalText(value).slice(0, limit);
}

function detailMarkdown(value, limit = 4000) {
  if (typeof value !== "string") return "";
  return value
    .replace(ANSI_PATTERN, "")
    .replace(UNSAFE_TERMINAL_CONTROLS, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

function detailCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function detailRows(value, limit) {
  return Array.isArray(value)
    ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)).slice(0, limit)
    : [];
}

function timestamp(value) {
  return typeof value === "string" ? detailText(value, 100) : undefined;
}

/** Read-only inspector metadata. No patch or diff fields are requested or retained. */
export async function collectPullRequestDetail({ cwd, repository, number, execute = executeFile }) {
  const unavailable = (error) => ({ repository, pullRequest: undefined, error });
  let result;
  try {
    result = await execute("gh", [
      "pr", "view", String(number), "--repo", repository, "--json", PR_DETAIL_FIELDS,
    ], { cwd, timeoutMs: 15_000 });
  } catch {
    return unavailable("Could not load pull request details");
  }
  if (result.exitCode !== 0) return unavailable("Could not load pull request details");

  let payload;
  try {
    payload = JSON.parse(result.stdout);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid detail");
  } catch {
    return unavailable("GitHub returned invalid pull request detail data");
  }

  // Reuse sidebar normalization so review, merge and check semantics cannot drift.
  const overview = normalizePullRequest(payload);
  return {
    repository,
    error: undefined,
    pullRequest: {
      number: detailCount(payload.number),
      title: detailText(overview.title),
      url: detailText(payload.url, 2000),
      bodySummary: detailMarkdown(payload.body),
      author: detailText(payload.author?.login),
      labels: detailRows(payload.labels, 100).map(label => detailText(label.name)),
      // Identity-bearing values stay raw; renderers must sanitize them for display.
      headBranch: overview.headBranch,
      baseBranch: overview.baseBranch,
      isDraft: overview.isDraft,
      review: overview.review,
      reviewFeedback: overview.reviewFeedback,
      merge: overview.merge,
      state: detailText(payload.state),
      additions: detailCount(payload.additions),
      deletions: detailCount(payload.deletions),
      changedFiles: detailCount(payload.changedFiles),
      createdAt: timestamp(payload.createdAt),
      updatedAt: timestamp(payload.updatedAt),
      closedAt: timestamp(payload.closedAt),
      mergedAt: timestamp(payload.mergedAt),
      checks: detailRows(payload.statusCheckRollup, 100).map(row => {
        const counts = normalizeChecks([row]);
        return {
          name: detailText(row.name || row.context) || "Unnamed check",
          status: counts.failed ? "failed" : counts.passed ? "passed" : "pending",
        };
      }),
      files: detailRows(payload.files, 300).map(file => ({
        path: detailText(file.path, 2000),
        additions: detailCount(file.additions),
        deletions: detailCount(file.deletions),
      })),
    },
  };
}

const PR_CONTEXT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 3) {
        nodes { number title state bodyText labels(first: 10) { nodes { name } } }
      }
      reviewThreads(first: 20) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 3) { nodes { author { login } body createdAt } }
        }
      }
      statusCheckRollup(first: 100) {
        nodes { ... on CheckRun { id name conclusion } }
      }
    }
  }
}`;

/**
 * Bounded read-only review context for the inspector's Context tab: closing
 * issues, unresolved review threads, and the failed check excerpt. All external
 * text is sanitized; every collection failure degrades without breaking the
 * caller. No patch, diff, or log-download fields are requested or retained.
 */
export async function collectPullRequestContext({ cwd, repository, number, execute = executeFile }) {
  const [owner, name] = String(repository ?? "").split("/");
  if (!owner || !name) {
    return { repository, error: "Could not load pull request context", context: undefined };
  }

  let result;
  try {
    result = await execute("gh", [
      "api", "graphql",
      "-f", `query=${PR_CONTEXT_QUERY}`,
      "-f", `owner=${owner}`,
      "-f", `name=${name}`,
      "-F", `number=${Number(number)}`,
    ], { cwd, timeoutMs: 15_000 });
  } catch {
    return { repository, error: "Could not load pull request context", context: undefined };
  }
  if (result.exitCode !== 0) {
    return { repository, error: "Could not load pull request context", context: undefined };
  }

  let payload;
  let pull;
  try {
    payload = JSON.parse(result.stdout);
    pull = payload?.data?.repository?.pullRequest;
    if (!pull || typeof pull !== "object") throw new Error("Invalid context");
  } catch {
    return { repository, error: "GitHub returned invalid pull request context data", context: undefined };
  }

  const linkedIssues = detailRows(pull.closingIssuesReferences?.nodes, 3).map((issue) => ({
    number: detailCount(issue.number),
    title: detailText(issue.title, 200),
    state: detailText(issue.state, 20),
    body: detailText(issue.bodyText, 200),
    labels: detailRows(issue.labels?.nodes, 10).map((label) => detailText(label.name)).filter(Boolean),
  }));

  const reviewThreads = detailRows(pull.reviewThreads?.nodes, 20)
    .filter((thread) => thread.isResolved !== true)
    .slice(0, 8)
    .map((thread) => {
      const comment = detailRows(thread.comments?.nodes, 1)[0];
      return {
        path: detailText(thread.path, 500),
        line: detailCount(thread.line),
        author: detailText(comment?.author?.login),
        createdAt: timestamp(comment?.createdAt),
        outdated: thread.isOutdated === true,
        excerpt: detailText(comment?.body, 200),
      };
    })
    .filter((thread) => thread.excerpt || thread.path);

  const failedRun = detailRows(pull.statusCheckRollup?.nodes, 100)
    .find((run) => run.__typename === "CheckRun" && FAILED_CONCLUSIONS.has(run.conclusion));

  let failedCheck;
  if (failedRun) {
    failedCheck = { name: detailText(failedRun.name, 200), summary: undefined, annotations: [] };
    const runPath = `repos/${repository}/check-runs/${failedRun.id}`;
    try {
      const runResult = await execute("gh", ["api", runPath, "--repo", repository], { cwd, timeoutMs: 15_000 });
      if (runResult.exitCode === 0) {
        const run = JSON.parse(runResult.stdout);
        failedCheck.summary = detailMarkdown(run?.output?.summary, 1000) || undefined;
      }
    } catch {
      // A failed check excerpt degrades to the name alone.
    }
    try {
      const annotationsResult = await execute("gh", ["api", `${runPath}/annotations`, "--repo", repository], { cwd, timeoutMs: 15_000 });
      if (annotationsResult.exitCode === 0) {
        failedCheck.annotations = detailRows(JSON.parse(annotationsResult.stdout), 10).map((annotation) => ({
          message: detailText(annotation.message, 200),
          path: detailText(annotation.path, 500),
          line: detailCount(annotation.start_line),
        }));
      }
    } catch {
      // Annotations are optional context.
    }
  }

  return { repository, error: undefined, context: { linkedIssues, reviewThreads, failedCheck } };
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
