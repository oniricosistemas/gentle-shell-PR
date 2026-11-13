import { cleanExternalText, filterPullRequestInbox } from "./github.js";

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

function checksLine(checks, reviewFeedback = false) {
  if (!checks || checks.total === 0) return { token: "muted", text: "No CI" };
  const feedback = reviewFeedback ? " · feedback" : "";
  if (checks.failed > 0) {
    return { token: "error", text: `CI ${checks.passed}/${checks.total} · ${checks.failed} failed${feedback}` };
  }
  if (checks.pending > 0) {
    return { token: "warning", text: `CI ${checks.passed}/${checks.total} · ${checks.pending} running${feedback}` };
  }
  return { token: reviewFeedback ? "warning" : "success", text: `CI ${checks.passed}/${checks.total} passed${feedback}` };
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

const ATTENTION_LABELS = { review_requested: "review requested", failed_ci: "failed CI" };

/**
 * v0.5 Command Center: a read-only cross-repository inbox panel. Filters are
 * pure local views and never change repository state.
 */
export function createCommandCenterPanel({ tui, theme, initialState }) {
  let inbox = initialState?.inbox ?? [];
  const owners = () => ["All owners", ...new Set(inbox.flatMap((entry) => (entry.pullRequests ?? []).map((pr) => pr.author)))];
  let ownerIndex = 0;
  let attentionIndex = 0;
  const attentionValues = ["All", "review_requested", "failed_ci"];

  const paint = (token, text, bold = false) => {
    const emphasized = bold && typeof theme.bold === "function" ? theme.bold(text) : text;
    return theme.fg(token, emphasized);
  };

  const render = (width) => {
    const boundedWidth = Math.max(24, Math.floor(width));
    const row = (text, token = "text", bold = false) => paint(token, truncateText(text, boundedWidth), bold);
    const ownerLabel = owners()[ownerIndex] ?? "All owners";
    const attentionLabel = attentionIndex === 0 ? "All" : ATTENTION_LABELS[attentionValues[attentionIndex]];

    const lines = [
      row(`Command center · ${inbox.length} repositories`, "accent", true),
      row(`Filter: ${ownerLabel} · ${attentionLabel}`, "muted"),
      row("", "muted"),
    ];

    const attention = attentionValues[attentionIndex] === "All" ? undefined : attentionValues[attentionIndex];
    const owner = ownerLabel === "All owners" ? undefined : ownerLabel;
    const filtered = filterPullRequestInbox(inbox, { owner, attention });
    let total = 0;
    // Attention summary across the unfiltered inbox, like the artboard's
    // inbox header ("Review requested · N", "Failed CI · N").
    const allPullRequests = inbox.flatMap((entry) => entry.pullRequests ?? []);
    const reviewRequested = allPullRequests.filter((pr) => pr.review === "waiting").length;
    const failedCi = allPullRequests.filter((pr) => pr.checks?.failed > 0).length;
    if (reviewRequested > 0) lines.push(row(`◇ Review requested · ${reviewRequested}`, "warning"));
    if (failedCi > 0) lines.push(row(`× Failed CI · ${failedCi}`, "error"));

    for (const entry of filtered) {
      if (entry.error) {
        lines.push(row(`${entry.repository} · could not load pull requests`, "error"));
        continue;
      }
      const marker = entry.current ? " · current" : "";
      if (!entry.pullRequests?.length) continue;
      lines.push(row(`${entry.repository}${marker}`, "text", true));
      for (const pr of entry.pullRequests) {
        total += 1;
        const reviewToken = pr.review === "changes_requested" ? "error"
          : pr.review === "approved" ? "success"
          : pr.review === "waiting" ? "warning" : "muted";
        const checks = pr.checks?.failed > 0
          ? paint("error", "×")
          : pr.checks?.pending > 0 ? paint("warning", "◷") : paint("success", "✓");
        lines.push(row(`  ${checks} #${pr.number} ${pr.title}`, reviewToken));
        lines.push(row(`    @${pr.author} · ${pr.headBranch}`, "muted"));
      }
    }

    if (total === 0) {
      lines.push(row("No pull requests match the current filters", "muted"));
    }
    lines.push(row("", "muted"));
    lines.push(row("f owner · a attention: failed CI, review requested", "muted"));
    return lines;
  };

  return {
    render,
    invalidate: () => tui.requestRender(),
    digest: () => JSON.stringify({ inbox, ownerIndex, attentionIndex }),
    setState(next) {
      inbox = next?.inbox ?? inbox;
      tui.requestRender();
    },
    getInbox: () => inbox,
    cycleOwner() {
      ownerIndex = (ownerIndex + 1) % Math.max(1, owners().length);
      tui.requestRender();
    },
    cycleAttention() {
      attentionIndex = (attentionIndex + 1) % attentionValues.length;
      tui.requestRender();
    },
    resetFilters() {
      ownerIndex = 0;
      attentionIndex = 0;
      tui.requestRender();
    },
  };
}

export function detectGentleShellRailLayout(tui) {
  const host = tui?.terminal?.[GENTLE_SHELL_SIDEBAR_STATE];
  if (!host || !(host.parts instanceof Map)) return "legacy";
  return host.parts.has("statusbar") || host.parts.has("header") ? "rail" : "legacy";
}

function factsToken(pr) {
  if (pr.merge === "conflicting" || pr.review === "changes_requested") return "error";
  if (pr.merge === "ready" && pr.review === "approved") return "success";
  return "muted";
}

export function createPullRequestPanel({ tui, theme, initialState, onCollapsedChange, onOpenPullRequest, layout }) {
  let state = initialState;
  const railMode = (layout ?? detectGentleShellRailLayout(tui)) === "rail";
  let collapsed = railMode;
  let pullRequestTitleRows = new Map();

  onCollapsedChange?.(collapsed);

  const paint = (token, text, bold = false) => {
    const emphasized = bold && typeof theme.bold === "function" ? theme.bold(text) : text;
    return theme.fg(token, emphasized);
  };

  const render = (width, nativeTitle = false) => {
    pullRequestTitleRows = new Map();
    const boundedWidth = Math.max(0, Math.floor(width));
    if (boundedWidth === 0) return [];
    if (boundedWidth === 1) return [paint("muted", "…")];

    const count = state.pullRequests?.length ?? 0;
    const titleText = collapsed
      ? (railMode ? `▸ Pull requests · ${count}` : `▶ Pull requests · ${count}`)
      : (railMode ? `▾ Pull requests · ${count}` : `▼ Pull requests · ${count}`);
    const contentWidth = railMode ? boundedWidth : Math.max(0, boundedWidth - 4);
    const row = (token, text, bold = false) => {
      const bounded = truncateText(text, contentWidth);
      if (railMode) return paint(token, bounded, bold);
      const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(bounded)));
      return paint("border", "│ ") + paint(token, `${bounded}${padding}`, bold) + paint("border", " │");
    };

    const lines = [];
    if (railMode) {
      // Native rail card headers carry the accent role without the bold
      // card-title emphasis (Gentle Shell tinted rail titles).
      lines.push(row("accent", titleText, !nativeTitle));
      if (collapsed) return lines;
    } else {
      const title = truncateText(titleText, Math.max(1, boundedWidth - 6));
      const topFill = Math.max(0, boundedWidth - visibleWidth(title) - 5);
      lines.push(paint("border", "╭─ ") + paint("accent", title, true) + paint("border", ` ${"─".repeat(topFill)}╮`));
      if (collapsed) {
        lines.push(paint("border", `╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`));
        return lines;
      }
    }

    const repository = cleanExternalText(state.repository) || "No GitHub repository";
    const currentBranch = cleanExternalText(state.branch);
    const branch = currentBranch ? ` · ${currentBranch}` : "";
    lines.push(row(healthToken(state), `${repository}${branch}`));

    if (state.error) {
      lines.push(row("error", state.error));
      if (!railMode) lines.push(paint("border", `╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`));
      return lines;
    }

    if (!state.pullRequests?.length) {
      lines.push(row("muted", "No open pull requests"));
      if (!railMode) lines.push(paint("border", `╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`));
      return lines;
    }

    for (const pr of state.pullRequests.slice(0, 3)) {
      pullRequestTitleRows.set(lines.length, pr);
      lines.push(row("text", `#${pr.number} ${pr.title}`, true));
      const headBranch = cleanExternalText(pr.headBranch) || "unknown";
      const baseBranch = cleanExternalText(pr.baseBranch) || "unknown";
      lines.push(row("muted", `${headBranch} → ${baseBranch}${pr.isDraft ? " · Draft" : ""}`));
      const checks = checksLine(pr.checks, pr.reviewFeedback);
      lines.push(row(checks.token, checks.text));
      lines.push(row(factsToken(pr), `${reviewLabel(pr.review)} · ${mergeLabel(pr.merge)}`));
    }

    if (state.pullRequests.length > 3) {
      lines.push(row("muted", `+${state.pullRequests.length - 3} more`));
    }

    if (!railMode) {
      lines.push(paint("border", `╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`));
    }
    return lines;
  };

  const setCollapsed = (next) => {
    if (collapsed === next) return;
    collapsed = next;
    onCollapsedChange?.(collapsed);
    tui.requestRender();
  };

  const panel = {
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
      if (event?.button !== "left" || event.type !== "click") return undefined;
      if (event.y === 0) {
        setCollapsed(!collapsed);
        return { handled: true, render: true };
      }
      const pullRequest = pullRequestTitleRows.get(event.y);
      if (pullRequest && !collapsed) {
        onOpenPullRequest?.(pullRequest);
        return { handled: true, render: false };
      }
      return undefined;
    },
    // Gentle Shell's newer tinted rail draws independent cards per participant.
    // This grouped variant renders one leading spacer plus the same borderless
    // rows, and declares its card group starting at row 1 so the spacer stays
    // outside the card and carded rails insert their own gap instead.
    createGroupedPanelSection() {
      const renderGrouped = (width) => {
        const boundedWidth = Math.floor(width);
        if (boundedWidth <= 0) return [];
        return ["", ...render(boundedWidth, true)];
      };
      return {
        render: renderGrouped,
        invalidate: () => tui.requestRender(),
        digest: () => JSON.stringify({ state, collapsed, grouped: true }),
        cardGroups: (width) => {
          const lines = renderGrouped(width);
          if (lines.length <= 1) return undefined;
          return { groups: [{ start: 1, end: lines.length }] };
        },
        handleMouse: (event) => {
          if (event?.button !== "left" || event.type !== "click") return undefined;
          if (event.y <= 0) return undefined;
          return panel.handleMouse({ ...event, y: event.y - 1 });
        },
      };
    },
  };

  return panel;
}

function createSharedRailStack(host, original) {
  const supportsCardGroups = typeof original.cardGroups === "function";
  const stack = {
    host,
    original,
    wrapper: undefined,
    participants: new Map(),
    revision: 0,
    segments: [],
    segmentsWidth: undefined,
    surface: original.surface,
    supportsCardGroups,
  };

  stack.wrapper = {
    ...(supportsCardGroups
      ? {
        // Gentle Shell's transparent rail asks each part for optional
        // cardGroups(width) to draw independent cards. Without forwarding the
        // contract the host falls back to one group spanning every row,
        // reprocesses already width-shaped rows, merges all sections into a
        // single nested card, and appends ellipses.
        cardGroups(width) {
          if (stack.segmentsWidth !== width) stack.wrapper.render(width);
          const groups = [];
          const loose = [];
          for (const segment of stack.segments) {
            const layout = segment.component.cardGroups?.(width);
            if (layout) {
              groups.push(...layout.groups.map(({ start, end }) => ({
                start: segment.startY + start,
                end: segment.startY + end,
              })));
              loose.push(...(layout.loose ?? []).map((row) => segment.startY + row));
            } else {
              groups.push({ start: segment.startY, end: segment.startY + segment.height });
            }
          }
          return loose.length > 0 ? { groups, loose } : { groups };
        },
      }
      : {}),
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
      stack.segmentsWidth = width;
      return lines;
    },
    invalidate() {
      stack.revision += 1;
      stack.segments = [];
      stack.segmentsWidth = undefined;
      original.invalidate();
      for (const participant of stack.participants.values()) participant.component.invalidate();
    },
    digest() {
      let originalDigest = "";
      try {
        originalDigest = original.digest?.() ?? "";
      } catch {
        // A host digest failure degrades that component to explicit invalidation.
      }
      const participantDigests = [];
      for (const participant of stack.participants.values()) {
        if (!participant.visible) continue;
        let digest = "";
        try {
          digest = participant.component.digest?.() ?? "";
        } catch {
          // A participant digest failure also degrades to explicit invalidation.
        }
        participantDigests.push(digest);
      }
      return JSON.stringify([originalDigest, stack.revision, participantDigests]);
    },
    handleMouse(event) {
      if (event.y < 0 || event.y >= event.height) return undefined;
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
  for (const property of ["surface", "summary", "open", "alert", "spend"]) {
    if (!(property in original)) continue;
    Object.defineProperty(stack.wrapper, property, {
      enumerable: true,
      get() {
        const value = original[property];
        return typeof value === "function" ? value.bind(original) : value;
      },
    });
  }
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
    && typeof value.revision === "number"
    && typeof value.supportsCardGroups === "boolean",
  );
}

function railOwnsHost(host) {
  if (typeof host.ownsHost !== "function") return host.active !== false;
  try {
    return host.ownsHost() === true;
  } catch {
    return false;
  }
}

export function attachGentleShellRailPanel(tui, component, panelComponent = component, groupedPanelComponent = panelComponent) {
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
  // Feature-detect the host capabilities: carded rails receive the grouped
  // participant whose spacer stays outside its declared group, 4.6 panel hosts
  // receive the separated panel variant, and older compatible hosts keep the
  // plain framed component.
  const participant = {
    component: stack.supportsCardGroups
      ? groupedPanelComponent
      : stack.surface === "panel" ? panelComponent : component,
    visible: true,
  };
  stack.participants.set(id, participant);
  stack.revision += 1;
  tui.requestRender();
  let disposed = false;

  const mounted = () => !disposed && host.parts.get("footer") === stack.wrapper;
  const invalidate = () => {
    if (disposed) return;
    stack.revision += 1;
    stack.segments = [];
    stack.segmentsWidth = undefined;
    tui.requestRender();
  };

  return {
    isMounted: mounted,
    isActive: () => mounted() && railOwnsHost(host),
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
