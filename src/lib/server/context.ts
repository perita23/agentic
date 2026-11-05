import { AgentManager } from "./agents";
import { hardenDataDir } from "./audit";
import { getConfig, type Config } from "./config";
import { queueMessage, runMessage } from "./integrations/messages";
import { ProjectService } from "./projects";
import { ReplyQueue } from "./reply-queue";
import { MailService, MAIL_STORES } from "./mail";
import { fetcher as mailFetcher, verify as mailVerify, bodyFetcher as mailBody, seenSetter as mailSeen } from "./mail-imap";
import { JiraService } from "./integrations/jira";
import { OAuthService } from "./integrations/oauth";
import { Installer } from "./install";
import { ChatService, chatDir } from "./chats";
import { McpService } from "./mcp";
import { PermissionService } from "./permissions";
import { worktreesRoot } from "./worktrees";
import { ScheduleService } from "./schedules";
import { BudgetService } from "./budgets";
import { BackupService } from "./backup";
import { CommandService } from "./commands";
import { LibraryService } from "./library";
import { PrefsService } from "./prefs";
import { ObsidianService } from "./obsidian";
import { ProfileService } from "./profile";
import { SessionTrash } from "./trash";
import pkg from "../../../package.json";
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
  mail: MailService;
  replies: ReplyQueue;
  queue: TaskQueue;
  integrations: IntegrationService;
  pulls: PullService;
  jira: JiraService;
  installer: Installer;
  chats: ChatService;
  mcp: McpService;
  permissions: PermissionService;
  schedules: ScheduleService;
  budgets: BudgetService;
  backups: BackupService;
  commands: CommandService;
  library: LibraryService;
  prefs: PrefsService;
  obsidian: ObsidianService;
  profile: ProfileService;
  trash: SessionTrash;
  oauth: OAuthService;
}

const g = globalThis as unknown as { __agentic?: Context };

export function createContext(config: Config): Context {
  // Credentials (integration tokens, OAuth secrets) are encrypted at rest.
  const store = new JsonStore(config.dataDir, new Set(["integrations", "oauth-apps", ...MAIL_STORES]));
  store.sealExisting();
  hardenDataDir(config.dataDir);
  const sessions = new SessionIndex(config.claudeHome);
  const tasks = new TaskService(store);
  const integrations = new IntegrationService(store, tasks);
  const obsidian = new ObsidianService(store);
  const runs = new RunManager(store, {
    dataDir: config.dataDir,
    obsidian: (cwd) => obsidian.forRun(cwd),
    claudeBin: config.claudeBin,
    maxConcurrent: config.maxConcurrentRuns,
    maxLogBytes: config.maxLogBytes,
    onFinished: (run) => {
      if (run.taskId) tasks.onRunFinished(run.taskId, run.status === "completed");
      // Late-bound: the queue is created right after the run manager.
      void queue.onRunFinished(run).catch((e) => console.error("[agentic] queue error", e));
      void replies.onRunFinished(run).catch((e) => console.error("[agentic] reply queue error", e));
      void integrations.notify("runFinished", runMessage(run), run.status !== "completed");
    },
  });
  const replies: ReplyQueue = new ReplyQueue(store, runs);
  const queue: TaskQueue = new TaskQueue(store, tasks, runs, (st) => {
    const ok = st.processed.filter((p) => p.status === "completed").length;
    void integrations.notify("queueFinished", queueMessage(st), ok < st.processed.length);
  });
  // The neutral chat folder and task worktrees are not projects.
  const projects = new ProjectService(store, sessions, [chatDir(config.dataDir), worktreesRoot(config.dataDir)]);
  const schedules = new ScheduleService(store, runs, (p) => projects.isKnown(p));
  const budgets = new BudgetService(store, runs, sessions, (msg, over) => integrations.notify("budget", msg, over));
  schedules.guard = queue.guard = () => budgets.assertAutomationAllowed();
  const mail = new MailService(store, () => projects.list().filter((x) => x.registered || x.sessionCount > 0).map((x) => ({ path: x.path, name: x.name })), mailFetcher, mailVerify, { body: mailBody, setSeen: mailSeen });
  if (process.env.NODE_ENV !== "test" && process.env.AGENTIC_MAIL_ROUTINE !== "0") mail.startRoutine();
  return {
    config,
    token: loadOrCreateToken(config.dataDir),
    store,
    sessions,
    agents: new AgentManager(config.claudeHome),
    tasks,
    mail,
    replies,
    runs,
    projects,
    pulls: new PullService(integrations, projects),
    jira: new JiraService(integrations, tasks),
    installer: new Installer(),
    chats: new ChatService(store, runs, sessions, config.dataDir),
    mcp: new McpService(config.claudeHome, config.claudeBin, projects),
    permissions: new PermissionService(config.claudeHome, projects),
    schedules,
    budgets,
    backups: new BackupService(store, config.dataDir, pkg.version),
    commands: new CommandService(config.claudeHome, projects),
    library: new LibraryService(sessions),
    prefs: new PrefsService(store),
    obsidian,
    profile: new ProfileService(store, config.dataDir),
    trash: new SessionTrash(config.dataDir, config.claudeHome, sessions),
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
    g.__agentic.budgets.start();
    startAutoBackups(g.__agentic);
    const stop = () => {
      g.__agentic?.schedules.stop();
      g.__agentic?.budgets.stop();
      g.__agentic?.runs.shutdown();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  return g.__agentic;
}

/** One automatic copy per day (checked at start and every 6 h). */
function startAutoBackups(c: Context) {
  const run = () => {
    try {
      c.backups.autoBackup();
    } catch (e) {
      console.warn("[agentic] automatic backup failed:", (e as Error).message);
    }
  };
  run();
  setInterval(run, 6 * 3600_000).unref();
}

/** Test helper. */
export function setContext(c: Context | undefined) {
  g.__agentic = c;
}
