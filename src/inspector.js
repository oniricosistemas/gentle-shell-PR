import { cleanExternalText } from "./github.js";

const TABS = ["Overview", "Checks", "Files", "Context", "Timeline"];
const TIMELINE_EVENT_LABELS = {
  review: "Review",
  merged: "Merged into main",
  closed: "Closed",
  ready: "Ready for review",
  draft: "Converted to draft",
  dismissed: "Review dismissed",
};
const REVIEW_STATE_LABELS = {
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  DISMISSED: "Dismissed",
  COMMENTED: "Commented",
  PENDING: "Pending",
};
const COMPACT_CHECK_LINES = 3;
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/g;

function visibleWidth(value) {
  return String(value).replace(ANSI_PATTERN, "").length;
}

function truncateText(value, width) {
  const text = String(value ?? "");
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  if (width === 1) return "…";
  return `${text.replace(ANSI_PATTERN, "").slice(0, width - 1)}…`;
}

function wrapText(value, width) {
  const text = cleanExternalText(value);
  if (!text) return [];
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (!current) {
      current = truncateText(word, width);
    } else if (visibleWidth(`${current} ${word}`) <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = truncateText(word, width);
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Wraps multiline external text line by line, preserving intentional breaks. */
function wrapMultiline(value, width) {
  return String(value ?? "")
    .split("\n")
    .flatMap((line) => wrapText(line, width));
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

function checkToken(status) {
  if (status === "passed") return "success";
  if (status === "failed") return "error";
  return "warning";
}

function checkIcon(status) {
  if (status === "passed") return "✓";
  if (status === "failed") return "×";
  return "◷";
}

export function createPullRequestInspector({ tui, theme, keybindings, matchesKey, renderMarkdown, onMarkdownError, initialState, onClose, onOpenGitHub }) {
  let state = initialState;
  let activeTabIndex = 0;
  let scrollOffset = 0;
  let closeHitRegion;
  let tabHitRegions = [];
  let markdownErrorReported = false;
  let contextExpanded = false;

  const paint = (token, text, bold = false) => {
    const emphasized = bold && typeof theme.bold === "function" ? theme.bold(text) : text;
    return theme.fg(token, emphasized);
  };

  const requestRender = () => tui.requestRender();

  const overviewLines = (pr, width) => {
    const head = cleanExternalText(pr.headBranch) || "unknown";
    const base = cleanExternalText(pr.baseBranch) || "unknown";
    const labels = pr.labels?.length ? pr.labels.map(cleanExternalText).filter(Boolean).join(" · ") : "No labels";
    const author = cleanExternalText(pr.author) || "unknown";
    const bodyMarkdown = pr.bodySummary || "No description provided.";
    let body;
    let bodyIsStyled = false;
    if (typeof renderMarkdown === "function") {
      try {
        body = renderMarkdown(bodyMarkdown, width);
        bodyIsStyled = Array.isArray(body);
      } catch (error) {
        body = undefined;
        if (!markdownErrorReported && typeof onMarkdownError === "function") {
          markdownErrorReported = true;
          onMarkdownError(error);
        }
      }
    }
    if (!bodyIsStyled) body = wrapText(bodyMarkdown, width);
    return [
      { token: "accent", text: `${head} → ${base}` },
      { token: pr.merge === "ready" && pr.review === "approved" ? "success" : "text", text: `${reviewLabel(pr.review)} · ${mergeLabel(pr.merge)}` },
      { token: "muted", text: `@${author}${pr.isDraft ? " · Draft" : ""} · ${labels}` },
      { token: "muted", text: `${pr.changedFiles} files · +${pr.additions} −${pr.deletions}` },
      { token: "muted", text: "" },
      { token: "text", text: "Description", bold: true },
      ...body.map((text) => ({ token: "muted", text, styled: bodyIsStyled })),
    ];
  };

  const checksLines = (pr) => {
    if (!pr.checks?.length) return [{ token: "muted", text: "No checks reported for this pull request." }];
    const totals = pr.checks.reduce((result, check) => {
      result[check.status] = (result[check.status] ?? 0) + 1;
      return result;
    }, {});
    const feedback = pr.reviewFeedback ? " · feedback" : "";
    return [
      { token: pr.reviewFeedback ? "warning" : "text", text: `${totals.passed ?? 0} passed · ${totals.pending ?? 0} running · ${totals.failed ?? 0} failed${feedback}`, bold: true },
      { token: "muted", text: "" },
      ...pr.checks.map((check) => ({
        token: checkToken(check.status),
        text: `${checkIcon(check.status)} ${cleanExternalText(check.name) || "Unnamed check"} · ${check.status}`,
      })),
    ];
  };

  const filesLines = (pr) => {
    if (!pr.files?.length) return [{ token: "muted", text: "No changed files reported." }];
    return [
      { token: "text", text: `${pr.changedFiles} files · +${pr.additions} −${pr.deletions}`, bold: true },
      { token: "muted", text: "Metadata only · use Gentle Shell for diffs" },
      { token: "muted", text: "" },
      ...pr.files.map((file) => ({
        token: "text",
        text: `${cleanExternalText(file.path) || "unknown file"}  +${file.additions} −${file.deletions}`,
      })),
    ];
  };

  const contextLines = (pr, width) => {
    const context = pr.context;
    if (!context) {
      return state.contextPending === true
        ? [{ token: "warning", text: "Loading review context…" }]
        : [{ token: "muted", text: "Review context is unavailable." }];
    }

    const lines = [];
    const fetched = context.fetchedAt
      ? `Fetched ${new Date(context.fetchedAt).toTimeString().slice(0, 5)} · read-only`
      : "Read-only context";
    lines.push({ token: "muted", text: fetched });
    const issues = Array.isArray(context.linkedIssues) ? context.linkedIssues : [];
    lines.push({ token: "text", text: `Linked issue${issues.length === 1 ? "" : "s"}${issues.length ? ` · ${issues.length} reference${issues.length === 1 ? "" : "s"}` : ""}`, bold: true });
    if (!issues.length) {
      lines.push({ token: "muted", text: "No linked issues" });
    } else {
      for (const issue of issues) {
        lines.push({ token: "text", text: `#${issue.number} · ${issue.title}` });
        for (const bodyLine of wrapText(issue.body, width - 2)) {
          lines.push({ token: "muted", text: `  ${bodyLine}` });
        }
        const labels = issue.labels?.length ? `${issue.labels.join(", ")} · ` : "";
        lines.push({ token: "muted", text: `  ${labels}${(issue.state || "state unknown").toLowerCase()} · linked by PR` });
      }
    }

    lines.push({ token: "muted", text: "" });
    const threads = Array.isArray(context.reviewThreads) ? context.reviewThreads : [];
    lines.push({ token: "text", text: `Review threads · ${threads.length} unresolved`, bold: true });
    if (!threads.length) {
      lines.push({ token: "muted", text: "No unresolved review threads" });
    } else {
      for (const thread of threads) {
        const location = thread.path ? `${thread.path}:${thread.line || "?"}` : "";
        lines.push({ token: "text", text: `@${thread.author || "unknown"}${thread.outdated ? " · outdated" : ""}${location ? ` · ${location}` : ""}` });
        for (const excerptLine of wrapText(thread.excerpt, width - 2)) {
          lines.push({ token: "muted", text: `  ${excerptLine}` });
        }
      }
    }

    lines.push({ token: "muted", text: "" });
    const failed = context.failedCheck;
    lines.push({ token: "text", text: failed ? `Failed check · × ${failed.name}` : "Failed check", bold: true });
    if (!failed) {
      lines.push({ token: "muted", text: "No failed checks" });
    } else {
      const summaryLines = wrapMultiline(failed.summary, width - 2).map((line) => ({ token: "error", text: `  ${line}` }));
      const excerptLines = contextExpanded ? summaryLines : summaryLines.slice(0, COMPACT_CHECK_LINES);
      lines.push(...excerptLines);
      if (!contextExpanded && summaryLines.length > COMPACT_CHECK_LINES) {
        lines.push({ token: "muted", text: `  … ${summaryLines.length - COMPACT_CHECK_LINES} more lines` });
      }
      for (const annotation of failed.annotations ?? []) {
        const location = annotation.path ? ` (${annotation.path}:${annotation.line || "?"})` : "";
        const messageLines = wrapText(annotation.message, width - 4);
        messageLines.forEach((messageLine, index) => {
          lines.push({ token: "warning", text: `  ! ${messageLine}${index === 0 ? location : ""}` });
        });
      }
      if (summaryLines.length > COMPACT_CHECK_LINES) {
        lines.push({ token: "muted", text: `Enter ${contextExpanded ? "collapse" : "expand"}` });
      }
    }
    return lines;
  };

  const timelineLines = (pr) => {
    const timeline = pr.timeline;
    if (!timeline) return [{ token: "muted", text: "Timeline is unavailable." }];

    const lines = [];
    const opened = timeline.openedAt ? `Opened ${new Date(timeline.openedAt).toTimeString().slice(0, 5)}` : "Opened";
    const merged = timeline.mergedAt ? ` · merged ${new Date(timeline.mergedAt).toTimeString().slice(0, 5)}` : " · not merged";
    lines.push({ token: "muted", text: `${opened}${merged} · read-only` });
    const events = Array.isArray(timeline.events) ? timeline.events : [];
    // A merged pull request always shows its merge row, even when the bounded
    // event list is empty: mergedAt/mergedBy are authoritative on their own.
    if (timeline.mergedAt && !events.some((event) => event.kind === "merged")) {
      events.push({ kind: "merged", at: timeline.mergedAt, author: timeline.mergedBy, commit: undefined });
    }
    if (!events.length) {
      lines.push({ token: "muted", text: "No timeline events yet" });
    } else {
      for (const event of events) {
        const label = TIMELINE_EVENT_LABELS[event.kind] || event.kind;
        const time = event.at ? new Date(event.at).toTimeString().slice(0, 5) : "";
        const suffix = time ? ` · ${time}` : "";
        const token = event.kind === "merged" ? "success"
          : event.kind === "review" && event.state === "CHANGES_REQUESTED" ? "error"
          : event.kind === "review" && event.state === "APPROVED" ? "success"
          : event.kind === "review" ? "warning"
          : "text";
        if (event.kind === "review") {
          const reviewState = REVIEW_STATE_LABELS[event.state] || event.state || label;
          lines.push({ token, text: `${reviewState} · ${event.author || "unknown"}${suffix}` });
        } else if (event.kind === "merged") {
          lines.push({ token, text: `${label} · ${event.author || "unknown"}${suffix} · ${String(event.commit ?? "").slice(0, 7) || "commit"}` });
        } else {
          lines.push({ token, text: `${label} · ${event.author || "unknown"}${suffix}` });
        }
      }
    }

    lines.push({ token: "muted", text: "" });
    const runs = Array.isArray(timeline.workflowRuns) ? timeline.workflowRuns : [];
    lines.push({ token: "text", text: `GitHub Actions · ${runs.length} run${runs.length === 1 ? "" : "s"}`, bold: true });
    if (!runs.length) {
      lines.push({ token: "muted", text: "No workflow runs" });
    } else {
      for (const run of runs) {
        const token = run.status === "in_progress" ? "warning"
          : run.conclusion === "success" ? "success"
          : run.conclusion === "failure" ? "error"
          : run.status === "completed" ? "error"
          : "warning";
        const icon = run.status === "in_progress" ? "◷" : run.conclusion === "success" ? "✓" : run.status === "completed" ? "×" : "◷";
        const stateLabel = run.status === "in_progress" ? "Running" : run.conclusion || run.status;
        const time = run.startedAt ? ` · ${new Date(run.startedAt).toTimeString().slice(0, 5)}` : "";
        lines.push({ token, text: `${icon} ${run.name || "Workflow"} · ${stateLabel}${time}` });
      }
    }
    return lines;
  };

  const contentLines = (pr, width) => {
    if (activeTabIndex === 1) return checksLines(pr);
    if (activeTabIndex === 2) return filesLines(pr);
    if (activeTabIndex === 3) return contextLines(pr, width);
    if (activeTabIndex === 4) return timelineLines(pr);
    return overviewLines(pr, width);
  };

  const render = (width) => {
    const boundedWidth = Math.max(24, Math.floor(width));
    const innerWidth = boundedWidth - 4;
    const border = (text) => paint("border", text);
    const row = (token, text = "", bold = false, styled = false) => {
      const bounded = visibleWidth(text) <= innerWidth ? text : truncateText(text, innerWidth);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(bounded)));
      const content = styled ? `${bounded}${padding}` : paint(token, `${bounded}${padding}`, bold);
      return border("│ ") + content + border(" │");
    };
    const topTitle = state.pullRequest
      ? `PR #${state.pullRequest.number} · ${state.pullRequest.title}`
      : "Pull request inspector";
    const title = truncateText(topTitle, Math.max(1, boundedWidth - 6));
    const top = border("╭─ ") + paint("accent", title, true) + border(` ${"─".repeat(Math.max(0, boundedWidth - visibleWidth(title) - 5))}╮`);
    const bottom = border(`╰${"─".repeat(Math.max(0, boundedWidth - 2))}╯`);
    const lines = [top];

    // Tab titles are clickable: record each label's terminal column range on
    // the fixed tabs row (line 1, after the "│ " gutter) for mouse routing.
    let tabOffset = 0;
    tabHitRegions = TABS.map((tab, index) => {
      const label = index === activeTabIndex ? `[${tab}]` : ` ${tab} `;
      const region = {
        index,
        startX: tabOffset + 2,
        endX: Math.min(tabOffset + 2 + label.length, innerWidth + 2),
      };
      tabOffset += label.length + 2;
      return region;
    });
    const tabsText = TABS.map((tab, index) => index === activeTabIndex ? `[${tab}]` : ` ${tab} `).join("  ");
    lines.push(row("accent", tabsText));
    lines.push(row("border", "─".repeat(innerWidth)));

    if (state.loading) {
      lines.push(row("warning", "◷ Loading pull request details…"));
    } else if (state.error) {
      lines.push(row("error", state.error));
    } else if (!state.pullRequest) {
      lines.push(row("muted", "No pull request details are available."));
    } else {
      const content = contentLines(state.pullRequest, innerWidth);
      const maxVisible = 16;
      const maxOffset = Math.max(0, content.length - maxVisible);
      scrollOffset = Math.min(scrollOffset, maxOffset);
      for (const line of content.slice(scrollOffset, scrollOffset + maxVisible)) {
        lines.push(row(line.token, line.text, line.bold, line.styled));
      }
      while (lines.length < 3 + Math.min(maxVisible, Math.max(1, content.length))) {
        lines.push(row("muted", ""));
      }
      if (content.length > maxVisible) {
        lines.push(row("muted", `Rows ${scrollOffset + 1}-${Math.min(content.length, scrollOffset + maxVisible)} of ${content.length}`));
      }
    }

    lines.push(row("border", "─".repeat(innerWidth)));
    const footerText = "←/→ or Tab tabs · j/k scroll · o GitHub · Esc close";
    const visibleFooter = truncateText(footerText, innerWidth);
    const closeLabel = "Esc close";
    const closeLabelColumn = visibleFooter.indexOf(closeLabel);
    closeHitRegion = closeLabelColumn >= 0
      ? { y: lines.length, startX: closeLabelColumn + 2, endX: closeLabelColumn + 2 + closeLabel.length }
      : undefined;
    lines.push(row("muted", footerText));
    lines.push(bottom);
    return lines;
  };

  const changeTab = (delta) => {
    activeTabIndex = (activeTabIndex + delta + TABS.length) % TABS.length;
    scrollOffset = 0;
    requestRender();
  };
  return {
    render,
    invalidate: requestRender,
    digest: () => JSON.stringify({ state, activeTabIndex, scrollOffset, contextExpanded }),
    setState(next) {
      state = next;
      scrollOffset = 0;
      requestRender();
    },
    setTab(tab) {
      const index = TABS.indexOf(tab);
      if (index >= 0) {
        activeTabIndex = index;
        scrollOffset = 0;
        requestRender();
      }
    },
    getActiveTab: () => TABS[activeTabIndex],    handleInput(data) {
      const cancel = keybindings?.matches?.(data, "tui.select.cancel") === true;
      if (cancel || data === "\u001b" || data === "\u0003") {
        onClose?.();
        return;
      }
      if (data === "\u001b[C" || data === "\t") {
        changeTab(1);
      } else if (data === "\u001b[D") {
        changeTab(-1);
      } else if (data === "j" || data === "\u001b[B") {
        scrollOffset += 1;
        requestRender();
      } else if (data === "k" || data === "\u001b[A") {
        scrollOffset = Math.max(0, scrollOffset - 1);
        requestRender();
      } else if (data === "o" || matchesKey?.(data, "o") === true) {
        if (state.pullRequest) onOpenGitHub?.(state.pullRequest);
      } else if (data === "\r" || data === "\n") {
        if (activeTabIndex === 3 && state.pullRequest?.context?.failedCheck) {
          contextExpanded = !contextExpanded;
          requestRender();
        }
      } else if (data === "1" || data === "2" || data === "3" || data === "4" || data === "5") {
        activeTabIndex = Number(data) - 1;
        scrollOffset = 0;
        requestRender();
      }
    },
    handleMouse(event) {
      if (event?.type !== "click" || event.button !== "left") return undefined;
      if (event.y === 1) {
        const region = tabHitRegions.find((candidate) => event.x >= candidate.startX && event.x < candidate.endX);
        if (!region) return undefined;
        if (region.index === activeTabIndex) return { handled: true, render: false };
        changeTab(region.index);
        return { handled: true, render: true };
      }
      if (!closeHitRegion) return undefined;
      if (event.y !== closeHitRegion.y || event.x < closeHitRegion.startX || event.x >= closeHitRegion.endX) return undefined;
      onClose?.();
      return { handled: true, render: false };
    },
  };
}
