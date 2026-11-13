import assert from "node:assert/strict";
import test from "node:test";

import { formatCheckSummary } from "../src/reviewer-control.js";

test("formats passed, failed, and pending check counts", () => {
  assert.equal(
    formatCheckSummary({ passed: 3, failed: 1, pending: 2 }),
    "3 passed · 1 failed · 2 pending",
  );
});

test("defaults omitted check counts to zero", () => {
  assert.equal(formatCheckSummary({}), "0 passed · 0 failed · 0 pending");
});

test("normalizes invalid and negative check counts", () => {
  assert.equal(
    formatCheckSummary({ passed: -1, failed: Number.NaN, pending: "2" }),
    "0 passed · 0 failed · 0 pending",
  );
});
