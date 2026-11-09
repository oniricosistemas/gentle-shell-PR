import { cleanExternalText } from "./github.js";

const TABS = ["Overview", "Checks", "Files"];
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

export function createPullRequestInspector({ tui, theme, keybindings, renderMarkdown, initialState, onClose, onOpenGitHub }) {
  let state = initialState;
  let activeTabIndex = 0;
  let scrollOffset = 0;
  let closeHitRegion;

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
      } catch {
        body = undefined;
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
    return [
      { token: "text", text: `${totals.passed ?? 0} passed · ${totals.pending ?? 0} running · ${totals.failed ?? 0} failed`, bold: true },
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

  const contentLines = (pr, width) => {
    if (activeTabIndex === 1) return checksLines(pr);
    if (activeTabIndex === 2) return filesLines(pr);
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
    digest: () => JSON.stringify({ state, activeTabIndex, scrollOffset }),
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
    getActiveTab: () => TABS[activeTabIndex],
    handleInput(data) {
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
      } else if (data === "o") {
        if (state.pullRequest) onOpenGitHub?.(state.pullRequest);
      } else if (data === "1" || data === "2" || data === "3") {
        activeTabIndex = Number(data) - 1;
        scrollOffset = 0;
        requestRender();
      }
    },
    handleMouse(event) {
      if (event?.type !== "click" || event.button !== "left" || !closeHitRegion) return undefined;
      if (event.y !== closeHitRegion.y || event.x < closeHitRegion.startX || event.x >= closeHitRegion.endX) return undefined;
      onClose?.();
      return { handled: true, render: false };
    },
  };
}
