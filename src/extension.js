import { collectPullRequestContext, collectPullRequestDetail, collectPullRequestInbox, collectPullRequests, collectPullRequestTimeline, executeFile } from "./github.js";
import { createPullRequestInspector } from "./inspector.js";
import { attachGentleShellRailPanel, createCommandCenterPanel, createPullRequestPanel } from "./sidebar.js";

const UI_KEY = "gentle-shell-pr";
const POLL_INTERVAL_MS = 60_000;

const EMPTY_STATE = {
  repository: undefined,
  branch: undefined,
  pullRequests: [],
  error: undefined,
  loading: true,
};

export function createPrSidebarExtension(dependencies = {}) {
  const collect = dependencies.collect ?? collectPullRequests;
  const collectDetail = dependencies.collectDetail ?? collectPullRequestDetail;
  const collectContext = dependencies.collectContext ?? collectPullRequestContext;
  const collectTimeline = dependencies.collectTimeline ?? collectPullRequestTimeline;
  const collectInbox = dependencies.collectInbox ?? collectPullRequestInbox;
  const execute = dependencies.execute ?? executeFile;
  const matchesKey = dependencies.matchesKey;
  const renderMarkdown = dependencies.renderMarkdown;
  const setIntervalFn = dependencies.setIntervalFn ?? setInterval;
  const clearIntervalFn = dependencies.clearIntervalFn ?? clearInterval;

  return (pi) => {
    let active;

    const renderStatus = (current) => {
      const state = current.state;
      if (state.loading) {
        current.context.ui.setStatus(UI_KEY, "PRs loading…");
        return;
      }
      if (state.error) {
        current.context.ui.setStatus(UI_KEY, `PRs · ${state.error}`);
        return;
      }
      const count = state.pullRequests.length;
      current.context.ui.setStatus(UI_KEY, `PRs ${count} · ${state.repository ?? "no repository"}`);
    };

    const syncPresentation = (current) => {
      current.rail?.setVisible(current.visible);
      current.rail?.invalidate();
      current.overlayHandle?.setHidden(!current.visible || current.rail?.isActive() === true);
    };

    const refresh = async (current) => {
      if (active !== current || current.refreshing) return undefined;
      current.refreshing = true;
      try {
        const next = await collect({ cwd: current.context.cwd, limit: 5 });
        if (active !== current) return undefined;
        current.state = { ...next, loading: false };
        current.panel?.setState(current.state);
        current.rail?.invalidate();
        renderStatus(current);
        return current.state;
      } catch {
        if (active !== current) return undefined;
        current.state = {
          ...current.state,
          loading: false,
          error: "Could not load pull requests",
        };
        current.panel?.setState(current.state);
        current.rail?.invalidate();
        renderStatus(current);
        return current.state;
      } finally {
        current.refreshing = false;
      }
    };

    const selectPullRequest = (state) => state?.pullRequests.find((item) => item.headBranch === state.branch) ?? state?.pullRequests[0];

    const openInGitHub = async (current, pullRequest, context = current.context) => {
      if (!current.state.repository || !pullRequest) return false;
      const result = await execute("gh", ["pr", "view", String(pullRequest.number), "--repo", current.state.repository, "--web"], { cwd: context.cwd });
      if (result.exitCode !== 0) context.ui.notify("Could not open the pull request", "warning");
      return result.exitCode === 0;
    };

    const openInspector = async (current, pullRequest, context = current.context) => {
      if (active !== current || !current.state.repository || !pullRequest) {
        context.ui.notify("No pull request is available", "warning");
        return;
      }
      if (current.inspectorSession) return;

      const session = {
        component: undefined,
        finish: undefined,
        state: { repository: current.state.repository, pullRequest: undefined, error: undefined, loading: true },
      };
      current.inspectorSession = session;
      const inspectorPromise = context.ui.custom((tui, theme, keybindings, done) => {
        session.finish = () => done(undefined);
        session.component = createPullRequestInspector({
          tui,
          theme,
          keybindings,
          matchesKey,
          renderMarkdown,
          onMarkdownError: () => {
            if (active === current) {
              context.ui.notify("Pull request Markdown rendering unavailable; showing plain text", "warning");
            }
          },
          initialState: session.state,
          onClose: session.finish,
          onOpenGitHub: (candidate) => { void openInGitHub(current, candidate, context); },
        });
        return session.component;
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "85%",
          minWidth: 32,
          maxHeight: "85%",
          margin: 1,
        },
      });
      void inspectorPromise.catch(() => {
        if (active === current) context.ui.notify("Pull request inspector unavailable", "warning");
      }).finally(() => {
        if (current.inspectorSession === session) current.inspectorSession = undefined;
      });

      try {
        const detail = await collectDetail({
          cwd: context.cwd,
          repository: current.state.repository,
          number: pullRequest.number,
        });
        if (active !== current || current.inspectorSession !== session) return;
        session.state = { ...detail, loading: false };
      } catch {
        session.state = {
          repository: current.state.repository,
          pullRequest: undefined,
          error: "Could not load pull request details",
          loading: false,
        };
      }
      if (active === current && current.inspectorSession === session && session.state.pullRequest) {
        // Show the loaded detail immediately; review context is optional and
        // arrives separately so a slow GraphQL query cannot hold the
        // inspector on the loading state (review follow-up R4-1). The Context
        // tab distinguishes this pending window from a real failure.
        session.state = { ...session.state, contextPending: true };
        session.component?.setState(session.state);
        try {
          const collected = await collectContext({
            cwd: context.cwd,
            repository: current.state.repository,
            number: session.state.pullRequest.number,
          });
          if (active === current && current.inspectorSession === session) {
            const attached = !collected.error && collected.context
              ? { pullRequest: { ...session.state.pullRequest, context: collected.context } }
              : {};
            session.state = { ...session.state, contextPending: false, ...attached };
          }
          // Timeline shares the pending window: it also arrives after the
          // detail and degrades to an unavailable tab on failure.
          try {
            const timeline = await collectTimeline({
              cwd: context.cwd,
              repository: current.state.repository,
              number: session.state.pullRequest.number,
            });
            if (active === current && current.inspectorSession === session && !timeline.error && timeline.timeline) {
              session.state = {
                ...session.state,
                pullRequest: { ...session.state.pullRequest, timeline: timeline.timeline },
              };
              session.component?.setState(session.state);
            }
          } catch {
            // Timeline stays unavailable.
          }
        } catch {
          // Context stays unavailable; the pending marker clears.
          if (active === current && current.inspectorSession === session) {
            session.state = { ...session.state, contextPending: false };
          }
        }
      }
      if (active === current && current.inspectorSession === session) session.component?.setState(session.state);
    };

    const stop = () => {
      const current = active;
      active = undefined;
      if (!current) return;
      if (current.timerId !== undefined) clearIntervalFn(current.timerId);
      current.inspectorSession?.finish?.();
      current.rail?.dispose();
      current.finish?.();
      current.context.ui.setStatus(UI_KEY, undefined);
    };

    const mount = (current) => {
      if (current.context.mode !== "tui" || typeof current.context.ui.custom !== "function") return;
      void current.context.ui.custom((tui, theme, _keybindings, done) => {
        const panel = createPullRequestPanel({
          tui,
          theme,
          initialState: current.state,
          onCollapsedChange: (collapsed) => {
            current.collapsed = collapsed;
          },
          onOpenPullRequest: (pullRequest) => {
            void openInspector(current, pullRequest, current.context);
          },
        });
        panel.setCollapsed(current.collapsed);
        if (active !== current) {
          done(undefined);
          return panel;
        }
        current.finish = () => done(undefined);
        current.panel = panel;
        // Feature-detected per host: carded rails get the grouped section, 4.6
        // panel hosts the plain rows, and older compatible hosts the framed rail.
        current.rail = attachGentleShellRailPanel(tui, panel, panel, panel.createGroupedPanelSection());
        syncPresentation(current);
        return panel;
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "bottom-right",
          width: 44,
          minWidth: 30,
          maxHeight: "80%",
          margin: { right: 1, bottom: 1 },
          nonCapturing: true,
          visible: (terminalWidth) => current.visible && current.rail?.isActive() !== true && terminalWidth >= 100,
        },
        onHandle: (handle) => {
          current.overlayHandle = handle;
          syncPresentation(current);
        },
      }).catch(() => {
        if (active === current) current.context.ui.notify("Pull request sidebar unavailable", "warning");
      });
    };

    pi.on("session_start", async (_event, context) => {
      stop();
      if (!context.hasUI || context.mode !== "tui") return;
      const current = {
        context,
        state: { ...EMPTY_STATE },
        visible: true,
        collapsed: false,
        refreshing: false,
        timerId: undefined,
      };
      active = current;
      mount(current);
      renderStatus(current);
      await refresh(current);
      if (active !== current) return;
      current.timerId = setIntervalFn(() => {
        if (active === current && current.visible) void refresh(current);
      }, POLL_INTERVAL_MS);
      current.timerId?.unref?.();
    });

    pi.registerCommand("pr-inbox", {
      description: "Open the cross-repository pull request command center",
      handler: async (_args, context) => {
        if (context.mode !== "tui" || typeof context.ui.custom !== "function") {
          context.ui.notify("Pull request inbox requires interactive TUI mode", "warning");
          return;
        }
        const inbox = await collectInbox({ cwd: context.cwd });
        if (inbox.error) {
          context.ui.notify(inbox.error, "warning");
          return;
        }
        try {
          await context.ui.custom((tui, theme, keybindings, done) => {
            const panel = createCommandCenterPanel({ tui, theme, initialState: inbox });
            return {
              render: panel.render,
              invalidate: panel.invalidate,
              digest: panel.digest,
              handleInput(data) {
                const cancel = keybindings?.matches?.(data, "tui.select.cancel") === true;
                if (cancel || data === "\u001b" || data === "\u0003") {
                  done(undefined);
                  return;
                }
                if (data === "f") panel.cycleOwner();
                else if (data === "a") panel.cycleAttention();
              },
            };
          }, {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              width: 60,
              minWidth: 32,
              maxHeight: "70%",
              margin: 1,
            },
          });
        } catch {
          context.ui.notify("Pull request inbox unavailable", "warning");
        }
      },
    });

    pi.on("session_shutdown", () => stop());

    pi.registerCommand("pr-refresh", {
      description: "Refresh pull request status",
      handler: async (_args, context) => {
        if (!active) {
          context.ui.notify("Pull request sidebar is not active", "warning");
          return;
        }
        active.context = context;
        const state = await refresh(active);
        if (!state) return;
        context.ui.notify(state.error ? "Pull request refresh incomplete" : "Pull requests refreshed", state.error ? "warning" : "info");
      },
    });

    pi.registerCommand("pr-sidebar", {
      description: "Show or hide the pull request sidebar",
      handler: async (_args, context) => {
        if (!active) {
          context.ui.notify("Pull request sidebar is not active", "warning");
          return;
        }
        active.visible = !active.visible;
        syncPresentation(active);
        context.ui.notify(`Pull request sidebar ${active.visible ? "shown" : "hidden"}`, "info");
      },
    });

    pi.registerCommand("pr-sidebar-collapse", {
      description: "Collapse or expand the pull request sidebar",
      handler: async (_args, context) => {
        if (!active?.panel) {
          context.ui.notify("Pull request sidebar is not active", "warning");
          return;
        }
        active.collapsed = !active.collapsed;
        active.panel.setCollapsed(active.collapsed);
        context.ui.notify(`Pull request sidebar ${active.collapsed ? "collapsed" : "expanded"}`, "info");
      },
    });

    pi.registerCommand("pr-focus", {
      description: "Open the current pull request inspector",
      handler: async (_args, context) => {
        const state = active?.state;
        const pullRequest = selectPullRequest(state);
        if (!active || !state?.repository || !pullRequest) {
          context.ui.notify("No pull request is available", "warning");
          return;
        }
        active.context = context;
        await openInspector(active, pullRequest, context);
      },
    });

    pi.registerCommand("pr-open", {
      description: "Open the current branch pull request in GitHub",
      handler: async (_args, context) => {
        const state = active?.state;
        const pullRequest = selectPullRequest(state);
        if (!active || !state?.repository || !pullRequest) {
          context.ui.notify("No pull request is available", "warning");
          return;
        }
        active.context = context;
        await openInGitHub(active, pullRequest, context);
      },
    });
  };
}

export default createPrSidebarExtension();
