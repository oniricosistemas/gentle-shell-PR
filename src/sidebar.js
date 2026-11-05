import { cleanExternalText } from "./github.js";

export const GENTLE_SHELL_SIDEBAR_STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
const SHARED_RAIL_STACK = Symbol.for("mcp-sidebar.gentle-shell-rail-stack");
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;

function visibleWidth(value) {
  return String(value).replace(ANSI_PATTERN, "").length;
}

function truncateText(value, width) {
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;
  if (width === 1) return "…";
  const plain = String(value).replace(ANSI_PATTERN, "");
  return `${plain.slice(0, Math.max(0, width - 1))}…`;
}

function isComponent(value) {
  return Boolean(value && typeof value.render === "function" && typeof value.invalidate === "function");
}

function healthToken(state) {
  if (state.error) return "error";
  if (state.loading) return "warning";
  return "success";
}

function checksLine(checks) {
  if (!checks || checks.total === 0) return { token: "muted", text: "No CI" };
  if (checks.failed > 0) {
    return { token: "error", text: `CI ${checks.passed}/${checks.total} · ${checks.failed} failed` };
  }
  if (checks.pending > 0) {
    return { token: "warning", text: `CI ${checks.passed}/${checks.total} · ${checks.pending} running` };
  }
  return { token: "success", text: `CI ${checks.passed}/${checks.total} passed` };
}

function reviewLabel(review) {
  if (review === "approved") return "Approved";
  if (review === "changes_requested") return "Changes requested";
  if (review === "waiting") return "Waiting for review";
  return "No review";
}

function mergeLabel(merge) {
  if (merge === "ready") return "Ready to merge";
  if (merge === "conflicting") return "Merge conflict";
  if (merge === "blocked") return "Merge blocked";
  if (merge === "behind") return "Branch behind";
  return "Merge unknown";
}

function factsToken(pr) {
  if (pr.merge === "conflicting" || pr.review === "changes_requested") return "error";
  if (pr.merge === "ready" && pr.review === "approved") return "success";
  return "muted";
}

export function createPullRequestPanel({ tui, theme, initialState, onCollapsedChange }) {
  let state = initialState;
  let collapsed = false;

  const paint = (token, text, bold = false) => {
    const emphasized = bold && typeof theme.bold === "function" ? theme.bold(text) : text;
    return theme.fg(token, emphasized);
  };

  const render = (width) => {
    const boundedWidth = Math.max(0, Math.floor(width));
    if (boundedWidth === 0) return [];
    if (boundedWidth === 1) return [paint("muted", "…")];

    const border = (text) => paint("border", text);
    const count = state.pullRequests?.length ?? 0;
    const titleText = collapsed ? `▶ Pull requests · ${count}` : `▼ Pull requests · ${count}`;
    const title = truncateText(titleText, Math.max(1, boundedWidth - 6));
    const topFill = Math.max(0, boundedWidth - visibleWidth(title) - 5);
    const top = border("╭─ ") + paint("accent", title, true) + border(` ${"─".repeat(topFill)}╮`);
    const bottom = border(`╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`);
    const contentWidth = Math.max(0, boundedWidth - 4);
    const row = (token, text, bold = false) => {
      const bounded = truncateText(text, contentWidth);
      const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(bounded)));
      return border("│ ") + paint(token, `${bounded}${padding}`, bold) + border(" │");
    };

    const lines = [top];
    if (collapsed) return [...lines, bottom];

    const repository = cleanExternalText(state.repository) || "No GitHub repository";
    const currentBranch = cleanExternalText(state.branch);
    const branch = currentBranch ? ` · ${currentBranch}` : "";
    lines.push(row(healthToken(state), `${repository}${branch}`));

    if (state.error) {
      lines.push(row("error", state.error));
      return [...lines, bottom];
    }

    if (!state.pullRequests?.length) {
      lines.push(row("muted", "No open pull requests"));
      return [...lines, bottom];
    }

    for (const pr of state.pullRequests.slice(0, 3)) {
      lines.push(row("text", `#${pr.number} ${pr.title}`, true));
      const headBranch = cleanExternalText(pr.headBranch) || "unknown";
      const baseBranch = cleanExternalText(pr.baseBranch) || "unknown";
      lines.push(row("muted", `${headBranch} → ${baseBranch}${pr.isDraft ? " · Draft" : ""}`));
      const checks = checksLine(pr.checks);
      lines.push(row(checks.token, checks.text));
      lines.push(row(factsToken(pr), `${reviewLabel(pr.review)} · ${mergeLabel(pr.merge)}`));
    }

    if (state.pullRequests.length > 3) {
      lines.push(row("muted", `+${state.pullRequests.length - 3} more`));
    }

    return [...lines, bottom];
  };

  const setCollapsed = (next) => {
    if (collapsed === next) return;
    collapsed = next;
    onCollapsedChange?.(collapsed);
    tui.requestRender();
  };

  return {
    render,
    invalidate: () => tui.requestRender(),
    digest: () => JSON.stringify({ state, collapsed }),
    setState(next) {
      state = next;
      tui.requestRender();
    },
    setCollapsed,
    isCollapsed: () => collapsed,
    handleMouse(event) {
      if (event.button !== "left" || event.y !== 0 || event.type !== "click") return undefined;
      setCollapsed(!collapsed);
      return { handled: true, render: true };
    },
  };
}

function createSharedRailStack(host, original) {
  const stack = {
    host,
    original,
    wrapper: undefined,
    participants: new Map(),
    revision: 0,
    segments: [],
  };

  stack.wrapper = {
    render(width) {
      const lines = [];
      const segments = [];
      const append = (component) => {
        const rendered = [...component.render(width)];
        if (rendered.length === 0) return;
        segments.push({ component, startY: lines.length, height: rendered.length });
        lines.push(...rendered);
      };
      append(original);
      for (const participant of stack.participants.values()) {
        if (participant.visible) append(participant.component);
      }
      stack.segments = segments;
      return lines;
    },
    invalidate() {
      stack.revision += 1;
      stack.segments = [];
      original.invalidate();
      for (const participant of stack.participants.values()) participant.component.invalidate();
    },
    digest() {
      const participantDigests = [...stack.participants.values()]
        .filter((participant) => participant.visible)
        .map((participant) => participant.component.digest?.() ?? "");
      return JSON.stringify([original.digest?.() ?? "", stack.revision, participantDigests]);
    },
    handleMouse(event) {
      const segment = stack.segments.find((candidate) => event.y >= candidate.startY && event.y < candidate.startY + candidate.height);
      if (!segment) return undefined;
      const result = segment.component.handleMouse?.({
        ...event,
        y: event.y - segment.startY,
        height: segment.height,
      });
      if (result?.render) stack.revision += 1;
      return result;
    },
  };
  return stack;
}

function isCompatibleStack(value, host) {
  return Boolean(
    value
    && value.host === host
    && isComponent(value.original)
    && isComponent(value.wrapper)
    && value.participants instanceof Map
    && Array.isArray(value.segments)
    && typeof value.revision === "number",
  );
}

export function attachGentleShellRailPanel(tui, component) {
  if (tui.mode !== "fullscreen" || !tui.terminal) return undefined;
  const terminal = tui.terminal;
  const host = terminal[GENTLE_SHELL_SIDEBAR_STATE];
  if (!host || !(host.parts instanceof Map)) return undefined;

  let stack = terminal[SHARED_RAIL_STACK];
  if (!isCompatibleStack(stack, host) || host.parts.get("footer") !== stack.wrapper) {
    const original = host.parts.get("footer");
    if (!isComponent(original)) return undefined;
    stack = createSharedRailStack(host, original);
    terminal[SHARED_RAIL_STACK] = stack;
    host.parts.set("footer", stack.wrapper);
  }

  const id = Symbol("gentle-shell-pr-rail-participant");
  const participant = { component, visible: true };
  stack.participants.set(id, participant);
  stack.revision += 1;
  tui.requestRender();
  let disposed = false;

  const mounted = () => !disposed && host.parts.get("footer") === stack.wrapper;
  const invalidate = () => {
    if (disposed) return;
    stack.revision += 1;
    stack.segments = [];
    tui.requestRender();
  };

  return {
    isActive: () => mounted() && host.active !== false && (typeof host.ownsHost !== "function" || host.ownsHost()),
    setVisible(visible) {
      if (disposed || participant.visible === visible) return;
      participant.visible = visible;
      invalidate();
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      stack.participants.delete(id);
      stack.revision += 1;
      stack.segments = [];
      if (stack.participants.size === 0) {
        if (host.parts.get("footer") === stack.wrapper) host.parts.set("footer", stack.original);
        if (terminal[SHARED_RAIL_STACK] === stack) delete terminal[SHARED_RAIL_STACK];
      }
      tui.requestRender();
    },
  };
}
