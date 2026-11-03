import { AgentManager } from "./agents";
import { getConfig, type Config } from "./config";
import { ProjectService } from "./projects";
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
}

const g = globalThis as unknown as { __agentic?: Context };

export function createContext(config: Config): Context {
  const store = new JsonStore(config.dataDir);
  const sessions = new SessionIndex(config.claudeHome);
  const tasks = new TaskService(store);
  const runs = new RunManager(store, {
    dataDir: config.dataDir,
    claudeBin: config.claudeBin,
    maxConcurrent: config.maxConcurrentRuns,
    maxLogBytes: config.maxLogBytes,
    onFinished: (run) => {
      if (run.taskId) tasks.onRunFinished(run.taskId, run.status === "completed");
    },
  });
  return {
    config,
    token: loadOrCreateToken(config.dataDir),
    store,
    sessions,
    agents: new AgentManager(config.claudeHome),
    tasks,
    runs,
    projects: new ProjectService(store, sessions),
  };
}

/**
 * Process-wide singleton. Kept on globalThis so every route bundle (and hot
 * reloads in dev) share the same store cache and child-process registry.
 */
export function ctx(): Context {
  if (!g.__agentic) {
    g.__agentic = createContext(getConfig());
    const stop = () => g.__agentic?.runs.shutdown();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  return g.__agentic;
}

/** Test helper. */
export function setContext(c: Context | undefined) {
  g.__agentic = c;
}
