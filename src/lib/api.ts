"use client";

import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";
import type { SessionSummary, ActiveProcess, TranscriptMessage } from "@/lib/server/sessions";
import type { Agent } from "@/lib/server/agents";
import type { Task, Template } from "@/lib/server/tasks";
import type { Run } from "@/lib/server/runs";
import type { ProjectListItem } from "@/lib/server/projects";

export type { SessionSummary, ActiveProcess, TranscriptMessage, Agent, Task, Template, Run, ProjectListItem };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const fetcher = <T,>(url: string) => fetch(url, { credentials: "same-origin" }).then((r) => handle<T>(r));

export async function api<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res);
}

export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(url, fetcher, { revalidateOnFocus: true, ...config });
}

/** Revalidate every cached key that starts with one of the prefixes. */
export function refresh(...prefixes: string[]) {
  return globalMutate((key) => typeof key === "string" && prefixes.some((p) => key.startsWith(p)));
}

export interface ProjectInfo extends ProjectListItem {
  git: {
    branch: string | null;
    lastCommit: { hash: string; subject: string; author: string; date: string } | null;
    changes: number;
    changedFiles: { status: string; file: string }[];
    remotes: string[];
    commitCount: number;
    recentCommits: { hash: string; subject: string; author: string; date: string }[];
  } | null;
  claudeMd: string | null;
  readme: string | null;
  scripts: Record<string, string>;
  package?: { name?: string; version?: string; dependencies: number } | null;
  stack: string[];
  files: string[];
}

export interface Transcript extends SessionSummary {
  messages: TranscriptMessage[];
  totalMessages: number;
  truncated: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  tools: Record<string, number>;
}

export interface Overview {
  activeProcesses: ActiveProcess[];
  counts: {
    sessions: number;
    activeSessions: number;
    sessionsToday: number;
    runningRuns: number;
    tasks: number;
    openTasks: number;
    projects: number;
    costUsd: number;
  };
  tasksByStatus: Record<string, number>;
  recentSessions: SessionSummary[];
  recentRuns: Run[];
}

export interface SystemInfo {
  dataDir: string;
  claudeHome: string;
  claudeBin: string;
  claudeVersion: string | null;
  tmux: boolean;
  maxConcurrentRuns: number;
  node: string;
  platform: string;
}

export interface RunLog {
  events: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  nextOffset: number;
  status: Run["status"];
  run: Run;
}
