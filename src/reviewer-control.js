function normalizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function formatCheckSummary({ passed = 0, failed = 0, pending = 0 }) {
  return `${normalizeCount(passed)} passed · ${normalizeCount(failed)} failed · ${normalizeCount(pending)} pending`;
}
