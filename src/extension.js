import { collectPullRequests, executeFile } from "./github.js";
import { attachGentleShellRailPanel, createPullRequestPanel } from "./sidebar.js";

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
  const execute = dependencies.execute ?? executeFile;
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

    const stop = () => {
      const current = active;
      active = undefined;
      if (!current) return;
      if (current.timerId !== undefined) clearIntervalFn(current.timerId);
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
        });
        panel.setCollapsed(current.collapsed);
        if (active !== current) {
          done(undefined);
          return panel;
        }
        current.finish = () => done(undefined);
        current.panel = panel;
        current.rail = attachGentleShellRailPanel(tui, panel);
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

    pi.registerCommand("pr-open", {
      description: "Open the current branch pull request in GitHub",
      handler: async (_args, context) => {
        const state = active?.state;
        const pr = state?.pullRequests.find((item) => item.headBranch === state.branch) ?? state?.pullRequests[0];
        if (!state?.repository || !pr) {
          context.ui.notify("No pull request is available", "warning");
          return;
        }
        const result = await execute("gh", ["pr", "view", String(pr.number), "--repo", state.repository, "--web"], { cwd: context.cwd });
        if (result.exitCode !== 0) context.ui.notify("Could not open the pull request", "warning");
      },
    });
  };
}

export default createPrSidebarExtension();
