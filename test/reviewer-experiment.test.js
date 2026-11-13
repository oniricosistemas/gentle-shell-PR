import assert from "node:assert/strict";
import test from "node:test";

import { isMergeReady } from "../src/reviewer-experiment.js";

test("approved pull request with no failed or pending checks is merge-ready", () => {
  assert.equal(isMergeReady({ approved: true, failedChecks: 0, pendingChecks: 0 }), true);
});

test("pull request without approval is not merge-ready", () => {
  assert.equal(isMergeReady({ approved: false, failedChecks: 0, pendingChecks: 0 }), false);
});

test("pull request with pending checks is not merge-ready", () => {
  assert.equal(isMergeReady({ approved: true, failedChecks: 0, pendingChecks: 1 }), false);
});
