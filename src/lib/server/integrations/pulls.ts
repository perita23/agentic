import { z } from "zod";
import { git } from "../git";
import type { ProjectService } from "../projects";
import { HttpError, parse, text } from "../util";
import type { IntegrationError } from "./http";
import { parseRemote, type IntegrationService } from "./service";

export type PrProvider = "github" | "bitbucket";

export interface PullSummary {
  provider: PrProvider;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string | null;
  state: string;
  draft: boolean;
  branch: string | null;
  base: string | null;
  updatedAt: string | null;
  url: string;
  projectPath: string;
  comments: number | null;
}

export interface PullDetail extends PullSummary {
  body: string;
  headSha: string | null;
  mergeable: boolean | null;
  mergeState: string | null;
  checks: { name: string; status: "success" | "failure" | "pending" | "neutral"; url: string | null }[];
  reviews: { author: string; state: string; body: string; at: string | null }[];
  comments_: { author: string; body: string; at: string | null; path?: string | null }[];
  files: { file: string; status: string; additions: number | null; deletions: number | null; patch: string | null }[];
  canMerge: boolean;
}

const SLUG = /^[A-Za-z0-9_.-]{1,100}$/;

/** Split a multi-file unified diff into per-file bodies keyed by the new path. */
export function splitUnifiedDiff(diff: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (key) out.set(key, buf.join("\n"));
  };
  for (const line of diff.split("\n")) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      flush();
      key = m[2];
      buf = [];
    } else if (key) buf.push(line);
  }
  flush();
  return out;
}

export const prActionSchemas = {
  comment: z.object({ body: text(65_000).trim().min(1) }),
  review: z.object({ event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]), body: text(65_000).default("") }),
  merge: z.object({ method: z.enum(["merge", "squash", "rebase"]).default("squash"), expectedHeadSha: z.string().regex(/^[0-9a-f]{7,64}$/) }),
};

type Gh = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const checkState = (s: string | null | undefined): PullDetail["checks"][number]["status"] => {
  const v = (s ?? "").toLowerCase();
  if (["success", "successful"].includes(v)) return "success";
  if (["failure", "failed", "error", "timed_out", "cancelled", "action_required", "stopped"].includes(v)) return "failure";
  if (["neutral", "skipped"].includes(v)) return "neutral";
  return "pending";
};

/** Pull requests from GitHub and Bitbucket, normalised to one shape. */
export class PullService {
  constructor(
    private integrations: IntegrationService,
    private projects: ProjectService,
  ) {}

  /** Repositories of known projects, by provider, from their `origin` remotes. */
  async repos(): Promise<{ provider: PrProvider; owner: string; repo: string; projectPath: string }[]> {
    const st = this.integrations.status() as Record<string, { configured: boolean }>;
    const out: { provider: PrProvider; owner: string; repo: string; projectPath: string }[] = [];
    const seen = new Set<string>();
    const projects = this.projects.list().filter((p) => p.exists).slice(0, 50);
    const ghHost = st.github?.configured ? this.integrations.githubHost() : null;
    await Promise.all(
      projects.map(async (p) => {
        const remote = (await git(p.path, ["remote", "get-url", "origin"]))?.trim();
        if (!remote) return;
        const candidates: [PrProvider, string | null][] = [
          ["github", ghHost],
          ["bitbucket", st.bitbucket?.configured ? "bitbucket.org" : null],
        ];
        for (const [provider, host] of candidates) {
          if (!host) continue;
          const r = parseRemote(remote, host);
          const key = `${provider}:${r?.owner}/${r?.repo}`.toLowerCase();
          if (r && !seen.has(key)) {
            seen.add(key);
            out.push({ provider, ...r, projectPath: p.path });
          }
        }
      }),
    );
    return out;
  }

  private async resolve(provider: string, owner: string, repo: string) {
    if (provider !== "github" && provider !== "bitbucket") throw new HttpError(404, "Proveedor no soportado");
    if (!SLUG.test(owner) || !SLUG.test(repo)) throw new HttpError(400, "Repositorio no válido");
    // Only operate on repositories that belong to a project known to Agentic.
    const r = (await this.repos()).find((x) => x.provider === provider && x.owner.toLowerCase() === owner.toLowerCase() && x.repo.toLowerCase() === repo.toLowerCase());
    if (!r) throw new HttpError(404, "Repositorio no asociado a ningún proyecto de Agentic");
    return r;
  }

  /** Repository (and provider) behind a project, for creating PRs from it. */
  async repoFor(projectPath: string) {
    const r = (await this.repos()).find((x) => x.projectPath === projectPath);
    if (!r) throw new HttpError(400, "Conecta GitHub o Bitbucket (Integraciones) y comprueba que el proyecto tiene un remoto «origin» de ese servicio");
    return r;
  }

  /** Open a pull request from `head` into `base`. */
  async create(projectPath: string, input: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<{ provider: PrProvider; number: number; url: string }> {
    const r = await this.repoFor(projectPath);
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    if (r.provider === "github") {
      const p = await this.integrations.gh<Gh>(`/repos/${slug}/pulls`, { method: "POST", body: { title: input.title, head: input.head, base: input.base, body: input.body, draft: input.draft } });
      return { provider: "github", number: p.number, url: p.html_url };
    }
    const p = await this.integrations.bb<Gh>(`/repositories/${slug}/pullrequests`, {
      method: "POST",
      body: { title: input.title, description: input.body, source: { branch: { name: input.head } }, destination: { branch: { name: input.base } }, draft: input.draft },
    });
    return { provider: "bitbucket", number: p.id, url: p.links?.html?.href ?? "" };
  }

  async inbox(): Promise<{ items: PullSummary[]; errors: { repo: string; error: string }[] }> {
    const repos = await this.repos();
    const items: PullSummary[] = [];
    const errors: { repo: string; error: string }[] = [];
    await Promise.all(
      repos.map(async (r) => {
        try {
          items.push(...(r.provider === "github" ? await this.ghList(r) : await this.bbList(r)));
        } catch (e) {
          errors.push({ repo: `${r.owner}/${r.repo}`, error: (e as Error).message });
        }
      }),
    );
    items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return { items, errors };
  }

  async detail(provider: string, owner: string, repo: string, number: number): Promise<PullDetail> {
    const r = await this.resolve(provider, owner, repo);
    if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Número de PR no válido");
    return r.provider === "github" ? this.ghDetail(r, number) : this.bbDetail(r, number);
  }

  async action(provider: string, owner: string, repo: string, number: number, action: string, body: unknown) {
    const r = await this.resolve(provider, owner, repo);
    if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "Número de PR no válido");
    const gh = r.provider === "github";
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const i = this.integrations;
    switch (action) {
      case "comment": {
        const { body: b } = parse(prActionSchemas.comment, body);
        if (gh) await i.gh(`/repos/${slug}/issues/${number}/comments`, { method: "POST", body: { body: b } });
        else await i.bb(`/repositories/${slug}/pullrequests/${number}/comments`, { method: "POST", body: { content: { raw: b } } });
        return { ok: true };
      }
      case "review": {
        const { event, body: b } = parse(prActionSchemas.review, body);
        if (gh) {
          if (event !== "APPROVE" && !b.trim()) throw new HttpError(400, "Escribe un comentario para esta review");
          await i.gh(`/repos/${slug}/pulls/${number}/reviews`, { method: "POST", body: { event, body: b } });
        } else {
          if (b.trim()) await i.bb(`/repositories/${slug}/pullrequests/${number}/comments`, { method: "POST", body: { content: { raw: b } } });
          if (event === "APPROVE") await i.bb(`/repositories/${slug}/pullrequests/${number}/approve`, { method: "POST" });
          if (event === "REQUEST_CHANGES") await i.bb(`/repositories/${slug}/pullrequests/${number}/request-changes`, { method: "POST" });
        }
        return { ok: true };
      }
      case "merge": {
        const { method, expectedHeadSha } = parse(prActionSchemas.merge, body);
        if (gh) {
          // GitHub refuses the merge if the head moved since the user looked at it.
          try {
            await i.gh(`/repos/${slug}/pulls/${number}/merge`, { method: "PUT", body: { merge_method: method, sha: expectedHeadSha } });
          } catch (e) {
            const st = (e as IntegrationError).upstreamStatus;
            if (st === 409) throw new HttpError(409, "La PR ha cambiado desde que la abriste; recarga antes de mergear");
            if (st === 405) throw new HttpError(409, "GitHub no permite mergear esta PR ahora (checks requeridos, reviews o protección de rama)");
            throw e;
          }
        } else {
          const pr = await i.bb<Gh>(`/repositories/${slug}/pullrequests/${number}`);
          const head = String(pr.source?.commit?.hash ?? "");
          if (!head || !(head.startsWith(expectedHeadSha) || expectedHeadSha.startsWith(head)))
            throw new HttpError(409, "La PR ha cambiado desde que la abriste; recarga antes de mergear");
          const strategy = { merge: "merge_commit", squash: "squash", rebase: "fast_forward" }[method];
          await i.bb(`/repositories/${slug}/pullrequests/${number}/merge`, { method: "POST", body: { type: "pullrequest", merge_strategy: strategy } });
        }
        return { ok: true };
      }
      case "close": {
        if (gh) await i.gh(`/repos/${slug}/pulls/${number}`, { method: "PATCH", body: { state: "closed" } });
        else await i.bb(`/repositories/${slug}/pullrequests/${number}/decline`, { method: "POST" });
        return { ok: true };
      }
      default:
        throw new HttpError(404, "Acción desconocida");
    }
  }

  // ---------- GitHub ----------

  private ghSummary(r: { owner: string; repo: string; projectPath: string }, p: Gh): PullSummary {
    return {
      provider: "github",
      owner: r.owner,
      repo: r.repo,
      number: p.number,
      title: String(p.title ?? ""),
      author: p.user?.login ?? null,
      state: p.merged_at ? "merged" : String(p.state ?? "open"),
      draft: !!p.draft,
      branch: p.head?.ref ?? null,
      base: p.base?.ref ?? null,
      updatedAt: p.updated_at ?? null,
      url: String(p.html_url ?? ""),
      projectPath: r.projectPath,
      comments: typeof p.comments === "number" ? p.comments : null,
    };
  }

  private async ghList(r: { owner: string; repo: string; projectPath: string }) {
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const rows = await this.integrations.gh<Gh[]>(`/repos/${slug}/pulls?state=open&per_page=50`);
    return rows.map((p) => this.ghSummary(r, p));
  }

  private async ghDetail(r: { owner: string; repo: string; projectPath: string }, n: number): Promise<PullDetail> {
    const i = this.integrations;
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const pr = await i.gh<Gh>(`/repos/${slug}/pulls/${n}`);
    const sha = pr.head?.sha as string | undefined;
    const [files, reviews, comments, runs, status] = await Promise.all([
      i.gh<Gh[]>(`/repos/${slug}/pulls/${n}/files?per_page=100`).catch(() => []),
      i.gh<Gh[]>(`/repos/${slug}/pulls/${n}/reviews?per_page=100`).catch(() => []),
      i.gh<Gh[]>(`/repos/${slug}/issues/${n}/comments?per_page=100`).catch(() => []),
      sha ? i.gh<Gh>(`/repos/${slug}/commits/${sha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] })) : { check_runs: [] },
      sha ? i.gh<Gh>(`/repos/${slug}/commits/${sha}/status`).catch(() => ({ statuses: [] })) : { statuses: [] },
    ]);
    const checks: PullDetail["checks"] = [
      ...(runs.check_runs ?? []).map((c: Gh) => ({ name: String(c.name), status: c.status !== "completed" ? "pending" : checkState(c.conclusion), url: c.html_url ?? null })),
      ...(status.statuses ?? []).map((s: Gh) => ({ name: String(s.context), status: checkState(s.state), url: s.target_url ?? null })),
    ];
    return {
      ...this.ghSummary(r, pr),
      body: String(pr.body ?? ""),
      headSha: sha ?? null,
      mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null,
      mergeState: pr.mergeable_state ?? null,
      checks,
      reviews: reviews
        .filter((x) => x.state !== "PENDING")
        .map((x) => ({ author: x.user?.login ?? "?", state: String(x.state), body: String(x.body ?? ""), at: x.submitted_at ?? null })),
      comments_: comments.map((c) => ({ author: c.user?.login ?? "?", body: String(c.body ?? ""), at: c.created_at ?? null })),
      files: files.map((f) => ({
        file: String(f.filename),
        status: String(f.status),
        additions: f.additions ?? null,
        deletions: f.deletions ?? null,
        patch: typeof f.patch === "string" ? f.patch.slice(0, 200_000) : null,
      })),
      canMerge: pr.state === "open" && !pr.merged && pr.mergeable !== false && !pr.draft,
    };
  }

  // ---------- Bitbucket ----------

  private bbSummary(r: { owner: string; repo: string; projectPath: string }, p: Gh): PullSummary {
    return {
      provider: "bitbucket",
      owner: r.owner,
      repo: r.repo,
      number: p.id,
      title: String(p.title ?? ""),
      author: p.author?.display_name ?? p.author?.nickname ?? null,
      state: String(p.state ?? "OPEN").toLowerCase(),
      draft: !!p.draft,
      branch: p.source?.branch?.name ?? null,
      base: p.destination?.branch?.name ?? null,
      updatedAt: p.updated_on ?? null,
      url: String(p.links?.html?.href ?? ""),
      projectPath: r.projectPath,
      comments: typeof p.comment_count === "number" ? p.comment_count : null,
    };
  }

  private async bbList(r: { owner: string; repo: string; projectPath: string }) {
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const res = await this.integrations.bb<{ values: Gh[] }>(`/repositories/${slug}/pullrequests?state=OPEN&pagelen=50`);
    return (res.values ?? []).map((p) => this.bbSummary(r, p));
  }

  private async bbDetail(r: { owner: string; repo: string; projectPath: string }, n: number): Promise<PullDetail> {
    const i = this.integrations;
    const slug = `${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`;
    const pr = await i.bb<Gh>(`/repositories/${slug}/pullrequests/${n}`);
    const [diffstat, comments, statuses, diff] = await Promise.all([
      i.bb<{ values: Gh[] }>(`/repositories/${slug}/pullrequests/${n}/diffstat?pagelen=100`).catch(() => ({ values: [] })),
      i.bb<{ values: Gh[] }>(`/repositories/${slug}/pullrequests/${n}/comments?pagelen=100`).catch(() => ({ values: [] })),
      i.bb<{ values: Gh[] }>(`/repositories/${slug}/pullrequests/${n}/statuses?pagelen=50`).catch(() => ({ values: [] })),
      i.bb<string>(`/repositories/${slug}/pullrequests/${n}/diff`).catch(() => ""),
    ]);
    const patches = splitUnifiedDiff(typeof diff === "string" ? diff : "");
    return {
      ...this.bbSummary(r, pr),
      body: String(pr.description ?? pr.summary?.raw ?? ""),
      headSha: pr.source?.commit?.hash ?? null,
      mergeable: null,
      mergeState: null,
      checks: (statuses.values ?? []).map((s) => ({ name: String(s.name ?? s.key), status: checkState(s.state), url: s.url ?? null })),
      reviews: (pr.participants ?? [])
        .filter((p: Gh) => p.approved || p.state)
        .map((p: Gh) => ({ author: p.user?.display_name ?? "?", state: p.approved ? "APPROVED" : String(p.state).toUpperCase(), body: "", at: p.participated_on ?? null })),
      comments_: (comments.values ?? [])
        .filter((c) => !c.deleted)
        .map((c) => ({ author: c.user?.display_name ?? "?", body: String(c.content?.raw ?? ""), at: c.created_on ?? null, path: c.inline?.path ?? null })),
      files: (diffstat.values ?? []).map((f) => {
        const file = String(f.new?.path ?? f.old?.path ?? "");
        return { file, status: String(f.status), additions: f.lines_added ?? null, deletions: f.lines_removed ?? null, patch: patches.get(file)?.slice(0, 200_000) ?? null };
      }),
      canMerge: String(pr.state).toUpperCase() === "OPEN" && !pr.draft,
    };
  }
}
