import { AgentManager } from "./agents";
import { hardenDataDir } from "./audit";
import { getConfig, type Config } from "./config";
import { queueMessage, runMessage } from "./integrations/messages";
import { ProjectService } from "./projects";
import { JiraService } from "./integrations/jira";
import { OAuthService } from "./integrations/oauth";
import { Installer } from "./install";
import { ChatService, chatDir } from "./chats";
import { McpService } from "./mcp";
import { PermissionService } from "./permissions";
import { worktreesRoot } from "./worktrees";
import { ScheduleService } from "./schedules";
import { PullService } from "./integrations/pulls";
import { IntegrationService } from "./integrations/service";
import { TaskQueue } from "./queue";
import { RunManager } from "./runs";
import { loadOrCreateToken } from "./security";
import { SessionIndex } from "./sessions";
import { JsonStore } from "./store";
import { TaskService } from "./tasks";

export interface Context {
  config: Config;
  token: string;
  store: JsonStore;
  sessions: SessionIndex;
  agents: AgentManager;
  tasks: TaskService;
  runs: RunManager;
  projects: ProjectService;
  queue: TaskQueue;
  integrations: IntegrationService;
  pulls: PullService;
  jira: JiraService;
  installer: Installer;
  chats: ChatService;
  mcp: McpService;
  permissions: PermissionService;
  schedules: ScheduleService;
  oauth: OAuthService;
}

const g = globalThis as unknown as { __agentic?: Context };

export function createContext(config: Config): Context {
  // Credentials (integration tokens, OAuth secrets) are encrypted at rest.
  const store = new JsonStore(config.dataDir, new Set(["integrations", "oauth-apps"]));
  store.sealExisting();
  hardenDataDir(config.dataDir);
  const sessions = new SessionIndex(config.claudeHome);
  const tasks = new TaskService(store);
  const integrations = new IntegrationService(store, tasks);
  const runs = new RunManager(store, {
    dataDir: config.dataDir,
    claudeBin: config.claudeBin,
    maxConcurrent: config.maxConcurrentRuns,
    maxLogBytes: config.maxLogBytes,
    onFinished: (run) => {
      if (run.taskId) tasks.onRunFinished(run.taskId, run.status === "completed");
      // Late-bound: the queue is created right after the run manager.
      void queue.onRunFinished(run).catch((e) => console.error("[agentic] queue error", e));
      void integrations.notify("runFinished", runMessage(run), run.status !== "completed");
    },
  });
  const queue: TaskQueue = new TaskQueue(store, tasks, runs, (st) => {
    const ok = st.processed.filter((p) => p.status === "completed").length;
    void integrations.notify("queueFinished", queueMessage(st), ok < st.processed.length);
  });
  // The neutral chat folder and task worktrees are not projects.
  const projects = new ProjectService(store, sessions, [chatDir(config.dataDir), worktreesRoot(config.dataDir)]);
  return {
    config,
    token: loadOrCreateToken(config.dataDir),
    store,
    sessions,
    agents: new AgentManager(config.claudeHome),
    tasks,
    runs,
    projects,
    pulls: new PullService(integrations, projects),
    jira: new JiraService(integrations, tasks),
    installer: new Installer(),
    chats: new ChatService(store, runs, sessions, config.dataDir),
    mcp: new McpService(config.claudeHome, config.claudeBin, projects),
    permissions: new PermissionService(config.claudeHome, projects),
    schedules: new ScheduleService(store, runs, (p) => projects.isKnown(p)),
    oauth: new OAuthService(store, integrations),
    queue,
    integrations,
  };
}

/**
 * Process-wide singleton. Kept on globalThis so every route bundle (and hot
 * reloads in dev) share the same store cache and child-process registry.
 */
export function ctx(): Context {
  if (!g.__agentic) {
    g.__agentic = createContext(getConfig());
    g.__agentic.schedules.start();
    const stop = () => {
      g.__agentic?.schedules.stop();
      g.__agentic?.runs.shutdown();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  return g.__agentic;
}

/** Test helper. */
export function setContext(c: Context | undefined) {
  g.__agentic = c;
}
