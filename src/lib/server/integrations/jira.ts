import { z } from "zod";
import type { Task, TaskService } from "../tasks";
import { absPath, HttpError, parse, text } from "../util";
import type { IntegrationService } from "./service";

const KEY_RE = /^[A-Z][A-Z0-9_]{0,30}-\d{1,9}$/;
export const jiraKey = (k: string) => {
  if (!KEY_RE.test(k)) throw new HttpError(400, "Clave de incidencia no válida");
  return k;
};

type Adf = { type?: string; text?: string; content?: Adf[]; attrs?: Record<string, unknown> };

/** Atlassian Document Format → readable plain text (never HTML). */
export function adfToText(node: unknown, depth = 0): string {
  if (!node || typeof node !== "object" || depth > 50) return typeof node === "string" ? node : "";
  const n = node as Adf;
  const kids = (sep = "") => (n.content ?? []).map((c) => adfToText(c, depth + 1)).join(sep);
  switch (n.type) {
    case "text":
      return n.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
      return String(n.attrs?.text ?? "@?");
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    case "inlineCard":
    case "blockCard":
      return String(n.attrs?.url ?? "");
    case "paragraph":
    case "heading":
      return kids() + "\n\n";
    case "codeBlock":
      return "```\n" + kids() + "\n```\n\n";
    case "blockquote":
      return kids().split("\n").map((l) => (l ? `> ${l}` : l)).join("\n");
    case "bulletList":
      return (n.content ?? []).map((li) => `- ${adfToText(li, depth + 1).trim()}`).join("\n") + "\n\n";
    case "orderedList":
      return (n.content ?? []).map((li, i) => `${i + 1}. ${adfToText(li, depth + 1).trim()}`).join("\n") + "\n\n";
    case "rule":
      return "---\n\n";
    default:
      return kids();
  }
}

/** Plain text → minimal ADF document (paragraphs + hard breaks). */
export function textToAdf(t: string) {
  return {
    type: "doc",
    version: 1,
    content: t
      .trim()
      .split(/\n{2,}/)
      .map((para) => ({
        type: "paragraph",
        content: para.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
      })),
  };
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  type: string | null;
  status: string;
  statusCategory: "new" | "indeterminate" | "done" | string;
  priority: string | null;
  assignee: string | null;
  updated: string | null;
  project: string | null;
  url: string;
  imported: string | null;
}

export interface JiraIssueDetail extends JiraIssueSummary {
  description: string;
  reporter: string | null;
  created: string | null;
  labels: string[];
  comments: { author: string; body: string; at: string | null }[];
  transitions: { id: string; name: string; to: string; category: string }[];
}

export const jiraSearchSchema = z.object({ jql: text(2000).trim().min(1), max: z.number().int().min(1).max(100).default(50) });
export const jiraCommentSchema = z.object({ body: text(30_000).trim().min(1) });
export const jiraTransitionSchema = z.object({ transitionId: z.string().regex(/^\d{1,10}$/) });
export const jiraImportSchema = z.object({ projectPath: absPath.nullable().optional() });

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIELDS = ["summary", "status", "priority", "issuetype", "assignee", "updated", "project"];

export class JiraService {
  constructor(
    private integrations: IntegrationService,
    private tasks: TaskService,
  ) {}

  private site() {
    return this.integrations.jiraSite();
  }

  private importedTask(key: string): string | null {
    return this.tasks.list().find((t) => t.external?.provider === "jira" && t.external.id === key)?.id ?? null;
  }

  private summary(i: J): JiraIssueSummary {
    const f = i.fields ?? {};
    const key = String(i.key);
    return {
      key,
      summary: String(f.summary ?? ""),
      type: f.issuetype?.name ?? null,
      status: String(f.status?.name ?? "?"),
      statusCategory: String(f.status?.statusCategory?.key ?? "new"),
      priority: f.priority?.name ?? null,
      assignee: f.assignee?.displayName ?? null,
      updated: f.updated ?? null,
      project: f.project?.key ?? null,
      url: `${this.site()}/browse/${encodeURIComponent(key)}`,
      imported: this.importedTask(key),
    };
  }

  async search(body: unknown): Promise<{ issues: JiraIssueSummary[] }> {
    const { jql, max } = parse(jiraSearchSchema, body);
    const r = await this.integrations.jira<{ issues?: J[] }>("/rest/api/3/search/jql", { method: "POST", body: { jql, maxResults: max, fields: FIELDS } });
    return { issues: (r.issues ?? []).map((i) => this.summary(i)) };
  }

  async detail(key: string): Promise<JiraIssueDetail> {
    const k = encodeURIComponent(jiraKey(key));
    const [issue, tr] = await Promise.all([
      this.integrations.jira<J>(`/rest/api/3/issue/${k}?fields=${[...FIELDS, "description", "reporter", "created", "labels", "comment"].join(",")}`),
      this.integrations.jira<{ transitions?: J[] }>(`/rest/api/3/issue/${k}/transitions`).catch(() => ({ transitions: [] })),
    ]);
    const f = issue.fields ?? {};
    return {
      ...this.summary(issue),
      description: adfToText(f.description).trim().slice(0, 50_000),
      reporter: f.reporter?.displayName ?? null,
      created: f.created ?? null,
      labels: Array.isArray(f.labels) ? f.labels.map(String).slice(0, 30) : [],
      comments: (f.comment?.comments ?? []).slice(-100).map((c: J) => ({ author: c.author?.displayName ?? "?", body: adfToText(c.body).trim(), at: c.created ?? null })),
      transitions: (tr.transitions ?? []).map((t) => ({ id: String(t.id), name: String(t.name), to: String(t.to?.name ?? ""), category: String(t.to?.statusCategory?.key ?? "") })),
    };
  }

  async comment(key: string, body: unknown) {
    const { body: b } = parse(jiraCommentSchema, body);
    await this.integrations.jira(`/rest/api/3/issue/${encodeURIComponent(jiraKey(key))}/comment`, { method: "POST", body: { body: textToAdf(b) } });
    return { ok: true };
  }

  async transition(key: string, body: unknown) {
    const { transitionId } = parse(jiraTransitionSchema, body);
    const k = encodeURIComponent(jiraKey(key));
    // Only transitions Jira currently offers for this issue are accepted.
    const tr = await this.integrations.jira<{ transitions?: J[] }>(`/rest/api/3/issue/${k}/transitions`);
    if (!(tr.transitions ?? []).some((t) => String(t.id) === transitionId)) throw new HttpError(409, "Esa transición ya no está disponible para la incidencia");
    await this.integrations.jira(`/rest/api/3/issue/${k}/transitions`, { method: "POST", body: { transition: { id: transitionId } } });
    return { ok: true };
  }

  /** Create (or return the existing) Agentic task linked to a Jira issue. */
  async importIssue(key: string, body: unknown): Promise<{ task: Task; created: boolean }> {
    const { projectPath } = parse(jiraImportSchema, body);
    const existing = this.importedTask(jiraKey(key));
    if (existing) return { task: this.tasks.get(existing), created: false };
    const d = await this.detail(key);
    const priority = /highest|blocker|critical/i.test(d.priority ?? "") ? "urgent" : /high/i.test(d.priority ?? "") ? "high" : /low/i.test(d.priority ?? "") ? "low" : "medium";
    const task = this.tasks.create(
      {
        title: `${d.key} ${d.summary}`.slice(0, 200),
        description: `${d.url}\n\n${d.description}`.slice(0, 20_000),
        labels: ["jira", ...d.labels].map((l) => l.slice(0, 40)).slice(0, 20),
        priority,
        projectPath: projectPath ?? null,
        status: "todo",
        prompt: `Resuelve la incidencia de Jira ${d.key} «${d.summary}» (${d.url}).\n\n${d.description}`.slice(0, 50_000),
      },
      { external: { provider: "jira", id: d.key, key: d.key, url: d.url } },
    );
    return { task, created: true };
  }
}
