export function isMergeReady({ approved, failedChecks, pendingChecks }) {
  return approved === true && failedChecks >= 0 && pendingChecks === 0;
}
